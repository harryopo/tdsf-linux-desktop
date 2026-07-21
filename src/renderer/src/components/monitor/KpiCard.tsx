/**
 * KpiCard — KPI 环形进度图卡片
 *
 * 设计稿：monitor.html 第 3 段 KPI 4 列
 *
 * 1:1 复刻设计稿视觉：
 * - 左侧 72×72 SVG 环形进度图（CPU/内存/磁盘），transform: rotate(-90deg)
 *   - 背景圆：cx=36, cy=36, r=30, stroke=#3A3D42, stroke-width=6
 *   - 进度圆：stroke=主色（CPU/内存 #387BFF，磁盘 #F59E0B 警告色）
 *   - 中心数字（16px, 600）+ 单位（9px）
 * - 网络用迷你双向折线图（上行品牌蓝实线 + 下行灰虚线）
 * - 右侧信息：图标 + 标签 + 主值（"8 核心" / "4.2 / 8 GB" / "156 / 200 GB" / "2.0 MB/s"）+ 趋势 delta
 *
 * 配色：磁盘 78% 用 amber 警告色 #F59E0B（设计稿示例），其他用品牌蓝 #387BFF
 *
 * Spec: build-runnable-tdsf-from-design · Task 2.4 · SubTask 2.4.2
 */
import { Cpu, Database, Globe, MemoryStick, TrendingDown, TrendingUp } from 'lucide-react'
import type { KpiStat } from './mock-data'

/** 环形进度图周长（r=30） */
const RING_CIRCUMFERENCE = 2 * Math.PI * 30 // ≈ 188.4

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

/** 根据百分比计算 stroke-dashoffset（0→满偏移，100→0 偏移） */
function offsetFromPercent(percent: number): number {
  const clamped = Math.max(0, Math.min(100, percent))
  return RING_CIRCUMFERENCE * (1 - clamped / 100)
}

/**
 * 环形进度图 SVG（72×72）
 *
 * @param percent - 0~100
 * @param color - 进度圆颜色
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
  const offset = offsetFromPercent(percent)
  return (
    <div style={{ position: 'relative', width: 72, height: 72, flex: '0 0 auto' }}>
      <svg
        width="72"
        height="72"
        viewBox="0 0 72 72"
        style={{ transform: 'rotate(-90deg)' }}
        aria-label={`${centerValue}%`}
        role="img"
      >
        <circle cx="36" cy="36" r="30" fill="none" stroke="#3A3D42" strokeWidth="6" />
        <circle
          cx="36"
          cy="36"
          r="30"
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--trae-font-family-mono)',
            fontVariantNumeric: 'tabular-nums',
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--trae-text-default)',
            lineHeight: 1,
          }}
        >
          {centerValue}
        </div>
        <div
          style={{
            fontSize: 9,
            color: 'var(--trae-text-tertiary)',
            lineHeight: 1,
            marginTop: 1,
          }}
        >
          %
        </div>
      </div>
    </div>
  )
}

/**
 * 网络迷你双向折线图 SVG（72×72）
 *
 * - 上行：品牌蓝实线
 * - 下行：灰色虚线
 * - 中线：1px 灰色虚线
 * - 上下行标签（mono 8px）
 */
function NetworkMiniChart() {
  return (
    <div
      style={{
        position: 'relative',
        width: 72,
        height: 72,
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
        {/* 上行 (品牌蓝) */}
        <path
          d="M 8,52 L 18,48 L 28,50 L 38,42 L 48,44 L 58,36 L 64,38"
          fill="none"
          stroke="#387BFF"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* 下行 (灰) */}
        <path
          d="M 8,56 L 18,58 L 28,54 L 38,56 L 48,50 L 58,52 L 64,46"
          fill="none"
          stroke="#6B7078"
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
          stroke="#3A3D42"
          strokeWidth="1"
          strokeDasharray="1,3"
        />
        {/* 标签 */}
        <text x="6" y="14" fill="#387BFF" fontSize="8" fontFamily="var(--trae-font-family-mono)" fontWeight="600">
          ↑1.2
        </text>
        <text x="6" y="68" fill="#6B7078" fontSize="8" fontFamily="var(--trae-font-family-mono)">
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
      className="flex h-full items-center gap-3 rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] p-[14px]"
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}
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
      <div
        style={{
          flex: '1 1 0',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}
      >
        {/* 图标 + 标签 */}
        <div className="flex items-center gap-[5px]">
          <Icon className="h-3 w-3 text-[var(--trae-icon-secondary)]" />
          <span className="text-[10px] font-medium tracking-[0.04em] text-[var(--trae-text-tertiary)]">
            {stat.label}
          </span>
        </div>
        {/* 主值（如 "8 核心" / "4.2 / 8 GB" / "156 / 200 GB" / "2.0 MB/s"） */}
        <div
          className="font-mono text-[11px] font-semibold tabular-nums text-[var(--trae-text-default)]"
          style={{ fontFamily: 'var(--trae-font-family-mono)' }}
        >
          {stat.sub}
        </div>
        {/* 趋势 */}
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
    </div>
  )
}
