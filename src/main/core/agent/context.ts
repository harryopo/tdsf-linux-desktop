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
 * 5 层 compaction 阈值（tokens）
 *
 * 数值参考 Claude Code 的 200K-1M 上下文 + 5 层 pipeline
 */
export const COMPACTION_THRESHOLDS = {
  /** L1：单条消息阈值（4K tokens） */
  L1_SINGLE_MESSAGE: 4_000,
  /** L2：会话总 tokens 阈值（50K） */
  L2_SESSION_SOFT: 50_000,
  /** L3：会话总 tokens 阈值（100K，触发重要节点抽取） */
  L3_SESSION_HARD: 100_000,
  /** L4：会话总 tokens 阈值（150K，触发摘要压缩） */
  L4_SESSION_CRITICAL: 150_000,
  /** L5：跨会话长期记忆（占位，v1.0 实现） */
  L5_CROSS_SESSION: -1,
  /** L4 触发比例：75% of L4_SESSION_CRITICAL */
  L4_TRIGGER_RATIO: 0.75,
  /** L5 触发比例：90% of L4_SESSION_CRITICAL */
  L5_TRIGGER_RATIO: 0.90,
  /** L4 摘要后保留的最近消息 tokens 上限 */
  L4_KEEP_RECENT_TOKENS: 30_000,
  /** L5 Jaccard 相似度去重阈值 */
  L5_SIMILARITY_THRESHOLD: 0.7,
} as const

/** LLM 摘要函数签名（可选注入） */
export type SummarizeFn = (text: string) => Promise<string>

/**
 * 估算字符串的 token 数（粗略估算）
 *
 * 经验值：英文约 4 字符/token，中文约 1.5 字符/token。
 * 取折中值 3 字符/token（保守估算，避免低估触发 compaction）。
 *
 * @param text 文本
 * @returns 估算 token 数
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  // 中文字符按 1.5 个字符/token，英文按 4 个字符/token，加权后取 3
  return Math.ceil(text.length / 3)
}

/**
 * 估算消息列表的总 tokens
 *
 * @param messages 消息列表（ModelMessage 或 ChatMessage）
 * @returns 估算 token 数
 */
export function estimateMessageTokens(messages: Array<{ content: unknown }>): number {
  let total = 0
  for (const m of messages) {
    if (typeof m.content === 'string') {
      total += estimateTokens(m.content)
    } else if (Array.isArray(m.content)) {
      // 多模态消息：累加每个 part 的 text
      for (const part of m.content) {
        if (typeof part === 'object' && part !== null && 'text' in part) {
          total += estimateTokens(String((part as { text: string }).text))
        }
      }
    } else if (m.content && typeof m.content === 'object') {
      total += estimateTokens(JSON.stringify(m.content))
    }
  }
  return total
}

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
 * 当前版本实现：
 * - L1：对超过 4K tokens 的单条消息，截断保留前 2K + 后 1K（中间用 [...省略...] 占位）
 * - L2：会话 > 50K → 仅保留最近 30K tokens 的消息（滑动窗口）
 * - L3：会话 > 100K → 仅保留最近 50K tokens，并触发"重要节点抽取"日志（占位）
 * - L4：会话 > 75% max → 摘要压缩（降级模式：首尾提取；LLM 版见 compactIfNeededAsync）
 * - L5：会话 > 90% max → 语义去重（Jaccard 相似度 > 0.7 的连续消息仅保留最新）
 *
 * @param messages 当前消息列表
 * @returns Compaction 决策结果
 */
export function compactIfNeeded(messages: ModelMessage[]): CompactionResult {
  const beforeTokens = estimateMessageTokens(messages)
  let result: ModelMessage[] = messages
  let level: CompactionResult['level'] = 'none'
  let truncatedCount = 0

  // L1：单条消息超阈值 → 截断
  result = result.map((m) => {
    if (typeof m.content === 'string' && estimateTokens(m.content) > COMPACTION_THRESHOLDS.L1_SINGLE_MESSAGE) {
      const content = m.content
      // 保留前 2K tokens（约 6K 字符）+ 后 1K tokens（约 3K 字符）
      const head = content.slice(0, 6_000)
      const tail = content.slice(-3_000)
      truncatedCount++
      return {
        ...m,
        content: `${head}\n\n[...省略约 ${estimateTokens(content) - 3_000} tokens 内容（L1 compaction 触发）...]\n\n${tail}`,
      } as ModelMessage
    }
    return m
  })
  if (truncatedCount > 0) {
    level = 'L1'
    logger.info('AGENT.CONTEXT', `L1 compaction 触发：截断了 ${truncatedCount} 条消息`, {
      beforeTokens,
    })
  }

  // L2：会话总 tokens 超阈值 → 滑动窗口（保留最近 30K tokens）
  let afterTokens = estimateMessageTokens(result)
  if (afterTokens > COMPACTION_THRESHOLDS.L2_SESSION_SOFT) {
    result = applySlidingWindow(result, 30_000)
    afterTokens = estimateMessageTokens(result)
    level = level === 'none' ? 'L2' : level
    logger.info('AGENT.CONTEXT', `L2 compaction 触发：滑动窗口保留最近 30K tokens`, {
      beforeTokens,
      afterTokens,
    })
  }

  // L3：会话总 tokens 超阈值 → 更激进的滑动窗口（保留最近 50K）+ 重要节点抽取占位
  if (afterTokens > COMPACTION_THRESHOLDS.L3_SESSION_HARD) {
    result = applySlidingWindow(result, 50_000)
    afterTokens = estimateMessageTokens(result)
    level = level === 'none' ? 'L3' : level
    logger.warn('AGENT.CONTEXT', `L3 compaction 触发：会话已超 100K tokens，滑动窗口压缩`, {
      beforeTokens,
      afterTokens,
    })
  }

  // L4：会话 > 75% max → 摘要压缩（同步降级模式：首尾提取）
  const l4Trigger = COMPACTION_THRESHOLDS.L4_SESSION_CRITICAL * COMPACTION_THRESHOLDS.L4_TRIGGER_RATIO
  if (afterTokens > l4Trigger) {
    const before4 = result.length
    result = applySummaryCompaction(result, COMPACTION_THRESHOLDS.L4_KEEP_RECENT_TOKENS)
    afterTokens = estimateMessageTokens(result)
    level = 'L4'
    truncatedCount += before4 - result.length
    logger.warn('AGENT.CONTEXT', `L4 compaction 触发：摘要压缩（降级模式），${before4} → ${result.length} 条`, {
      beforeTokens,
      afterTokens,
    })
  }

  // L5：会话 > 90% max → 语义去重（Jaccard 相似度，纯算法）
  const l5Trigger = COMPACTION_THRESHOLDS.L4_SESSION_CRITICAL * COMPACTION_THRESHOLDS.L5_TRIGGER_RATIO
  if (afterTokens > l5Trigger) {
    const before5 = result.length
    result = applySemanticDedup(result)
    afterTokens = estimateMessageTokens(result)
    level = 'L5'
    truncatedCount += before5 - result.length
    logger.warn('AGENT.CONTEXT', `L5 compaction 触发：语义去重，${before5} → ${result.length} 条`, {
      beforeTokens,
      afterTokens,
    })
  }

  return {
    messages: result,
    level,
    beforeTokens,
    afterTokens,
    truncatedCount,
  }
}

