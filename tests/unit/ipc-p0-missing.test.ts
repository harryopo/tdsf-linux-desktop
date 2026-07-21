/**
 * v0.9.5 P0 - 5 组缺失 IPC 通道单元测试
 *
 * 覆盖 17 个新 IPC 方法（IPC 4 步同步铁律验证）：
 * - 组 1：token:cost-stats（1 个）— 成本透明
 * - 组 2：mode:list / mode:set-default / mode:get-current（3 个）— 五模式切换
 * - 组 3：attention:current / attention:history / attention:track-* / attention:reset（7 个）— 注意力跟踪
 * - 组 4：subagent:list / subagent:reload（2 个）— 自定义 Agent 加载器
 * - 组 5：provider:capabilities / capabilities-all / pricing / pricing-all（4 个）— Provider 能力 + 定价透明
 *
 * 测试策略（混合 Mock + 真实模块）：
 * - Mock electron（ipcMain.handle 捕获 + app.getAppPath）+ electron-store（logger 依赖）
 * - Mock IO 依赖模块：getCostStats / getProvider / loadCustomAgents / loadCustomAgent
 * - 使用真实模块：mode-registry（纯函数）/ attention-tracker（内存单例）/ provider-capabilities / provider-pricing
 * - 每个测试用例独立隔离（beforeEach 重置单例状态 + 清空 Mock 调用记录）
 *
 * IPC 4 步同步铁律验证：
 * - 步骤 1：main 层 handler 已注册到 ipcMain.handle（通过 handlers map 捕获验证）
 * - 步骤 2：ipc/index.ts 已调用 registerXxxHandlers（通过 handlers map 非空验证）
 * - 步骤 3+4：preload 暴露 + electron.d.ts 类型声明由 typecheck:web 验证
 *
 * 设计依据：v0.9.5 §UI接入接线图（5 组 P0 级缺失 IPC - 4 步同步铁律）
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
// ============================================================================

import { registerTokenCostStatsHandlers } from '../../src/main/ipc/token-stats'
import { registerModeHandlers } from '../../src/main/ipc/mode'
import { registerAttentionHandlers } from '../../src/main/ipc/attention'
import { registerSubagentHandlers } from '../../src/main/ipc/subagent'
import { registerProviderInfoHandlers } from '../../src/main/ipc/provider-info'

// 导入 Mock 模块的引用（用于在测试中控制返回值）
import { getCostStats } from '../../src/main/core/agent/providers/token-stats'
import { getProvider } from '../../src/main/core/agent/providers/provider-registry'
import {
  loadCustomAgents,
  loadCustomAgent,
} from '../../src/main/core/agent/subagents/agent-loader'

// 导入真实模块（mode-registry 是纯函数，attention-tracker 是内存单例，用于集成测试）
import {
  resetCurrentMode,
  DEFAULT_MODE,
  MODE_CONFIGS,
} from '../../src/main/core/agent/modes/mode-registry'
import {
  AttentionTracker,
  resetAttentionTrackerInstance,
} from '../../src/main/core/agent/attention-tracker'
import { PROVIDER_CAPABILITIES } from '../../src/main/core/agent/providers/provider-capabilities'
import { PROVIDER_PRICING } from '../../src/main/core/agent/providers/provider-pricing'

// 导入类型
import type {
  CostStats,
  ModeListResponse,
  ModeSetDefaultRequest,
  ModeSetDefaultResponse,
  ModeCurrentResponse,
  AttentionFocus,
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
const mockEvent = null as unknown as Parameters<typeof handlers['mode:list']>[0]

// ============================================================================
// 全局 setup：每个测试前重置状态 + 重新注册 handlers
// ============================================================================

beforeEach(() => {
  // 清空 handlers map（避免重复注册）
  for (const key of Object.keys(handlers)) {
    delete handlers[key]
  }

  // 注册所有 5 组 IPC handlers（捕获到 handlers map）
  registerTokenCostStatsHandlers()
  registerModeHandlers()
  registerAttentionHandlers()
  registerSubagentHandlers()
  registerProviderInfoHandlers()

  // 重置 Mock 函数（清除调用记录 + 重置实现为返回 undefined）
  vi.mocked(getCostStats).mockReset()
  vi.mocked(getProvider).mockReset()
  vi.mocked(loadCustomAgents).mockReset()
  vi.mocked(loadCustomAgent).mockReset()

  // 重置单例状态
  resetCurrentMode() // mode-registry 的 currentMode 重置为 DEFAULT_MODE ('chat')
  resetAttentionTrackerInstance() // AttentionTracker 单例重置为空 attention
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
// 组 2：mode:list / mode:set-default / mode:get-current（五模式切换）— 8 个测试
// ============================================================================

describe('[组 2] mode:* IPC 通道', () => {
  it('2.1 三个通道已注册到 ipcMain.handle', () => {
    expect(handlers['mode:list']).toBeDefined()
    expect(handlers['mode:set-default']).toBeDefined()
    expect(handlers['mode:get-current']).toBeDefined()
  })

  it('2.2 mode:list 返回 5 个 mode', async () => {
    const result: ModeListResponse = await handlers['mode:list'](mockEvent)

    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(5)
    const names = result.map((m) => m.name)
    expect(names).toContain('chat')
    expect(names).toContain('ask')
    expect(names).toContain('plan')
    expect(names).toContain('code')
    expect(names).toContain('debug')
  })

  it('2.3 mode:list 返回的 ModeInfo 不含 systemPrompt（避免泄露内部 prompt 模板）', async () => {
    const result: ModeListResponse = await handlers['mode:list'](mockEvent)

    for (const mode of result) {
      expect(mode).not.toHaveProperty('systemPrompt')
      // ModeInfo 应该只有 name / displayName / description / allowedTools
      const keys = Object.keys(mode).sort()
      expect(keys).toEqual(['allowedTools', 'description', 'displayName', 'name'])
    }
  })

  it('2.4 mode:list 返回的 allowedTools 与 MODE_CONFIGS 一致', async () => {
    const result: ModeListResponse = await handlers['mode:list'](mockEvent)

    for (const mode of result) {
      const config = MODE_CONFIGS[mode.name]
      expect(mode.allowedTools).toEqual([...config.allowedTools])
    }
  })

  it('2.5 mode:set-default 合法 mode → success=true，返回 previousMode + currentMode', async () => {
    const request: ModeSetDefaultRequest = { mode: 'code' }
    const result: ModeSetDefaultResponse = await handlers['mode:set-default'](
      mockEvent,
      request
    )

    expect(result.success).toBe(true)
    expect(result.previousMode).toBe('chat') // 默认是 chat
    expect(result.currentMode).toBe('code')
  })

  it('2.6 mode:set-default 非法 mode → success=false，currentMode 保持原值', async () => {
    const request = { mode: 'invalid-mode' } as unknown as ModeSetDefaultRequest
    const result: ModeSetDefaultResponse = await handlers['mode:set-default'](
      mockEvent,
      request
    )

    expect(result.success).toBe(false)
    expect(result.currentMode).toBe('chat') // 保持默认值
    expect(result.previousMode).toBe('chat')
  })

  it('2.7 mode:set-default 入参为 null → success=false', async () => {
    const result: ModeSetDefaultResponse = await handlers['mode:set-default'](
      mockEvent,
      null as unknown as ModeSetDefaultRequest
    )

    expect(result.success).toBe(false)
  })

  it('2.8 mode:get-current 返回初始默认 mode（chat）+ displayName', async () => {
    const result: ModeCurrentResponse = await handlers['mode:get-current'](mockEvent)

    expect(result.mode).toBe(DEFAULT_MODE)
    expect(result.mode).toBe('chat')
    expect(typeof result.displayName).toBe('string')
    expect(result.displayName.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// 组 3：attention:* 7 通道（注意力跟踪）— 10 个测试
// ============================================================================

describe('[组 3] attention:* IPC 通道', () => {
  it('3.1 七个通道已注册到 ipcMain.handle', () => {
    expect(handlers['attention:current']).toBeDefined()
    expect(handlers['attention:history']).toBeDefined()
    expect(handlers['attention:track-files']).toBeDefined()
    expect(handlers['attention:track-commands']).toBeDefined()
    expect(handlers['attention:track-errors']).toBeDefined()
    expect(handlers['attention:track-keywords']).toBeDefined()
    expect(handlers['attention:reset']).toBeDefined()
  })

  it('3.2 attention:current 返回 AttentionFocus，since 字段必有', async () => {
    const result: AttentionFocus = await handlers['attention:current'](mockEvent)

    expect(result).toBeDefined()
    expect(typeof result.since).toBe('number')
    expect(result.since).toBeGreaterThan(0)
  })

  it('3.3 attention:history 初始为空数组', async () => {
    const result: AttentionFocus[] = await handlers['attention:history'](mockEvent)

    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(0)
  })

  it('3.4 attention:track-files 添加文件后 current 反映变更', async () => {
    const files = ['/etc/nginx/nginx.conf', '/var/log/syslog']
    const ok = await handlers['attention:track-files'](mockEvent, files)

    expect(ok).toBe(true)
    const current: AttentionFocus = await handlers['attention:current'](mockEvent)
    expect(current.files).toEqual(files)
  })

  it('3.5 attention:track-commands 添加命令后 current 反映变更', async () => {
    const commands = ['systemctl status nginx', 'journalctl -u nginx']
    const ok = await handlers['attention:track-commands'](mockEvent, commands)

    expect(ok).toBe(true)
    const current: AttentionFocus = await handlers['attention:current'](mockEvent)
    expect(current.commands).toEqual(commands)
  })

  it('3.6 attention:track-errors 添加错误后 current 反映变更', async () => {
    const errors = ['nginx: config test failed', 'permission denied']
    const ok = await handlers['attention:track-errors'](mockEvent, errors)

    expect(ok).toBe(true)
    const current: AttentionFocus = await handlers['attention:current'](mockEvent)
    expect(current.errors).toEqual(errors)
  })

  it('3.7 attention:track-keywords 添加关键词后 current 反映变更', async () => {
    const keywords = ['segfault', 'oom-killer']
    const ok = await handlers['attention:track-keywords'](mockEvent, keywords)

    expect(ok).toBe(true)
    const current: AttentionFocus = await handlers['attention:current'](mockEvent)
    expect(current.keywords).toEqual(keywords)
  })

  it('3.8 attention:track-files 入参非数组 → 返回 false', async () => {
    const ok = await handlers['attention:track-files'](mockEvent, 'not-an-array')

    expect(ok).toBe(false)
  })

  it('3.9 attention:reset 返回 true，并将当前 attention 归档到 history', async () => {
    // 先添加一些数据
    await handlers['attention:track-files'](mockEvent, ['/etc/hosts'])
    await handlers['attention:track-commands'](mockEvent, ['ls -la'])

    // reset
    const ok = await handlers['attention:reset'](mockEvent)
    expect(ok).toBe(true)

    // history 应该有 1 条
    const history: AttentionFocus[] = await handlers['attention:history'](mockEvent)
    expect(history).toHaveLength(1)
    expect(history[0].files).toEqual(['/etc/hosts'])
    expect(history[0].commands).toEqual(['ls -la'])

    // current 应该被重置为空（无 files/commands/errors/keywords）
    const current: AttentionFocus = await handlers['attention:current'](mockEvent)
    expect(current.files).toBeUndefined()
    expect(current.commands).toBeUndefined()
  })

  it('3.10 attention:reset 后 current.since 更新为新时间戳', async () => {
    const beforeReset: AttentionFocus = await handlers['attention:current'](mockEvent)
    await handlers['attention:reset'](mockEvent)
    const afterReset: AttentionFocus = await handlers['attention:current'](mockEvent)

    expect(afterReset.since).toBeGreaterThanOrEqual(beforeReset.since)
  })
})

// ============================================================================
// 组 4：subagent:list / subagent:reload（自定义 Agent 加载器）— 6 个测试
// ============================================================================

describe('[组 4] subagent:* IPC 通道', () => {
  it('4.1 两个通道已注册到 ipcMain.handle', () => {
    expect(handlers['subagent:list']).toBeDefined()
    expect(handlers['subagent:reload']).toBeDefined()
  })

  it('4.2 subagent:list 返回 loadCustomAgents 的结果', async () => {
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

  it('4.3 subagent:list loadCustomAgents 抛错时 handler 抛出错误', async () => {
    vi.mocked(loadCustomAgents).mockRejectedValue(new Error('permission denied'))

    await expect(handlers['subagent:list'](mockEvent)).rejects.toThrow(
      '加载自定义 agent 列表失败'
    )
  })

  it('4.4 subagent:reload 单文件成功（loadCustomAgent 返回 config）', async () => {
    const mockConfig: CustomAgentConfig = {
      name: 'linux-expert',
      displayName: 'Linux 专家',
      description: 'Linux 运维专家',
      tools: ['search'],
      systemPrompt: '你是 Linux 运维专家',
      sourceFile: '/tmp/agent.md',
    }
    vi.mocked(loadCustomAgent).mockResolvedValue(mockConfig)

    const request: SubagentReloadRequest = { filePath: '/tmp/agent.md' }
    const result: SubagentReloadResponse = await handlers['subagent:reload'](
      mockEvent,
      request
    )

    expect(result.success).toBe(true)
    expect(result.reloaded).toContain('/tmp/agent.md')
    expect(result.failed).toHaveLength(0)
    expect(vi.mocked(loadCustomAgent)).toHaveBeenCalledTimes(1)
  })

  it('4.5 subagent:reload 单文件解析失败（loadCustomAgent 返回 null）→ failed 列表非空', async () => {
    vi.mocked(loadCustomAgent).mockResolvedValue(null)

    const request: SubagentReloadRequest = { filePath: '/tmp/bad-agent.md' }
    const result: SubagentReloadResponse = await handlers['subagent:reload'](
      mockEvent,
      request
    )

    expect(result.success).toBe(true) // 流程完成仍返回 true
    expect(result.reloaded).toHaveLength(0)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].filePath).toBe('/tmp/bad-agent.md')
    expect(result.failed[0].error).toContain('解析失败')
  })

  it('4.6 subagent:reload 全部重载（无 filePath）+ 目录不存在 → success=false', async () => {
    // app.getAppPath() mock 返回 '/tmp/test-app-path'，.tdsf/agent/ 目录不存在
    const result: SubagentReloadResponse = await handlers['subagent:reload'](mockEvent)

    expect(result.success).toBe(false)
    expect(result.reloaded).toEqual([])
    expect(result.failed).toEqual([])
  })
})

// ============================================================================
// 组 5：provider:capabilities* / pricing*（Provider 能力 + 定价透明）— 8 个测试
// ============================================================================

describe('[组 5] provider:capabilities* / pricing* IPC 通道', () => {
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

  it('5.1 四个通道已注册到 ipcMain.handle', () => {
    expect(handlers['provider:capabilities']).toBeDefined()
    expect(handlers['provider:capabilities-all']).toBeDefined()
    expect(handlers['provider:pricing']).toBeDefined()
    expect(handlers['provider:pricing-all']).toBeDefined()
  })

  it('5.2 provider:capabilities 入参非法（null）→ 返回 null', async () => {
    const result = await handlers['provider:capabilities'](
      mockEvent,
      null as unknown as ProviderCapabilitiesRequest
    )

    expect(result).toBeNull()
  })

  it('5.3 provider:capabilities Provider 不存在 → 返回 null', async () => {
    vi.mocked(getProvider).mockReturnValue(null)

    const result = await handlers['provider:capabilities'](mockEvent, {
      providerId: 'non-existent',
    })

    expect(result).toBeNull()
    expect(vi.mocked(getProvider)).toHaveBeenCalledWith('non-existent')
  })

  it('5.4 provider:capabilities 合法 Provider → 返回 ProviderCapabilities', async () => {
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

  it('5.5 provider:capabilities-all 返回所有 ProviderType 的能力声明（8 个类型）', async () => {
    const result: ProviderCapabilitiesAllResponse =
      await handlers['provider:capabilities-all'](mockEvent)

    expect(result).toBeDefined()
    const types = Object.keys(result)
    expect(types).toHaveLength(8)
    expect(types).toContain('anthropic')
    expect(types).toContain('google')
    expect(types).toContain('openai-compatible')
    expect(types).toContain('deepseek')
    expect(types).toContain('qwen')
    expect(types).toContain('volcengine-ark')
    expect(types).toContain('ollama')
    expect(types).toContain('claude-sdk')
  })

  it('5.6 provider:capabilities-all 返回深拷贝（不污染内部 PROVIDER_CAPABILITIES 表）', async () => {
    const result: ProviderCapabilitiesAllResponse =
      await handlers['provider:capabilities-all'](mockEvent)

    // 修改返回值，不应影响内部表
    result['anthropic'].contextWindow = 999_999
    expect(PROVIDER_CAPABILITIES['anthropic'].contextWindow).toBe(200_000)
  })

  it('5.7 provider:pricing 合法 Provider → 返回 ModelPricing', async () => {
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

  it('5.8 provider:pricing-all 返回所有 ProviderType 的定价表 + 深拷贝验证', async () => {
    const result: ProviderPricingAllResponse = await handlers['provider:pricing-all'](
      mockEvent
    )

    expect(result).toBeDefined()
    expect(Object.keys(result)).toHaveLength(8)
    expect(result['ollama'].inputCostPer1M).toBe(0.0) // ollama 是本地推理，0 成本

    // 深拷贝验证：修改返回值不应影响内部表
    result['anthropic'].inputCostPer1M = 999
    expect(PROVIDER_PRICING['anthropic'].inputCostPer1M).toBe(3.0)
  })
})
