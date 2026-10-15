/**
 * 上下文管理（Context Manager）
 *
 * 职责：
 * - 实现 5 层 compaction 阈值（借鉴 Claude Code 5 层 compaction pipeline）
 * - L1：单条消息 > 4K tokens → 摘要压缩（后续可接入 Mastra memory summarize）
 * - L2：会话 > 50K tokens → 滑动窗口 + 历史摘要
 * - L3：会话 > 100K tokens → 重要节点抽取 + Dexie 持久化
 * - L4：会话 > 75% max → 摘要压缩（LLM 生成摘要，降级为首尾提取）
 * - L5：会话 > 90% max → 语义去重（Jaccard 相似度，纯算法无 API 开销）
 *
 * 当前版本（v0.9）：
 * - 定义 5 层阈值常量
 * - 实现 L1-L3 简单截断（粗略 token 估算）
 * - 实现 L4 摘要压缩（含 LLM 可选 + 降级）
 * - 实现 L5 语义去重（纯计算）
 *
 * 方案书依据：v0.9 §3.3（上下文管理）
 */
import type { ModelMessage } from 'ai'
import { logger } from '../../services/log/logger'

/**
 * 尺子本体在 shared/context-budget.ts：主进程压缩与渲染层"压缩上下文"按钮共用同一份
 * token 估算与同一组阈值。这里只做转发，不再抄第二遍。
 */
export {
  COMPACTION_THRESHOLDS,
  resolveCompactionThresholds,
  estimateTokens,
  estimateMessageTokens,
} from '@shared/context-budget'
export type { CompactionThresholds } from '@shared/context-budget'
import {
  estimateMessageTokens,
  estimateTokens,
  resolveCompactionThresholds,
  type CompactionThresholds,
} from '@shared/context-budget'

/** LLM 摘要函数签名（可选注入） */
export type SummarizeFn = (text: string) => Promise<string>

/**
 * Compaction 决策结果
 */
export interface CompactionResult {
  /** 处理后的消息列表 */
  messages: ModelMessage[]
  /** 触发的层级（'none' / 'L1' / 'L2' / 'L3' / 'L4' / 'L5'） */
  level: 'none' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5'
  /** 处理前 token 数 */
  beforeTokens: number
  /** 处理后 token 数 */
  afterTokens: number
  /** 被截断的消息数 */
  truncatedCount: number
}

/**
 * 检查并执行 compaction（L1-L5 完整版）
 *
 * - L1：单条消息超阈值 → 截断保留头尾（中间用 [...省略...] 占位）
 * - L2：会话超软阈值 → 滑动窗口保留最近一段
 * - L3：会话超硬阈值 → 更激进的滑动窗口 + 重要节点抽取占位
 * - L4：会话 > 75% 窗口 → 摘要压缩（同步降级：首尾提取；异步版走 LLM 摘要）
 * - L5：会话 > 90% 窗口 → 语义去重（Jaccard 相似度，纯算法无 API 开销）
 *
 * @param messages 当前消息列表
 * @param contextWindowTokens 该 Provider 的生效上下文窗口；0/缺省 = 未知，按原绝对阈值
 */
export function compactIfNeeded(
  messages: ModelMessage[],
  contextWindowTokens?: number,
): CompactionResult {
  const thresholds = resolveCompactionThresholds(contextWindowTokens)
  const beforeTokens = estimateMessageTokens(messages)
  let level: CompactionResult['level'] = 'none'
  let truncatedCount = 0

  // L1：单条消息超阈值 → 截断
  const [afterL1, l1Truncated] = applySingleMessageTruncation(messages, thresholds)
  truncatedCount += l1Truncated
  if (l1Truncated > 0) {
    level = 'L1'
    logger.info('AGENT.CONTEXT', `L1 compaction 触发：截断了 ${l1Truncated} 条消息`, {
      beforeTokens,
      windowTokens: thresholds.windowTokens,
    })
  }

  // L2 / L3：会话总 tokens 超阈值 → 滑动窗口
  const { messages: afterWindows, triggered: windowLevel } = applySessionWindows(afterL1, thresholds)
  if (windowLevel !== 'none' && level === 'none') level = windowLevel
  let result = afterWindows
  let afterTokens = estimateMessageTokens(result)

  // L4：摘要压缩（同步降级模式：首尾提取）
  if (afterTokens > thresholds.critical) {
    const before = result.length
    result = applySummaryCompaction(result, thresholds.keepRecentTokens)
    afterTokens = estimateMessageTokens(result)
    level = 'L4'
    truncatedCount += before - result.length
    logger.warn('AGENT.CONTEXT', `L4 compaction 触发：摘要压缩（降级模式），${before} → ${result.length} 条`, {
      beforeTokens,
      afterTokens,
      windowTokens: thresholds.windowTokens,
    })
  }

  // L5：语义去重（Jaccard 相似度，纯算法）
  if (afterTokens > thresholds.dedup) {
    const before = result.length
    result = applySemanticDedup(result, thresholds.similarity)
    afterTokens = estimateMessageTokens(result)
    level = 'L5'
    truncatedCount += before - result.length
    logger.warn('AGENT.CONTEXT', `L5 compaction 触发：语义去重，${before} → ${result.length} 条`, {
      beforeTokens,
      afterTokens,
    })
  }

  return { messages: result, level, beforeTokens, afterTokens, truncatedCount }
}

