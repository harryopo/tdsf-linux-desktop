/**
 * 内容质量过滤模块
 *
 * 教学术语：
 * - Quality Score (质量评分)：基于多维度的 0-1 评分
 * - Junk Page (垃圾页)：短内容/广告/导航页
 * - Threshold Filtering (阈值过滤)：score < threshold 的内容丢弃
 *
 * 5 维评分模型（详见 方案书-v0.7.0 §3.4）：
 *   1. 内容长度  (0.30)
 *   2. 命令密度  (0.20)
 *   3. 标题完整  (0.15)
 *   4. 链接存活  (0.15)
 *   5. 去重检查  (0.20)
 *
 * 使用：
 *   import { filterLowQuality, scoreEntry } from './quality-filter'
 *   const valid = filterLowQuality(entries, { threshold: 0.3 })
 *   // valid.entries = 保留
 *   // valid.dropped = 丢弃（带原因）
 */

import type { TutorialEntry } from '../types'

/** 质量评分明细（用于 UI 展示） */
export interface QualityBreakdown {
  /** 内容长度分 (0-1) */
  length: number
  /** 命令密度分 (0-1) */
  commands: number
  /** 标题完整分 (0-1) */
  headings: number
  /** 链接存活分 (0-1) */
  links: number
  /** 去重分 (0-1)，已重复时 = 0 */
  dedup: number
}

/** 质量评分结果 */
export interface QualityScore {
  /** 总分 0-1 */
  total: number
  /** 明细 */
  breakdown: QualityBreakdown
  /** 拒绝原因（如果被过滤） */
  reason?: string
}

/** 过滤选项 */
export interface FilterOptions {
  /** 评分阈值，低于此值的条目被过滤（默认 0.3） */
  threshold?: number
  /** 最短字符数（默认 200） */
  minLength?: number
  /** 是否启用去重检查（默认 true，需要外部传入已有 entries） */
  enableDedup?: boolean
  /** 已有 entries（用于去重比较） */
  existingEntries?: TutorialEntry[]
}

/** 过滤结果 */
export interface FilterResult {
  /** 通过过滤的条目 */
  entries: TutorialEntry[]
  /** 被丢弃的条目（带原因） */
  dropped: Array<{ entry: TutorialEntry; reason: string; score: QualityScore }>
  /** 统计 */
  stats: {
    total: number
    kept: number
    dropped: number
    byReason: Record<string, number>
  }
}

/**
 * 计算内容长度分
 *   < 200 字符 = 0.1
 *   200-1000 = 0.5
 *   > 1000 = 1.0
 */
export function scoreLength(content: string): number {
  const len = content.length
  if (len < 200) return 0.1
  if (len < 1000) return 0.5
  return 1.0
}

/**
 * 计算命令密度分
 *   含 ``` 代码块 = 0.8
 *   否则 = 0.2
 */
export function scoreCommands(entry: TutorialEntry): number {
  if (entry.commands.length >= 3) return 1.0
  if (entry.commands.length >= 1) return 0.6
  // fallback: 从 content 中找 ``` 块
  const codeBlockRe = /```[\s\S]*?```/g
  const hasCode = codeBlockRe.test(entry.content)
  return hasCode ? 0.4 : 0.2
}

/**
 * 计算标题完整分
 *   标题 > 10 字符 + content 有 H1/H2 = 1.0
 *   只有 H3+ = 0.4
 *   完全无标题 = 0.1
 */
export function scoreHeadings(entry: TutorialEntry): number {
  const titleLen = entry.title?.length ?? 0
  const hasH1H2 = /^#{1,2}\s+/m.test(entry.content)
  const hasAnyHeading = /^#{1,6}\s+/m.test(entry.content)

  if (titleLen > 10 && hasH1H2) return 1.0
  if (titleLen > 5 && hasAnyHeading) return 0.7
  if (hasAnyHeading) return 0.4
  return 0.1
}

/**
 * 计算链接存活分
 *   至少 1 个内链 = 0.6
 *   0 链接 = 0.3
 *   多个链接 = 0.8
 */
export function scoreLinks(content: string): number {
  const linkRe = /\[.+?\]\(.+?\)/g
  const count = (content.match(linkRe) || []).length
  if (count === 0) return 0.3
  if (count < 3) return 0.6
  return 0.8
}

