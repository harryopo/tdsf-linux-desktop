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
 * - 未知工具返回"未知工具"（且不会被误报成"高危已拦截"）
 * - 命令闸在派发口生效：高危命令与未登记工具都被拒，工具体一次都不执行（#88）
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
  // 注册在 v5 注册表里、但没登记进命令闸形状表的工具：用来验 fail-closed
  unshaped: vi.fn(),
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
    {
      // 真实派发口可能收到"注册表里有、形状表没登记"的工具（新加工具忘了登记），
      // 用它验命令闸 fail-closed：宁可拒绝也不能让它落到 call()。
      meta: {
        name: 'brand_new_unregistered_tool',
        description: 'v5 新工具，命令闸形状表未登记',
        inputSchema: { type: 'object', properties: {} },
      },
      call: v5CallMocks.unshaped,
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

  it('未知工具名返回"未知工具"提示，不谎报成"高危已拦截"', async () => {
    const result = await service.invokeTool('nonexistent_tool_xyz', {})
    expect(result.content[0].text).toContain('未知工具')
    // 名字压根不存在时没有任何代码会被执行，报"已被拦截"会让调用方以为工具存在且被禁
    expect(result.content[0].text).not.toContain('拦截')
  })

  // ────────── 4.5 命令闸（#88：assessToolCall 接回派发口）──────────

  it('已登记工具带高危命令时：拒绝且不执行工具体', async () => {
    const result = await service.invokeTool(TOOL_IDS.SSH_EXEC, {
      sessionId: 'sess-1',
      command: 'rm -rf /',
    })

    expect(result.content[0].text).toContain('高危操作已被拦截')
    expect(result.isError).toBe(true)
    expect(v5CallMocks.sshExec).not.toHaveBeenCalled()
  })

  it('注册表里有但形状表未登记的工具：fail-closed 拒绝且不执行工具体', async () => {
    const result = await service.invokeTool('brand_new_unregistered_tool', { command: 'ls' })

    expect(result.content[0].text).toContain('未登记')
    expect(result.isError).toBe(true)
    expect(v5CallMocks.unshaped).not.toHaveBeenCalled()
  })

  it('只读命令仍照常分发到注册表 call()', async () => {
    v5CallMocks.sshExec.mockResolvedValue({ content: [{ type: 'text', text: 'ssh-ok' }] })

    const result = await service.invokeTool(TOOL_IDS.SSH_EXEC, {
      sessionId: 'sess-1',
      command: 'df -h',
    })

    expect(v5CallMocks.sshExec).toHaveBeenCalled()
    expect(result.content[0].text).toBe('ssh-ok')
  })

  it('工具体抛异常（缺必填参数）时结果带 isError，不只靠文案', async () => {
    // risk_check 的 command 是必填，z.parse 会抛，落到 handleToolCall 的 catch
    const result = await service.invokeTool('risk_check', {})
    expect(result.content[0].text).toContain('工具调用失败')
    expect(result.isError).toBe(true)
  })

  // ────────── 5. listRegisteredTools 去重 ──────────

  it('listRegisteredTools 去重后 ssh_exec 只出现一次', () => {
    const tools = service.listRegisteredTools()
    const sshExecCount = tools.filter((t) => t.name === TOOL_IDS.SSH_EXEC).length
    expect(sshExecCount).toBe(1)
  })
})
