/**
 * 导出分析报告前脱敏（2026-10-21 全维度审查 A12）+ 落点归主进程（#212）
 *
 * profiler 的 md 来自远端命令输出（cat ~/.my.cnf、env、日志），导出文件会被分享。
 * 这里用假 IPC 环境接住 exportMd/exportPdf，断言落盘内容不含凭据、且仍带 [REDACTED]。
 *
 * #212 之后这两个 handler 收的不再是"渲染层给的路径"而是主机名：第三个参数即使写成
 * 一个绝对路径，落点也必须在主进程自己的 reports 目录里，不然这条判据就白留着了。
 */
import { describe, it, expect, vi } from 'vitest'
import * as path from 'node:path'

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())
const written = vi.hoisted(() => ({ md: '', pdf: '', mdPath: '', pdfPath: '' }))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    },
  },
  app: { getPath: () => '/tmp/tdsf-userdata' },
}))

vi.mock('../../src/main/services/profiler/pdf-exporter', () => ({
  writeMdFile: async (md: string, filePath: string) => {
    written.md = md
    written.mdPath = filePath
    return { filePath, size: md.length }
  },
  exportMarkdownToPdf: async (md: string, filePath: string) => {
    written.pdf = md
    written.pdfPath = filePath
    return { filePath, size: md.length }
  },
  defaultPdfFileName: (host: string) =>
    // 与真实现同形（pdf-exporter.ts 的 defaultPdfFileName 就这一步替换），
    // 否则这里断言的是替身自己的行为，不是生产的
    `system-report-${host.replace(/[\\/:*?"<>|]/g, '_')}-20261024-000000.pdf`,
}))

vi.mock('../../src/main/services/security/path-confinement', () => ({
  assertWithinConfinement: (p: string) => p,
}))

import { registerProfilerIpcHandlers } from '../../src/main/ipc/profiler'

// 拆成相邻字面量：整串会被密钥扫描闸当成真凭据（项目规矩，见 AGENTS.md）
const SECRET = ['Sup3r', 'Secret', 'Pw'].join('')

registerProfilerIpcHandlers()

async function call(channel: string, md: string, third: string): Promise<void> {
  const fn = handlers.get(channel)
  expect(fn, `没有注册 ${channel}`).toBeDefined()
  await fn!({}, md, third)
}

describe('profiler 导出脱敏', () => {
  it('exportMd 落盘前涂掉凭据', async () => {
    await call('profiler:exportMd', `# 报告\n\nmysql -uroot -p${SECRET}`, 'web01')
    expect(written.md).not.toContain(SECRET)
    expect(written.md).toContain('[REDACTED]')
  })

  it('exportPdf 同样先脱敏再渲染', async () => {
    await call('profiler:exportPdf', `# 报告\n\nPGPASSWORD=${SECRET} psql`, 'web01')
    expect(written.pdf).not.toContain(SECRET)
    expect(written.pdf).toContain('[REDACTED]')
  })

  it('第三个参数写成一个绝对路径也不会照它落盘：目的地由主进程定', async () => {
    await call('profiler:exportMd', '# 报告\n\n正文', '/tmp/evil.md')
    const mdPath = written.mdPath.replace(/\\/g, '/')
    expect(mdPath).not.toBe('/tmp/evil.md')
    expect(mdPath.startsWith('/tmp/tdsf-userdata/reports/'), `落点跑出主进程目录：${mdPath}`).toBe(true)
    // 主机名里的路径分隔符在定名时被换成 _，不许原样拼进去（拼进去就成了越层路径）
    expect(mdPath).toContain('system-report-_tmp_evil.md-')

    await call('profiler:exportPdf', '# 报告\n\n正文', '/tmp/evil.pdf')
    const pdfPath = written.pdfPath.replace(/\\/g, '/')
    expect(pdfPath).not.toBe('/tmp/evil.pdf')
    expect(pdfPath.startsWith('/tmp/tdsf-userdata/reports/'), `落点跑出主进程目录：${pdfPath}`).toBe(true)
    expect(pdfPath).toContain('system-report-_tmp_evil.pdf-')
  })

  it('主机名是一整行 uname 输出时，文件名里不留空格和 #', async () => {
    await call('profiler:exportMd', '# 报告\n\n正文', 'Linux fixture-vm 6.8.0-fixture #1 SMP x86_64')
    const name = path.basename(written.mdPath)
    expect(name).toBe('system-report-Linux_fixture-vm_6.8.0-fixture__1_SMP_x86_64-20261024-000000.md')
  })
})
