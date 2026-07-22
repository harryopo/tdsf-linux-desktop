/**
 * Subagent 调度 14 步协议 - 步骤 11-14（D.3 尾 + D.4）
 *
 * 从 task-protocol-steps.ts 拆分而来（避免单文件超 500 行硬约束）。
 *
 * 包含：
 * - step 11: collect-usage（D.3，getProviderPricing + calculateCost + recordTokenUsage）
 * - step 12: validate-output（D.4，校验非空 + finishReason 非 error）
 * - step 13: cleanup（D.4，释放 abortController）
 * - step 14: return-result（D.4，计算总耗时 + 汇总 failedSteps）
 */
import type { TaskProtocolContext, StepResult, StepUsage } from './task-protocol-types'
import { recordTokenUsage } from '../providers/token-stats'
import { getProviderPricing, calculateCost } from '../providers/provider-pricing'
import { DEFAULT_MODE } from '../modes/mode-registry'
import { log } from './task-protocol-helpers'

// ============================================================================
// D.3 尾：step 11（collect-usage）
// ============================================================================

/**
 * 步骤 11：收集 token usage
 *
 * 借鉴 Kilo Code：KiloCostPropagation.propagate(parentSessionID, costDelta)
 * - 子 session 成本传播到父 session
 *
 * 真实逻辑：
 * 1. 从 ctx.chatResult.usage 读取 inputTokens / outputTokens / totalTokens
 * 2. 计算 cost（用 calculateCost + getProviderPricing）
 * 3. 调用 recordTokenUsage 记录到统计服务
 * 4. 写入 ctx.usage
 */