/**
 * 异步版 compaction（L4 使用 LLM 生成摘要）
 *
 * 与 compactIfNeeded 同一把阈值（共用 applySingleMessageTruncation / applySessionWindows），
 * 只有 L4 换成注入的 summarizer；未提供或调用失败时降级到首尾提取。
 *
 * @param messages 当前消息列表
 * @param summarizer 可选的 LLM 摘要函数
 * @param contextWindowTokens 该 Provider 的生效上下文窗口
 */
export async function compactIfNeededAsync(
  messages: ModelMessage[],
  summarizer?: SummarizeFn,
  contextWindowTokens?: number,
): Promise<CompactionResult> {
  const thresholds = resolveCompactionThresholds(contextWindowTokens)
  const beforeTokens = estimateMessageTokens(messages)
  let level: CompactionResult['level'] = 'none'
  let truncatedCount = 0

  const [afterL1, l1Truncated] = applySingleMessageTruncation(messages, thresholds)
  truncatedCount += l1Truncated
  if (l1Truncated > 0) level = 'L1'

  const { messages: afterWindows, triggered: windowLevel } = applySessionWindows(afterL1, thresholds)
  if (windowLevel !== 'none' && level === 'none') level = windowLevel
  let result = afterWindows
  let afterTokens = estimateMessageTokens(result)

  if (afterTokens > thresholds.critical) {
    const before = result.length
    result = await applySummaryCompactionAsync(result, thresholds.keepRecentTokens, summarizer)
    afterTokens = estimateMessageTokens(result)
    level = 'L4'
    truncatedCount += before - result.length
    logger.warn('AGENT.CONTEXT', `L4 compaction 触发（async）：${before} → ${result.length} 条`, {
      beforeTokens,
      afterTokens,
      windowTokens: thresholds.windowTokens,
    })
  }

  if (afterTokens > thresholds.dedup) {
    const before = result.length
    result = applySemanticDedup(result, thresholds.similarity)
    afterTokens = estimateMessageTokens(result)
    level = 'L5'
    truncatedCount += before - result.length
    logger.warn('AGENT.CONTEXT', `L5 compaction 触发（async）：${before} → ${result.length} 条`, {
      beforeTokens,
      afterTokens,
    })
  }

  return { messages: result, level, beforeTokens, afterTokens, truncatedCount }
}

// ─── 内部工具函数 ────────────────────────────────────────────────────────────

/**
 * L1：把超阈值的单条消息截成"头 + 省略提示 + 尾"
 *
 * 头尾长度按阈值等比缩放（默认窗口 4K tokens 时正好是原来的 6000 / 3000 字符）。
 * 不缩放的话小窗口模型会出现"阈值 2400 tokens、却照抄 6000 字符头"—— 截了等于没截。
 *
 * @returns [处理后的消息, 被截断的条数]
 */
