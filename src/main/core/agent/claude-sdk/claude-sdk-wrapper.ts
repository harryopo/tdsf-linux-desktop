/**
 * Claude Agent SDK 输出包装层
 *
 * 职责：
 * 将 Claude Agent SDK 的输出格式（SDKMessage 联合类型）转换为项目统一的
 * `ChatResult` / 流式 chunk 文本，使其能与现有 Provider 抽象层、Token 统计、
 * Supervisor 流式 chat 协议无缝对接。
 *
 * 关键事实（基于 @anthropic-ai/claude-agent-sdk@0.3.211 实际 API）：
 * - `query()` 返回 `AsyncGenerator<SDKMessage, void>`，迭代过程中会产出
 *   `SDKAssistantMessage` / `SDKPartialAssistantMessage` / `SDKResultMessage` 等。
 * - `SDKResultMessage = SDKResultSuccess | SDKResultError` 是终止消息，
 *   含 `usage` / `total_cost_usd` / `duration_ms` / `num_turns` / `stop_reason`。
 * - `SDKAssistantMessage.message` 是 @anthropic-ai/sdk 的 `BetaMessage`，
 *   `content` 是 `BetaContentBlock[]`，其中 `BetaTextBlock`（type='text'）携带文本。
 * - `SDKPartialAssistantMessage.event` 是 `BetaRawMessageStreamEvent`，
 *   其中 `content_block_delta` 事件 + `text_delta` 子类型携带流式文本增量。
 * - `NonNullableUsage` 是 `BetaUsage` 的 NonNullable 版本，
 *   含 `input_tokens` / `output_tokens` 等字段。
 *
 * 类型策略：
 * - 仅依赖 `@anthropic-ai/claude-agent-sdk` 的导出类型（项目的直接 dependency）。
 * - 不直接 import `@anthropic-ai/sdk`（peer 依赖，pnpm 严格模式下不在顶层 node_modules）。
 * - 对 BetaMessage.content 与 BetaRawMessageStreamEvent.delta 使用结构化类型断言
 *   （仅访问 type/text 两个字段，安全收窄）。
 *
 * Hard Constraints 对齐：
 * - HC-1 网络日志：所有转换入口记录 logger.info（SDK 调用是远程网络操作）
 * - HC-2 redactSecrets：text 输出经过 redactSecrets 脱敏后再返回
 * - HC-3 本地优先：纯本地转换，无额外网络依赖
 *
 * 方案书依据：v0.9 §3（Provider 抽象）+ 调研文档 §8.2（SDK 输出转换契约）
 */
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKResultSuccess,
  SDKResultError,
  NonNullableUsage,
} from '@anthropic-ai/claude-agent-sdk'
import type { ChatResult, CompactionLevel, ThinkingStrength } from '@shared/agent-types'
import { redactSecrets } from '../providers/redact'
import { logger } from '../../../services/log/logger'

/**
 * BetaTextBlock 的最小结构化形状（仅访问 type/text 字段）
 *
 * 不直接 import `@anthropic-ai/sdk`（peer 依赖），用结构化类型安全收窄。
 */
interface TextBlockShape {
  type: string
  text?: string
}

/**
 * BetaRawContentBlockDeltaEvent 的最小结构化形状
 *
 * 用于流式增量提取：event.type === 'content_block_delta' && event.delta.type === 'text_delta'
 */
interface ContentBlockDeltaEventShape {
  type: string
  delta?: {
    type: string
    text?: string
  }
}

/**
 * ChatResult 转换上下文（由调用方填充）
 */
export interface ConvertClaudeResultOptions {
  /** 触发的 Provider ID（如 'claude-sonnet-4-5'） */
  providerId: string
  /** 实际使用的模型名（如 'claude-sonnet-4-5'） */
  model: string
  /** 思考强度 */
  strength: ThinkingStrength
  /** compaction 触发层级（来自 Supervisor 上下文管理） */
  compactionLevel: CompactionLevel
  /** 调用关联 ID（用于日志追踪） */
  correlationId?: string
}

/**
 * 从 SDK 助手消息（BetaMessage）中提取纯文本
 *
 * 遍历 `message.content` 数组，拼接所有 `BetaTextBlock`（type='text'）的 text 字段，
 * 跳过 tool_use / thinking / image 等非文本块。
 *
 * @param message SDK 助手消息
 * @returns 拼接后的纯文本（已脱敏）
 */
