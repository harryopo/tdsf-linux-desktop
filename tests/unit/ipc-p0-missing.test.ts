/**
 * v0.9.5 P0 补齐通道的单元测试（IPC 4 步同步铁律验证）
 *
 * 覆盖 7 个方法：
 * - token:cost-stats（1 个）— 成本透明
 * - subagent:list / subagent:reload（2 个）— 自定义 Agent 加载器
 * - provider:capabilities / capabilities-all / pricing / pricing-all（4 个）— Provider 能力 + 定价透明
 *
 * 曾有第 4 组 mode:list / mode:set-default / mode:get-current（8 个用例），
 * 2026-10-24 随实现整删：五模式既不注入 system prompt 也不拦工具，
 * 渲染层零调用，测试测的是一层没有执行体的包装。
 *
 * 测试策略（混合 Mock + 真实模块）：
 * - Mock electron（ipcMain.handle 捕获 + app.getAppPath）+ electron-store（logger 依赖）
 * - Mock IO 依赖模块：getCostStats / getProvider / loadCustomAgents / loadCustomAgent
 * - 使用真实模块：provider-capabilities / provider-pricing（纯表）
 * - 每个测试用例独立隔离（beforeEach 清空 handlers map + 清空 Mock 调用记录）
 *
 * IPC 4 步同步铁律验证：
 * - 步骤 1：main 层 handler 已注册到 ipcMain.handle（通过 handlers map 捕获验证）
 * - 步骤 2：ipc/index.ts 已调用 registerXxxHandlers（通过 handlers map 非空验证）
 * - 步骤 3+4：preload 暴露 + electron.d.ts 类型声明由 typecheck:web 验证
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// Mock：electron（ipcMain.handle 捕获 + app.getAppPath）
// ============================================================================

/**
 * 捕获 ipcMain.handle 注册的 handler（按 channel 索引）
 *
 * Electron 的 ipcMain.handle(channel, handler) 会将 handler 注册到内部 map。
 * 测试中通过此 map 直接调用 handler，绕过 Electron 的 IPC 机制。
 */
const handlers: Record<string, (...args: any[]) => any> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: any) => {
      handlers[channel] = handler
    },
  },
  app: {
    // subagent.ts 的 getDefaultAgentsDir() 使用 app.getAppPath() + '.tdsf/agent/'
    // 测试中返回固定路径（目录不存在，用于测试 subagent:reload 全部重载的目录不存在分支）
    getAppPath: () => '/tmp/test-app-path',
    getPath: () => '/tmp/test-userdata',
    isReady: () => true,
  },
}))

// ============================================================================
// Mock：electron-store（logger 间接依赖）
// ============================================================================

vi.mock('electron-store', () => {
  const store = new Map<string, unknown>()
  return {
    default: class {
      get(key: string) {
        return store.get(key)
      }
      set(key: string, value: unknown) {
        store.set(key, value)
      }
      delete(key: string) {
        store.delete(key)
      }
    },
  }
})

// ============================================================================
// Mock：IO 依赖模块（控制返回值，避免依赖文件系统 / electron-store 持久化状态）
// ============================================================================

// Mock token-stats 的 getCostStats（同步函数，控制返回值）
vi.mock('../../src/main/core/agent/providers/token-stats', () => ({
  getCostStats: vi.fn(),
}))

// Mock provider-registry 的 getProvider（同步函数，控制返回值）
vi.mock('../../src/main/core/agent/providers/provider-registry', () => ({
  getProvider: vi.fn(),
}))

// Mock agent-loader 的 loadCustomAgents / loadCustomAgent（异步函数，控制返回值）
vi.mock('../../src/main/core/agent/subagents/agent-loader', () => ({
  loadCustomAgents: vi.fn(),
  loadCustomAgent: vi.fn(),
}))

// ============================================================================
// 导入被测模块（在 Mock 设置之后导入，确保 Mock 生效）
//
// mode:* 三通道与其 handlers 已于 2026-10-24 整删，本文件组 2 同步移除。
// ============================================================================

import { registerTokenCostStatsHandlers } from '../../src/main/ipc/token-stats'
import { registerSubagentHandlers } from '../../src/main/ipc/subagent'
import { registerProviderInfoHandlers } from '../../src/main/ipc/provider-info'

// 导入 Mock 模块的引用（用于在测试中控制返回值）
import { getCostStats } from '../../src/main/core/agent/providers/token-stats'
import { getProvider } from '../../src/main/core/agent/providers/provider-registry'
import {
  loadCustomAgents,
  loadCustomAgent,
} from '../../src/main/core/agent/subagents/agent-loader'

