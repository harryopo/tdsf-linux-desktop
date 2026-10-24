/**
 * 远程搜索这一格的形状与诚实性（#213）
 *
 * `sftp:search` / `sftp:grep` 在渲染层零调用有两年了：实现是真的（SSH exec 跑 find/grep、
 * 输入走单引号转义、3 秒超时、条数有上限），preload 也暴露了，就是没人在界面上按。
 * 现在资源管理器多一格搜索（`src/renderer/src/components/workbench/FileSearchPanel.tsx`），
 * 这批判据盯的是"接上之后别又变成假功能"：
 *
 * 1. 超时不是"没有结果"——必须带 ok:false 与原因，界面才敢说"搜索没做成"而不是"没找到"
 * 2. 命令末尾是 `| head -50` / `| head -100`：到顶要报 truncated，界面才有依据说"可能不全"
 * 3. 渲染层真有调用点（把这一格拆掉，刻度会红，这条是它的另一半）
 *
 * 打的是真 handler：electron 与 SshConnectionManager 都换成替身，
 * 断的是注册进 ipcMain 的那个函数本身，不是它的注释。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'node:path'
import { listSourceFiles, readSourceFile } from '../helpers/source-scan'

const ROOT = path.resolve(__dirname, '../..')

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => Promise<unknown>>())
const exec = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn)
    },
  },
}))

vi.mock('../../src/main/services/ssh/connection-manager', () => ({
  SshConnectionManager: {
    getInstance: () => ({ exec }),
  },
}))

import { registerSftpSearchIpcHandlers } from '../../src/main/ipc/sftp-search'

registerSftpSearchIpcHandlers()

function okResult(stdout: string) {
  return { exitCode: 0, stdout, stderr: '', duration: 10 }
}

describe('远程搜索的形状（#213）', () => {
  beforeEach(() => {
    exec.mockReset()
  })

  it('注册的是 search 与 grep 两条通道', () => {
    expect([...handlers.keys()].sort()).toEqual(['sftp:grep', 'sftp:search'])
  })

  it('超时不报成"没有结果"：必须带 ok:false 与一句原因', async () => {
    // withTimeout 的兜底是 stderr='timeout' 且 stdout 空——这正是最容易演成"0 条 = 没找到"的地方
    vi.useFakeTimers()
    exec.mockReturnValue(new Promise(() => {}))
    const p = handlers.get('sftp:search')!({}, 's1', '/var', 'log')
    await vi.advanceTimersByTimeAsync(3_100)
    const r = (await p) as { ok?: boolean; files: unknown[]; error?: string }
    vi.useRealTimers()
    expect(r.ok, '超时被当成一次成功的空结果返回了').toBe(false)
    expect(r.error).toContain('超时')
    expect(r.files).toEqual([])
  })

  it('find 正常返回：条数没到上限时不许报 truncated', async () => {
    exec.mockResolvedValue(okResult('/etc/nginx/nginx.conf\n'))
    const r = (await handlers.get('sftp:search')!({}, 's1', '/etc', 'nginx')) as {
      files: Array<{ path: string; name: string }>
      truncated?: boolean
    }
    expect(r.files).toEqual([
      { path: '/etc/nginx/nginx.conf', name: 'nginx.conf', size: 0, mtime: 0 },
    ])
    expect(r.truncated).toBe(false)
  })

  it('find 到 50 条要说 truncated：界面据此才能说"可能不全"', async () => {
    exec.mockResolvedValue(okResult(Array.from({ length: 50 }, (_, i) => `/etc/f${i}`).join('\n')))
    const r = (await handlers.get('sftp:search')!({}, 's1', '/etc', 'f')) as {
      files: unknown[]
      truncated?: boolean
    }
    expect(r.files).toHaveLength(50)
    expect(r.truncated).toBe(true)
  })

  it('grep 到 100 条同样要报 truncated', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `/var/log/a.log:${i + 1}:hit`).join('\n')
    exec.mockResolvedValue(okResult(lines))
    const r = (await handlers.get('sftp:grep')!({}, {
      sessionId: 's1',
      path: '/var/log',
      pattern: 'hit',
      isRegex: false,
      caseSensitive: false,
      wholeWord: false,
    })) as { results: Array<{ file: string; line: number }>; truncated?: boolean }
    expect(r.results).toHaveLength(100)
    expect(r.results[0]).toEqual({ file: '/var/log/a.log', line: 1, text: 'hit', match: 'hit' })
    expect(r.truncated).toBe(true)
  })

  it('渲染层真的有调用点（这两把键不再是没人按的出口）', () => {
    const hits: string[] = []
    for (const abs of listSourceFiles(path.join(ROOT, 'src/renderer'))) {
      const text = readSourceFile(abs)
      if (/electronAPI\.sftpSearch|electronAPI\.sftpGrep|api\.sftpSearch|api\.sftpGrep/.test(text)) {
        hits.push(path.relative(ROOT, abs).split(path.sep).join('/'))
      }
    }
    expect(hits, '界面里没有远程搜索的调用点').toEqual([
      'src/renderer/src/components/workbench/FileSearchPanel.tsx',
    ])
  })
})
