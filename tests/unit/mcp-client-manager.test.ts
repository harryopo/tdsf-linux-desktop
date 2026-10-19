/**
 * tests/unit/mcp-client-manager.test.ts — 外部 MCP Client 侧的三条硬要求（#92）
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
})
