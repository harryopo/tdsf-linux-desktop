/**
 * tests/unit/mcp-client-manager.test.ts — 外部 MCP Client 侧的连接纪律（#92 → #173）
 *
 * 为什么写这几条：
 * 1. 失败必须带 isError。以前"未注册/已禁用/连不上/调用抛错"都只把错误写进 text，
 *    标记位是空的 —— 网关于是把整条失败链报成 success:true，渲染层拿到的
 *    mcpExternalCall 结果永远"成功"。
 * 2. 只有 enabled:true 的配置才会进连接池（registerServers 的过滤条件）。
 *    这条以前没人守着，配置里写 enabled:false 的服务器一旦被注册进去，
 *    mcp:external-status 就会列出它。
 * 3. connect() 失败后必须 close()。SDK 在 connect() 第一行就把 transport 绑到
 *    client 上，超时放弃后晚到的连接会把 stdio 子进程留在后台没人收。
 * 4. 同一台同时只跑一次连接、同一份配置重推不踢活连接（5-8 条，#173 真机 e2e 逼出来的，
 *    下面那段的注释记着当时的现象）。
 *
 * 调研依据：2026-10-13 后端审查 #92（MCP 网关死路径与闸脱钩）
 * 判据引擎：node_modules/@modelcontextprotocol/sdk 的 Client / StdioClientTransport
 * 用替身顶掉，不真起子进程。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(),
  listTools: vi.fn(),
  callTool: vi.fn(),
  transportClose: vi.fn(),
}))

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(function () {
    return {
      connect: sdk.connect,
      close: sdk.close,
      listTools: sdk.listTools,
      callTool: sdk.callTool,
    }
  }),
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(function () {
    return { close: sdk.transportClose }
  }),
  // client-manager 现在从这个模块取"可安全继承的基础环境表"（child-env.ts），
  // 假模块必须把用到的导出都补上，否则测的就不是同一条路径。
  // 它到底传了什么给子进程由 tests/unit/mcp-child-env.test.ts 判，这里不重复判。
  getDefaultEnvironment: () => ({ PATH: '/usr/bin', HOME: '/root' }),
}))

import { McpClientManager } from '../../src/main/services/mcp/client-manager'
import type { ExternalMcpServer } from '../../src/shared/models'

/** 一条能过校验的 stdio 配置 */
function serverConfig(overrides: Partial<ExternalMcpServer> = {}): ExternalMcpServer {
  return {
    id: 'srv-demo',
    name: '示例外部服务器',
    transport: 'stdio',
    command: 'node',
    args: ['-e', ''],
    enabled: true,
    ...overrides,
  }
}