function applySingleMessageTruncation(
  messages: ModelMessage[],
  thresholds: CompactionThresholds,
): [ModelMessage[], number] {
  const headChars = Math.round(thresholds.singleMessage * 1.5)
  const tailChars = Math.round(thresholds.singleMessage * 0.75)
  let truncated = 0
  const result = messages.map((m) => {
    if (typeof m.content !== 'string' || estimateTokens(m.content) <= thresholds.singleMessage) {
      return m
    }
    const content = m.content
    const head = content.slice(0, headChars)
    const tail = content.slice(-tailChars)
    const dropped = Math.max(0, estimateTokens(content) - estimateTokens(head) - estimateTokens(tail))
    truncated++
    return {
      ...m,
      content: `${head}\n\n[...省略约 ${dropped} tokens 内容（L1 compaction 触发）...]\n\n${tail}`,
    } as ModelMessage
  })
  return [result, truncated]
}

/**
 * L2 / L3：两级滑动窗口
 *
 * 两级都留"最近一段"，但保留量不同：软阈值留 20% 窗口，硬阈值只留 10%。
 */
function applySessionWindows(
  messages: ModelMessage[],
  thresholds: CompactionThresholds,
): { messages: ModelMessage[]; triggered: 'none' | 'L2' | 'L3' } {
  let result = messages
  let triggered: 'none' | 'L2' | 'L3' = 'none'
  const windowKeep = (ratioOfWindow: number, absolute: number): number =>
    thresholds.windowTokens > 0
      ? Math.max(1, Math.min(absolute, Math.floor(thresholds.windowTokens * ratioOfWindow)))
      : absolute

  if (estimateMessageTokens(result) > thresholds.sessionSoft) {
    result = applySlidingWindow(result, windowKeep(0.2, 30_000))
    triggered = 'L2'
    logger.info('AGENT.CONTEXT', `L2 compaction 触发：滑动窗口压缩`, {
      afterTokens: estimateMessageTokens(result),
      windowTokens: thresholds.windowTokens,
    })
  }
  if (estimateMessageTokens(result) > thresholds.sessionHard) {
    result = applySlidingWindow(result, windowKeep(0.1, 50_000))
    if (triggered === 'none') triggered = 'L3'
    logger.warn('AGENT.CONTEXT', `L3 compaction 触发：会话超硬阈值，激进滑动窗口压缩`, {
      afterTokens: estimateMessageTokens(result),
      windowTokens: thresholds.windowTokens,
    })
  }
  return { messages: result, triggered }
}

/**
 * 滑动窗口：保留最近 maxTokens tokens 的消息
 *
 * 不破坏 system 消息（始终保留首条 system）。
 *
 * @param messages 消息列表
 * @param maxTokens 保留的最大 tokens
 */
function applySlidingWindow(messages: ModelMessage[], maxTokens: number): ModelMessage[] {
  if (messages.length === 0) return messages

  // 始终保留首条 system 消息
  const head = messages[0]?.role === 'system' ? [messages[0]] : []
  const tail = messages[0]?.role === 'system' ? messages.slice(1) : messages

  // 从尾部开始累加，直到达到 maxTokens
  const kept: ModelMessage[] = []
  let used = 0
  for (let i = tail.length - 1; i >= 0; i--) {
    const msgTokens = estimateMessageTokens([tail[i]])
    if (used + msgTokens > maxTokens) {
      break
    }
    kept.unshift(tail[i])
    used += msgTokens
  }

  return [...head, ...kept]
}

/**
 * L4 摘要压缩（同步降级版）：将旧消息替换为首尾提取的摘要
 *
 * 保留最近 keepRecentTokens 的消息不动，将更旧的消息压缩为一条 system 摘要。
 * 降级策略：提取旧段首条 + 末条内容作为摘要（无需 LLM）。
 *
 * @param messages 消息列表
 * @param keepRecentTokens 保留最近消息的 token 上限
 */
function applySummaryCompaction(messages: ModelMessage[], keepRecentTokens: number): ModelMessage[] {
  if (messages.length <= 2) return messages

  const head = messages[0]?.role === 'system' ? [messages[0]] : []
  const body = messages[0]?.role === 'system' ? messages.slice(1) : messages

  // 从尾部累加，划分"最近保留"与"待压缩"
  const recent: ModelMessage[] = []
  let used = 0
  let splitIdx = body.length
  for (let i = body.length - 1; i >= 0; i--) {
    const t = estimateMessageTokens([body[i]])
    if (used + t > keepRecentTokens) break
    recent.unshift(body[i])
    used += t
    splitIdx = i
  }

  const oldSegment = body.slice(0, splitIdx)
  if (oldSegment.length === 0) return messages

  // 降级摘要：提取首条 + 末条
  const firstText = extractText(oldSegment[0]).slice(0, 500)
  const lastText = extractText(oldSegment[oldSegment.length - 1]).slice(0, 500)
  const summary = `[历史摘要 - ${oldSegment.length} 条消息已压缩]\n起始：${firstText}\n...\n最近：${lastText}`

  const summaryMsg: ModelMessage = { role: 'system', content: summary } as ModelMessage
  return [...head, summaryMsg, ...recent]
}

