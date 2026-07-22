/**
 * Task Protocol 步骤 11-14 单元测试（v2.0 Phase D）
 *
 * 覆盖 task-protocol-steps-late.ts 的 4 个步骤函数：
 * - step 11: collect-usage（calculateCost + recordTokenUsage + 写入 ctx.usage）
 * - step 12: validate-output（output 非空 + finishReason 非 error）
 * - step 13: cleanup（释放 abortController）
 * - step 14: return-result（汇总 + 总耗时 + 失败列表）
 *
 * Mock 策略：
 * - electron + electron-store（logger 间接依赖）
 * - provider-pricing（getProviderPricing / calculateCost）
 * - token-stats.recordTokenUsage（避免触发持久化）
 * - mode-registry.DEFAULT_MODE（仅常量）
 * - task-protocol-helpers（保留纯函数 log 实现）
 *
 * 设计依据：v2.0 Phase D（task-protocol-steps-late.ts §11-14）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TaskProtocolContext, StepResult } from '../../src/main/core/agent/subagents/task-protocol-types'
import type { ProviderConfig, ChatResult } from '../../src/shared/agent-types'

// ============================================================================
// Mock：electron + electron-store
// ============================================================================
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test-userdata',
    isReady: () => true,
  },
}))

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
// Mock：provider-pricing（getProviderPricing / calculateCost）
// ============================================================================
const mockGetProviderPricing = vi.hoisted(() => vi.fn())
const mockCalculateCost = vi.hoisted(() => vi.fn())
vi.mock('../../src/main/core/agent/providers/provider-pricing', () => ({
  getProviderPricing: (...args: unknown[]) => mockGetProviderPricing(...args),
  calculateCost: (...args: unknown[]) => mockCalculateCost(...args),
}))

// ============================================================================
// Mock：token-stats.recordTokenUsage（避免触发持久化）
// ============================================================================
const mockRecordTokenUsage = vi.hoisted(() => vi.fn())
vi.mock('../../src/main/core/agent/providers/token-stats', () => ({
  recordTokenUsage: (...args: unknown[]) => mockRecordTokenUsage(...args),
}))

// ============================================================================
// Mock：mode-registry.DEFAULT_MODE（仅常量）
// ============================================================================
vi.mock('../../src/main/core/agent/modes/mode-registry', () => ({
  DEFAULT_MODE: 'chat',
}))

// ============================================================================
// Mock：task-protocol-helpers（保留纯函数 log 实现）
// ============================================================================
vi.mock('../../src/main/core/agent/subagents/task-protocol-helpers', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  readInputField: (input: unknown, field: string): unknown => {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      return (input as Record<string, unknown>)[field]
    }
    return undefined
  },
  extractStringField: (input: unknown, field: string): string | undefined => {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      const v = (input as Record<string, unknown>)[field]
      return typeof v === 'string' && v.length > 0 ? v : undefined
    }
    return undefined
  },
  createBuiltinRegistry: () => ({ get: () => null, list: () => [] }),
}))

// ============================================================================
// 导入被测模块（必须在 mock 注册之后）
// ============================================================================
import {
  stepCollectUsage,
  stepValidateOutput,
  stepCleanup,
  stepReturnResult,
} from '../../src/main/core/agent/subagents/task-protocol-steps-late'

// ============================================================================
// 工具函数
// ============================================================================
function makeCtx(overrides: Partial<TaskProtocolContext> = {}): TaskProtocolContext {
  return {
    taskId: 'task-001',
    subagentName: 'coding',
    input: 'test',
    completedSteps: [],
    currentStep: 0,
    cancelled: false,
    ...overrides,
  }
}

function makeProviderConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'deepseek-v4',
    name: 'DeepSeek V4',
    type: 'deepseek',
    baseURL: 'https://api.deepseek.com',
    apiKey: 'sk-test',
    model: 'deepseek-chat',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: false,
    enabled: true,
    ...overrides,
  }
}

function makeChatResult(overrides: Partial<ChatResult> = {}): ChatResult {
  return {
    text: 'LLM 输出文本',
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    finishReason: 'stop',
    providerId: 'deepseek-v4',
    model: 'deepseek-chat',
    strength: 'standard',
    durationMs: 200,
    compactionLevel: 'none',
    ...overrides,
  }
}

function makeStepResult(overrides: Partial<StepResult> = {}): StepResult {
  return {
    step: 'validate-input',
    success: true,
    durationMs: 10,
    ...overrides,
  }
}

// ============================================================================
// 测试用例
// ============================================================================

describe('[task-protocol-step-11] collect-usage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('11.1 成功路径：计算 cost + 调用 recordTokenUsage + 写入 ctx.usage', async () => {
    const config = makeProviderConfig()
    const chatResult = makeChatResult({
      usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
      providerId: config.id,
      model: config.model,
    })
    const ctx = makeCtx({
      chatResult,
      providerConfig: config,
      subagentName: 'coding',
      strength: 'standard',
    })

    mockGetProviderPricing.mockReturnValue({
      inputCostPer1M: 0.14,
      outputCostPer1M: 0.28,
      currency: 'USD',
    })
    mockCalculateCost.mockReturnValue(0.00028)

    const result = await stepCollectUsage(ctx)

    expect(result.success).toBe(true)
    expect(result.step).toBe('collect-usage')
    expect(mockGetProviderPricing).toHaveBeenCalledTimes(1)
    expect(mockGetProviderPricing).toHaveBeenCalledWith(config)
    expect(mockCalculateCost).toHaveBeenCalledWith(
      { inputTokens: 1000, outputTokens: 500 },
      { inputCostPer1M: 0.14, outputCostPer1M: 0.28, currency: 'USD' }
    )
    expect(mockRecordTokenUsage).toHaveBeenCalledTimes(1)
    const recorded = mockRecordTokenUsage.mock.calls[0][0] as {
      providerId: string
      model: string
      inputTokens: number
      outputTokens: number
      totalTokens: number
      subagent: string
      strength: string
      timestamp: number
      cost: number
    }
    expect(recorded.providerId).toBe(config.id)
    expect(recorded.model).toBe(config.model)
    expect(recorded.inputTokens).toBe(1000)
    expect(recorded.outputTokens).toBe(500)
    expect(recorded.totalTokens).toBe(1500)
    expect(recorded.subagent).toBe('coding')
    expect(recorded.strength).toBe('standard')
    expect(recorded.cost).toBe(0.00028)

    expect(ctx.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      cost: 0.00028,
    })
    expect(result.output).toMatchObject({
      inputTokens: 1000,
      outputTokens: 500,
      cost: 0.00028,
    })
  })

  it('11.2 失败路径：缺少 chatResult → success=false', async () => {
    const ctx = makeCtx()
    delete ctx.chatResult

    const result = await stepCollectUsage(ctx)

    expect(result.success).toBe(false)
    expect(result.error).toContain('chatResult')
    expect(mockRecordTokenUsage).not.toHaveBeenCalled()
    expect(ctx.usage).toBeUndefined()
  })

  it('11.3 边界：calculateCost 抛错时 usage 仍写入但 cost=undefined', async () => {
    const config = makeProviderConfig()
    const chatResult = makeChatResult({
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    })
    const ctx = makeCtx({
      chatResult,
      providerConfig: config,
    })

    mockGetProviderPricing.mockImplementation(() => {
      throw new Error('pricing 服务不可用')
    })

    const result = await stepCollectUsage(ctx)

    // 主流程仍成功（cost 计算失败仅记录日志，不中断）
    expect(result.success).toBe(true)
    expect(ctx.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      cost: undefined,
    })
    // recordTokenUsage 仍被调用（cost=undefined）
    expect(mockRecordTokenUsage).toHaveBeenCalledTimes(1)
  })

  it('11.4 边界：recordTokenUsage 抛错时不影响主流程', async () => {
    const config = makeProviderConfig()
    const chatResult = makeChatResult()
    const ctx = makeCtx({ chatResult, providerConfig: config })

    mockGetProviderPricing.mockReturnValue({
      inputCostPer1M: 1,
      outputCostPer1M: 3,
    })
    mockCalculateCost.mockReturnValue(0.001)
    mockRecordTokenUsage.mockImplementation(() => {
      throw new Error('electron-store 未就绪')
    })

    const result = await stepCollectUsage(ctx)

    expect(result.success).toBe(true)
    expect(ctx.usage?.cost).toBe(0.001)
  })

  it('11.5 边界：providerConfig 未注入时不计算 cost（cost=undefined）', async () => {
    const chatResult = makeChatResult()
    const ctx = makeCtx({ chatResult })
    delete ctx.providerConfig

    const result = await stepCollectUsage(ctx)

    expect(result.success).toBe(true)
    expect(mockGetProviderPricing).not.toHaveBeenCalled()
    expect(mockCalculateCost).not.toHaveBeenCalled()
    expect(ctx.usage?.cost).toBeUndefined()
    // recordTokenUsage 仍被调用
    expect(mockRecordTokenUsage).toHaveBeenCalledTimes(1)
  })
})

describe('[task-protocol-step-12] validate-output', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('12.1 成功路径：output 非空 + finishReason=stop → success=true', async () => {
    const ctx = makeCtx({
      output: '这是有效的输出',
      chatResult: makeChatResult({ finishReason: 'stop' }),
    })

    const result = await stepValidateOutput(ctx)

    expect(result.success).toBe(true)
    expect(result.step).toBe('validate-output')
    expect(result.output).toMatchObject({
      valid: true,
      // '这是有效的输出' = 7 个字符（中文字符按 1 计）
      outputLength: 7,
      finishReason: 'stop',
      isPartial: false,
    })
  })

  it('12.2 失败路径：output 为空字符串 → 走第一分支（输出为空或非字符串）', async () => {
    // 注：源码逻辑 `!ctx.output || typeof ctx.output !== 'string'` 会拦截空字符串
    // （`!""` = true），所以永远不会到达 `ctx.output.length === 0` 的第二分支。
    // 这是被测源码的"软 bug"（不影响功能，只是错误信息不够精确），
    // 测试按真实行为断言，不修改源码。
    const ctx = makeCtx({
      output: '',
      chatResult: makeChatResult(),
    })

    const result = await stepValidateOutput(ctx)

    expect(result.success).toBe(false)
    expect(result.error).toContain('输出为空或非字符串')
  })

  it('12.3 失败路径：output 为 undefined → success=false', async () => {
    const ctx = makeCtx()
    delete ctx.output

    const result = await stepValidateOutput(ctx)

    expect(result.success).toBe(false)
    expect(result.error).toContain('输出为空')
  })

  it('12.4 失败路径：finishReason=error → success=false', async () => {
    const ctx = makeCtx({
      output: '部分输出',
      chatResult: makeChatResult({ finishReason: 'error' }),
    })

    const result = await stepValidateOutput(ctx)

    expect(result.success).toBe(false)
    expect(result.error).toContain('finishReason=error')
  })

  it('12.5 边界：finishReason=cancelled → success=true 但 isPartial=true', async () => {
    const ctx = makeCtx({
      output: '部分输出',
      chatResult: makeChatResult({ finishReason: 'cancelled' }),
    })

    const result = await stepValidateOutput(ctx)

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      isPartial: true,
      finishReason: 'cancelled',
    })
  })

  it('12.6 边界：ctx.cancelled=true 但 finishReason=stop → isPartial=true', async () => {
    const ctx = makeCtx({
      output: '部分输出',
      cancelled: true,
      chatResult: makeChatResult({ finishReason: 'stop' }),
    })

    const result = await stepValidateOutput(ctx)

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({ isPartial: true })
  })
})

describe('[task-protocol-step-13] cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('13.1 成功路径：abortController 存在且未 abort → 主动 abort 并清理', async () => {
    const controller = new AbortController()
    const ctx = makeCtx({
      abortController: controller,
      completedSteps: [makeStepResult()],
    })

    const result = await stepCleanup(ctx)

    expect(result.success).toBe(true)
    expect(result.step).toBe('cleanup')
    expect(controller.signal.aborted).toBe(true)
    expect(ctx.abortController).toBeUndefined()
    expect(result.output).toMatchObject({
      cleaned: true,
      abortReleased: true,
      completedStepCount: 1,
    })
  })

  it('13.2 边界：abortController 已 aborted → 不重复 abort 且 abortReleased=false', async () => {
    const controller = new AbortController()
    controller.abort()
    const ctx = makeCtx({
      abortController: controller,
    })

    const result = await stepCleanup(ctx)

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      cleaned: true,
      abortReleased: false,
    })
    expect(ctx.abortController).toBeUndefined()
  })

  it('13.3 边界：abortController 未注入 → 仍返回 success=true 但 abortReleased=false', async () => {
    const ctx = makeCtx()
    delete ctx.abortController

    const result = await stepCleanup(ctx)

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      cleaned: true,
      abortReleased: false,
    })
  })

  it('13.4 边界：completedStepCount 字段反映 completedSteps 数量', async () => {
    const ctx = makeCtx({
      completedSteps: [
        makeStepResult({ step: 'validate-input' }),
        makeStepResult({ step: 'check-permission' }),
        makeStepResult({ step: 'load-subagent-config' }),
      ],
    })

    const result = await stepCleanup(ctx)

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({ completedStepCount: 3 })
  })
})

describe('[task-protocol-step-14] return-result', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('14.1 成功路径：所有步骤成功 → allSuccess=true 且无 failedSteps', async () => {
    const ctx = makeCtx({
      startTime: Date.now() - 1000,
      completedSteps: [
        makeStepResult({ step: 'validate-input', success: true, durationMs: 100 }),
        makeStepResult({ step: 'check-permission', success: true, durationMs: 50 }),
        makeStepResult({ step: 'cleanup', success: true, durationMs: 5 }),
      ],
      output: '最终输出',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cost: 0.001 },
      providerConfig: makeProviderConfig(),
      modelInstance: {
        model: { id: 'mock' } as never,
        config: { ...makeProviderConfig(), apiKey: undefined },
        resolvedModel: 'deepseek-chat',
      },
      mode: 'chat',
      subagentName: 'coding',
    })

    const result = await stepReturnResult(ctx)

    expect(result.success).toBe(true)
    expect(result.step).toBe('return-result')
    expect(result.output).toMatchObject({
      completedSteps: 3,
      allSuccess: true,
      output: '最终输出',
      usage: { inputTokens: 100, outputTokens: 50, cost: 0.001 },
      providerId: 'deepseek-v4',
      model: 'deepseek-chat',
      mode: 'chat',
      subagentName: 'coding',
    })
    // failedSteps 应为 undefined
    expect((result.output as { failedSteps?: string[] }).failedSteps).toBeUndefined()
    // totalDurationMs >= 1000（因为 startTime 设为 1s 前）
    expect(
      (result.output as { totalDurationMs: number }).totalDurationMs
    ).toBeGreaterThanOrEqual(1000)
  })

  it('14.2 边界：步骤失败时 allSuccess=false 且 failedSteps 包含失败步骤名', async () => {
    const ctx = makeCtx({
      startTime: Date.now(),
      completedSteps: [
        makeStepResult({ step: 'validate-input', success: true }),
        makeStepResult({
          step: 'check-permission',
          success: false,
          error: 'cancelled',
        }),
        makeStepResult({ step: 'cleanup', success: true }),
      ],
    })

    const result = await stepReturnResult(ctx)

    expect(result.success).toBe(true) // step 自身成功，仅汇总结果
    expect((result.output as { allSuccess: boolean }).allSuccess).toBe(false)
    expect((result.output as { failedSteps: string[] }).failedSteps).toEqual([
      'check-permission',
    ])
  })

  it('14.3 边界：startTime 未注入时用 completedSteps 累加 durationMs', async () => {
    const ctx = makeCtx({
      completedSteps: [
        makeStepResult({ step: 'validate-input', durationMs: 100 }),
        makeStepResult({ step: 'check-permission', durationMs: 50 }),
      ],
    })
    delete ctx.startTime

    const result = await stepReturnResult(ctx)

    expect(result.success).toBe(true)
    const output = result.output as { totalDurationMs: number }
    expect(output.totalDurationMs).toBe(150)
  })

  it('14.4 边界：output 为 undefined 时 resultSummary.output=null', async () => {
    const ctx = makeCtx({
      completedSteps: [makeStepResult()],
    })
    delete ctx.output

    const result = await stepReturnResult(ctx)

    expect(result.success).toBe(true)
    expect((result.output as { output: unknown }).output).toBeNull()
  })

  it('14.5 边界：providerConfig 未注入时 resultSummary.providerId=null', async () => {
    const ctx = makeCtx({
      completedSteps: [makeStepResult()],
    })
    delete ctx.providerConfig

    const result = await stepReturnResult(ctx)

    expect(result.success).toBe(true)
    expect((result.output as { providerId: unknown }).providerId).toBeNull()
  })
})