// 导入真实模块（provider-capabilities / provider-pricing 是纯表，用于集成测试）
import { PROVIDER_CAPABILITIES } from '../../src/main/core/agent/providers/provider-capabilities'
import { PROVIDER_PRICING } from '../../src/main/core/agent/providers/provider-pricing'

// 导入类型
import type {
  CostStats,
  CustomAgentConfig,
  SubagentReloadRequest,
  SubagentReloadResponse,
  ProviderCapabilitiesRequest,
  ProviderCapabilities,
  ProviderCapabilitiesAllResponse,
  ProviderPricingRequest,
  ModelPricing,
  ProviderPricingAllResponse,
  PersistedProviderConfig,
} from '@shared/agent-types'

// ============================================================================
// Mock event（ipcMain.handle 的 handler 第一个参数是 IpcMainInvokeEvent）
// ============================================================================

/**
 * Mock 的 IpcMainInvokeEvent
 *
 * 大部分 handler 用 _event 接收但不使用，传 null 即可。
 * 为类型安全起见，使用 unknown 类型的 null。
 */
const mockEvent = null as unknown as Parameters<typeof handlers['token:cost-stats']>[0]

// ============================================================================
// 全局 setup：每个测试前重置状态 + 重新注册 handlers
// ============================================================================

beforeEach(() => {
  // 清空 handlers map（避免重复注册）
  for (const key of Object.keys(handlers)) {
    delete handlers[key]
  }

  // 注册剩余 3 组 IPC handlers（捕获到 handlers map）
  registerTokenCostStatsHandlers()
  registerSubagentHandlers()
  registerProviderInfoHandlers()

  // 重置 Mock 函数（清除调用记录 + 重置实现为返回 undefined）
  vi.mocked(getCostStats).mockReset()
  vi.mocked(getProvider).mockReset()
  vi.mocked(loadCustomAgents).mockReset()
  vi.mocked(loadCustomAgent).mockReset()
})

// ============================================================================
// 组 1：token:cost-stats（成本透明）— 3 个测试
// ============================================================================

describe('[组 1] token:cost-stats IPC 通道', () => {
  it('1.1 通道已注册到 ipcMain.handle', () => {
    expect(handlers['token:cost-stats']).toBeDefined()
    expect(typeof handlers['token:cost-stats']).toBe('function')
  })

  it('1.2 返回 CostStats 结构（含所有必需字段）', async () => {
    const mockStats: CostStats = {
      todayCost: 0.5,
      weekCost: 3.2,
      monthCost: 12.8,
      totalCost: 45.6,
      bySubagent: { supervisor: 30.1, 'coding-subagent': 15.5 },
      byProvider: { 'deepseek-v4': 40.2, 'anthropic-claude': 5.4 },
    }
    vi.mocked(getCostStats).mockReturnValue(mockStats)

    const result = await handlers['token:cost-stats'](mockEvent)

    expect(result).toEqual(mockStats)
    expect(result.todayCost).toBe(0.5)
    expect(result.totalCost).toBe(45.6)
    expect(result.bySubagent).toHaveProperty('supervisor')
    expect(result.byProvider).toHaveProperty('deepseek-v4')
    expect(vi.mocked(getCostStats)).toHaveBeenCalledTimes(1)
  })

  it('1.3 getCostStats 抛错时 handler 抛出错误', async () => {
    vi.mocked(getCostStats).mockImplementation(() => {
      throw new Error('provider-registry not initialized')
    })

    await expect(handlers['token:cost-stats'](mockEvent)).rejects.toThrow(
      '获取成本统计失败'
    )
  })
})

// ============================================================================
// 组 3：subagent:list / subagent:reload（自定义 Agent 加载器）— 6 个测试
// ============================================================================