/**
 * 异步版 compaction（L4 使用 LLM 生成摘要）
 *
 * 与 compactIfNeeded 逻辑一致，但 L4 层调用注入的 summarizer 生成高质量摘要。
 * 若 summarizer 未提供或调用失败，自动降级到首尾提取。
 *
 * @param messages 当前消息列表
 * @param summarizer 可选的 LLM 摘要函数
 * @returns Compaction 决策结果
 */
export async function compactIfNeededAsync(
  messages: ModelMessage[],
  summarizer?: SummarizeFn,
): Promise<CompactionResult> {
  const beforeTokens = estimateMessageTokens(messages)
  let result: ModelMessage[] = messages
  let level: CompactionResult['level'] = 'none'
  let truncatedCount = 0

  // L1-L3：与同步版一致
  result = result.map((m) => {
    if (typeof m.content === 'string' && estimateTokens(m.content) > COMPACTION_THRESHOLDS.L1_SINGLE_MESSAGE) {
      const content = m.content
      const head = content.slice(0, 6_000)
      const tail = content.slice(-3_000)
      truncatedCount++
      return {
        ...m,
        content: `${head}\n\n[...省略约 ${estimateTokens(content) - 3_000} tokens 内容（L1 compaction 触发）...]\n\n${tail}`,
      } as ModelMessage
    }
    return m
  })
  if (truncatedCount > 0) level = 'L1'

  let afterTokens = estimateMessageTokens(result)
  if (afterTokens > COMPACTION_THRESHOLDS.L2_SESSION_SOFT) {
    result = applySlidingWindow(result, 30_000)
    afterTokens = estimateMessageTokens(result)
    if (level === 'none') level = 'L2'
  }
  if (afterTokens > COMPACTION_THRESHOLDS.L3_SESSION_HARD) {
    result = applySlidingWindow(result, 50_000)
    afterTokens = estimateMessageTokens(result)
    if (level === 'none') level = 'L3'
  }

  // L4：摘要压缩（LLM 版，含降级）
  const l4Trigger = COMPACTION_THRESHOLDS.L4_SESSION_CRITICAL * COMPACTION_THRESHOLDS.L4_TRIGGER_RATIO
  if (afterTokens > l4Trigger) {
    const before4 = result.length
    result = await applySummaryCompactionAsync(result, COMPACTION_THRESHOLDS.L4_KEEP_RECENT_TOKENS, summarizer)
    afterTokens = estimateMessageTokens(result)
    level = 'L4'
    truncatedCount += before4 - result.length
    logger.warn('AGENT.CONTEXT', `L4 compaction 触发（async）：${before4} → ${result.length} 条`, {
      beforeTokens,
      afterTokens,
    })
  }

  // L5：语义去重
  const l5Trigger = COMPACTION_THRESHOLDS.L4_SESSION_CRITICAL * COMPACTION_THRESHOLDS.L5_TRIGGER_RATIO
  if (afterTokens > l5Trigger) {
    const before5 = result.length
    result = applySemanticDedup(result)
    afterTokens = estimateMessageTokens(result)
    level = 'L5'
    truncatedCount += before5 - result.length
    logger.warn('AGENT.CONTEXT', `L5 compaction 触发（async）：${before5} → ${result.length} 条`, {
      beforeTokens,
      afterTokens,
    })
  }

  return { messages: result, level, beforeTokens, afterTokens, truncatedCount }
}

// ─── 内部工具函数 ────────────────────────────────────────────────────────────

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
function applySemanticDedup(messages: ModelMessage[]): ModelMessage[] {
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
      if (sim > COMPACTION_THRESHOLDS.L5_SIMILARITY_THRESHOLD) {
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
