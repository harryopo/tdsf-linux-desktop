/**
 * SDK 消息 → CoT Trace 收集器适配器（v0.9.6 P2 M5+ 新增）
 *
 * 职责：
 * 把 Claude Agent SDK 的 SDKMessage 流转换为 CotTraceCollector 的 recordXXX() 调用。
 *
 * 适配策略（按优先级降级）：
 * 1. SDKAssistantMessage 包含 thinking block → collector.recordThinkingBlock(text)
 * 2. SDKAssistantMessage 是普通助手消息 → collector.recordTurnText(text) + collector.accumulateFinalText(text)
 * 3. SDKPartialAssistantMessage 流式 delta → collector.accumulateFinalText(delta)
 *
 * SDK Message 类型回顾（基于 @anthropic-ai/claude-agent-sdk 实际 API）：
 * - SDKAssistantMessage.message.content: BetaContentBlock[]（可能含 type='thinking' | 'text' | 'tool_use'）
 * - SDKPartialAssistantMessage.event: BetaRawMessageStreamEvent（content_block_delta）
 * - SDKResultMessage: 终止消息
 *
 * 设计原则：
 * - 不修改 SDK 原始消息（只读 + 安全收窄）
 * - 显式标注每个 step 来源（trace 审计用）
 * - 边界处理：空 content / 非数组 content / 未知 type 全部静默跳过
 */

import type {
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { CotTraceCollector } from './cot-trace-collector'

/**
 * BetaContentBlock 的最小结构化形状（仅访问 type / thinking / text 字段）
 *
 * 不直接 import `@anthropic-ai/sdk`（peer 依赖），用结构化类型安全收窄。
 */
interface ContentBlockShape {
  type: string
  /** thinking block：推理文本（Anthropic Claude with thinking enabled） */
  thinking?: string
  /** text block：最终输出文本 */
  text?: string
}

/**
 * 从 SDKAssistantMessage 提取 thinking blocks 文本列表
 *
 * 遍历 `message.content` 数组，收集所有 `type === 'thinking'` 块。
 * 一次助手消息可能包含 0-N 个 thinking block（多步推理）。
 *
 * @param message SDK 助手消息
 * @returns thinking block 文本数组（已过滤空字符串）
 */
export function extractThinkingBlocks(message: SDKAssistantMessage): string[] {
  const content = message?.message?.content
  const blocks: ContentBlockShape[] = Array.isArray(content)
    ? (content as unknown as ContentBlockShape[])
    : []

  return blocks
    .filter((b) => b?.type === 'thinking' && typeof b.thinking === 'string')
    .map((b) => (b.thinking as string).trim())
    .filter((t) => t.length > 0)
}

/**
 * 从 SDKAssistantMessage 提取所有 text block 文本（已拼接）
 *
 * 遍历 `message.content` 数组，拼接所有 `type === 'text'` 块。
 * 跳过 thinking / tool_use / image 等非文本块。
 *
 * @param message SDK 助手消息
 * @returns 拼接后的纯文本（可能为空字符串）
 */
export function extractTextBlocks(message: SDKAssistantMessage): string {
  const content = message?.message?.content
  const blocks: ContentBlockShape[] = Array.isArray(content)
    ? (content as unknown as ContentBlockShape[])
    : []

  return blocks
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
    .trim()
}

/**
 * 适配 SDKAssistantMessage 到 collector
 *
 * 行为：
 * - 提取所有 thinking blocks → collector.recordThinkingBlock(text)
 * - 提取所有 text blocks → collector.recordTurnText(text) + collector.accumulateFinalText(text)
 * - 任一为空时静默跳过
 *
 * @param message SDK 助手消息
 * @param collector 收集器实例
 * @returns 适配的步骤数（用于日志/审计）
 */
export function adaptAssistantMessageToCollector(
  message: SDKAssistantMessage,
  collector: CotTraceCollector
): { thinkingSteps: number; turnTextLength: number } {
  const thinkingBlocks = extractThinkingBlocks(message)
  for (const tb of thinkingBlocks) {
    collector.recordThinkingBlock(tb)
  }

  const turnText = extractTextBlocks(message)
  let turnTextLength = 0
  if (turnText.length > 0) {
    collector.recordTurnText(turnText)
    collector.accumulateFinalText(turnText)
    turnTextLength = turnText.length
  }

  return {
    thinkingSteps: thinkingBlocks.length,
    turnTextLength,
  }
}

/**
 * 适配 SDKPartialAssistantMessage 流式 delta 到 collector
 *
 * 流式 delta 不包含 thinking block 边界（thinking 是离散的），
 * 因此仅累积 finalText 用于 fallback 切分。
 *
 * @param partial SDK 流式事件
 * @param collector 收集器实例
 * @returns 是否有文本增量
 */
export function adaptPartialMessageToCollector(
  partial: SDKPartialAssistantMessage,
  collector: CotTraceCollector
): boolean {
  const event = partial?.event as unknown as
    | { type: string; delta?: { type: string; text?: string } }
    | undefined
  if (!event || event.type !== 'content_block_delta') {
    return false
  }
  const delta = event.delta
  if (!delta || delta.type !== 'text_delta' || typeof delta.text !== 'string') {
    return false
  }
  collector.accumulateFinalText(delta.text)
  return true
}

/**
 * 适配 SDKResultMessage（终止消息）到 collector
 *
 * ResultMessage 不携带增量数据，但用于在 collector 中标记"流结束"，
 * 目前仅返回 SDK 暴露的 num_turns（用于审计交叉验证）。
 *
 * @param result SDK 终止消息
 * @returns num_turns（agent loop 轮次数，-1 表示非 success）
 */
export function extractNumTurns(result: SDKResultMessage): number {
  // SDKResultSuccess 有 num_turns，SDKResultError 也有
  if (typeof (result as { num_turns?: number }).num_turns === 'number') {
    return (result as { num_turns: number }).num_turns
  }
  return -1
}
