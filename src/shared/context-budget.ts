/**
 * 上下文预算的单一尺子（token 估算 + 5 层阈值）
 *
 * 为什么放在 shared：这把尺子原先只住在主进程（core/agent/context.ts），
 * 渲染层要判断"该不该压缩、压缩后留多少"只能自己再编一套字符算术，
 * 于是同一份对话在两个进程里有两把不同的尺——主进程按 L2/L3 阈值剪，
 * 界面按"最近 6 条"剪，两边都说自己在管理上下文，谁也不是权威。
 * 现在估算与阈值都只在这一份里定义，主进程的压缩算法与渲染层的压缩按钮都从这里取数。
 *
 * 本文件刻意不 import `ai`：渲染进程也要用它，不能把 Node 侧的 SDK 拖进浏览器包。
 */

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
  L5_TRIGGER_RATIO: 0.9,
  /** L4 摘要后保留的最近消息 tokens 上限 */
  L4_KEEP_RECENT_TOKENS: 30_000,
  /** L5 Jaccard 相似度去重阈值 */
  L5_SIMILARITY_THRESHOLD: 0.7,
} as const

/**
 * 按"生效上下文窗口"收紧阈值
 *
 * 这五层以前只有一把绝对尺子（50K/100K/112.5K/135K，按 150K 窗口设计）。
 * 后果是本地小窗口模型（Ollama 常见 8K、Kimi 32K）永远轮不到压缩，
 * 请求直接被上游拒成 400 —— 用户看到的就是"AI 突然不能用了"。
 * 现在按窗口比例再压一道：窗口比 150K 大就维持原绝对上限（只更严不更松），
 * 比它小就按比例提前触发。
 */
export interface CompactionThresholds {
  /** L1：单条消息截断阈值 */
  singleMessage: number
  /** L2：滑动窗口触发线 */
  sessionSoft: number
  /** L3：激进滑动窗口触发线 */
  sessionHard: number
  /** L4：摘要压缩触发线 */
  critical: number
  /** L5：语义去重触发线 */
  dedup: number
  /** L4 摘要后保留的最近消息 tokens */
  keepRecentTokens: number
  /** L5 Jaccard 相似度阈值（与窗口无关） */
  similarity: number
  /** 本次判定用的窗口口径（0 = 未知，走绝对阈值） */
  windowTokens: number
}

/** 窗口比例（对应原来按 150K 设计的那把绝对尺子） */
const WINDOW_RATIOS = {
  singleMessage: 0.3,
  sessionSoft: 0.34,
  sessionHard: 0.67,
  critical: 0.75,
  dedup: 0.9,
  keepRecentTokens: 0.2,
} as const

export function resolveCompactionThresholds(windowTokens?: number): CompactionThresholds {
  const w = Number.isFinite(windowTokens) ? Math.trunc(windowTokens ?? 0) : 0
  // 未知窗口（capabilities 里 0 表示未知）→ 维持旧行为，不因为"不知道"就乱压缩
  if (w <= 0) {
    return {
      singleMessage: COMPACTION_THRESHOLDS.L1_SINGLE_MESSAGE,
      sessionSoft: COMPACTION_THRESHOLDS.L2_SESSION_SOFT,
      sessionHard: COMPACTION_THRESHOLDS.L3_SESSION_HARD,
      critical: COMPACTION_THRESHOLDS.L4_SESSION_CRITICAL * COMPACTION_THRESHOLDS.L4_TRIGGER_RATIO,
      dedup: COMPACTION_THRESHOLDS.L4_SESSION_CRITICAL * COMPACTION_THRESHOLDS.L5_TRIGGER_RATIO,
      keepRecentTokens: COMPACTION_THRESHOLDS.L4_KEEP_RECENT_TOKENS,
      similarity: COMPACTION_THRESHOLDS.L5_SIMILARITY_THRESHOLD,
      windowTokens: 0,
    }
  }
  const cap = (ratio: number, absolute: number): number =>
    Math.max(1, Math.min(absolute, Math.floor(w * ratio)))
  return {
    singleMessage: cap(WINDOW_RATIOS.singleMessage, COMPACTION_THRESHOLDS.L1_SINGLE_MESSAGE),
    sessionSoft: cap(WINDOW_RATIOS.sessionSoft, COMPACTION_THRESHOLDS.L2_SESSION_SOFT),
    sessionHard: cap(WINDOW_RATIOS.sessionHard, COMPACTION_THRESHOLDS.L3_SESSION_HARD),
    critical: cap(
      WINDOW_RATIOS.critical,
      COMPACTION_THRESHOLDS.L4_SESSION_CRITICAL * COMPACTION_THRESHOLDS.L4_TRIGGER_RATIO,
    ),
    dedup: cap(
      WINDOW_RATIOS.dedup,
      COMPACTION_THRESHOLDS.L4_SESSION_CRITICAL * COMPACTION_THRESHOLDS.L5_TRIGGER_RATIO,
    ),
    keepRecentTokens: cap(
      WINDOW_RATIOS.keepRecentTokens,
      COMPACTION_THRESHOLDS.L4_KEEP_RECENT_TOKENS,
    ),
    similarity: COMPACTION_THRESHOLDS.L5_SIMILARITY_THRESHOLD,
    windowTokens: w,
  }
}

/**
 * 估算字符串的 token 数（粗略估算）
 *
 * 经验值：英文约 4 字符/token，中文约 1.5 字符/token。
 * 非中文按 3 字符/token（比 4 保守，宁可早一点压缩）；
 * 中日韩字符按 2 字符/token —— 原来不分语种一律除 3，
 * 对中文是**低估近一倍**，等于中文对话总是压晚了才触发。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    // 常用汉字、假名、谚文与全角标点；代理对算一个
    if (
      (code >= 0x3000 && code <= 0x30ff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk++
    }
  }
  const other = text.length - cjk
  return Math.ceil(cjk / 2 + other / 3)
}

/**
 * 估算消息列表的总 tokens
 *
 * 逐条（数组 content 则逐 part）取整后累加——与主进程压缩用的是同一个口径，
 * 两边不许各自再写一遍字符算术。
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
