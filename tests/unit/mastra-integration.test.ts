/**
 * Mastra 集成单元测试
 *
 * 验证要点：
 * 1. tool-bridge：ToolDefinition → Mastra createTool 转换正确性
 * 2. tool-bridge：requireApproval 从 meta 传递
 * 3. tool-bridge：批量转换
 * 4. tool-bridge：execute 包装（异常兜底）
 * 5. ops-agent：createOpsAgent 创建 Agent 实例
 * 6. mastra/index：单例模式 + 配置变更重建 + reset
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { z } from 'zod'

// ─── vi.hoisted: 在 vi.mock 工厂之前初始化 mock 函数 ───
const {
  mockCreateTool,
  mockGenerate,
  MockAgentClass,
  mockGetAgent,
  MockMastraClass,
  mockOpenAIModel,
  mockCreateOpenAI,
} = vi.hoisted(() => {
  const mockCreateTool = vi.fn().mockImplementation((config: Record<string, unknown>) => ({
    __mastraTool: true,
    id: config.id,
    description: config.description,
    inputSchema: config.inputSchema,
    requireApproval: config.requireApproval,
    execute: config.execute,
  }))
  const mockGenerate = vi.fn().mockResolvedValue({
    text: '模拟 Agent 响应',
    toolCalls: [],
  })
  const MockAgentClass = vi.fn().mockImplementation((config: Record<string, unknown>) => ({
    __agent: true,
    id: config.id,
    name: config.name,
    instructions: config.instructions,
    generate: mockGenerate,
  }))
  const mockGetAgent = vi.fn()
  const MockMastraClass = vi.fn().mockImplementation((config: Record<string, unknown>) => ({
    __mastra: true,
    agents: config.agents,
    getAgent: mockGetAgent,
  }))
  const mockOpenAIModel = vi.fn().mockReturnValue({ __model: true })
  const mockCreateOpenAI = vi.fn().mockReturnValue(mockOpenAIModel)
  return { mockCreateTool, mockGenerate, MockAgentClass, mockGetAgent, MockMastraClass, mockOpenAIModel, mockCreateOpenAI }
})

// ─── Mock @mastra/core/tools ───
vi.mock('@mastra/core/tools', () => ({
  createTool: mockCreateTool,
}))

// ─── Mock @mastra/core/agent ───
vi.mock('@mastra/core/agent', () => ({
  Agent: MockAgentClass,
}))

// ─── Mock @mastra/core/mastra ───
vi.mock('@mastra/core/mastra', () => ({
  Mastra: MockMastraClass,
}))

// ─── Mock @ai-sdk/openai ───
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: mockCreateOpenAI,
}))

// ─── Mock logger ───
vi.mock('../../src/main/services/log/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// ─── Mock ToolRegistry 依赖（避免加载 better-sqlite3 / electron-store）───
vi.mock('../../src/main/services/llm/tools/ssh-exec', () => ({
  sshExecTool: {
    name: 'ssh_exec',
    description: 'SSH 命令执行',
    parameters: z.object({ sessionId: z.string(), command: z.string() }),
    execute: vi.fn().mockResolvedValue({ toolId: 'ssh_exec', success: true, data: { stdout: 'ok' } }),
  },
  SSH_EXEC_META: { id: 'ssh_exec', label: 'SSH', emoji: '🖥️', description: 'SSH', risk: 'high', requiresApproval: true },
}))

vi.mock('../../src/main/services/llm/tools/tutorial-search', () => ({
  createTutorialSearchTool: () => ({
    name: 'tutorial_search',
    description: '教程搜索',
    parameters: z.object({ query: z.string() }),
    execute: vi.fn().mockResolvedValue({ toolId: 'tutorial_search', success: true, data: [] }),
  }),
  TUTORIAL_SEARCH_META: { id: 'tutorial_search', label: '教程', emoji: '📚', description: '教程搜索', risk: 'low', requiresApproval: false },
}))

vi.mock('../../src/main/services/llm/tools/deploy-list', () => ({
  deployListTool: {
    name: 'deploy_list_templates',
    description: '部署列表',
    parameters: z.object({}),
    execute: vi.fn().mockResolvedValue({ toolId: 'deploy_list_templates', success: true, data: [] }),
  },
  DEPLOY_LIST_META: { id: 'deploy_list_templates', label: '部署', emoji: '🚀', description: '部署列表', risk: 'safe', requiresApproval: false },
}))

vi.mock('../../src/main/services/llm/tools/profiler-run', () => ({
  profilerRunTool: {
    name: 'profiler_run',
    description: '系统分析',
    parameters: z.object({ sessionId: z.string() }),
    execute: vi.fn().mockResolvedValue({ toolId: 'profiler_run', success: true, data: {} }),
  },
  PROFILER_RUN_META: { id: 'profiler_run', label: '分析', emoji: '📊', description: '系统分析', risk: 'medium', requiresApproval: false },
}))

vi.mock('../../src/main/services/llm/tools/monitor-get', () => ({
  monitorGetTool: {
    name: 'monitor_get_data',
    description: '监控数据',
    parameters: z.object({ sessionId: z.string() }),
    execute: vi.fn().mockResolvedValue({ toolId: 'monitor_get_data', success: true, data: {} }),
  },
  MONITOR_GET_META: { id: 'monitor_get_data', label: '监控', emoji: '📈', description: '监控数据', risk: 'low', requiresApproval: false },
}))

// ─── 导入被测模块（在 mock 之后）───
import { adaptToolToMastra, adaptToolsToMastra } from '../../src/main/core/agent/mastra/tool-bridge'
import type { ToolDefinition, ToolCallMeta } from '../../src/shared/llm-tool-types'

describe('Mastra Tool Bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ────────── 1. adaptToolToMastra 基本转换 ──────────

  it('adaptToolToMastra：正确映射 name→id / description / parameters→inputSchema', () => {
    const tool: ToolDefinition = {
      name: 'test_tool',
      description: '测试工具',
      parameters: z.object({ input: z.string() }),
      execute: vi.fn(),
    }

    const result = adaptToolToMastra(tool)

    expect(mockCreateTool).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'test_tool',
        description: '测试工具',
        inputSchema: tool.parameters,
      })
    )
    expect((result as any).__mastraTool).toBe(true)
  })

  // ────────── 2. requireApproval 传递 ──────────

  it('adaptToolToMastra：meta.requiresApproval=true 时传递 requireApproval', () => {
    const tool: ToolDefinition = {
      name: 'ssh_exec',
      description: 'SSH',
      parameters: z.object({}),
      execute: vi.fn(),
    }
    const meta: ToolCallMeta = {
      id: 'ssh_exec',
      label: 'SSH',
      emoji: '🖥️',
      description: 'SSH 命令执行',
      risk: 'high',
      requiresApproval: true,
    }

    adaptToolToMastra(tool, meta)

    expect(mockCreateTool).toHaveBeenCalledWith(
      expect.objectContaining({
        requireApproval: true,
      })
    )
  })

  it('adaptToolToMastra：无 meta 时不传 requireApproval', () => {
    const tool: ToolDefinition = {
      name: 'safe_tool',
      description: '安全工具',
      parameters: z.object({}),
      execute: vi.fn(),
    }

    adaptToolToMastra(tool)

    const callArgs = mockCreateTool.mock.calls[0][0]
    expect(callArgs.requireApproval).toBeUndefined()
  })

  // ────────── 3. execute 包装 ──────────

  it('adaptToolToMastra：execute 正确委托给原始 tool.execute', async () => {
    const mockExecute = vi.fn().mockResolvedValue({ toolId: 'test', success: true, data: 'ok' })
    const tool: ToolDefinition = {
      name: 'test_tool',
      description: '测试',
      parameters: z.object({}),
      execute: mockExecute,
    }

    const result = adaptToolToMastra(tool)
    const mastraExecute = (result as any).execute

    const output = await mastraExecute({ input: 'hello' })
    expect(mockExecute).toHaveBeenCalledWith({ input: 'hello' })
    expect(output).toEqual({ toolId: 'test', success: true, data: 'ok' })
  })

  it('adaptToolToMastra：execute 异常时兜底返回错误结构', async () => {
    const mockExecute = vi.fn().mockRejectedValue(new Error('boom'))
    const tool: ToolDefinition = {
      name: 'failing_tool',
      description: '会失败的工具',
      parameters: z.object({}),
      execute: mockExecute,
    }

    const result = adaptToolToMastra(tool)
    const mastraExecute = (result as any).execute

    const output = await mastraExecute({})
    expect(output.success).toBe(false)
    expect(output.error).toContain('boom')
    expect(output.toolId).toBe('failing_tool')
  })

  // ────────── 4. 批量转换 ──────────

  it('adaptToolsToMastra：批量转换多个工具', () => {
    const tools: ToolDefinition[] = [
      { name: 'tool_a', description: 'A', parameters: z.object({}), execute: vi.fn() },
      { name: 'tool_b', description: 'B', parameters: z.object({}), execute: vi.fn() },
      { name: 'tool_c', description: 'C', parameters: z.object({}), execute: vi.fn() },
    ]

    const result = adaptToolsToMastra(tools)

    expect(Object.keys(result)).toEqual(['tool_a', 'tool_b', 'tool_c'])
    expect(mockCreateTool).toHaveBeenCalledTimes(3)
  })

  it('adaptToolsToMastra：带 meta 时按 id 匹配 requireApproval', () => {
    const tools: ToolDefinition[] = [
      { name: 'ssh_exec', description: 'SSH', parameters: z.object({}), execute: vi.fn() },
      { name: 'monitor', description: '监控', parameters: z.object({}), execute: vi.fn() },
    ]
    const metas: ToolCallMeta[] = [
      { id: 'ssh_exec', label: 'SSH', emoji: '🖥️', description: 'SSH', risk: 'high', requiresApproval: true },
      { id: 'monitor', label: '监控', emoji: '📈', description: '监控', risk: 'low', requiresApproval: false },
    ]

    adaptToolsToMastra(tools, metas)

    // ssh_exec 应该有 requireApproval: true
    const sshCall = mockCreateTool.mock.calls.find((c) => c[0].id === 'ssh_exec')![0]
    expect(sshCall.requireApproval).toBe(true)

    // monitor 不应该有 requireApproval
    const monitorCall = mockCreateTool.mock.calls.find((c) => c[0].id === 'monitor')![0]
    expect(monitorCall.requireApproval).toBeUndefined()
  })
})

describe('Mastra Ops Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 动态导入以确保 mock 生效
  })

  // ────────── 5. createOpsAgent ──────────

  it('createOpsAgent：创建 Agent 并传入正确的配置', async () => {
    // 动态导入（mock 已生效）
    const { createOpsAgent } = await import('../../src/main/core/agent/mastra/ops-agent')

    const agent = createOpsAgent({
      llmConfig: {
        apiKey: 'test-key-12345678',
        baseUrl: 'https://api.test.com',
        model: 'test-model',
      },
    })

    expect(MockAgentClass).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'tdsf-ops-agent',
        name: 'TDSF 运维助手',
        instructions: expect.stringContaining('AI 运维助手'),
      })
    )
    expect((agent as any).__agent).toBe(true)
  })

  it('createOpsAgent：无 db 时 tools 包含 4 个工具（tutorial_search 跳过）', async () => {
    const { createOpsAgent } = await import('../../src/main/core/agent/mastra/ops-agent')

    createOpsAgent({
      llmConfig: {
        apiKey: 'test-key',
        baseUrl: 'https://api.test.com',
        model: 'test-model',
      },
    })

    const agentConfig = MockAgentClass.mock.calls[0][0]
    const toolKeys = Object.keys(agentConfig.tools)
    // 无 db 时 4 个工具（tutorial_search 需要 db，未传则跳过）
    expect(toolKeys).toContain('ssh_exec')
    expect(toolKeys).toContain('deploy_list_templates')
    expect(toolKeys).toContain('profiler_run')
    expect(toolKeys).toContain('monitor_get_data')
    expect(toolKeys).not.toContain('tutorial_search')
  })
})

describe('Mastra Instance Singleton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 重置单例状态
  })

  // ────────── 6. 单例 + 配置变更 ──────────

  it('getMastraInstance：首次调用创建 Mastra 实例', async () => {
    const { getMastraInstance, resetMastraInstance } = await import(
      '../../src/main/core/agent/mastra/index'
    )
    resetMastraInstance()

    const instance = getMastraInstance({
      apiKey: 'key1',
      baseUrl: 'https://api.test.com',
      model: 'model-a',
    })

    expect(MockMastraClass).toHaveBeenCalled()
    expect((instance as any).__mastra).toBe(true)
  })

  it('getMastraInstance：配置未变时返回缓存实例', async () => {
    const { getMastraInstance, resetMastraInstance } = await import(
      '../../src/main/core/agent/mastra/index'
    )
    resetMastraInstance()
    MockMastraClass.mockClear()

    const config = { apiKey: 'key2', baseUrl: 'https://api.test.com', model: 'model-b' }

    const first = getMastraInstance(config)
    const callCountAfterFirst = MockMastraClass.mock.calls.length

    const second = getMastraInstance(config)
    const callCountAfterSecond = MockMastraClass.mock.calls.length

    expect(first).toBe(second)
    expect(callCountAfterSecond).toBe(callCountAfterFirst) // 没有新创建
  })

  it('getMastraInstance：配置变更时重建实例', async () => {
    const { getMastraInstance, resetMastraInstance } = await import(
      '../../src/main/core/agent/mastra/index'
    )
    resetMastraInstance()
    MockMastraClass.mockClear()

    getMastraInstance({ apiKey: 'key3', baseUrl: 'https://api.test.com', model: 'model-c' })
    expect(MockMastraClass).toHaveBeenCalledTimes(1)

    getMastraInstance({ apiKey: 'key4', baseUrl: 'https://api.test.com', model: 'model-d' })
    expect(MockMastraClass).toHaveBeenCalledTimes(2) // 重建了
  })

  it('resetMastraInstance：重置后下次调用重建', async () => {
    const { getMastraInstance, resetMastraInstance, isMastraInitialized } = await import(
      '../../src/main/core/agent/mastra/index'
    )
    resetMastraInstance()

    getMastraInstance({ apiKey: 'key5', baseUrl: 'https://api.test.com', model: 'model-e' })
    expect(isMastraInitialized()).toBe(true)

    resetMastraInstance()
    expect(isMastraInitialized()).toBe(false)
  })
})