export function extractAssistantText(message: SDKAssistantMessage): string {
  const content = message?.message?.content
  const blocks: TextBlockShape[] = Array.isArray(content)
    ? (content as unknown as TextBlockShape[])
    : []
  const raw = blocks
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
  // HC-2：输出脱敏（模型可能复述 .env 路径、API Key 等）
  return redactSecrets(raw)
}

/**
 * 从 SDK 流式事件中提取文本增量
 *
 * 处理 `SDKPartialAssistantMessage`（type='stream_event'）：
 * - 仅 `event.type === 'content_block_delta'` 且 `event.delta.type === 'text_delta'`
 *   时返回 `delta.text`
 * - 其他事件（content_block_start / message_start / message_delta 等）返回空串
 *
 * @param partial SDK 流式事件消息
 * @returns 文本增量（已脱敏；空字符串表示无文本增量）
 */
export function extractPartialText(partial: SDKPartialAssistantMessage): string {
  const event = partial?.event as unknown as ContentBlockDeltaEventShape | undefined
  if (!event || event.type !== 'content_block_delta') {
    return ''
  }
  const delta = event.delta
  if (!delta || delta.type !== 'text_delta' || typeof delta.text !== 'string') {
    return ''
  }
  // HC-2：流式增量也需脱敏（防止流式中途泄露密钥）
  return redactSecrets(delta.text)
}

/**
 * 从 SDK NonNullableUsage 提取 token 使用统计
 *
 * NonNullableUsage 字段：
 * - input_tokens: number（用户输入 + 工具结果 + 历史消息）
 * - output_tokens: number（模型生成）
 * - cache_creation_input_tokens / cache_read_input_tokens: number（缓存统计，单列）
 *
 * 总 token 数 = input_tokens + output_tokens
 * （缓存 token 已包含在 input_tokens 中，不重复计入 totalTokens）
 *
 * @param usage SDK NonNullableUsage
 * @returns 统一的 token 使用统计
 */
export function extractUsage(
  usage: NonNullableUsage | undefined
): { inputTokens: number; outputTokens: number; totalTokens: number } {
  const inputTokens = usage?.input_tokens ?? 0
  const outputTokens = usage?.output_tokens ?? 0
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  }
}

/**
 * 把 SDK 的 stop_reason 映射到项目统一的 finishReason
 *
 * SDK stop_reason 取值（来自 Anthropic Messages API）：
 * - 'end_turn' / 'stop_sequence' / 'max_tokens' / 'tool_use' / 'pause_turn' /
 *   'refusal' / 'model_refusal_fallback' / 'server_shutdown' / null
 *
 * ChatResult.finishReason 约定：
 * - 'stop' / 'length' / 'content-filter' / 'tool-calls' / 'error' / 'cancelled' / 'unknown'
 *
 * @param stopReason SDK stop_reason
 * @returns 项目统一的 finishReason
 */
export function mapStopReason(stopReason: string | null | undefined): string {
  if (!stopReason) return 'unknown'
  switch (stopReason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop'
    case 'max_tokens':
      return 'length'
    case 'tool_use':
    case 'pause_turn':
      return 'tool-calls'
    case 'refusal':
    case 'model_refusal_fallback':
      return 'content-filter'
    default:
      return 'unknown'
  }
}

/**
 * 把 SDK 错误子类型映射到项目统一的 finishReason + 用户可读消息
 *
 * SDKResultError.subtype 取值：
 * - 'error_during_execution' — 执行中异常（工具失败、网络错误等）
 * - 'error_max_turns' — 超过 maxTurns 限制
 * - 'error_max_budget_usd' — 超过 maxBudgetUsd 预算
 * - 'error_max_structured_output_retries' — 结构化输出重试上限
 *
 * @param subtype SDK 错误子类型
 * @param errors SDK 错误详情数组
 * @returns 项目统一的 finishReason + 消息
 */
export function mapErrorSubtype(
  subtype: SDKResultError['subtype'],
  errors: string[]
): { finishReason: string; message: string } {
  const detail = errors?.length > 0 ? errors.join('; ') : subtype
  switch (subtype) {
    case 'error_max_turns':
      return { finishReason: 'length', message: `已达最大轮次上限: ${detail}` }
    case 'error_max_budget_usd':
      return { finishReason: 'length', message: `已达预算上限: ${detail}` }
    case 'error_max_structured_output_retries':
      return { finishReason: 'error', message: `结构化输出重试上限: ${detail}` }
    case 'error_during_execution':
    default:
      return { finishReason: 'error', message: `SDK 执行失败: ${detail}` }
  }
}

