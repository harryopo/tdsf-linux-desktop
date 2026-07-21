/**
 * EvidenceTimeline — 证据溯源链
 *
 * 设计稿：history-detail.html Card 2 证据溯源链
 *
 * - N 步时间线（从 card.evidences 派生）
 * - 每步：圆点 + 连接线 + 标题 + 状态徽章 + 描述 + 时间戳
 * - 全部完成（success 色填充）
 * - 最后一步无连接线
 */
import { Check } from 'lucide-react'
import type { Evidence } from '@shared/models'

export interface EvidenceTimelineProps {
  evidences: Evidence[]
}

/** 证据来源 → 中文标题映射 */
const SOURCE_TITLES: Record<Evidence['source'], string> = {
  log: '日志分析',
  metric: '指标采集',
  command: '命令执行',
  config: '配置检查',
  knowledge: '知识匹配',
}

/** 格式化时间戳为 HH:mm:ss */
function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 步骤状态徽章颜色 */
function statusColor(status: string): string {
  switch (status) {
    case '已完成':
      return 'var(--trae-status-success-default)'
    case '进行中':
      return 'var(--trae-status-warning-default)'
    case '待处理':
      return 'var(--trae-text-tertiary)'
    default:
      return 'var(--trae-status-success-default)'
  }
}

/** 派生的步骤数据 */
interface DerivedStep {
  step: number
  title: string
  status: string
  desc: string
  time: string
}

/**
 * 单步证据
 */
function Step({
  step,
  isLast,
}: {
  step: DerivedStep
  isLast: boolean
}) {
  const color = statusColor(step.status)
  return (
    <div className="flex" style={{ gap: '8px', paddingBottom: '8px' }}>
      {/* 左侧：圆点 + 连接线 */}
      <div className="flex flex-col items-center shrink-0">
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
          style={{ background: 'var(--trae-bg-brand)' }}
        >
          <Check
            className="w-3 h-3"
            style={{ color: 'var(--trae-text-onbrand)' }}
          />
        </div>
        {!isLast && (
          <div
            className="w-0.5 mt-1 flex-1 min-h-[24px]"
            style={{ background: 'var(--trae-bg-brand)' }}
          />
        )}
      </div>
      {/* 右侧：标题 + 状态 + 描述 + 时间 */}
      <div className="flex-1 pb-2">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-[10px] font-semibold text-[var(--trae-text-default)]">
            Step {step.step} · {step.title}
          </span>
          <span
            className="inline-flex items-center px-1.5 h-4 whitespace-nowrap text-[11px] font-medium rounded-[var(--trae-radius-2)]"
            style={{
              background: 'var(--trae-status-success-surface-l1)',
              color,
            }}
          >
            {step.status}
          </span>
        </div>
        <p className="text-[11px] text-[var(--trae-text-secondary)] mt-1 leading-[1.5]">
          {step.desc}
        </p>
        <p className="font-mono text-[10px] text-[var(--trae-text-tertiary)] mt-1">
          {step.time}
        </p>
      </div>
    </div>
  )
}

/**
 * EvidenceTimeline 主组件
 */
export function EvidenceTimeline({ evidences }: EvidenceTimelineProps) {
  /** 将 Evidence[] 派生为时间线步骤 */
  const steps: DerivedStep[] = evidences.map((ev, idx) => ({
    step: idx + 1,
    title: SOURCE_TITLES[ev.source] ?? ev.source,
    status: ev.verified ? '已完成' : '进行中',
    desc: ev.content || `${ev.sourceDetail}（匹配度 ${(ev.drainMatch * 100).toFixed(0)}%）`,
    time: formatTime(ev.timestamp),
  }))

  const totalSteps = steps.length
  const allDone = steps.every((s) => s.status === '已完成')

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
          <ScrollTextIcon />
          <span className="text-[13px] font-semibold text-[var(--trae-text-default)]">
            证据溯源链
          </span>
          <span className="inline-flex items-center px-1.5 h-4 whitespace-nowrap text-[11px] font-medium bg-[var(--trae-bg-overlay-l3)] text-[var(--trae-text-secondary)] rounded-[var(--trae-radius-2)]">
            {totalSteps}步 · HITL
          </span>
        </div>
        <span
          className="inline-flex items-center px-1.5 h-4 whitespace-nowrap text-[11px] font-medium rounded-[var(--trae-radius-2)]"
          style={{
            background: allDone
              ? 'var(--trae-status-success-surface-l1)'
              : 'var(--trae-status-warning-surface-l1, rgba(255,170,0,0.1))',
            color: allDone
              ? 'var(--trae-status-success-default)'
              : 'var(--trae-status-warning-default)',
          }}
        >
          {allDone ? '全部完成' : '进行中'}
        </span>
      </div>

      {/* 步骤列表 */}
      <div className="flex flex-col">
        {steps.length > 0 ? (
          steps.map((step, idx) => (
            <Step
              key={step.step}
              step={step}
              isLast={idx === steps.length - 1}
            />
          ))
        ) : (
          <p className="text-[11px] text-[var(--trae-text-tertiary)] py-4 text-center">
            暂无证据数据
          </p>
        )}
      </div>
    </section>
  )
}

/** 章节标题图标（scroll-text） */
function ScrollTextIcon() {
  return (
    <span
      className="shrink-0 inline-block"
      style={{
        width: '16px',
        height: '16px',
        backgroundColor: 'var(--trae-icon-default)',
        maskImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M15 12H9'/><path d='M15 8H9'/><path d='M19 17V5a2 2 0 0 0-2-2H4'/><path d='M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3'/></svg>\")",
        maskSize: 'contain',
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M15 12H9'/><path d='M15 8H9'/><path d='M19 17V5a2 2 0 0 0-2-2H4'/><path d='M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3'/></svg>\")",
        WebkitMaskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
      }}
    />
  )
}
