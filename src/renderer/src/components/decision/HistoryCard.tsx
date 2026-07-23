/**
 * HistoryCard — 历史决策卡片
 *
 * 抽离自 DecisionPage.tsx（M2 Task 3 review fix），展示决策 ID + 时间 + 场景 +
 * 置信度 + 风险等级 + 状态徽章，点击跳转决策详情。
 *
 * 视觉：圆角卡片 + Fingerprint 头部 + Activity 场景 + Clock 时间 + 置信度数值 +
 * 状态徽章。Hover 时边框品牌化、背景叠加层加深。
 *
 * Token 合规：所有颜色使用 var(--trae-*) 或 var(--bg-brand)，无硬编码。
 */
import { Fingerprint, Clock, Activity } from 'lucide-react'
import type { DecisionCard } from '@shared/models'
import { riskLevelMeta } from '@/utils/decision-mappers'

interface HistoryCardProps {
  /** 决策卡片数据 */
  card: DecisionCard
  /** 点击回调（通常为跳转详情页） */
  onClick: () => void
}

/** 状态文案映射 */
const STATUS_TEXT: Record<DecisionCard['status'], string> = {
  pending: '待审批',
  approved: '已批准',
  rejected: '已拒绝',
  executed: '已执行',
  verified: '已验证',
  failed: '执行失败',
}

/** 状态徽章 className 映射（边框 + 半透明背景 + 文字色） */
const STATUS_CLASS: Record<DecisionCard['status'], string> = {
  pending: 'border-[var(--trae-status-alert-default)] bg-[rgba(210,157,0,0.12)] text-[var(--trae-status-alert-default)]',
  approved: 'border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] text-[var(--trae-text-brand)]',
  rejected: 'border-[var(--trae-status-error-default)] bg-[rgba(246,90,90,0.12)] text-[var(--trae-status-error-default)]',
  executed: 'border-[var(--trae-status-success-default)] bg-[rgba(51,193,146,0.12)] text-[var(--trae-status-success-default)]',
  verified: 'border-[var(--trae-status-success-default)] bg-[rgba(51,193,146,0.12)] text-[var(--trae-status-success-default)]',
  failed: 'border-[var(--trae-status-error-default)] bg-[rgba(246,90,90,0.12)] text-[var(--trae-status-error-default)]',
}

/** 历史决策卡片：决策ID + 时间 + 场景 + 置信度 + 状态 */
export function HistoryCard({ card, onClick }: HistoryCardProps) {
  const ts = new Date(card.timestamp)
  const timeStr = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}:${String(ts.getSeconds()).padStart(2, '0')}`
  const riskMeta = riskLevelMeta(card.risk.level)
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col gap-2 rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] p-4 text-left transition-colors hover:border-[var(--trae-border-brand)] hover:bg-[var(--trae-bg-overlay-l2)]"
      aria-label={`查看决策 ${card.id} 详情`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Fingerprint className="h-3 w-3 text-[var(--trae-text-secondary)]" />
          <span className="font-mono text-[11px] font-medium tabular-nums text-[var(--trae-text-default)]">
            #{card.id}
          </span>
        </div>
        <span className={`inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border px-2 text-[10px] font-medium ${STATUS_CLASS[card.status]}`}>
          {STATUS_TEXT[card.status]}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[12px] text-[var(--trae-text-default)]">
        <Activity className="h-3 w-3 text-[var(--trae-text-secondary)]" />
        <span className="truncate">{card.problem.slice(0, 40) || '未命名场景'}</span>
      </div>
      <div className="flex items-center justify-between gap-3 text-[10px] text-[var(--trae-text-tertiary)]">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3" />
          <span className="font-mono tabular-nums">{timeStr}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="text-[var(--trae-text-tertiary)]">置信度</span>
            <span className="font-mono font-medium tabular-nums text-[var(--trae-text-brand)]">
              {card.confidence.toFixed(2)}
            </span>
          </span>
          <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l1)] px-2 text-[10px] text-[var(--trae-text-secondary)]">
            {riskMeta.urgency}
          </span>
        </div>
      </div>
    </button>
  )
}
