/**
 * ResultTable — 执行结果对比表
 *
 * 设计稿：history-detail.html Card 3 执行结果
 *
 * - 指标对比行（从 DecisionCard 派生）
 * - 4 列：指标 / 执行前 / 执行后 / 变化
 * - 变化列用 success 绿（正向变化）或 error 红（负向变化）
 * - 头部右侧状态标签
 */
import { CheckCircle, XCircle } from 'lucide-react'
import type { DecisionCard } from '@shared/models'

export interface ResultTableProps {
  card: DecisionCard
}

/** 执行结果指标对比 */
interface ResultMetric {
  name: string
  before: string
  after: string
  delta: string
  positive: boolean
}

/** 状态 → 结果标签 */
const STATUS_RESULT_LABELS: Record<DecisionCard['status'], string> = {
  pending: '待执行',
  approved: '已批准',
  rejected: '已拒绝',
  executed: '执行成功',
  verified: '验证通过',
  failed: '执行失败',
}

/** 状态 → 是否为成功态 */
function isSuccessStatus(status: DecisionCard['status']): boolean {
  return status === 'executed' || status === 'verified'
}

/**
 * 从 DecisionCard 派生指标对比数据。
 * 由于 DecisionCard 不直接包含 before/after 指标，
 * 根据置信度和状态生成概要指标。
 */
function deriveMetrics(card: DecisionCard): ResultMetric[] {
  const confidencePercent = `${(card.confidence * 100).toFixed(0)}%`
  const riskScore = card.risk?.score ?? 0
  const evidenceCount = card.evidences?.length ?? 0

  return [
    {
      name: '置信度',
      before: '—',
      after: confidencePercent,
      delta: confidencePercent,
      positive: card.confidence >= 0.7,
    },
    {
      name: '风险评分',
      before: '—',
      after: `${riskScore}/100`,
      delta: riskScore <= 30 ? '低风险' : riskScore <= 60 ? '中风险' : '高风险',
      positive: riskScore <= 60,
    },
    {
      name: '证据数量',
      before: '0',
      after: `${evidenceCount}`,
      delta: `+${evidenceCount}`,
      positive: evidenceCount > 0,
    },
    {
      name: '执行状态',
      before: '待处理',
      after: STATUS_RESULT_LABELS[card.status] ?? card.status,
      delta: isSuccessStatus(card.status) ? '已完成' : '进行中',
      positive: isSuccessStatus(card.status),
    },
  ]
}

/**
 * ResultTable 主组件
 */
export function ResultTable({ card }: ResultTableProps) {
  const metrics = deriveMetrics(card)
  const success = isSuccessStatus(card.status)
  const resultLabel = STATUS_RESULT_LABELS[card.status] ?? card.status

  return (
    <section
      className="bg-[var(--trae-bg-base-secondary)] border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-8)]"
      style={{ padding: '24px' }}
    >
      {/* 头部条 */}
      <div
        className="flex items-center justify-between px-4 py-3 -mx-6 -mt-6 mb-4 bg-[#252629] border-b border-[var(--trae-border-neutral-l1)] rounded-t-[var(--trae-radius-8)]"
        style={{ padding: '12px 16px' }}
      >
        <div className="flex items-center gap-2">
          <ActivityIcon />
          <span className="text-[13px] font-semibold text-[var(--trae-text-default)]">
            执行结果
          </span>
        </div>
        <span
          className="inline-flex items-center gap-1.5 text-[11px] font-medium"
          style={{
            color: success
              ? 'var(--trae-status-success-default)'
              : 'var(--trae-status-error-default)',
          }}
        >
          {success ? (
            <CheckCircle
              className="w-3.5 h-3.5"
              style={{ color: 'var(--trae-status-success-default)' }}
            />
          ) : (
            <XCircle
              className="w-3.5 h-3.5"
              style={{ color: 'var(--trae-status-error-default)' }}
            />
          )}
          {resultLabel}
        </span>
      </div>

      {/* 对比表 */}
      <div
        className="border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-8)] overflow-hidden"
      >
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#252629]">
              <th className="text-left p-2.5 text-[11px] font-medium text-[var(--trae-text-secondary)] border-b border-[var(--trae-border-neutral-l1)]" style={{ letterSpacing: '0.04em', padding: '10px 16px' }}>
                指标
              </th>
              <th className="text-left p-2.5 text-[11px] font-medium text-[var(--trae-text-secondary)] border-b border-[var(--trae-border-neutral-l1)]" style={{ letterSpacing: '0.04em', padding: '10px 16px' }}>
                执行前
              </th>
              <th className="text-left p-2.5 text-[11px] font-medium text-[var(--trae-text-secondary)] border-b border-[var(--trae-border-neutral-l1)]" style={{ letterSpacing: '0.04em', padding: '10px 16px' }}>
                执行后
              </th>
              <th className="text-left p-2.5 text-[11px] font-medium text-[var(--trae-text-secondary)] border-b border-[var(--trae-border-neutral-l1)]" style={{ letterSpacing: '0.04em', padding: '10px 16px' }}>
                变化
              </th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric, idx) => {
              const isLast = idx === metrics.length - 1
              const borderClass = isLast ? '' : 'border-b border-[var(--trae-border-neutral-l1)]'
              return (
                <tr key={metric.name}>
                  <td className={`text-[12px] text-[var(--trae-text-default)] ${borderClass}`} style={{ padding: '10px 16px' }}>
                    {metric.name}
                  </td>
                  <td className={`font-mono tabular-nums text-[12px] text-[var(--trae-text-default)] ${borderClass}`} style={{ padding: '10px 16px' }}>
                    {metric.before}
                  </td>
                  <td className={`font-mono tabular-nums text-[12px] text-[var(--trae-text-default)] ${borderClass}`} style={{ padding: '10px 16px' }}>
                    {metric.after}
                  </td>
                  <td
                    className={`font-mono tabular-nums text-[12px] font-medium ${borderClass}`}
                    style={{
                      padding: '10px 16px',
                      color: metric.positive
                        ? 'var(--trae-status-success-default)'
                        : 'var(--trae-status-error-default)',
                    }}
                  >
                    {metric.delta}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** 章节标题图标（activity） */
function ActivityIcon() {
  return (
    <span
      className="shrink-0 inline-block"
      style={{
        width: '16px',
        height: '16px',
        backgroundColor: 'var(--trae-icon-default)',
        maskImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M22 12h-4l-3 9L9 3l-3 9H2'/></svg>\")",
        maskSize: 'contain',
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M22 12h-4l-3 9L9 3l-3 9H2'/></svg>\")",
        WebkitMaskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
      }}
    />
  )
}
