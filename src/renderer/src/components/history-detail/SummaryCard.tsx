/**
 * SummaryCard — 决策摘要卡片
 *
 * 设计稿：history-detail.html Card 1 决策摘要
 *
 * 7 行 label-value：
 * - 问题 / 根因 / 决策 / 执行命令 / 置信度 / 执行人 / 审核人
 *
 * 特殊行渲染：
 * - 执行命令：黑色代码块 + 语法高亮（nginx 蓝色 / -s reload 白色 / 注释 tertiary）
 * - 置信度：大数值 + 进度条
 * - 执行人：AI Agent 蓝色徽章
 * - 审核人：Engineer Zhang 绿色徽章
 */
import { Check, Sparkles } from 'lucide-react'
import type { DecisionCard } from '@shared/models'

export interface SummaryCardProps {
  card: DecisionCard
}

/** 行 label 样式（统一 84px 宽） */
const labelClass =
  'shrink-0 w-[84px] text-[10px] leading-[18px] text-[var(--trae-text-tertiary)] font-medium'
/** 行 value 样式 */
const valueClass =
  'flex-1 min-w-0 text-[11px] leading-[18px] text-[var(--trae-text-default)]'

/**
 * 单行 label-value
 */
function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-[var(--trae-border-neutral-l1)] last:border-b-0">
      <span className={labelClass} style={{ letterSpacing: '0.04em' }}>
        {label}
      </span>
      <div className={valueClass}>{children}</div>
    </div>
  )
}

/**
 * SummaryCard 主组件
 */
export function SummaryCard({ card }: SummaryCardProps) {
  const problem = card.problem || '未知问题'
  const hypothesis = card.hypothesis || '分析中'
  const fixDescription = card.fixDescription || '待生成修复方案'
  const fixCommand = card.fixCommand || ''
  const confidence = card.confidence ?? 0

  return (
    <section
      className="bg-[var(--trae-bg-base-secondary)] border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-8)]"
      style={{ padding: '24px' }}
    >
      {/* 卡片头部条 */}
      <div
        className="flex items-center gap-2 px-4 py-3 -mx-6 -mt-6 mb-4 bg-[#252629] border-b border-[var(--trae-border-neutral-l1)] rounded-t-[var(--trae-radius-8)]"
        style={{ padding: '12px 16px' }}
      >
        <ScrollTextIcon />
        <span className="text-[13px] font-semibold text-[var(--trae-text-default)]">
          决策摘要
        </span>
      </div>

      {/* 问题 */}
      <Row label="问题">
        <span>{problem}</span>
      </Row>

      {/* 根因 */}
      <Row label="根因">
        <span>{hypothesis}</span>
      </Row>

      {/* 决策 */}
      <Row label="决策">
        <span>{fixDescription}</span>
      </Row>

      {/* 执行命令 */}
      <Row label="执行命令">
        <div
          className="font-mono text-[12px] leading-[1.6] px-3 py-2 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)]"
          style={{ background: '#0F1011' }}
        >
          {fixCommand ? (
            <span style={{ color: 'var(--trae-text-default)' }}>{fixCommand}</span>
          ) : (
            <span style={{ color: 'var(--trae-text-tertiary)' }}>暂无执行命令</span>
          )}
        </div>
      </Row>

      {/* 置信度 */}
      <Row label="置信度">
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-[14px] font-semibold"
            style={{ color: 'var(--trae-text-brand)' }}
          >
            {confidence.toFixed(2)}
          </span>
          <div
            className="h-1 bg-[var(--trae-bg-overlay-l3)] rounded-full overflow-hidden"
            style={{ flex: '1', maxWidth: '200px' }}
          >
            <div
              className="h-full bg-[var(--trae-bg-brand)] rounded-full"
              style={{ width: `${confidence * 100}%` }}
            />
          </div>
        </div>
      </Row>

      {/* 执行人 */}
      <Row label="执行人">
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--trae-radius-4)] text-[10px]"
          style={{
            background: 'var(--trae-bg-brand-popup)',
            color: 'var(--trae-text-brand)',
          }}
        >
          <Sparkles className="w-3 h-3" />
          AI Agent
        </span>
      </Row>

      {/* 审核人 */}
      <Row label="审核人">
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--trae-radius-4)] text-[10px]"
          style={{
            background: 'var(--trae-status-success-surface-l1)',
            color: 'var(--trae-status-success-default)',
          }}
        >
          <Check className="w-3 h-3" />
          Engineer Zhang
        </span>
      </Row>
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
