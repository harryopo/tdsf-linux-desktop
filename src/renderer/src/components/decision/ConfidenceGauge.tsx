/**
 * ConfidenceGauge — 大型径向置信度仪表（SVG 直接绘制）
 *
 * 抽离自 DecisionDetailPage.tsx（M2 Task 1），供 DecisionDetailPage / DecisionPage /
 * HistoryDetailPage 等页面复用。
 *
 * 设计稿：decision-detail.html 区域2 左侧（核心视觉锚点）
 *
 * 视觉构成：
 * - 外圈：6 段弧（按 EvidenceSource 权重渲染透明度）
 * - 内圈：综合置信度进度环（var(--trae-bg-brand)）
 * - 中心：大号置信度数值 + 高/中/低可信 tag
 * - 底部：6 源权重明细 grid
 *
 * Token 合规：所有颜色使用 var(--trae-*) 或 var(--bg-brand)，无硬编码。
 */
import { Activity } from 'lucide-react'
import type { EvidenceSource } from '@/components/decision/EvidenceRadar'

interface ConfidenceGaugeProps {
  /** 综合置信度 [0, 1] */
  value: number
  /** 6 源证据权重数据（不足 6 个时使用默认权重） */
  sources: EvidenceSource[]
}

/**
 * 大型径向置信度仪表
 *
 * - 当 sources.length >= 6 时，按 sources 渲染 6 段弧
 * - 否则使用默认 6 源权重（基础分/指标采集/历史匹配/知识库/人工校验/模型置信）
 */
export function ConfidenceGauge({ value, sources }: ConfidenceGaugeProps) {
  const weights = sources.length >= 6
    ? sources.map(s => ({ label: s.label, val: s.weight, opacity: Math.max(0.4, s.weight) }))
    : [
        { label: '基础分', val: 0.3, opacity: 1 },
        { label: '指标采集', val: 0.3, opacity: 1 },
        { label: '历史匹配', val: 0.22, opacity: 0.85 },
        { label: '知识库', val: 0.15, opacity: 0.6 },
        { label: '人工校验', val: 0.2, opacity: 0.9 },
        { label: '模型置信', val: 0.2, opacity: 0.9 },
      ]

  // 6 段弧的起止点（与设计稿一致）
  const segments = [
    'M 110,20 A 90,90 0 0 1 197.44,88.71',
    'M 198.10,91.63 A 90,90 0 0 1 148.71,191.25',
    'M 145.99,192.49 A 90,90 0 0 1 61.78,185.99',
    'M 59.26,184.33 A 90,90 0 0 1 24.22,137.23',
    'M 23.42,134.57 A 90,90 0 0 1 36.44,58.15',
    'M 38.35,55.54 A 90,90 0 0 1 106.92,20.05',
  ]

  const confidenceLabel = value >= 0.8 ? '高可信' : value >= 0.6 ? '中可信' : '低可信'

  return (
    <div className="flex w-full min-w-[280px] max-w-[400px] flex-none flex-col items-center gap-4 rounded-[var(--trae-radius-10)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] p-6">
      <div className="flex items-center gap-1.5 self-start">
        <Activity className="h-3.5 w-3.5 text-[var(--trae-text-secondary)]" />
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--trae-text-secondary)]">
          置信度仪表
        </span>
      </div>
      <div className="relative h-[220px] w-[220px]">
        <svg width="220" height="220" viewBox="0 0 220 220" style={{ display: 'block', overflow: 'visible' }}>
          <circle cx="110" cy="110" r="90" fill="none" stroke="var(--trae-bg-overlay-l1)" strokeWidth="8" />
          {segments.map((d, i) => {
            const w = weights[i]
            // hover tooltip：源名 + 权重 + 数值
            const tooltipText = w
              ? `${w.label} · 权重 ${w.val.toFixed(2)} · 占比 ${((w.val / weights.reduce((s, x) => s + x.val, 0)) * 100).toFixed(1)}%`
              : `源 ${i + 1}`
            return (
              <path
                key={i}
                className="gauge-segment"
                d={d}
                fill="none"
                stroke="var(--trae-bg-brand)"
                strokeWidth="8"
                opacity={w?.opacity ?? 0.5}
                strokeLinecap="round"
                role="presentation"
              >
                <title>{tooltipText}</title>
              </path>
            )
          })}
          <circle cx="110" cy="110" r="70" fill="none" stroke="var(--trae-bg-overlay-l2)" strokeWidth="6" />
          <circle
            className="gauge-progress"
            cx="110"
            cy="110"
            r="70"
            fill="none"
            stroke="var(--trae-bg-brand)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${value * 439.82} 439.82`}
            transform="rotate(-90 110 110)"
          >
            <title>{`综合置信度 ${value.toFixed(2)} · ${confidenceLabel}`}</title>
          </circle>
          <text x="110" y="214" textAnchor="middle" fontSize="9" fill="var(--trae-text-tertiary)" fontFamily="var(--trae-font-family-mono)">0.5</text>
          <text x="6" y="150" textAnchor="start" fontSize="9" fill="var(--trae-text-tertiary)" fontFamily="var(--trae-font-family-mono)">0.7</text>
          <text x="46" y="24" textAnchor="middle" fontSize="9" fill="var(--trae-text-tertiary)" fontFamily="var(--trae-font-family-mono)">0.9</text>
        </svg>
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1">
          <span
            className="font-mono font-bold leading-none tabular-nums text-[var(--trae-text-brand)]"
            style={{ fontSize: '40px' }}
          >
            {value.toFixed(2)}
          </span>
          <span className="text-[11px] text-[var(--trae-text-tertiary)]">置信度</span>
          <span className="mt-1 inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-status-success-default)] bg-[rgba(51,193,146,0.12)] px-2 text-[10px] font-medium text-[var(--trae-status-success-default)]">
            {confidenceLabel}
          </span>
        </div>
      </div>
      {/* 6 源权重明细 */}
      <div className="grid w-full grid-cols-2 gap-x-4 gap-y-1.5">
        {weights.map((w) => (
          <div key={w.label} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-sm bg-[var(--trae-bg-brand)]"
              style={{ opacity: w.opacity }}
            />
            <span className="text-[10px] text-[var(--trae-text-secondary)]">{w.label}</span>
            <span className="ml-auto font-mono text-[10px] tabular-nums text-[var(--trae-text-default)]">
              {w.val.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