/**
 * 计算去重分
 *   已有相似度 < 0.85 = 1.0
 *   与已有相似度 ≥ 0.85 = 0（已存在）
 */
export function scoreDedup(
  entry: TutorialEntry,
  existing: TutorialEntry[]
): { score: number; isDuplicate: boolean } {
  if (existing.length === 0) return { score: 1.0, isDuplicate: false }
  const entryKeywords = new Set(entry.keywords.map((k) => k.toLowerCase()))
  if (entryKeywords.size === 0) return { score: 1.0, isDuplicate: false }
  for (const ex of existing) {
    const exKeywords = new Set(ex.keywords.map((k) => k.toLowerCase()))
    if (exKeywords.size === 0) continue
    const sim = jaccard(entryKeywords, exKeywords)
    if (sim > 0.85) {
      return { score: 0, isDuplicate: true }
    }
  }
  return { score: 1.0, isDuplicate: false }
}

/** Jaccard 相似度 */
function jaccard(a: Set<string>, b: Set<string>): number {
  const intersect = new Set([...a].filter((x) => b.has(x)))
  const union = new Set([...a, ...b])
  if (union.size === 0) return 0
  return intersect.size / union.size
}

/**
 * 评分单个条目
 */
export function scoreEntry(
  entry: TutorialEntry,
  existing: TutorialEntry[] = []
): QualityScore {
  const length = scoreLength(entry.content)
  const commands = scoreCommands(entry)
  const headings = scoreHeadings(entry)
  const links = scoreLinks(entry.content)
  const dedup = scoreDedup(entry, existing)

  const total =
    length * 0.3 +
    commands * 0.2 +
    headings * 0.15 +
    links * 0.15 +
    dedup.score * 0.2

  const breakdown: QualityBreakdown = { length, commands, headings, links, dedup: dedup.score }

  // 生成拒绝原因
  let reason: string | undefined
  if (dedup.isDuplicate) {
    reason = '与已有条目高度相似（关键词 Jaccard > 0.85）'
  } else if (length < 0.3) {
    reason = `内容过短（${entry.content.length} 字符 < 200）`
  } else if (commands < 0.3 && headings < 0.3) {
    reason = '无命令无标题，疑似噪声页'
  }

  return { total, breakdown, reason }
}

/**
 * 批量过滤
 */
export function filterLowQuality(
  entries: TutorialEntry[],
  options: FilterOptions = {}
): FilterResult {
  const {
    threshold = 0.3,
    minLength = 200,
    enableDedup = true,
    existingEntries = []
  } = options

  const kept: TutorialEntry[] = []
  const dropped: Array<{ entry: TutorialEntry; reason: string; score: QualityScore }> = []
  const allSeen: TutorialEntry[] = [...existingEntries]
  const byReason: Record<string, number> = {}

  for (const entry of entries) {
    // 硬过滤：最短字符
    if (entry.content.length < minLength) {
      const reason = `内容过短（${entry.content.length} < ${minLength}）`
      dropped.push({ entry, reason, score: { total: 0, breakdown: { length: 0, commands: 0, headings: 0, links: 0, dedup: 0 } } })
      byReason[reason] = (byReason[reason] || 0) + 1
      continue
    }

    const score = scoreEntry(entry, enableDedup ? allSeen : [])

    if (score.total < threshold || score.reason) {
      const reason = score.reason || `质量评分过低（${score.total.toFixed(2)} < ${threshold}）`
      dropped.push({ entry, reason, score })
      byReason[reason] = (byReason[reason] || 0) + 1
      continue
    }

    kept.push(entry)
    allSeen.push(entry)
  }

  return {
    entries: kept,
    dropped,
    stats: {
      total: entries.length,
      kept: kept.length,
      dropped: dropped.length,
      byReason
    }
  }
}

/**
 * 工具：格式化评分明细（用于 UI 展示）
 */
export function formatScoreBreakdown(score: QualityScore): string {
  const b = score.breakdown
  return [
    `长度: ${(b.length * 100).toFixed(0)}`,
    `命令: ${(b.commands * 100).toFixed(0)}`,
    `标题: ${(b.headings * 100).toFixed(0)}`,
    `链接: ${(b.links * 100).toFixed(0)}`,
    `去重: ${(b.dedup * 100).toFixed(0)}`
  ].join(' / ')
}
