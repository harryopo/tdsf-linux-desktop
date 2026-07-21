/**
 * KpiCard — KPI 数字 + Sparkline 卡片
 *
 * 设计稿：monitor.html 第 3 段 KPI 4 列
 *
 * 布局：
 * - 左侧：大数值 + 单位 + 标签 + 副值 + 变化趋势
 * - 右侧：迷你 Sparkline（SVG 面积/折线）
 *
 * 配色：磁盘 78% 用 amber 警告色（#F59E0B），其他用品牌蓝（#387BFF）
 */
import { Cpu, Database, Globe, MemoryStick, TrendingDown, TrendingUp } from 'lucide-react'
import type { KpiStat } from './mock-data'

/** 图标按 label 映射（替代设计稿的 SVG mask） */
function iconForLabel(label: string) {
  switch (label) {
    case 'CPU':
      return Cpu
    case '内存':
      return MemoryStick
    case '磁盘':
      return Database
    case '网络 I/O':
      return Globe
    default:
      return Cpu
  }
}

/**
 * 根据 sparkline 数据点生成 SVG 折线路径
 *
 * @param data - 0-100 数值数组
 * @param width - 视图宽度
 * @param height - 视图高度
 * @returns SVG path 的 d 属性
 */
function buildSparklinePath(data: number[], width: number, height: number): string {
  if (data.length < 2) return ''
  const stepX = width / (data.length - 1)
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const points = data.map((v, i) => {
    const x = i * stepX
    // 留出上下 4px padding
    const y = height - 4 - ((v - min) / range) * (height - 8)
    return [x, y]
  })
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]},${p[1]}`).join(' ')
}

/**
 * KpiCard 单卡片组件
 *
 * @param stat - KPI 数据
 */
export function KpiCard({ stat }: { stat: KpiStat }) {
  const Icon = iconForLabel(stat.label)
  const lineColor = stat.ringColor

  const sparkPath = buildSparklinePath(stat.sparkline, 96, 40)
  const areaPath =
    sparkPath &&
    `${sparkPath} L 96,${40 - 4} L 0,${40 - 4} Z`

  const trendColor = stat.trend === 'up' ? 'var(--trae-text-brand)' : 'var(--trae-text-tertiary)'

  return (
    <div className="flex h-full items-center justify-between gap-3 rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] p-3 shadow-[var(--trae-shadow-card)]">
      {/* 左侧：大数值 + 标签 + 副值 + 趋势 */}
      <div className="flex min-w-0 flex-col gap-[6px]">
        {/* 图标 + 标签 */}
        <div className="flex items-center gap-[5px]">
          <Icon className="h-3 w-3 text-[var(--trae-icon-secondary)]" />
          <span className="text-[10px] font-medium tracking-[0.04em] text-[var(--trae-text-tertiary)]">
            {stat.label}
          </span>
        </div>
        {/* 大数值 */}
        <div className="flex items-baseline gap-1">
          <span
            className="font-mono text-[26px] font-semibold leading-none tabular-nums"
            style={{ color: lineColor }}
          >
            {stat.value}
          </span>
          <span className="text-[12px] font-medium text-[var(--trae-text-tertiary)]">
            {stat.unit}
          </span>
        </div>
        {/* 副值 */}
        <div className="font-mono text-[11px] font-semibold text-[var(--trae-text-default)]">
          {stat.sub}
        </div>
        {/* 变化趋势 */}
        <div className="flex items-center gap-[3px] text-[10px]">
          {stat.trend === 'up' ? (
            <TrendingUp className="h-2.5 w-2.5" style={{ color: trendColor }} />
          ) : (
            <TrendingDown className="h-2.5 w-2.5" style={{ color: trendColor }} />
          )}
          <span className="font-medium" style={{ color: trendColor }}>
            {stat.trend === 'up' ? '+' : ''}
            {stat.delta}
            {stat.unit === '%' ? '%' : ` ${stat.unit}`}
          </span>
          <span className="text-[var(--trae-text-tertiary)]">较昨日</span>
        </div>
      </div>

      {/* 右侧：迷你 Sparkline */}
      <div className="shrink-0">
        <svg width="96" height="40" viewBox="0 0 96 40" className="overflow-visible">
          {/* 渐变填充面积 */}
          <defs>
            <linearGradient id={`sparkGradient-${stat.label}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
              <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
            </linearGradient>
          </defs>
          {areaPath && (
            <path d={areaPath} fill={`url(#sparkGradient-${stat.label})`} stroke="none" />
          )}
          {sparkPath && (
            <path
              d={sparkPath}
              fill="none"
              stroke={lineColor}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
      </div>
    </div>
  )
}