describe('McpClientManager：失败要能被识别，放弃的连接要收尾', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1. 调没注册过的服务器 → 返回体带 isError，不是"看起来成功的错误文本"', async () => {
    const r = await McpClientManager.getInstance().callTool('never-registered', 'x', {})
    expect(r.isError).toBe(true)
    expect(r.content[0]?.text).toContain('未注册')
  })

  it('2. 注册了但配置里 enabled:false → 不进连接池，调用同样带 isError', async () => {
    const mgr = McpClientManager.getInstance()
    mgr.registerServers([serverConfig({ id: 'srv-off', enabled: false })])
    expect(mgr.getStatuses().find((s) => s.id === 'srv-off')).toBeUndefined()

    const r = await mgr.callTool('srv-off', 'x', {})
    expect(r.isError).toBe(true)
  })

  it('3. enabled:true 的配置进池（正反两向都判，否则第 2 条只是空表里挑刺）', () => {
    const mgr = McpClientManager.getInstance()
    mgr.registerServers([serverConfig({ id: 'srv-on' }), serverConfig({ id: 'srv-off2', enabled: false })])
    const ids = mgr.getStatuses().map((s) => s.id)
    expect(ids).toContain('srv-on')
  })

  it('4. connect() 失败 → 调用带 isError，且对半途而废的 client 补一次 close（否则子进程成孤儿）', async () => {
    sdk.connect.mockRejectedValueOnce(new Error('连不上'))
    const mgr = McpClientManager.getInstance()
    mgr.registerServers([serverConfig({ id: 'srv-bad' })])

    const r = await mgr.callTool('srv-bad', 'x', {})
    expect(r.isError).toBe(true)
    expect(r.content[0]?.text).toContain('连不上')
    expect(sdk.close).toHaveBeenCalled()
    expect(mgr.getServerStatus('srv-bad')?.connectionState).toBe('error')
  })

  it('5. 连上之后调用成功 → 不带 isError（防止把上面几条改成一律 isError）', async () => {
    sdk.connect.mockResolvedValueOnce(undefined)
    sdk.listTools.mockResolvedValueOnce({ tools: [{ name: 'echo', description: 'd' }] })
    sdk.callTool.mockResolvedValueOnce({ content: [{ type: 'text', text: 'pong' }] })

    const mgr = McpClientManager.getInstance()
    mgr.registerServers([serverConfig({ id: 'srv-good' })])
    const r = await mgr.callTool('srv-good', 'echo', {})
    expect(r.isError).toBeUndefined()
    expect(r.content[0]?.text).toBe('pong')
  })

  /**
   * 6-8 是 2026-10-23 真机 e2e（tests/e2e/mcp-external-settings.spec.ts）逼出来的三条：
   * 添加第二台服务器时，登记面会把整份列表重推一遍，而界面上一次"读工具"和一次"调用"
   * 会几乎同时落到同一台没连上的服务器上。两条路当时都是坏的：
   * 并发那次直接报"无法连接"，重推那次把已经连上的连接踢回未连接且旧子进程没人收。
   */
  it('6. 一台正被第一个调用连着，第二个调用要等它，不许当场报"无法连接"', async () => {
    let settle: (() => void) | undefined
    sdk.connect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve
        })
    )
    sdk.listTools.mockResolvedValue({ tools: [{ name: 'echo', description: 'd' }] })
    sdk.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'pong' }] })

    const mgr = McpClientManager.getInstance()
    mgr.registerServers([serverConfig({ id: 'srv-race' })])
    const first = mgr.callTool('srv-race', 'echo', {})
    const second = mgr.callTool('srv-race', 'echo', {})
    settle?.()

    const [a, b] = await Promise.all([first, second])
    expect(a.isError, `第一个调用失败了：${a.content[0]?.text ?? ''}`).toBeUndefined()
    expect(b.isError, `第二个调用没等第一次连完：${b.content[0]?.text ?? ''}`).toBeUndefined()
    expect(sdk.connect, '两次调用各起了一次连接（同一台起了两个子进程）').toHaveBeenCalledTimes(1)
  })

  it('7. 同一份配置原样再推一遍 → 已连上的那条不动', async () => {
    sdk.connect.mockResolvedValue(undefined)
    sdk.listTools.mockResolvedValue({ tools: [{ name: 'echo', description: 'd' }] })
    sdk.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'pong' }] })

    const mgr = McpClientManager.getInstance()
    const cfg = serverConfig({ id: 'srv-keep' })
    mgr.registerServers([cfg])
    await mgr.callTool('srv-keep', 'echo', {})
    expect(mgr.getServerStatus('srv-keep')?.connectionState).toBe('connected')
    sdk.close.mockClear()

    mgr.registerServers([{ ...cfg }])
    expect(
      mgr.getServerStatus('srv-keep')?.connectionState,
      '重推同一份配置把活连接踢回了未连接'
    ).toBe('connected')
    expect(mgr.getServerStatus('srv-keep')?.toolCount, '重推之后工具缓存被清空').toBe(1)
    expect(sdk.close, '旧连接被悄悄丢掉＝那个 stdio 子进程没人收，成了孤儿').not.toHaveBeenCalled()
  })

  it('8. 配置真变了（换了命令）→ 旧的先关掉，不许留着旧子进程换新的', async () => {
    sdk.connect.mockResolvedValue(undefined)
    sdk.listTools.mockResolvedValue({ tools: [] })
    sdk.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'pong' }] })

    const mgr = McpClientManager.getInstance()
    mgr.registerServers([serverConfig({ id: 'srv-changed', command: 'node' })])
    await mgr.callTool('srv-changed', 'echo', {})
    sdk.close.mockClear()

    mgr.registerServers([serverConfig({ id: 'srv-changed', command: 'python' })])
    expect(sdk.close, '换了配置却没关旧连接（旧子进程留在后台）').toHaveBeenCalledTimes(1)
    expect(mgr.getServerStatus('srv-changed')?.connectionState, '新配置要重新连，不能沿用旧的').toBe(
      'disconnected'
    )
  })

  it('9. getConnectedTools 只给此刻连上的那些，且不为了列表去起子进程', async () => {
    sdk.connect.mockResolvedValue(undefined)
    sdk.listTools.mockResolvedValue({
      tools: [{ name: 'env_probe', description: '环境探针', inputSchema: { type: 'object' } }],
    })
    sdk.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'pong' }] })

    const mgr = McpClientManager.getInstance()
    // 管理器是单例，前面几条用例连过的服务器还活着，所以这里按 id 判"这条在不在"，
    // 判整张表为空测的是用例顺序，不是产品。
    const connectedIds = () => mgr.getConnectedTools().map((t) => t.serverId)

    // 登记了但还没连：AI 侧挂载必须看不见它，否则每轮对话都会替它起一个进程
    mgr.registerServers([serverConfig({ id: 'srv-idle' })])
    expect(connectedIds(), '没连上的服务器也被挂进对话').not.toContain('srv-idle')

    await mgr.callTool('srv-idle', 'env_probe', {})
    const mine = mgr.getConnectedTools().filter((t) => t.serverId === 'srv-idle')
    expect(mine).toHaveLength(1)
    expect(mine[0].name).toBe('env_probe')
    expect(mine[0].serverName, '外部工具得说得出是哪台服务器给的').toBe('示例外部服务器')
    expect(mine[0].inputSchema, '参数表没带出来，模型只能瞎猜参数').toBeDefined()

    // 停用的那台：registerServers 根本不会把它放进池子，所以这里走 registerServer
    // 绕过过滤，专门判 getConnectedTools 自己那道 enabled 闸门真的在看
    mgr.registerServer(serverConfig({ id: 'srv-off3', enabled: false }))
    expect(connectedIds(), 'getConnectedTools 没看 enabled').not.toContain('srv-off3')
  })
})