/**
 * 将 SDK 最终结果消息转换为项目统一的 ChatResult
 *
 * 处理两种情况：
 * 1. SDKResultSuccess：用 `result` 字段作为完整文本，usage / duration_ms / stop_reason 直接映射
 * 2. SDKResultError：finishReason 来自 subtype 映射，usage 仍然提取（已消耗的 token）
 *
 * 注意：
 * - 成功时优先使用 `result` 字段（SDK 已聚合所有 assistant turn 的最终文本），
 *   若调用方传入了累积文本 `accumulatedText`，则使用累积文本（流式场景更准确）。
 * - 错误时 text 为空串，错误信息通过 finishReason + 日志体现（不混入 text）。
 *
 * @param result SDK 终止消息（SDKResultSuccess | SDKResultError）
 * @param options 转换上下文
 * @param accumulatedText 流式累积的文本（可选，成功时优先使用）
 * @returns 项目统一的 ChatResult
 */
export function convertClaudeResultToChatResult(
  result: SDKResultMessage,
  options: ConvertClaudeResultOptions,
  accumulatedText?: string,
  cotEntropyTrajectory?: number[]
): ChatResult {
  const { providerId, model, strength, compactionLevel, correlationId } = options
  const isSuccess = result.subtype === 'success'

  if (isSuccess) {
    const success = result as SDKResultSuccess
    // 成功时：优先使用累积文本（流式场景已拼接所有 chunk），其次用 SDK result 字段
    const rawText = accumulatedText ?? success.result ?? ''
    const text = redactSecrets(rawText) // HC-2：最终输出脱敏
    const usage = extractUsage(success.usage)
    const durationMs = success.duration_ms ?? 0

    logger.info('AGENT.CLAUDE_SDK.WRAPPER', `SDK 调用成功`, {
      correlationId,
      providerId,
      model,
      durationMs,
      numTurns: success.num_turns,
      totalCostUsd: success.total_cost_usd,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      stopReason: success.stop_reason,
      textLength: text.length,
      cotTraceSteps: cotEntropyTrajectory?.length ?? 0,
    })

    return {
      text,
      usage,
      finishReason: mapStopReason(success.stop_reason),
      providerId,
      model,
      strength,
      durationMs,
      compactionLevel,
      // v0.9.6 P2 M5+：附加 CoT 熵轨迹（可选，undefined 时不参与 ai-param 融合）
      cotEntropyTrajectory: cotEntropyTrajectory && cotEntropyTrajectory.length > 0
        ? cotEntropyTrajectory
        : undefined,
    }
  }

  // 错误分支
  const errorResult = result as SDKResultError
  const { finishReason, message } = mapErrorSubtype(errorResult.subtype, errorResult.errors ?? [])
  const usage = extractUsage(errorResult.usage)
  const durationMs = errorResult.duration_ms ?? 0

  logger.error('AGENT.CLAUDE_SDK.WRAPPER', `SDK 调用失败`, {
    correlationId,
    providerId,
    model,
    subtype: errorResult.subtype,
    durationMs,
    numTurns: errorResult.num_turns,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    errors: errorResult.errors,
    message: redactSecrets(message),
  })

  return {
    text: '', // 错误时不返回文本，由调用方根据 finishReason 决定如何提示用户
    usage,
    finishReason,
    providerId,
    model,
    strength,
    durationMs,
    compactionLevel,
  }
}

/**
 * 判断 SDK 消息是否为终止消息（SDKResultMessage）
 *
 * 用于流式迭代时识别终点，触发 ChatResult 转换。
 *
 * @param message SDK 消息
 * @returns 是否为终止消息
 */
export function isResultMessage(message: SDKMessage): message is SDKResultMessage {
  return message?.type === 'result'
}

/**
 * 判断 SDK 消息是否为助手消息（SDKAssistantMessage）
 *
 * 用于流式迭代时累积完整 assistant 文本（非流式场景下 result.result 已足够，
 * 但开启 forwardSubagentText 或多轮时仍需从 assistant message 提取）。
 *
 * @param message SDK 消息
 * @returns 是否为助手消息
 */
export function isAssistantMessage(message: SDKMessage): message is SDKAssistantMessage {
  return message?.type === 'assistant'
}

/**
 * 判断 SDK 消息是否为流式增量消息（SDKPartialAssistantMessage）
 *
 * 用于流式迭代时提取文本增量并推送给渲染进程。
 * 仅当 `Options.includePartialMessages: true` 时才会收到此类消息。
 *
 * @param message SDK 消息
 * @returns 是否为流式增量消息
 */
export function isPartialAssistantMessage(
  message: SDKMessage
): message is SDKPartialAssistantMessage {
  return message?.type === 'stream_event'
}
