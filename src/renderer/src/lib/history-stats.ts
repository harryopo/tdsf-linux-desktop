/**
 * 决策历史的统计口径（2026-10-15 全维度系统审查 F4）
 *
 * 病根：0 条记录时页面照样渲染出"成功率 0.0%"（还是成功绿）和"平均置信度 0.00"，
 * 把"从没测过"演成"测了，结果是零"。这违反本项目 PRODUCT 的红线"不放示例数字"，
 * 而绿色会让人以为这是一个已知的、糟糕但真实的结果。
 *
 * 规则只有一条：**分母为零的派生量没有值**。显示 — 并用中性色，不参与"成功/危险"的语义着色。
 * 统计有两个来源（主进程聚合 / 当前记录派生），所以这里先汇成一个形状再判分母——
 * 两条分支各写一遍"没有数据时显示什么"，就是这次缺陷的成因。
 */

/** 主进程 historyStats 的派生入参 */
export interface HistoryStatsSource {
  total: number
  /** [0,1] */
  successRate: number
  /** [0,1] */
  avgConfidence: number
  /** 平均耗时（ms）；null = 这一项没有真实样本（一条都没记录耗时） */
  avgDurationMs: number | null
}

/**
 * 耗时读数：毫秒是唯一的原始单位。
 *
 * 原先两条路各自换算（列表行 `Math.max(1, round(ms/1000))`、统计卡 `round(ms/1000)`），
 * 前者把 200ms 抬成"1s"，后者把"一条样本都没有"的 0 演成"平均 0 秒"。
 * 换算只留这一处：没有就是 —，不到 1 秒保留一位小数，绝不进位。
 */
export function durationLabel(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return NO_DATA
  if (ms < 100) return '<0.1s'
  if (ms < 1000) return `${Math.round(ms / 100) / 10}s`
  return `${Math.round(ms / 1000)}s`
}

/**
 * 主进程聚合 → 同一个形状（#175-①）
 *
 * `HistoryStats.avgDurationMs` 现在可以是 null；但库里旧数据与"样本数为 0"都可能给出 0，
 * 而 0 毫秒的平均耗时不是一个能出现的真值（有样本至少记到毫秒），所以 0 一律按"没有样本"处理。
 * 这一条不靠调用方记得判 0——两条分支都从这里过，才不会再各写一遍。
 */
export function fromAggregate(stats: {
  total: number
  successRate: number
  avgConfidence: number
  avgDurationMs: number | null
}): HistoryStatsSource {
  return {
    total: stats.total,
    successRate: stats.successRate,
    avgConfidence: stats.avgConfidence,
    avgDurationMs: stats.avgDurationMs && stats.avgDurationMs > 0 ? stats.avgDurationMs : null,
  }
}

export interface StatCell {
  label: string
  value: string
  /** 语义色：没有数据时一律中性，不许用成功绿 */
  color: string
}

export const NO_DATA = '—'
const TONE_ACCENT = 'var(--accent-text)'
const TONE_SUCCESS = 'var(--status-success-text)'
const TONE_NEUTRAL = 'var(--text-tertiary)'

/** 把"当前记录"这一路派生成同一个形状（记录里只有耗时可能缺失） */
export function deriveFromRecords(
  records: Array<{ status: string; confidence: number; durationMs?: number | null }>
): HistoryStatsSource {
  const withDuration = records.filter((r) => r.durationMs != null && r.durationMs > 0)
  return {
    total: records.length,
    successRate: records.length > 0 ? records.filter((r) => r.status === '成功').length / records.length : 0,
    avgConfidence: records.length > 0 ? records.reduce((s, r) => s + r.confidence, 0) / records.length : 0,
    avgDurationMs:
      withDuration.length > 0
        ? Math.round(withDuration.reduce((s, r) => s + (r.durationMs ?? 0), 0) / withDuration.length)
        : null,
  }
}

/**
 * 生成四张统计卡。
 * @param src 已统一形状的统计来源
 */
export function buildHistoryStats(src: HistoryStatsSource): StatCell[] {
  const has = src.total > 0
  return [
    { label: '总决策数', value: String(src.total), color: TONE_ACCENT },
    {
      label: '成功率',
      value: has ? `${(src.successRate * 100).toFixed(1)}%` : NO_DATA,
      color: has ? TONE_SUCCESS : TONE_NEUTRAL,
    },
    {
      label: '平均置信度',
      value: has ? src.avgConfidence.toFixed(2) : NO_DATA,
      color: has ? TONE_ACCENT : TONE_NEUTRAL,
    },
    {
      label: '平均响应时间',
      value: durationLabel(src.avgDurationMs),
      color: TONE_NEUTRAL,
    },
  ]
}