/**
 * L4 摘要压缩（异步 LLM 版）：调用 summarizer 生成高质量摘要
 *
 * 若 summarizer 未提供或调用失败，自动降级到 applySummaryCompaction。
 *
 * @param messages 消息列表
 * @param keepRecentTokens 保留最近消息的 token 上限
 * @param summarizer 可选 LLM 摘要函数
 */
async function applySummaryCompactionAsync(
  messages: ModelMessage[],
  keepRecentTokens: number,
  summarizer?: SummarizeFn,
): Promise<ModelMessage[]> {
  if (messages.length <= 2) return messages
  if (!summarizer) return applySummaryCompaction(messages, keepRecentTokens)

  const head = messages[0]?.role === 'system' ? [messages[0]] : []
  const body = messages[0]?.role === 'system' ? messages.slice(1) : messages

  const recent: ModelMessage[] = []
  let used = 0
  let splitIdx = body.length
  for (let i = body.length - 1; i >= 0; i--) {
    const t = estimateMessageTokens([body[i]])
    if (used + t > keepRecentTokens) break
    recent.unshift(body[i])
    used += t
    splitIdx = i
  }

  const oldSegment = body.slice(0, splitIdx)
  if (oldSegment.length === 0) return messages

  // 拼接旧段文本，调用 LLM 摘要
  const oldText = oldSegment.map((m) => `[${m.role}] ${extractText(m)}`).join('\n').slice(0, 12_000)
  const prompt = '将以下对话历史压缩为一段简洁摘要，保留关键决策、命令和结果：\n\n' + oldText

  try {
    const summaryText = await summarizer(prompt)
    const summaryMsg: ModelMessage = {
      role: 'system',
      content: `[历史摘要 - ${oldSegment.length} 条消息已压缩]\n${summaryText}`,
    } as ModelMessage
    return [...head, summaryMsg, ...recent]
  } catch (err) {
    logger.warn('AGENT.CONTEXT', 'L4 LLM 摘要失败，降级到首尾提取', {
      error: err instanceof Error ? err.message : String(err),
    })
    return applySummaryCompaction(messages, keepRecentTokens)
  }
}

/**
 * L5 语义去重：移除连续语义冗余消息（纯算法，无 API 开销）
 *
 * 对连续消息计算 Jaccard 相似度（基于词集合），
 * 若相似度 > 阈值（0.7），仅保留较新的一条。
 * 不处理 system 消息（始终保留）。
 *
 * @param messages 消息列表
 */
function applySemanticDedup(messages: ModelMessage[], similarity: number): ModelMessage[] {
  if (messages.length <= 2) return messages

  const result: ModelMessage[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    // system 消息始终保留
    if (msg.role === 'system') {
      result.push(msg)
      continue
    }
    // 与下一条非 system 消息比较
    const next = messages[i + 1]
    if (next && next.role !== 'system') {
      const sim = jaccardSimilarity(extractText(msg), extractText(next))
      if (sim > similarity) {
        // 跳过当前（较旧的），保留下一条（较新的）
        continue
      }
    }
    result.push(msg)
  }
  return result
}

/**
 * Jaccard 相似度：基于词集合的文本相似程度量
 *
 * @param a 文本 A
 * @param b 文本 B
 * @returns 相似度 [0, 1]
 */
function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean))
  const setB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean))
  if (setA.size === 0 && setB.size === 0) return 1
  if (setA.size === 0 || setB.size === 0) return 0
  let intersection = 0
  for (const word of setA) {
    if (setB.has(word)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * 提取消息的纯文本内容（兼容 string / 多模态 part 数组）
 *
 * @param message 消息对象
 * @returns 纯文本
 */
function extractText(message: ModelMessage): string {
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    return message.content
      .filter((p): p is { type: 'text'; text: string } => typeof p === 'object' && p !== null && 'text' in p)
      .map((p) => p.text)
      .join(' ')
  }
  return ''
}
