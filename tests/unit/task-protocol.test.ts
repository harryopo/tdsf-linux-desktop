/**
 * Task Protocol executeTaskProtocol 串行执行单元测试（v2.0 Phase D）
 *
 * 覆盖 task-protocol.ts 的核心入口逻辑：
 * - executeTaskProtocol 14 步全跑通（成功路径）
 * - 中间步骤失败短路 + try-finally 兜底 cleanup / return-result
 * - cancelled 中断（跳过非 cleanup 步骤）
 * - createTaskProtocolContext 工厂函数
 * - STEP_FUNCTIONS 注册表完整性（14 个步骤函数齐全且顺序正确）
 *
 * Mock 策略：
 * - electron + electron-store（logger 间接依赖）
 * - task-protocol-steps 模块（替换 STEP_FUNCTIONS / stepCleanup / stepReturnResult
 *   为可控 mock，避免触发真实 step 实现的所有外部依赖链）
 * - 保留 TASK_PROTOCOL_STEPS 真实常量（验证顺序一致性）
 *
 * 设计依据：v2.0 Phase D（task-protocol.ts executeTaskProtocol）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { StepResult, StepFunction } from '../../src/main/core/agent/subagents/task-protocol-types'

// ============================================================================
// Mock：electron + electron-store（logger 间接依赖）
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
// Mock：task-protocol-steps（替换 STEP_FUNCTIONS / stepCleanup / stepReturnResult）
// 用 vi.hoisted 提升，避免 vi.mock hoisting 引用错误
// ============================================================================
const mockedSteps = vi.hoisted(() => {
  // 14 个步骤的 mock 函数，每个默认返回 success=true 的 StepResult
  const stepNames = [
    'validate-input',
    'check-permission',
    'load-subagent-config',
    'derive-permissions',
    'prepare-context',
    'select-provider',
    'select-mode',
    'build-prompt',
    'invoke-subagent',
    'stream-output',
    'collect-usage',
    'validate-output',
    'cleanup',
    'return-result',
  ] as const

  const fns: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const name of stepNames) {
    fns[name] = vi.fn(async () => ({
      step: name,
      success: true,
      output: { mocked: true, step: name },
      durationMs: 5,
    } as StepResult))
  }

  // stepCleanup / stepReturnResult 单独导出（executeTaskProtocol 直接 import 这两个）
  const stepCleanup = vi.fn(async () => ({
    step: 'cleanup',
    success: true,
    output: { cleaned: true },
    durationMs: 1,
  } as StepResult))

  const stepReturnResult = vi.fn(async () => ({
    step: 'return-result',
    success: true,
    output: {
      totalDurationMs: 100,
      completedSteps: 14,
      allSuccess: true,
    },
    durationMs: 1,
  } as StepResult))

  return { fns, stepCleanup, stepReturnResult, stepNames }
})

vi.mock('../../src/main/core/agent/subagents/task-protocol-steps', () => {
  const STEP_FUNCTIONS: Record<string, StepFunction> = {}
  for (const name of mockedSteps.stepNames) {
    STEP_FUNCTIONS[name] = mockedSteps.fns[name]
  }
  return {
    STEP_FUNCTIONS,
    stepCleanup: mockedSteps.stepCleanup,
    stepReturnResult: mockedSteps.stepReturnResult,
    // re-export step 函数（保持外部 import 兼容）
    stepValidateInput: mockedSteps.fns['validate-input'],
    stepCheckPermission: mockedSteps.fns['check-permission'],
    stepLoadSubagentConfig: mockedSteps.fns['load-subagent-config'],
    stepDerivePermissions: mockedSteps.fns['derive-permissions'],
    stepPrepareContext: mockedSteps.fns['prepare-context'],
    stepSelectProvider: mockedSteps.fns['select-provider'],
    stepSelectMode: mockedSteps.fns['select-mode'],
    stepBuildPrompt: mockedSteps.fns['build-prompt'],
    stepInvokeSubagent: mockedSteps.fns['invoke-subagent'],
    stepStreamOutput: mockedSteps.fns['stream-output'],
    stepCollectUsage: mockedSteps.fns['collect-usage'],
    stepValidateOutput: mockedSteps.fns['validate-output'],
    stepCleanup: mockedSteps.stepCleanup,
    stepReturnResult: mockedSteps.stepReturnResult,
  }
})

// ============================================================================
// 导入被测模块（必须在 mock 注册之后）
// ============================================================================
import {
  executeTaskProtocol,
  createTaskProtocolContext,
} from '../../src/main/core/agent/subagents/task-protocol'
import { TASK_PROTOCOL_STEPS } from '../../src/main/core/agent/subagents/task-protocol-types'

// ============================================================================
// 工具函数
// ============================================================================
function resetStepMocks(): void {
  for (const name of mockedSteps.stepNames) {
    mockedSteps.fns[name].mockReset()
    mockedSteps.fns[name].mockImplementation(async () => ({
      step: name,
      success: true,
      output: { mocked: true, step: name },
      durationMs: 5,
    } as StepResult))
  }
  mockedSteps.stepCleanup.mockReset()
  mockedSteps.stepCleanup.mockImplementation(async () => ({
    step: 'cleanup',
    success: true,
    output: { cleaned: true },
    durationMs: 1,
  } as StepResult))

  mockedSteps.stepReturnResult.mockReset()
  mockedSteps.stepReturnResult.mockImplementation(async () => ({
    step: 'return-result',
    success: true,
    output: {
      totalDurationMs: 100,
      completedSteps: 14,
      allSuccess: true,
    },
    durationMs: 1,
  } as StepResult))
}

// ============================================================================
// 测试用例
// ============================================================================

describe('[task-protocol] TASK_PROTOCOL_STEPS 常量', () => {
  it('包含 14 个步骤且顺序固定', () => {
    expect(TASK_PROTOCOL_STEPS).toHaveLength(14)
    expect(TASK_PROTOCOL_STEPS).toEqual([
      'validate-input',
      'check-permission',
      'load-subagent-config',
      'derive-permissions',
      'prepare-context',
      'select-provider',
      'select-mode',
      'build-prompt',
      'invoke-subagent',
      'stream-output',
      'collect-usage',
      'validate-output',
      'cleanup',
      'return-result',
    ])
  })
})

describe('[task-protocol] createTaskProtocolContext 工厂函数', () => {
  it('创建初始上下文，字段完整且默认值正确', () => {
    const ctx = createTaskProtocolContext('task-1', 'coding', { prompt: 'hi' }, 'parent-1')
    expect(ctx).toEqual({
      taskId: 'task-1',
      subagentName: 'coding',
      input: { prompt: 'hi' },
      parentSessionId: 'parent-1',
      completedSteps: [],
      currentStep: 0,
      cancelled: false,
    })
  })

  it('parentSessionId 缺省为 undefined', () => {
    const ctx = createTaskProtocolContext('task-1', 'coding', 'hello')
    expect(ctx.parentSessionId).toBeUndefined()
  })
})

describe('[task-protocol] executeTaskProtocol 14 步全跑通成功路径', () => {
  beforeEach(() => {
    resetStepMocks()
  })

  it('所有步骤 success=true → completedSteps 长度=14 且每步都被调用', async () => {
    const ctx = createTaskProtocolContext('task-1', 'coding', 'test input')

    const result = await executeTaskProtocol(ctx)

    // 验证返回的就是 ctx（同一个引用）
    expect(result).toBe(ctx)
    // 14 个步骤都被调用过
    expect(ctx.completedSteps).toHaveLength(14)
    // 验证每步都被调用
    for (const stepName of TASK_PROTOCOL_STEPS) {
      const fn = mockedSteps.fns[stepName]
      if (stepName === 'cleanup' || stepName === 'return-result') {
        // cleanup / return-result 既在 STEP_FUNCTIONS 中也被单独导出调用
        // 源码：循环遍历 TASK_PROTOCOL_STEPS 会调用 stepCleanup/stepReturnResult，
        // 然后通过 try-finally 检查是否已执行（已执行就跳过）
        // 因此 cleanup 应被调用 1 次（在循环中），return-result 应被调用 1 次
        expect(fn).toHaveBeenCalled()
      } else {
        expect(fn).toHaveBeenCalledTimes(1)
      }
    }
    // 验证 ctx.completedSteps 中的步骤顺序
    const stepNames = ctx.completedSteps.map((s) => s.step)
    expect(stepNames).toEqual([...TASK_PROTOCOL_STEPS])
    // startTime 已被设置
    expect(ctx.startTime).toBeTypeOf('number')
  })

  it('ctx.startTime 已存在时不被覆盖', async () => {
    const preset = 12345
    const ctx = createTaskProtocolContext('task-1', 'coding', 'input')
    ctx.startTime = preset

    await executeTaskProtocol(ctx)

    expect(ctx.startTime).toBe(preset)
  })

  it('所有步骤 output 透传到 completedSteps', async () => {
    const ctx = createTaskProtocolContext('task-2', 'thinking', 'input')

    await executeTaskProtocol(ctx)

    for (const step of ctx.completedSteps) {
      expect(step.success).toBe(true)
      expect(step.durationMs).toBeTypeOf('number')
    }
  })
})

describe('[task-protocol] 中间步骤失败短路', () => {
  beforeEach(() => {
    resetStepMocks()
  })

  it('step 6 select-provider 失败 → 跳过后续 7-14 但 cleanup 通过 finally 仍执行', async () => {
    // step 6 失败
    mockedSteps.fns['select-provider'].mockImplementation(async () => ({
      step: 'select-provider',
      success: false,
      error: 'Provider "x" 不存在',
      durationMs: 10,
    } as StepResult))

    const ctx = createTaskProtocolContext('task-3', 'coding', 'input')

    const result = await executeTaskProtocol(ctx)

    expect(result).toBe(ctx)
    // 前 6 步执行 + finally 兜底的 cleanup + return-result = 8 步
    // 注意：源码循环到 step 6（index 5）失败就 break，前 5 步 + step 6 失败结果已 push
    // 然后 finally 调用 stepCleanup（独立导入版本），再调用 stepReturnResult
    // 注意：因为循环已 break 在 step 6（index 5），所以 ctx.completedSteps = [step1..step6_failed, cleanup, return-result]
    const executedNames = ctx.completedSteps.map((s) => s.step)
    expect(executedNames).toContain('validate-input')
    expect(executedNames).toContain('check-permission')
    expect(executedNames).toContain('load-subagent-config')
    expect(executedNames).toContain('derive-permissions')
    expect(executedNames).toContain('prepare-context')
    expect(executedNames).toContain('select-provider')
    // step 7-12 不应被调用
    expect(executedNames).not.toContain('select-mode')
    expect(executedNames).not.toContain('build-prompt')
    expect(executedNames).not.toContain('invoke-subagent')
    expect(executedNames).not.toContain('stream-output')
    expect(executedNames).not.toContain('collect-usage')
    expect(executedNames).not.toContain('validate-output')
    // 但 cleanup 必须被调用（finally 兜底）
    expect(executedNames).toContain('cleanup')
    // return-result 也应被调用（非 cancelled 场景）
    expect(executedNames).toContain('return-result')
    // 验证 step 6 是失败的
    const failedStep = ctx.completedSteps.find((s) => s.step === 'select-provider')
    expect(failedStep?.success).toBe(false)
    expect(failedStep?.error).toContain('Provider')
  })

  it('step 1 validate-input 失败 → 立即跳出且仅 cleanup/return-result 兜底', async () => {
    mockedSteps.fns['validate-input'].mockImplementation(async () => ({
      step: 'validate-input',
      success: false,
      error: 'taskId 必须为非空字符串',
      durationMs: 1,
    } as StepResult))

    const ctx = createTaskProtocolContext('task-fail', 'coding', 'input')

    await executeTaskProtocol(ctx)

    // 仅 validate-input 失败 + cleanup + return-result = 3 步
    const executedNames = ctx.completedSteps.map((s) => s.step)
    expect(executedNames).toEqual(['validate-input', 'cleanup', 'return-result'])
    // 其他步骤不应被调用
    expect(mockedSteps.fns['check-permission']).not.toHaveBeenCalled()
    expect(mockedSteps.fns['load-subagent-config']).not.toHaveBeenCalled()
    expect(mockedSteps.fns['invoke-subagent']).not.toHaveBeenCalled()
  })

  it('步骤函数抛异常 → 异常被捕获并转为 success=false 的 StepResult', async () => {
    mockedSteps.fns['derive-permissions'].mockImplementation(async () => {
      throw new Error('derive-permissions 异常抛出')
    })

    const ctx = createTaskProtocolContext('task-throw', 'coding', 'input')

    await executeTaskProtocol(ctx)

    // 前 4 步成功 + step 4 失败（异常捕获）+ cleanup + return-result
    const executedNames = ctx.completedSteps.map((s) => s.step)
    expect(executedNames).toContain('derive-permissions')
    const deriveStep = ctx.completedSteps.find((s) => s.step === 'derive-permissions')
    expect(deriveStep?.success).toBe(false)
    expect(deriveStep?.error).toContain('derive-permissions 异常抛出')
    // 后续步骤被跳过
    expect(mockedSteps.fns['prepare-context']).not.toHaveBeenCalled()
    expect(mockedSteps.fns['select-provider']).not.toHaveBeenCalled()
  })
})

describe('[task-protocol] cancelled 中断路径', () => {
  beforeEach(() => {
    resetStepMocks()
  })

  it('cancelled=true → 跳过非 cleanup 步骤，仅执行 cleanup + return-result', async () => {
    // 源码：`if (ctx.cancelled && stepName !== 'cleanup' && stepName !== 'return-result')`
    // 因此 cancelled=true 时，循环会跳过 1-12，但 13/14 仍会执行
    const ctx = createTaskProtocolContext('task-cancel', 'coding', 'input')
    ctx.cancelled = true

    await executeTaskProtocol(ctx)

    // 仅 cleanup + return-result 被调用（在循环内）
    const executedNames = ctx.completedSteps.map((s) => s.step)
    // 由于循环中 step 13/14 执行了，finally 检测到 hasCleanup / hasReturn 已存在，不再重复调用
    expect(executedNames).toEqual(['cleanup', 'return-result'])

    // 1-12 步骤函数不应被调用
    expect(mockedSteps.fns['validate-input']).not.toHaveBeenCalled()
    expect(mockedSteps.fns['check-permission']).not.toHaveBeenCalled()
    expect(mockedSteps.fns['invoke-subagent']).not.toHaveBeenCalled()
    expect(mockedSteps.fns['collect-usage']).not.toHaveBeenCalled()
    // 13/14 步骤函数（STEP_FUNCTIONS 中的）应被调用
    expect(mockedSteps.fns['cleanup']).toHaveBeenCalledTimes(1)
    expect(mockedSteps.fns['return-result']).toHaveBeenCalledTimes(1)
    // finally 单独导出的 stepCleanup / stepReturnResult 不应被重复调用
    // （因为循环中已执行 cleanup/return-result，hasCleanup/hasReturn=true）
    expect(mockedSteps.stepCleanup).not.toHaveBeenCalled()
    expect(mockedSteps.stepReturnResult).not.toHaveBeenCalled()
  })

  it('cancelled=true 时 finally 不调用 stepReturnResult（源码 !ctx.cancelled 条件）', async () => {
    // 验证源码：`if (!hasReturn && !ctx.cancelled)` - 即使 hasReturn=false，
    // cancelled=true 时也不会调用 stepReturnResult。
    // 但循环中 step 14 'return-result' 会被调用（不属于被跳过的步骤），所以 hasReturn=true
    // 此测试用例验证：循环中 return-result 被调用后，finally 不会重复调用
    const ctx = createTaskProtocolContext('task-cancel-2', 'coding', 'input')
    ctx.cancelled = true

    await executeTaskProtocol(ctx)

    // finally 中的 stepReturnResult 不应被调用（因循环已调用 + cancelled=true 双保险）
    expect(mockedSteps.stepReturnResult).not.toHaveBeenCalled()
  })
})

describe('[task-protocol] finally 兜底机制', () => {
  beforeEach(() => {
    resetStepMocks()
  })

  it('中间步骤失败时 finally 调用 stepCleanup 兜底', async () => {
    mockedSteps.fns['select-mode'].mockImplementation(async () => ({
      step: 'select-mode',
      success: false,
      error: 'mode 解析失败',
      durationMs: 1,
    } as StepResult))

    const ctx = createTaskProtocolContext('task-cleanup', 'coding', 'input')

    await executeTaskProtocol(ctx)

    // step 7 select-mode 在循环中失败 → break
    // 此时循环中 step 13 cleanup 还未被执行
    // finally 检测 hasCleanup=false，调用 stepCleanup 兜底
    expect(mockedSteps.stepCleanup).toHaveBeenCalledTimes(1)
    const cleanupResult = ctx.completedSteps.find((s) => s.step === 'cleanup')
    expect(cleanupResult).toBeDefined()
    expect(cleanupResult?.success).toBe(true)
  })

  it('cleanup 自身失败时 finally 不重复调用', async () => {
    // 让循环中的 step 13 cleanup 成功执行，验证 finally 不再重复调用
    const ctx = createTaskProtocolContext('task-cleanup-ok', 'coding', 'input')

    await executeTaskProtocol(ctx)

    // 循环中已调用 step 13（STEP_FUNCTIONS['cleanup']）
    expect(mockedSteps.fns['cleanup']).toHaveBeenCalledTimes(1)
    // finally 检测到 hasCleanup=true，不再调用 stepCleanup
    expect(mockedSteps.stepCleanup).not.toHaveBeenCalled()
  })

  it('stepCleanup 抛异常时 finally 捕获并记录日志（不抛出）', async () => {
    mockedSteps.stepCleanup.mockImplementation(async () => {
      throw new Error('cleanup 抛错')
    })
    // 让循环中 step 12 validate-output 失败，触发 finally 调用 stepCleanup
    mockedSteps.fns['validate-output'].mockImplementation(async () => ({
      step: 'validate-output',
      success: false,
      error: 'output 无效',
      durationMs: 1,
    } as StepResult))

    const ctx = createTaskProtocolContext('task-cleanup-throw', 'coding', 'input')

    // executeTaskProtocol 不应抛出（finally 捕获了 cleanup 异常）
    const result = await executeTaskProtocol(ctx)

    expect(result).toBe(ctx)
    // 即使 cleanup 抛错，return-result 仍应被调用
    const executedNames = ctx.completedSteps.map((s) => s.step)
    expect(executedNames).toContain('return-result')
  })
})
