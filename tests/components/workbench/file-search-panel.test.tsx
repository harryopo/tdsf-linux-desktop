// @vitest-environment jsdom
/**
 * tests/components/workbench/file-search-panel.test.tsx — 远程文件搜索这一格（#213）
 *
 * 病根与 #212 同一类：`sftp:search` / `sftp:grep` 在主进程是真实现
 * （SSH exec 跑 find / grep，输入走单引号转义，3 秒超时，结果条数有上限），
 * preload 也暴露了，唯独渲染层零调用——资源管理器只有列表、上传下载、改名、删除，
 * 想在服务器上"找那个配置文件"只能回终端敲 find。
 *
 * 这一格把它接成看得见的功能，并且把两件容易做假的事做实：
 * - 内容命中带行号，点下去必须真的跳到那一行（`onOpenFile` 要收到 line）；
 *   只把行号显示出来却跳不过去，就是假 affordance。
 * - 主进程的结果条数有上限（find 50 / grep 100）。到顶了要明说"可能不全"，
 *   不许把 50 条当"全部结果"报给用户。
 *
 * 判据各钉一件事：
 * 1. 没连上会话时不装忙：说清没连上 + 输入框禁用
 * 2. 按文件名搜：调 sftpSearch 并带上会话与当前树根；点结果打开文件（不带行号）
 * 3. 按内容搜：调 sftpGrep 带 pattern 与四个开关；点结果打开文件**并带上那一行**
 * 4. 到上限要说"可能不全"，没到上限不许说
 * 5. 失败说原因、空结果说没有匹配，两者不许同形
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FileSearchPanel } from '@/components/workbench/FileSearchPanel'

function fileEntry(path: string, name: string) {
  return { path, name, size: 0, mtime: 0 }
}

function installApi(over: Record<string, unknown> = {}): Record<string, unknown> {
  const api = {
    sftpSearch: vi.fn(async () => ({ files: [fileEntry('/etc/nginx/nginx.conf', 'nginx.conf')] })),
    sftpGrep: vi.fn(async () => ({
      results: [{ file: '/var/log/syslog', line: 42, text: 'kernel: oops', match: 'oops' }],
    })),
    ...over,
  }
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api })
  return api
}

function submit(query: string): void {
  fireEvent.change(screen.getByRole('textbox', { name: /搜索远程文件/ }), { target: { value: query } })
  fireEvent.click(screen.getByRole('button', { name: /搜索/ }))
}

describe('FileSearchPanel — 远程文件搜索这一格', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1. 没连上服务器时说不连，输入框禁用', () => {
    installApi()
    render(<FileSearchPanel sessionId={null} rootPath="/" onOpenFile={vi.fn()} />)

    expect(screen.getByText(/没连上服务器/)).toBeTruthy()
    expect((screen.getByRole('textbox', { name: /搜索远程文件/ }) as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByText(/nginx\.conf/)).toBeNull()
  })

  it('2. 按文件名搜：调 sftpSearch 带会话与树根，点结果打开文件且不带行号', async () => {
    const api = installApi()
    const onOpenFile = vi.fn()
    render(<FileSearchPanel sessionId="s1" rootPath="/etc" onOpenFile={onOpenFile} />)

    submit('nginx')
    await waitFor(() => expect(api.sftpSearch).toHaveBeenCalledWith('s1', '/etc', 'nginx'))
    expect(await screen.findByText('nginx.conf')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /nginx\.conf/ }))
    expect(onOpenFile).toHaveBeenCalledWith({
      path: '/etc/nginx/nginx.conf',
      name: 'nginx.conf',
    })
  })

  it('3. 按内容搜：调 sftpGrep 带 pattern 与四个开关，点结果必须带上那一行', async () => {
    const api = installApi()
    const onOpenFile = vi.fn()
    render(<FileSearchPanel sessionId="s1" rootPath="/var/log" onOpenFile={onOpenFile} />)

    fireEvent.click(screen.getByRole('radio', { name: /内容/ }))
    submit('oops')
    await waitFor(() =>
      expect(api.sftpGrep).toHaveBeenCalledWith({
        sessionId: 's1',
        path: '/var/log',
        pattern: 'oops',
        isRegex: false,
        caseSensitive: false,
        wholeWord: false,
      })
    )
    expect(await screen.findByText(/syslog/)).toBeTruthy()
    expect(screen.getByText(/42/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /syslog/ }))
    expect(onOpenFile).toHaveBeenCalledWith({
      path: '/var/log/syslog',
      name: 'syslog',
      line: 42,
    })
  })

  it('4. 到上限要说"可能不全"，没到上限不许说', async () => {
    const many = Array.from({ length: 50 }, (_, i) => fileEntry(`/etc/f${i}`, `f${i}`))
    installApi({ sftpSearch: vi.fn(async () => ({ files: many, truncated: true })) })
    const { unmount } = render(
      <FileSearchPanel sessionId="s1" rootPath="/etc" onOpenFile={vi.fn()} />
    )
    submit('f')
    expect(await screen.findByText(/可能不全/)).toBeTruthy()
    unmount()

    installApi({ sftpSearch: vi.fn(async () => ({ files: [fileEntry('/etc/a', 'a')], truncated: false })) })
    render(<FileSearchPanel sessionId="s1" rootPath="/etc" onOpenFile={vi.fn()} />)
    submit('a')
    await screen.findByText('a')
    expect(screen.queryByText(/可能不全/)).toBeNull()
  })

  it('5. 失败说原因、空结果说没有匹配，两者不许同形', async () => {
    installApi({ sftpSearch: vi.fn(async () => ({ ok: false, files: [], error: '会话已关闭' })) })
    const { unmount } = render(
      <FileSearchPanel sessionId="s1" rootPath="/etc" onOpenFile={vi.fn()} />
    )
    submit('x')
    expect(await screen.findByText(/会话已关闭/)).toBeTruthy()
    expect(screen.queryByText(/没有匹配/)).toBeNull()
    unmount()

    installApi({ sftpSearch: vi.fn(async () => ({ files: [], truncated: false })) })
    render(<FileSearchPanel sessionId="s1" rootPath="/etc" onOpenFile={vi.fn()} />)
    submit('x')
    expect(await screen.findByText(/没有匹配/)).toBeTruthy()
  })
})
