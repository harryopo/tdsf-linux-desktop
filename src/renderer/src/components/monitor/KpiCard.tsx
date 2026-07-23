/**
 * KpiCard — KPI 环形进度图卡片
 *
 * 设计稿：monitor.html 第 3 段 KPI 4 列
 *
 * 1:1 复刻设计稿视觉：
 * - 左侧 72×72 recharts RadialBarChart 环形进度图（CPU/内存/磁盘）
 *   - 背景圆：var(--trae-bg-overlay-l3)（原 SVG #3A3D42 的 token 等价物）
 *   - 进度圆：主色（CPU/内存 var(--trae-bg-brand)，磁盘 var(--trae-status-warning-default)）
 *   - 中心数字（16px, 600）+ 单位（9px）
 * - 网络用迷你双向折线图 SVG（上行品牌蓝实线 + 下行灰虚线）
 * - 右侧信息：图标 + 标签 + 主值（"8 核心" / "4.2 / 8 GB" / "156 / 200 GB" / "2.0 MB/s"）+ 趋势 delta
 *
 * 配色：磁盘 78% 用 amber 警告色（设计稿示例），其他用品牌蓝
 *
 * Spec: build-runnable-tdsf-from-design · Task 2.4 · SubTask 2.4.2
 * M3-1: 从 SVG RingProgress 迁移到 recharts RadialBarChart
 */
import { Cpu, Database, Globe, MemoryStick, TrendingDown, TrendingUp } from 'lucide-react'
import { PolarAngleAxis, RadialBar, RadialBarChart } from 'recharts'
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
 * 环形进度图（72×72，recharts RadialBarChart）
 *
 * 视觉对齐原 SVG RingProgress：
 * - 72×72 canvas
 * - 中心 (36, 36)
 * - 半径 30，环厚 6（innerRadius=27, outerRadius=33）
 * - 起点 12 点（startAngle=90），顺时针 360°（endAngle=-270）
 * - PolarAngleAxis domain=[0,100] 让 percent 直接映射到角度比例
 *
 * @param percent - 0~100
 * @param color - 进度圆颜色（token）
 * @param centerValue - 中心数字
 */
function RingProgress({
  percent,
  color,
  centerValue,
}: {
  percent: number
  color: string
  centerValue: number
}) {
  const clamped = Math.max(0, Math.min(100, percent))
  const data = [{ name: 'progress', value: clamped, fill: color }]
  return (
    <div className="mon-kpi-ring-wrap">
      <RadialBarChart
        width={72}
        height={72}
        cx={36}
        cy={36}
        innerRadius={27}
        outerRadius={33}
        data={data}
        startAngle={90}
        endAngle={-270}
        barSize={6}
      >
        <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
        <RadialBar
          background={{ fill: 'var(--trae-bg-overlay-l3)' }}
          dataKey="value"
          cornerRadius={3}
          fill={color}
        />
      </RadialBarChart>
      <div className="mon-kpi-ring-center">
        <div className="mon-kpi-ring-value">
          {centerValue}
        </div>
        <div className="mon-kpi-ring-unit">
          %
        </div>
      </div>
    </div>
  )
}

/**
 * 网络迷你双向折线图 SVG（72×72）
 *
 * M3-1 决策：保留 SVG 实现（迁移到 recharts LineChart 复杂度高且视觉无收益，
 * 72×72 的迷你图用 SVG 更精简；recharts 主要价值在 24h 主图表）
 *
 * - 上行：品牌蓝实线（var(--trae-bg-brand)）
 * - 下行：灰色虚线（var(--trae-text-tertiary)）
 * - 中线：1px 灰色虚线（var(--trae-bg-overlay-l3)）
 * - 上下行标签（mono 8px）
 */
function NetworkMiniChart() {
  return (
    <div className="mon-net-mini-wrap">
      <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
        {/* 上行 (品牌蓝) */}
        <path
          d="M 8,52 L 18,48 L 28,50 L 38,42 L 48,44 L 58,36 L 64,38"
          fill="none"
          stroke="var(--trae-bg-brand)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* 下行 (灰) */}
        <path
          d="M 8,56 L 18,58 L 28,54 L 38,56 L 48,50 L 58,52 L 64,46"
          fill="none"
          stroke="var(--trae-text-tertiary)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="2,2"
        />
        {/* 中线 */}
        <line
          x1="4"
          y1="36"
          x2="68"
          y2="36"
          stroke="var(--trae-bg-overlay-l3)"
          strokeWidth="1"
          strokeDasharray="1,3"
        />
        {/* 标签 */}
        <text x="6" y="14" className="mon-net-mini-label-up">
          ↑1.2
        </text>
        <text x="6" y="68" className="mon-net-mini-label-down">
          ↓0.8
        </text>
      </svg>
    </div>
  )
}

/**
 * KpiCard 单卡片组件
 *
 * @param stat - KPI 数据
 */
export function KpiCard({ stat }: { stat: KpiStat }) {
  const Icon = iconForLabel(stat.label)
  const isNetwork = stat.label === '网络 I/O'
  const trendColor = stat.trend === 'up' ? stat.ringColor : 'var(--trae-text-tertiary)'

  return (
    <div
      className="mon-kpi-card mon-stat-card flex h-full items-center gap-3"
    >
      {/* 左侧：环形进度图 或 网络迷你折线 */}
      {isNetwork ? <NetworkMiniChart /> : (
        <RingProgress
          percent={stat.value}
          color={stat.ringColor}
          centerValue={stat.value}
        />
      )}

      {/* 右侧：信息列 */}
      <div className="mon-kpi-info">
        {/* 图标 + 标签 */}
        <div className="mon-kpi-label-row">
          <Icon className="h-3 w-3 text-[var(--trae-icon-secondary)]" />
          <span className="mon-kpi-label">
            {stat.label}
          </span>
        </div>
        {/* 主值（如 "8 核心" / "4.2 / 8 GB" / "156 / 200 GB" / "2.0 MB/s"） */}
        <div className="mon-kpi-value">
          {stat.sub}
        </div>
        {/* 趋势 */}
        <div className="mon-kpi-trend">
          {stat.trend === 'up' ? (
            <TrendingUp className="h-2.5 w-2.5" style={{ color: trendColor }} />
          ) : (
            <TrendingDown className="h-2.5 w-2.5" style={{ color: trendColor }} />
          )}
          <span className="mon-kpi-trend-delta" style={{ color: trendColor }}>
            {stat.trend === 'up' ? '+' : ''}
            {stat.delta}
            {stat.unit === '%' ? '%' : ` ${stat.unit}`}
          </span>
          <span className="mon-kpi-trend-text">较昨日</span>
        </div>
      </div>
    </div>
  )
}