export async function stepCollectUsage(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    if (!ctx.chatResult) {
      return {
        step: 'collect-usage',
        success: false,
        error: '缺少 chatResult（invoke-subagent 步骤未产出）',
        durationMs: Date.now() - start,
      }
    }

    // 1. 读取 usage
    const { inputTokens, outputTokens, totalTokens } = ctx.chatResult.usage
    const providerId = ctx.chatResult.providerId
    const model = ctx.chatResult.model

    // 2. 计算 cost
    let cost: number | undefined
    if (ctx.providerConfig) {
      try {
        const pricing = getProviderPricing(ctx.providerConfig)
        cost = calculateCost({ inputTokens, outputTokens }, pricing)
      } catch (err) {
        log.warn('计算成本失败（getProviderPricing / calculateCost 抛错）', {
          providerId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // 3. 记录到 token-stats
    try {
      recordTokenUsage({
        providerId,
        model,
        inputTokens,
        outputTokens,
        totalTokens,
        subagent: ctx.subagentName,
        strength: ctx.strength ?? 'standard',
        timestamp: Date.now(),
        cost,
      })
    } catch (err) {
      log.warn('recordTokenUsage 抛错（可能 electron-store 未就绪）', {
        providerId,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // 4. 写入 ctx
    const usage: StepUsage = { inputTokens, outputTokens, totalTokens, cost }
    ctx.usage = usage

    log.info('step 11/14 collect-usage 通过', {
      taskId: ctx.taskId,
      providerId,
      model,
      inputTokens,
      outputTokens,
      totalTokens,
      cost,
    })
    return {
      step: 'collect-usage',
      success: true,
      output: { inputTokens, outputTokens, totalTokens, cost },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'collect-usage',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

// ============================================================================
// D.4：step 12-14（validate-output / cleanup / return-result）
// ============================================================================

/**
 * 步骤 12：校验输出
 *
 * 真实逻辑：
 * 1. 校验 ctx.output 非空字符串
 * 2. 校验 ctx.output 长度 >= 1
 * 3. 校验 ctx.chatResult.finishReason 非 'error'
 */
export async function stepValidateOutput(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    // 1. 校验 output 非空
    if (!ctx.output || typeof ctx.output !== 'string') {
      return {
        step: 'validate-output',
        success: false,
        error: '输出为空或非字符串',
        durationMs: Date.now() - start,
      }
    }
    if (ctx.output.length === 0) {
      return {
        step: 'validate-output',
        success: false,
        error: '输出长度为 0',
        durationMs: Date.now() - start,
      }
    }

    // 2. 校验 finishReason 非 error
    const finishReason = ctx.chatResult?.finishReason ?? 'unknown'
    if (finishReason === 'error') {
      return {
        step: 'validate-output',
        success: false,
        error: `LLM 调用失败（finishReason=error）`,
        durationMs: Date.now() - start,
      }
    }

    // 3. cancelled 状态视为部分输出（success=true 但标记）
    const isPartial = finishReason === 'cancelled' || ctx.cancelled

    log.debug('step 12/14 validate-output 通过', {
      taskId: ctx.taskId,
      outputLength: ctx.output.length,
      finishReason,
      isPartial,
    })
    return {
      step: 'validate-output',
      success: true,
      output: {
        valid: true,
        outputLength: ctx.output.length,
        finishReason,
        isPartial,
      },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'validate-output',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * 步骤 13：清理资源
 *
 * 真实逻辑：
 * 1. 释放 abortController（如果存在且未 abort）
 * 2. 标记 cleaned = true
 * 3. 此步骤在 executeTaskProtocol 中通过 try-finally 保证总是被调用
 */
export async function stepCleanup(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    // 1. 释放 abortController（如果存在且未 abort）
    let abortReleased = false
    if (ctx.abortController) {
      if (!ctx.abortController.signal.aborted) {
        // 主动 abort（清理进行中的请求）
        ctx.abortController.abort()
        abortReleased = true
        log.debug('cleanup: 主动 abort AbortController（清理进行中请求）', {
          taskId: ctx.taskId,
        })
      }
      ctx.abortController = undefined
    }

    log.debug('step 13/14 cleanup 通过', {
      taskId: ctx.taskId,
      completedSteps: ctx.completedSteps.length,
      abortReleased,
    })
    return {
      step: 'cleanup',
      success: true,
      output: {
        cleaned: true,
        completedStepCount: ctx.completedSteps.length,
        abortReleased,
      },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'cleanup',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * 步骤 14：返回结果
 *
 * 真实逻辑：
 * 1. 汇总 completedSteps
 * 2. 计算总耗时（含 startTime）
 * 3. 构建最终结果对象（output / usage / success）
 */
export async function stepReturnResult(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    // 1. 计算总耗时
    const totalDurationMs = ctx.startTime !== undefined
      ? Date.now() - ctx.startTime
      : ctx.completedSteps.reduce((sum, s) => sum + s.durationMs, 0)

    // 2. 汇总步骤成功状态
    const allSuccess = ctx.completedSteps.every((s) => s.success)
    const failedSteps = ctx.completedSteps.filter((s) => !s.success).map((s) => s.step)

    // 3. 构建最终结果
    const resultSummary = {
      totalDurationMs,
      completedSteps: ctx.completedSteps.length,
      allSuccess,
      failedSteps: failedSteps.length > 0 ? failedSteps : undefined,
      output: ctx.output ?? null,
      usage: ctx.usage ?? null,
      providerId: ctx.providerConfig?.id ?? null,
      model: ctx.modelInstance?.resolvedModel ?? ctx.providerConfig?.model ?? null,
      mode: ctx.mode ?? DEFAULT_MODE,
      subagentName: ctx.subagentName,
    }

    log.info('step 14/14 return-result 通过', {
      taskId: ctx.taskId,
      subagentName: ctx.subagentName,
      completedSteps: ctx.completedSteps.length,
      totalDurationMs,
      allSuccess,
      failedStepsCount: failedSteps.length,
      outputLength: ctx.output?.length ?? 0,
      usage: ctx.usage,
    })
    return {
      step: 'return-result',
      success: true,
      output: resultSummary,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'return-result',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}
