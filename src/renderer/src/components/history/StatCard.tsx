/**
 * StatCard — 统计概览卡片
 *
 * 设计稿：history.html 第 2 段 统计概览行
 *
 * 单卡片结构：
 * - 标签（uppercase + 字距 0.08em）
 * - 大数值（heading-xl 字号 + brand/success/secondary 色）
 * - 迷你折线（polyline，width 100% height 24）
 *
 * 颜色：总决策数/置信度=brand，成功率=success，响应时间=secondary
 */
import type { StatOverview } from './mock-data'

/**
 * StatCard 单卡片
 *
 * @param stat - 统计概览数据
 */
export function StatCard({ stat }: { stat: StatOverview }) {
  return (
    <div
      className="flex flex-col gap-2 p-4 bg-[var(--trae-bg-base-secondary)] border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-8)] min-w-0"
    >
      {/* 标签 */}
      <span
        className="text-[10px] leading-[14px] font-medium uppercase text-[var(--trae-text-tertiary)]"
        style={{ letterSpacing: '0.08em' }}
      >
        {stat.label}
      </span>
      {/* 大数值 */}
      <span
        className="font-mono tabular-nums text-[24px] leading-[1.1] font-semibold"
        style={{ color: stat.color }}
      >
        {stat.value}
      </span>
      {/* 迷你折线 */}
      <svg
        width="100%"
        height="24"
        viewBox="0 0 100 24"
        preserveAspectRatio="none"
        className="block mt-auto"
      >
        <polyline
          points={stat.sparkline}
          fill="none"
          stroke={stat.sparkColor}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}
