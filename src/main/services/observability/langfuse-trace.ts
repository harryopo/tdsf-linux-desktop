/**
 * Langfuse 流式 trace 集成（D.5）
 *
 * 职责：
 * - 提供流式 LLM 调用的 trace 装饰器，包装 ClaudeSdkProvider.stream() 和 Supervisor.chat()
 * - 支持两种流式模式：
 *   1. AsyncIterable 模式（withStreamTrace）：包装返回 AsyncIterable 的函数（spec 要求接口）
 *   2. 回调模式（withCallbackStreamTrace）：包装基于 onToken/onDone/onError 的 Promise<void> 方法
 * - 提供 HITL 工作流的根 trace + 每步 span 辅助函数
 *
 * 设计约束：
 * - Langfuse 未启用时无副作用降级（直接调用原函数）
 * - trace 错误不影响主流程（try-catch 静默吞掉）
 * - TypeScript strict，禁止 any
 *
 * 调研依据：07-开源项目调研-AIOps-2025.md Top2
 * 方案书依据：R11 硬约束（OpenTelemetry 一统观测性，v1.0 集成 Langfuse）
 */
import type { ChatResult } from '@shared/agent-types'
import { LangfuseService, type SpanHandle, type TraceHandle, type LangfuseLevel } from './langfuse'

/** 流式 LLM 调用上下文 */
export interface StreamTraceContext {
  /** 会话 ID（关联到 SSH 会话或 correlationId） */
  sessionId: string
  /** 工作流名（'claude-sdk-stream' | 'supervisor-chat' | 'subagent-invoke' | 'hitl-step'） */
  workflowName: string
  /** 用户问题（用于 trace input） */
  userQuery?: string
  /** 子 agent 名（subagent-invoke 时设置） */
  subagentName?: string
  /** HITL 7 步名（hitl-step 时设置） */
  stepName?: string
  /** 自定义元数据 */
  metadata?: Record<string, unknown>
}

/** 回调式流参数基础接口（被包装方法需满足此结构） */
export interface CallbackStreamParams {
  /** token 流式回调（每个 chunk 调用一次） */
  onToken?: (delta: string) => void
  /** 完成回调（含完整结果） */
  onDone?: (result: ChatResult) => void
  /** 错误回调 */
  onError?: (error: Error) => void
}

/**
 * 流式包装器：包装一个返回 AsyncIterable 的函数（spec 接口）
 *
 * 用于纯 AsyncIterable 流（如未来基于 ai-sdk streamText 的直接迭代）。
 * 当被包装函数 yield 多个 chunk 时，每个 chunk 透传给上层，
 * 同时累积到 output；流结束后 span.end(output, level=DEFAULT)。
 *
 * Langfuse 未启用时直接 yield* fn()（无副作用降级）。
 *
 * @param fn - 返回 AsyncIterable<T> 的函数
 * @param ctx - 流式 trace 上下文
 * @returns AsyncIterable<T>（透传所有 chunk）
 */