describe('[组 3] subagent:* IPC 通道', () => {
  it('3.1 两个通道已注册到 ipcMain.handle', () => {
    expect(handlers['subagent:list']).toBeDefined()
    expect(handlers['subagent:reload']).toBeDefined()
  })

  it('3.2 subagent:list 返回 loadCustomAgents 的结果', async () => {
    const mockConfigs: CustomAgentConfig[] = [
      {
        name: 'linux-expert',
        displayName: 'Linux 专家',
        description: 'Linux 运维专家',
        tools: ['search', 'log'],
        systemPrompt: '你是 Linux 运维专家',
        sourceFile: '/tmp/test-app-path/.tdsf/agent/linux-expert.md',
      },
      {
        name: 'debug-helper',
        displayName: '调试助手',
        description: '擅长调试',
        tools: ['profiler'],
        systemPrompt: '你是调试助手',
        sourceFile: '/tmp/test-app-path/.tdsf/agent/debug-helper.md',
      },
    ]
    vi.mocked(loadCustomAgents).mockResolvedValue(mockConfigs)

    const result: CustomAgentConfig[] = await handlers['subagent:list'](mockEvent)

    expect(result).toEqual(mockConfigs)
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('linux-expert')
    expect(vi.mocked(loadCustomAgents)).toHaveBeenCalledTimes(1)
  })

  it('3.3 subagent:list loadCustomAgents 抛错时 handler 抛出错误', async () => {
    vi.mocked(loadCustomAgents).mockRejectedValue(new Error('permission denied'))

    await expect(handlers['subagent:list'](mockEvent)).rejects.toThrow(
      '加载自定义 agent 列表失败'
    )
  })

  it('3.4 subagent:reload 单文件成功（loadCustomAgent 返回 config）', async () => {
    const mockConfig: CustomAgentConfig = {
      name: 'linux-expert',
      displayName: 'Linux 专家',
      description: 'Linux 运维专家',
      tools: ['search'],
      systemPrompt: '你是 Linux 运维专家',
      sourceFile: '/tmp/test-app-path/.tdsf/agent/linux-expert.md',
    }
    vi.mocked(loadCustomAgent).mockResolvedValue(mockConfig)

    // S3 之后单文件重载只认 agent 目录内的路径（mock 的 app.getAppPath() 是 /tmp/test-app-path），
    // 返回值是规范化后的绝对路径，所以按尾名断言，别按输入原串
    const request: SubagentReloadRequest = {
      filePath: '/tmp/test-app-path/.tdsf/agent/linux-expert.md',
    }
    const result: SubagentReloadResponse = await handlers['subagent:reload'](
      mockEvent,
      request
    )

    expect(result.failed).toEqual([])
    expect(result.success).toBe(true)
    expect(result.reloaded).toHaveLength(1)
    expect(result.reloaded[0].replace(/\\/g, '/')).toMatch(/\/\.tdsf\/agent\/linux-expert\.md$/)
    expect(vi.mocked(loadCustomAgent)).toHaveBeenCalledTimes(1)
  })

  it('3.5 subagent:reload 单文件解析失败（loadCustomAgent 返回 null）→ failed 列表非空', async () => {
    vi.mocked(loadCustomAgent).mockResolvedValue(null)

    const request: SubagentReloadRequest = { filePath: '/tmp/test-app-path/.tdsf/agent/bad-agent.md' }
    const result: SubagentReloadResponse = await handlers['subagent:reload'](
      mockEvent,
      request
    )

    expect(result.success).toBe(true) // 流程完成仍返回 true
    expect(result.reloaded).toHaveLength(0)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].filePath.replace(/\\/g, '/')).toMatch(/\/\.tdsf\/agent\/bad-agent\.md$/)
    expect(result.failed[0].error).toContain('解析失败')
  })

  it('3.7 subagent:reload agent 目录外的路径必须被拒，且不去读文件（S3 判据）', async () => {
    vi.mocked(loadCustomAgent).mockClear()
    const request: SubagentReloadRequest = { filePath: '/tmp/elsewhere/agent.md' }
    const result: SubagentReloadResponse = await handlers['subagent:reload'](mockEvent, request)

    expect(result.success).toBe(false)
    expect(result.reloaded).toHaveLength(0)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].error).toContain('agent 目录')
    expect(vi.mocked(loadCustomAgent)).not.toHaveBeenCalled()
  })

  it('3.6 subagent:reload 全部重载（无 filePath）+ 目录不存在 → success=false', async () => {
    // app.getAppPath() mock 返回 '/tmp/test-app-path'，.tdsf/agent/ 目录不存在
    const result: SubagentReloadResponse = await handlers['subagent:reload'](mockEvent)

    expect(result.success).toBe(false)
    expect(result.reloaded).toEqual([])
    expect(result.failed).toEqual([])
  })
})

// ============================================================================
// 组 4：provider:capabilities* / pricing*（Provider 能力 + 定价透明）— 8 个测试
// ============================================================================

