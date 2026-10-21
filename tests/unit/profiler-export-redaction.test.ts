/**
 * 导出分析报告前脱敏（2026-10-21 全维度审查 A12）
 *
 * profiler 的 md 来自远端命令输出（cat ~/.my.cnf、env、日志），导出文件会被分享。
 * 这里用假 IPC 环境接住 exportMd/exportPdf，断言落盘内容不含凭据、且仍带 [REDACTED]。
 */
import { describe, it, expect, vi } from 'vitest'

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())
const written = vi.hoisted(() => ({ md: '', pdf: '' }))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    },
  },
}))

vi.mock('../../src/main/services/profiler/pdf-exporter', () => ({
  writeMdFile: async (md: string) => {
    written.md = md
    return { filePath: '/tmp/x.md', size: md.length }
  },
  exportMarkdownToPdf: async (md: string) => {
    written.pdf = md
    return { filePath: '/tmp/x.pdf', size: md.length }
  },
  defaultPdfFileName: () => 'x.pdf',
}))

vi.mock('../../src/main/services/security/path-confinement', () => ({
  assertWithinConfinement: (p: string) => p,
}))

import { registerProfilerIpcHandlers } from '../../src/main/ipc/profiler'

// 拆成相邻字面量：整串会被密钥扫描闸当成真凭据（项目规矩，见 AGENTS.md）
const SECRET = ['Sup3r', 'Secret', 'Pw'].join('')

registerProfilerIpcHandlers()

async function call(channel: string, md: string): Promise<void> {
  const fn = handlers.get(channel)
  expect(fn, `没有注册 ${channel}`).toBeDefined()
  await fn!({}, md, '/tmp/report.out')
}

describe('profiler 导出脱敏', () => {
  it('exportMd 落盘前涂掉凭据', async () => {
    await call('profiler:exportMd', `# 报告\n\nmysql -uroot -p${SECRET}`)
    expect(written.md).not.toContain(SECRET)
    expect(written.md).toContain('[REDACTED]')
  })

  it('exportPdf 同样先脱敏再渲染', async () => {
    await call('profiler:exportPdf', `# 报告\n\nPGPASSWORD=${SECRET} psql`)
    expect(written.pdf).not.toContain(SECRET)
    expect(written.pdf).toContain('[REDACTED]')
  })
})