export async function* withStreamTrace<T>(
  fn: () => AsyncIterable<T>,
  ctx: StreamTraceContext
): AsyncIterable<T> {
  const langfuse = LangfuseService.getInstance()
  if (!langfuse.isEnabled()) {
    // Langfuse 未启用时直接透传
    yield* fn()
    return
  }

  let trace: TraceHandle
  let span: SpanHandle
  try {
    trace = langfuse.startTrace({
      sessionId: ctx.sessionId,
      workflowName: ctx.workflowName,
      userQuery: ctx.userQuery,
      metadata: buildStreamMetadata(ctx),
    })
    span = trace.span({
      name: ctx.workflowName,
      input: ctx.userQuery,
      metadata: ctx.metadata,
    })
  } catch {
    // Langfuse trace 创建失败 — 降级到无 trace 模式
    yield* fn()
    return
  }

  const chunks: T[] = []
  try {
    for await (const chunk of fn()) {
      chunks.push(chunk)
      yield chunk
    }
    const output = concatenateChunks(chunks)
    try {
      span.end(output, { level: 'DEFAULT' })
      trace.end({ level: 'DEFAULT' })
    } catch {
      // 静默吞掉 trace 错误，不影响主流程
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    try {
      span.end({ error: error.message }, { level: 'ERROR', statusMessage: error.message })
      trace.end({ level: 'ERROR', statusMessage: error.message })
    } catch {
      // 静默吞掉 trace 错误
    }
    throw error
  }
}

/**
 * 回调式流包装器：包装基于 onToken/onDone/onError 回调的流方法
 *
 * 适用于 ClaudeSdkProvider.stream() 和 Supervisor.chat()，
 * 这两个方法返回 Promise<void>，通过回调推送流式数据。
 *
 * 行为：
 * - Langfuse 未启用时直接调用 fn(params)（无副作用降级）
 * - 启用时：包装 params 中的 onToken/onDone/onError 回调以累积 token，
 *   成功时 span.end(accumulated text, level=DEFAULT)
 *   fn 内部通过 onError 回调报告错误时 span.end(error, level=ERROR)（不 rethrow，保持原行为）
 *   fn reject 时 span.end(error, level=ERROR) + rethrow
 *
 * @param fn - 被包装的流方法（接收 params，返回 Promise<void>）
 * @param params - 流参数（含 onToken/onDone/onError 回调）
 * @param ctx - 流式 trace 上下文
 */
export async function withCallbackStreamTrace<TParams extends CallbackStreamParams>(
  fn: (params: TParams) => Promise<void>,
  params: TParams,
  ctx: StreamTraceContext
): Promise<void> {
  const langfuse = LangfuseService.getInstance()
  if (!langfuse.isEnabled()) {
    return fn(params)
  }

  let trace: TraceHandle
  let span: SpanHandle
  try {
    trace = langfuse.startTrace({
      sessionId: ctx.sessionId,
      workflowName: ctx.workflowName,
      userQuery: ctx.userQuery,
      metadata: buildStreamMetadata(ctx),
    })
    span = trace.span({
      name: ctx.workflowName,
      input: ctx.userQuery,
      metadata: ctx.metadata,
    })
  } catch {
    // Langfuse trace 创建失败 — 降级
    return fn(params)
  }

  let accumulated = ''
  let doneResult: ChatResult | undefined
  let caughtError: Error | null = null

  // 包装回调以累积 token + 透传给原回调
  const wrappedParams = {
    ...params,
    onToken: (delta: string) => {
      accumulated += delta
      try {
        params.onToken?.(delta)
      } catch {
        // 静默吞掉回调错误，不影响主流程
      }
    },
    onDone: (result: ChatResult) => {
      doneResult = result
      try {
        params.onDone?.(result)
      } catch {
        // 静默吞掉回调错误
      }
    },
    onError: (err: Error) => {
      caughtError = err
      try {
        params.onError?.(err)
      } catch {
        // 静默吞掉回调错误
      }
    },
  } as TParams

  try {
    await fn(wrappedParams)
    // fn resolve — 可能通过 onError 回调报告了错误（内部处理），或通过 onDone 报告成功
    if (caughtError) {
      // 闭包内赋值不会被 TS 控制流分析识别，需显式断言为 Error
      const errMsg = (caughtError as Error).message
      try {
        span.end(
          { error: errMsg },
          { level: 'ERROR', statusMessage: errMsg }
        )
        trace.end({ level: 'ERROR', statusMessage: errMsg })
      } catch {
        // 静默吞掉 trace 错误
      }
    } else {
      try {
        // 优先用 doneResult.text，降级到 accumulated
        const output = doneResult?.text ?? accumulated
        span.end(output, { level: 'DEFAULT' })
        trace.end({ level: 'DEFAULT' })
      } catch {
        // 静默吞掉 trace 错误
      }
    }
  } catch (err) {
    // fn reject — 传播错误 + 记录 ERROR trace
    const error = err instanceof Error ? err : new Error(String(err))
    try {
      span.end({ error: error.message }, { level: 'ERROR', statusMessage: error.message })
      trace.end({ level: 'ERROR', statusMessage: error.message })
    } catch {
      // 静默吞掉 trace 错误
    }
    throw error
  }
}

// ============================================================================
// HITL 工作流 trace 辅助
// ============================================================================

/**
 * 创建 HITL 工作流的根 trace
 *
 * 在 AgentWorkflow.start() 入口调用，返回 TraceHandle（Langfuse 未启用时返回 null）。
 * 工作流结束时调用 trace.end() 收尾。
 *
 * @param ctx - 流式 trace 上下文（workflowName 建议 'hitl-workflow'）
 * @returns TraceHandle 或 null（未启用时）
 */
export function startHitlTrace(ctx: StreamTraceContext): TraceHandle | null {
  const langfuse = LangfuseService.getInstance()
  if (!langfuse.isEnabled()) {
    return null
  }
  try {
    return langfuse.startTrace({
      sessionId: ctx.sessionId,
      workflowName: ctx.workflowName,
      userQuery: ctx.userQuery,
      metadata: buildStreamMetadata(ctx),
    })
  } catch {
    return null
  }
}

/** HITL 步骤 span 句柄 */
export interface HitlStepTraceHandle {
  /**
   * 结束步骤 span
   *
   * @param output - 步骤输出（可选）
   * @param level - Langfuse level（DEFAULT=成功，ERROR=失败）
   * @param statusMessage - 状态消息（错误时设置）
   */
  end(output?: unknown, level?: LangfuseLevel, statusMessage?: string): void
}

/**
 * 在 HITL 根 trace 下创建步骤 span
 *
 * 用于 7 步 HITL 工作流的每一步：collect / analyze / reason / check / confirm / execute / verify。
 * span 名为 `hitl-${stepName}`。
 *
 * Langfuse 未启用或 parentTrace 为 null 时返回 noop handle，调用方无感知。
 *
 * @param parentTrace - HITL 根 trace（来自 startHitlTrace）
 * @param stepName - 步骤名（collect / analyze / reason / check / confirm / execute / verify）
 * @param input - 步骤输入（可选，记录到 span.input）
 * @returns HitlStepTraceHandle
 */
export function startHitlStepTrace(
  parentTrace: TraceHandle | null,
  stepName: string,
  input?: unknown
): HitlStepTraceHandle {
  if (!parentTrace) {
    return {
      end() {
        // noop
      },
    }
  }
  try {
    const span = parentTrace.span({
      name: `hitl-${stepName}`,
      input,
    })
    return {
      end(output, level = 'DEFAULT', statusMessage) {
        try {
          const opts: { level?: LangfuseLevel; statusMessage?: string } = {}
          if (level) opts.level = level
          if (statusMessage) opts.statusMessage = statusMessage
          span.end(output, opts)
        } catch {
          // 静默吞掉
        }
      },
    }
  } catch {
    return {
      end() {
        // noop
      },
    }
  }
}

// ============================================================================
// 内部辅助函数
// ============================================================================

/**
 * 构建流式 trace 的 metadata（合并 ctx.metadata + subagentName + stepName）
 */
function buildStreamMetadata(ctx: StreamTraceContext): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = { ...(ctx.metadata ?? {}) }
  if (ctx.subagentName) meta.subagentName = ctx.subagentName
  if (ctx.stepName) meta.stepName = ctx.stepName
  return Object.keys(meta).length > 0 ? meta : undefined
}

/**
 * 拼接 chunk 数组为 output
 *
 * - 字符串 chunk：直接拼接
 * - 其他类型：返回数组
 */
function concatenateChunks<T>(chunks: T[]): unknown {
  if (chunks.length === 0) return undefined
  if (typeof chunks[0] === 'string') {
    return chunks.join('')
  }
  return chunks
}
