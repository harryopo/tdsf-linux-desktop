/**
 * 外部 MCP 服务器配置的写入口判据（任务 #173）
 *
 * 重点是"这台机器以后每次启动都会替你跑的那个程序"是怎么被登记下来的：
 * 换行、非 http(s) 的 URL、偷偷塞 env 值这三类必须当场挡住——
 * env 值一旦落盘就是明文配置里的密钥，而这一列以前是把整个 process.env
 * 交给第三方程序（见 tests/unit/mcp-child-env.test.ts）。
 */
import { describe, it, expect } from 'vitest'
import { MAX_EXTERNAL_SERVERS, newExternalServerId, validateDraft } from '@main/services/mcp/external-server-store'
import type { ExternalMcpServer, ExternalMcpServerDraft } from '@shared/models'

const draft = (over: Partial<ExternalMcpServerDraft> = {}): ExternalMcpServerDraft => ({
  name: '天气服务器',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', 'weather-mcp'],
  ...over,
})

const err = (over: Partial<ExternalMcpServerDraft> = {}): string => {
  const r = validateDraft(draft(over), [], 'mcp-1')
  if (r.ok) throw new Error(`这份草稿本该被拒，却通过了：${JSON.stringify(over)}`)
  return r.error
}

describe('外部 MCP 服务器登记', () => {
  it('正常的 stdio 配置能通过，并落成一个带 id 的服务器', () => {
    const r = validateDraft(draft(), [], 'mcp-1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.server).toMatchObject({ id: 'mcp-1', name: '天气服务器', command: 'npx', enabled: true })
  })

  it('命令里带换行直接拒（一条配置不能变成两条 shell 语义）', () => {
    expect(err({ command: 'npx\nrm -rf /' })).toContain('换行')
    expect(err({ cwd: 'C:\\tmp\nx' })).toContain('换行')
  })

  it('stdio 少了命令就拒，远程少了 URL 也拒', () => {
    expect(err({ command: '   ' })).toContain('可执行命令')
    expect(err({ transport: 'sse', url: '' })).toContain('URL')
  })

  it('URL 只认 http/https，其它协议在入口就拦', () => {
    for (const url of ['file:///C:/x', 'javascript:alert(1)', 'not a url', 'ftp://h/p']) {
      expect(err({ transport: 'streamable-http', url, command: undefined }), url).not.toBe('')
    }
    const ok = validateDraft(
      draft({ transport: 'streamable-http', url: 'https://h/p', command: undefined }),
      [],
      'mcp-2'
    )
    expect(ok.ok).toBe(true)
  })

  it('草稿里塞 env 值也带不进落库形状：读回来只有键名', () => {
    // 拆成相邻字面量拼：一整串 sk- 开头的形状会被 GitHub 密钥扫描当真警报，
    // 而它会向仓库所有者发邮件，事后删掉字面量警报也不会自动关。
    const SMUGGLED = 'sk-' + 'live-plaintext-not-a-real-key'
    // Object.assign 而不是类型转换：这里要测的正是"有人多带了一个属性"
    const withEnv = Object.assign(draft({ envKeys: ['PATH'] }), { env: { API_KEY: SMUGGLED } })
    const r = validateDraft(withEnv, [], 'mcp-3')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(JSON.stringify(r.server), '落库的服务器形状里出现了密钥值').not.toContain(SMUGGLED)
    expect(r.server.envKeys).toEqual(['PATH'])
  })

  it('非法环境变量名被拒（不给拼出奇怪的键）', () => {
    expect(err({ envKeys: ['BAD NAME'] })).toContain('不合法')
    expect(err({ envKeys: ['2START'] })).toContain('不合法')
    expect(err({ envKeys: ['a.b'] })).toContain('不合法')
  })

  it('名称必填、限长、且不能和已有服务器重名', () => {
    expect(err({ name: '' })).toContain('名称')
    expect(err({ name: 'x'.repeat(61) })).toContain('最长')
    const existing: ExternalMcpServer[] = [{ id: 'a', name: '天气服务器', transport: 'stdio', enabled: true }]
    expect(validateDraft(draft(), existing, 'mcp-4').ok).toBe(false)
  })

  it('超过上限就拒，别让人把配置页堆成看不出哪台在跑', () => {
    const full: ExternalMcpServer[] = Array.from({ length: MAX_EXTERNAL_SERVERS }, (_, i) => ({
      id: `mcp-${i}`,
      name: `s${i}`,
      transport: 'stdio',
      enabled: true,
    }))
    expect(full.length).toBe(MAX_EXTERNAL_SERVERS)
    const r = validateDraft(draft({ name: '再多一台' }), full, 'mcp-overflow')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain(String(MAX_EXTERNAL_SERVERS))
  })

  it('超时只收 1s 到 600s 之间的有限数', () => {
    expect(err({ timeoutMs: 500 })).toContain('超时')
    expect(err({ timeoutMs: 700_000 })).toContain('超时')
    expect(err({ timeoutMs: Number.NaN })).toContain('超时')
    const ok = validateDraft(draft({ timeoutMs: 45_000 }), [], 'mcp-5')
    expect(ok.ok && ok.server.timeoutMs).toBe(45_000)
  })

  it('生成的 id 与已有的不重，且不带用户输入', () => {
    const id = newExternalServerId([{ id: 'taken', name: 'x', transport: 'stdio', enabled: true }])
    expect(id).not.toBe('taken')
    expect(id.startsWith('mcp-')).toBe(true)
  })
})
