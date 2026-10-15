/**
 * 上下文用量徽章的算据（纯函数，可单测）
 *
 * 存在的理由：旧实现把分母 200_000 写在 Composer 里（Composer.tsx:101），
 * 于是 8K 窗口的本地模型和 1M 窗口的长文本模型显示同一个百分比，
 * 而这个百分比正是用户决定"要不要现在压缩上下文"的依据。
 * 分母改为取自选中模型真实声明的窗口（provider:list 带出来的 capabilities），
 * 窗口未知时返回 null —— 界面显示"未知"，而不是把"不知道"演成 0%。
 */

export interface ContextUsageInput {
  /** 真实占用量：上一轮请求的 prompt tokens（没有历史则为 0） */
  usedTokens: number
  /** 选中模型声明的上下文窗口；0 或非有限值表示未知 */
  windowTokens: number
}

export interface ContextUsage {
  /** 使用率 0-100；窗口未知时为 null（调用方不许编一个百分比） */
  pct: number | null
  /** 已用量文本，如 "12.3K" */
  usedLabel: string
  /** 窗口文本，如 "200K"；未知时为 "未知" */
  totalLabel: string
}

/** 去掉小数点后的 0（250.0 → 250，1.5 → 1.5） */
function trimFraction(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '')
}

/** token 数缩写：≥1M 用 M，≥1K 用 K，其余原值；负数按 0 */
export function formatTokens(tokens: number): string {
  const v = Math.max(0, Math.floor(Number.isFinite(tokens) ? tokens : 0))
  if (v >= 1_000_000) return `${trimFraction(v / 1_000_000)}M`
  if (v >= 1_000) return `${trimFraction(v / 1_000)}K`
  return String(v)
}

export function resolveContextUsage(input: ContextUsageInput): ContextUsage {
  const used = Math.max(0, Math.floor(Number.isFinite(input.usedTokens) ? input.usedTokens : 0))
  const window = Math.floor(Number.isFinite(input.windowTokens) ? input.windowTokens : 0)
  if (window <= 0) {
    return { pct: null, usedLabel: formatTokens(used), totalLabel: '未知' }
  }
  return {
    pct: Math.min(100, Math.round((used / window) * 100)),
    usedLabel: formatTokens(used),
    totalLabel: formatTokens(window),
  }
}

/**
 * 主进程压缩后给用户的一句话（不压缩则返回 null，界面什么都不加）
 *
 * 为什么要有这条：L2/L3/L5 会整条丢掉较早的历史，而此前 `compactionLevel` 一路带回到
 * 渲染层却零消费——于是"AI 忘了三分钟前说过的话"在界面上没有任何痕迹，用户只能猜。
 * 现在把去向如实写出来（剪了几条、从多少 tokens 压到多少），至少这一下是可看见的。
 */
export function buildCompactionNote(result: {
  compactionLevel?: string
  compactionDetail?: { beforeTokens: number; afterTokens: number; truncatedCount: number }
}): string | null {
  const level = result.compactionLevel
  if (!level || level === 'none') return null
  const detail = result.compactionDetail
  if (!detail) return `本轮上下文已压缩（${level}）`
  const parts = [
    `${formatTokens(detail.beforeTokens)} → ${formatTokens(detail.afterTokens)} tokens`,
  ]
  if (detail.truncatedCount > 0) parts.push(`剪掉 ${detail.truncatedCount} 条`)
  return `本轮上下文已压缩（${level}：${parts.join('，')}）`
}
