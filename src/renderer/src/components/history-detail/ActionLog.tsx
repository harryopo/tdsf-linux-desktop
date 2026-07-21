/**
 * ActionLog — 操作日志时间线
 *
 * 设计稿：history-detail.html Card 5 操作日志
 *
 * - 从 DecisionCard.status 派生操作日志
 * - 每条包含：时间 + 图标 + 描述（可选 mono 片段）
 * - 图标类型映射到 lucide-react：sparkles / shield / check / terminal / activity / check-circle
 * - 行间分隔线（last-child 无）
 */
import {
  Activity,
  Check,
  CheckCircle,
  Shield,
  Sparkles,
  Terminal,
  type LucideIcon,
} from 'lucide-react'
import type { DecisionCard } from '@shared/models'

export interface ActionLogProps {
  card: DecisionCard
}

/** 图标类型 */
type LogIconType = 'sparkles' | 'shield' | 'check' | 'terminal' | 'activity' | 'check-circle'

/** 操作日志单条 */
interface LogEntry {
  time: string
  icon: LogIconType
  iconColor: string
  desc: string
  mono?: string
}

/** 图标类型 → lucide 组件映射 */
const iconMap: Record<LogIconType, LucideIcon> = {
  sparkles: Sparkles,
  shield: Shield,
  check: Check,
  terminal: Terminal,
  activity: Activity,
  'check-circle': CheckCircle,
}

/** 格式化时间戳为 HH:mm:ss */
function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * 根据 DecisionCard 状态派生操作日志。
 * 工作流步骤：collect→analyze→reason→check→confirm→execute→verify
 * 根据 card.status 决定哪些步骤已完成。
 */
function deriveLogs(card: DecisionCard): LogEntry[] {
  const baseTime = card.timestamp
  const time = formatTime(baseTime)
  const logs: LogEntry[] = []

  // 所有状态都包含：AI 提出决策建议
  logs.push({
    time,
    icon: 'sparkles',
    iconColor: 'var(--trae-text-brand)',
    desc: 'AI 提出决策建议',
  })

  // 所有状态都包含：系统自动校验安全性
  logs.push({
    time,
    icon: 'shield',
    iconColor: 'var(--trae-icon-secondary)',
    desc: '系统自动校验安全性',
  })

  // approved 及之后的状态：工程师审核通过
  const postApproval: DecisionCard['status'][] = ['approved', 'executed', 'verified']
  if (postApproval.includes(card.status)) {
    logs.push({
      time,
      icon: 'check',
      iconColor: 'var(--trae-status-success-default)',
      desc: '工程师审核通过',
    })
  }

  // rejected 状态
  if (card.status === 'rejected') {
    logs.push({
      time,
      icon: 'check',
      iconColor: 'var(--trae-status-error-default)',
      desc: '工程师拒绝执行',
    })
    return logs
  }

  // executed / verified：执行命令
  const postExecute: DecisionCard['status'][] = ['executed', 'verified']
  if (postExecute.includes(card.status)) {
    logs.push({
      time,
      icon: 'terminal',
      iconColor: 'var(--trae-text-brand)',
      desc: '执行',
      mono: card.fixCommand || undefined,
    })
    logs.push({
      time,
      icon: 'activity',
      iconColor: 'var(--trae-icon-secondary)',
      desc: '开始效果监控',
    })
  }

  // verified：验证通过
  if (card.status === 'verified') {
    logs.push({
      time,
      icon: 'check-circle',
      iconColor: 'var(--trae-status-success-default)',
      desc: '验证通过，决策完成',
    })
  }

  // failed：执行失败
  if (card.status === 'failed') {
    logs.push({
      time,
      icon: 'terminal',
      iconColor: 'var(--trae-text-brand)',
      desc: '执行',
      mono: card.fixCommand || undefined,
    })
    logs.push({
      time,
      icon: 'check-circle',
      iconColor: 'var(--trae-status-error-default)',
      desc: '执行失败，需要人工介入',
    })
  }

  return logs
}

/**
 * 单条日志
 */
function LogRow({
  log,
  isLast,
}: {
  log: LogEntry
  isLast: boolean
}) {
  const Icon = iconMap[log.icon]
  const borderClass = isLast ? '' : 'border-b border-[var(--trae-border-neutral-l1)]'
  return (
    <div className={`flex items-start gap-3 py-2 ${borderClass}`}>
      {/* 时间 */}
      <span
        className="font-mono shrink-0 text-[10px] text-[var(--trae-text-tertiary)] tabular-nums"
        style={{ width: '64px' }}
      >
        {log.time}
      </span>
      {/* 图标 */}
      <span className="shrink-0 inline-flex pt-0.5">
        <Icon
          className="w-3.5 h-3.5"
          style={{ color: log.iconColor }}
        />
      </span>
      {/* 描述 */}
      <span className="flex-1 min-w-0 text-[11px] leading-[18px] text-[var(--trae-text-default)]">
        {log.desc}
        {log.mono && (
          <span
            className="font-mono ml-1"
            style={{ color: 'var(--trae-text-default)' }}
          >
            {log.mono}
          </span>
        )}
      </span>
    </div>
  )
}

/**
 * ActionLog 主组件
 */
export function ActionLog({ card }: ActionLogProps) {
  const logs = deriveLogs(card)

  return (
    <section
      className="bg-[var(--trae-bg-base-secondary)] border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-8)]"
      style={{ padding: '24px' }}
    >
      {/* 头部条 */}
      <div
        className="flex items-center gap-2 px-4 py-3 -mx-6 -mt-6 mb-4 bg-[#252629] border-b border-[var(--trae-border-neutral-l1)] rounded-t-[var(--trae-radius-8)]"
        style={{ padding: '12px 16px' }}
      >
        <ListIcon />
        <span className="text-[13px] font-semibold text-[var(--trae-text-default)]">
          操作日志
        </span>
      </div>

      {/* 日志列表 */}
      <div className="flex flex-col">
        {logs.map((log, idx) => (
          <LogRow
            key={`${log.time}-${idx}`}
            log={log}
            isLast={idx === logs.length - 1}
          />
        ))}
      </div>
    </section>
  )
}

/** 章节标题图标（list） */
function ListIcon() {
  return (
    <span
      className="shrink-0 inline-block"
      style={{
        width: '16px',
        height: '16px',
        backgroundColor: 'var(--trae-icon-default)',
        maskImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M8 6h13'/><path d='M8 12h13'/><path d='M8 18h13'/><path d='M3 6h.01'/><path d='M3 12h.01'/><path d='M3 18h.01'/></svg>\")",
        maskSize: 'contain',
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M8 6h13'/><path d='M8 12h13'/><path d='M8 18h13'/><path d='M3 6h.01'/><path d='M3 12h.01'/><path d='M3 18h.01'/></svg>\")",
        WebkitMaskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
      }}
    />
  )
}
