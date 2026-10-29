/**
 * tests/unit/mcp-state-producer.test.ts — MCP 状态机必须有真生产者（#92）
 *
 * 为什么写这几条：
 * 1. `McpLifecycleManager` 以前只有 `McpGateway.callLocalTool()` 一个生产者，而那个方法
 *    全仓零调用方 —— 于是 'mcp:get-state' 永远回报初始的 connected，
 *    等于界面上写着一句没人测过的"健康"。现在外部调用与启动失败都会上报。
 * 2. 网关不能把带 isError 的失败结果再报成 success:true（渲染层 mcpExternalCall
 *    的 success 字段就是这条链的出口）。
 * 3. MCP Server 启动失败必须落到 logger：打包后的 Windows 应用没有控制台，
 *    以前那句 console.error 是这个能力悄悄失效的唯一痕迹。
 *
 * 调研依据：2026-10-13 后端审查 #92
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const d = vi.hoisted(() => ({
  callTool: vi.fn(),
  serverConnect: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../../src/main/services/log/logger', () => ({
  logger: { info: d.info, warn: d.warn, error: d.error },
}))

vi.mock('../../src/main/services/mcp/client-manager', () => ({
  McpClientManager: { getInstance: () => ({ callTool: d.callTool }) },
}))

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(() => ({
    setRequestHandler: vi.fn(),
    connect: d.serverConnect,
    close: vi.fn(),
  })),
}))

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}))

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: 'CallToolRequestSchema',
  ListToolsRequestSchema: 'ListToolsRequestSchema',
  ListResourcesRequestSchema: 'ListResourcesRequestSchema',
  ReadResourceRequestSchema: 'ReadResourceRequestSchema',
  ListPromptsRequestSchema: 'ListPromptsRequestSchema',
  GetPromptRequestSchema: 'GetPromptRequestSchema',
}))

vi.mock('../../src/main/services/llm/vercel-ai-service', () => ({
  sshExecTool: { name: 'ssh_exec', description: 'mock', parameters: {} },
  knowledgeQueryTool: { name: 'knowledge_query', description: 'mock', parameters: {} },
  riskCheckTool: { name: 'risk_check', description: 'mock', parameters: {} },
}))

import { McpGateway } from '../../src/main/core/agent/mcp-gateway'
import { McpLifecycleManager } from '../../src/main/core/agent/mcp-lifecycle'

describe('MCP 生命周期状态：谁在喂它', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    McpLifecycleManager.getInstance().reset()
  })

  it('1. 外部调用带回 isError → success 翻成 false，且状态机离开 connected', async () => {
    d.callTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: '外部 MCP Server "x" 未注册' }],
      isError: true,
    })

    const r = await McpGateway.getInstance().callExternalTool('x', 'echo', {})

    expect(r.success).toBe(false)
    expect(r.error).toContain('未注册')
    // 这一条就是"状态机有真生产者"的证据：以前这里恒为 connected
    expect(McpLifecycleManager.getInstance().getState().state).toBe('degraded')
  })

  it('2. 之后一次成功调用把状态机带回 connected（正反两向，不然这盏灯只会变红）', async () => {
    d.callTool.mockResolvedValueOnce({ content: [{ type: 'text', text: '炸了' }], isError: true })
    await McpGateway.getInstance().callExternalTool('x', 'echo', {})
    expect(McpLifecycleManager.getInstance().getState().consecutiveFailures).toBe(1)

    d.callTool.mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }] })
    const r = await McpGateway.getInstance().callExternalTool('x', 'echo', {})

    expect(r.success).toBe(true)
    const s = McpLifecycleManager.getInstance().getState()
    expect(s.state).toBe('connected')
    expect(s.consecutiveFailures).toBe(0)
  })

})
