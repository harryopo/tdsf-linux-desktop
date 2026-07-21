/**
 * MCP Server 工具分发（dispatch）单元测试
 *
 * 针对 Round 7 修复的 bug：handleToolCall 此前只分发 5 个 legacy 工具，
 * 导致 v0.5.0 注册表中的 tutorial_search / deploy_list_templates /
 * profiler_run / monitor_get_data 以及新版 ssh_exec 全部落到"未知工具"。
 *
 * 验证要点：
 * - v5 注册表工具能被正确分发（monitor_get_data）
 * - ssh_exec legacy 兼容：传 connId 自动映射为 sessionId
 * - ssh_exec 已传 sessionId 时不做映射（原样透传）
 * - legacy 独有工具（risk_check）仍可分发
 * - 未知工具返回"未知工具"
 * - listRegisteredTools 去重后 ssh_exec 只出现一次
 *
 * 注：mock 掉 v5 注册表（返回可控假工具）以隔离分发逻辑本身，
 * 不真实执行 SSH/监控。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TOOL_IDS } from '@shared/llm-tool-types'

// ── hoisted 假工具 call mock（供 vi.mock 工厂引用）──
const v5CallMocks = vi.hoisted(() => ({
  sshExec: vi.fn(),
  monitorGet: vi.fn(),
}))

// ── Mock MCP SDK（与 mcp-server.test.ts 一致，避免 zod subpath 解析问题）──
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(() => ({
    setRequestHandler: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}))
vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: 'CallToolRequestSchema',
  ListToolsRequestSchema: 'ListToolsRequestSchema',
}))

// ── Mock vercel-ai-service（断开 provider 加载链）──
vi.mock('../../src/main/services/llm/vercel-ai-service', () => ({
  sshExecTool: { name: 'ssh_exec', description: 'mock', parameters: {} },
  knowledgeQueryTool: { name: 'knowledge_query', description: 'mock', parameters: {} },
  riskCheckTool: { name: 'risk_check', description: 'mock', parameters: {} },
}))

// ── Mock v5 工具注册表：返回可控假工具，隔离 dispatch 逻辑 ──
vi.mock('../../src/main/services/mcp/tools/registry', () => ({
  createMcpTools: vi.fn(() => [
    {
      meta: {
        name: TOOL_IDS.SSH_EXEC,
        description: 'v5 ssh_exec',
        inputSchema: { type: 'object', properties: {} },
      },
      call: v5CallMocks.sshExec,
    },
    {
      meta: {
        name: TOOL_IDS.MONITOR_GET,
        description: 'v5 monitor_get_data',
        inputSchema: { type: 'object', properties: {} },
      },
      call: v5CallMocks.monitorGet,
    },
  ]),
}))

// ── Mock DatabaseManager（避免真实打开 sqlite）──
vi.mock('../../src/main/services/db/database', () => ({
  DatabaseManager: { getInstance: () => null },
}))

// ── Mock AgentWorkflow（server.ts 模块级导入，较重）──
vi.mock('../../src/main/core/agent-workflow', () => ({
  AgentWorkflow: vi.fn(),
}))

// ── Mock risk-engine（legacy risk_check 用）──
vi.mock('../../src/main/core/risk-engine', () => ({
  assessRisk: vi.fn(() => ({ level: 'low', score: 10, reasons: [] })),
}))

import { McpServerService } from '../../src/main/services/mcp/server'
import { assessRisk } from '../../src/main/core/risk-engine'

describe('MCP Server 工具分发（dispatch）', () => {
  const service = McpServerService.getInstance({ enabled: false, port: 3107 })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ────────── 1. v5 注册表工具能被分发 ──────────

  it('v5 工具 monitor_get_data 被正确分发到注册表 call()', async () => {
    v5CallMocks.monitorGet.mockResolvedValue({
      content: [{ type: 'text', text: 'monitor-ok' }],
    })

    const result = await service.invokeTool(TOOL_IDS.MONITOR_GET, { sessionId: 's1' })

    expect(v5CallMocks.monitorGet).toHaveBeenCalledWith({ sessionId: 's1' })
    expect(result.content[0].text).toBe('monitor-ok')
  })

  // ────────── 2. ssh_exec legacy 兼容映射 ──────────

  it('ssh_exec 传 connId 时自动映射为 sessionId（legacy 客户端兼容）', async () => {
    v5CallMocks.sshExec.mockResolvedValue({
      content: [{ type: 'text', text: 'ssh-ok' }],
    })

    await service.invokeTool(TOOL_IDS.SSH_EXEC, { connId: 'conn-1', command: 'ls' })

    // sessionId 被自动补上，值等于 connId
    expect(v5CallMocks.sshExec).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'conn-1', command: 'ls' })
    )
  })

  it('ssh_exec 已传 sessionId 时不做映射（原样透传）', async () => {
    v5CallMocks.sshExec.mockResolvedValue({
      content: [{ type: 'text', text: 'ssh-ok' }],
    })

    await service.invokeTool(TOOL_IDS.SSH_EXEC, { sessionId: 'sess-9', command: 'pwd' })

    expect(v5CallMocks.sshExec).toHaveBeenCalledWith({ sessionId: 'sess-9', command: 'pwd' })
  })

  // ────────── 3. legacy 独有工具仍可分发 ──────────

  it('legacy 工具 risk_check 仍可分发（v5 注册表未覆盖）', async () => {
    const result = await service.invokeTool('risk_check', { command: 'ls -la' })

    expect(assessRisk).toHaveBeenCalledWith('ls -la')
    expect(result.content[0].text).toContain('low')
  })

  // ────────── 4. 未知工具兜底 ──────────

  it('未知工具名返回"未知工具"提示', async () => {
    const result = await service.invokeTool('nonexistent_tool_xyz', {})
    expect(result.content[0].text).toContain('未知工具')
  })

  // ────────── 5. listRegisteredTools 去重 ──────────

  it('listRegisteredTools 去重后 ssh_exec 只出现一次', () => {
    const tools = service.listRegisteredTools()
    const sshExecCount = tools.filter((t) => t.name === TOOL_IDS.SSH_EXEC).length
    expect(sshExecCount).toBe(1)
  })
})