describe('[组 4] provider:capabilities* / pricing* IPC 通道', () => {
  /** 构造 mock ProviderConfig（PersistedProviderConfig 不含 apiKey） */
  function makeMockProvider(
    id: string,
    type: PersistedProviderConfig['type']
  ): PersistedProviderConfig {
    return {
      id,
      name: `Provider ${id}`,
      type,
      baseURL: 'https://example.com/v1',
      model: 'test-model',
    }
  }

  it('4.1 四个通道已注册到 ipcMain.handle', () => {
    expect(handlers['provider:capabilities']).toBeDefined()
    expect(handlers['provider:capabilities-all']).toBeDefined()
    expect(handlers['provider:pricing']).toBeDefined()
    expect(handlers['provider:pricing-all']).toBeDefined()
  })

  it('4.2 provider:capabilities 入参非法（null）→ 返回 null', async () => {
    const result = await handlers['provider:capabilities'](
      mockEvent,
      null as unknown as ProviderCapabilitiesRequest
    )

    expect(result).toBeNull()
  })

  it('4.3 provider:capabilities Provider 不存在 → 返回 null', async () => {
    vi.mocked(getProvider).mockReturnValue(null)

    const result = await handlers['provider:capabilities'](mockEvent, {
      providerId: 'non-existent',
    })

    expect(result).toBeNull()
    expect(vi.mocked(getProvider)).toHaveBeenCalledWith('non-existent')
  })

  it('4.4 provider:capabilities 合法 Provider → 返回 ProviderCapabilities', async () => {
    const mockProvider = makeMockProvider('deepseek-v4', 'deepseek')
    vi.mocked(getProvider).mockReturnValue(mockProvider)

    const result: ProviderCapabilities = await handlers['provider:capabilities'](
      mockEvent,
      { providerId: 'deepseek-v4' }
    )

    expect(result).toBeDefined()
    expect(typeof result.streaming).toBe('boolean')
    expect(typeof result.toolCall).toBe('boolean')
    expect(typeof result.vision).toBe('boolean')
    expect(typeof result.contextWindow).toBe('number')
    // deepseek 默认能力：streaming=true, toolCall=true, vision=false, contextWindow=64000
    expect(result.streaming).toBe(true)
    expect(result.toolCall).toBe(true)
    expect(result.vision).toBe(false)
    expect(result.contextWindow).toBe(64_000)
  })

  it('4.5 provider:capabilities-all 返回所有 ProviderType 的能力声明（7 个类型）', async () => {
    const result: ProviderCapabilitiesAllResponse =
      await handlers['provider:capabilities-all'](mockEvent)

    expect(result).toBeDefined()
    const types = Object.keys(result)
    expect(types).toHaveLength(7)
    expect(types).toContain('anthropic')
    expect(types).toContain('google')
    expect(types).toContain('openai-compatible')
    expect(types).toContain('deepseek')
    expect(types).toContain('qwen')
    expect(types).toContain('volcengine-ark')
    expect(types).toContain('ollama')
  })

  it('4.6 provider:capabilities-all 返回深拷贝（不污染内部 PROVIDER_CAPABILITIES 表）', async () => {
    const result: ProviderCapabilitiesAllResponse =
      await handlers['provider:capabilities-all'](mockEvent)

    // 修改返回值，不应影响内部表
    result['anthropic'].contextWindow = 999_999
    expect(PROVIDER_CAPABILITIES['anthropic'].contextWindow).toBe(200_000)
  })

  it('4.7 provider:pricing 合法 Provider → 返回 ModelPricing', async () => {
    const mockProvider = makeMockProvider('anthropic-claude', 'anthropic')
    vi.mocked(getProvider).mockReturnValue(mockProvider)

    const result: ModelPricing = await handlers['provider:pricing'](mockEvent, {
      providerId: 'anthropic-claude',
    })

    expect(result).toBeDefined()
    expect(typeof result.inputCostPer1M).toBe('number')
    expect(typeof result.outputCostPer1M).toBe('number')
    expect(result.currency).toBe('USD')
    // anthropic 默认定价：$3/1M input + $15/1M output
    expect(result.inputCostPer1M).toBe(3.0)
    expect(result.outputCostPer1M).toBe(15.0)
  })

  it('4.8 provider:pricing-all 返回所有 ProviderType 的定价表 + 深拷贝验证', async () => {
    const result: ProviderPricingAllResponse = await handlers['provider:pricing-all'](
      mockEvent
    )

    expect(result).toBeDefined()
    expect(Object.keys(result)).toHaveLength(7)
    expect(result['ollama'].inputCostPer1M).toBe(0.0) // ollama 是本地推理，0 成本

    // 深拷贝验证：修改返回值不应影响内部表
    result['anthropic'].inputCostPer1M = 999
    expect(PROVIDER_PRICING['anthropic'].inputCostPer1M).toBe(3.0)
  })
})
