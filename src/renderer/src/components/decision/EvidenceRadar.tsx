/**
 * EvidenceRadar — 六源证据雷达图（D-S 证据理论可视化）
 *
 * 设计稿：decision-detail.html 区域3 左侧
 * - 3 层网格六边形（外/中/内）
 * - 6 条轴线
 * - 数据多边形 + 6 数据点
 * - 6 轴标签（基础分/指标/历史/知识库/校验/模型）
 *
 * 实现：纯 SVG 直接绘制（不引入 chart 库），含 radar-hex 入场动画。
 */
import { useEffect, useState } from 'react'

/** 六源证据权重数据 */
export interface EvidenceSource {
  /** 源名称（轴标签） */
  label: string
  /** 权重值（0-1） */
  weight: number
  /** 源详细说明 */
  desc: string
}

interface EvidenceRadarProps {
  /** 6 源证据数据（顺序对应 6 个轴：上/右上/右下/下/左下/左上） */
  sources: EvidenceSource[]
}

/** 六边形顶点坐标（外层，半径 70） */
const HEX_VERTICES = [
  { x: 90, y: 20 },    // 上
  { x: 150.62, y: 55 },  // 右上
  { x: 150.62, y: 125 }, // 右下
  { x: 90, y: 160 },   // 下
  { x: 29.38, y: 125 },  // 左下
  { x: 29.38, y: 55 },   // 左上
]

/** 中心点 */
const CENTER = { x: 90, y: 90 }

/** 中层六边形（半径 ~46.67） */
const HEX_MID = [
  { x: 90, y: 43.33 },
  { x: 130.41, y: 66.67 },
  { x: 130.41, y: 113.33 },
  { x: 90, y: 136.67 },
  { x: 49.59, y: 113.33 },
  { x: 49.59, y: 66.67 },
]

/** 内层六边形（半径 ~23.33） */
const HEX_INNER = [
  { x: 90, y: 66.67 },
  { x: 110.21, y: 78.33 },
  { x: 110.21, y: 101.67 },
  { x: 90, y: 113.33 },
  { x: 69.79, y: 101.67 },
  { x: 69.79, y: 78.33 },
]

/** 满刻度值（v2.6：权重是 0-1 的置信度，满刻度对齐 1.0；
 * 原 0.30 会让高置信源溢出封顶、低权重源塌缩成点） */
const FULL_SCALE = 1

/**
 * 根据权重计算数据点坐标（沿轴线性插值）。
 */
function getDataPoint(vertex: { x: number; y: number }, weight: number): { x: number; y: number } {
  const ratio = Math.min(weight / FULL_SCALE, 1)
  return {
    x: CENTER.x + (vertex.x - CENTER.x) * ratio,
    y: CENTER.y + (vertex.y - CENTER.y) * ratio,
  }
}

/**
 * EvidenceRadar 组件
 */
export function EvidenceRadar({ sources }: EvidenceRadarProps) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 100)
    return () => window.clearTimeout(t)
  }, [])

  const dataPoints = sources.map((src, i) => getDataPoint(HEX_VERTICES[i], src.weight))
  const polygonPoints = dataPoints.map((p) => `${p.x},${p.y}`).join(' ')

  return (
    <div className="flex shrink-0 flex-col items-center gap-2 pt-2">
      <svg
        width="200"
        height="200"
        viewBox="0 0 180 180"
        aria-label="六源证据权重雷达图"
        style={{ maxWidth: '200px' }}
      >
        {/* 3 层网格六边形 */}
        <polygon
          points={HEX_VERTICES.map((v) => `${v.x},${v.y}`).join(' ')}
          fill="none"
          stroke="var(--trae-border-neutral-l1)"
          strokeWidth="1"
        />
        <polygon
          points={HEX_MID.map((v) => `${v.x},${v.y}`).join(' ')}
          fill="none"
          stroke="var(--trae-border-neutral-l1)"
          strokeWidth="1"
        />
        <polygon
          points={HEX_INNER.map((v) => `${v.x},${v.y}`).join(' ')}
          fill="none"
          stroke="var(--trae-border-neutral-l1)"
          strokeWidth="1"
        />

        {/* 6 条轴线 */}
        {HEX_VERTICES.map((v, i) => (
          <line
            key={`axis-${i}`}
            x1={CENTER.x}
            y1={CENTER.y}
            x2={v.x}
            y2={v.y}
            stroke="var(--trae-border-neutral-l1)"
            strokeWidth="1"
          />
        ))}

        {/* 数据多边形 */}
        <polygon
          points={polygonPoints}
          fill="var(--trae-bg-brand)"
          fillOpacity={0.18}
          stroke="var(--trae-bg-brand)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          className="radar-hex"
          style={{
            transformOrigin: '90px 90px',
            transform: mounted ? 'scale(1)' : 'scale(0)',
            opacity: mounted ? 1 : 0,
            transition: 'transform .6s cubic-bezier(.3,0,0,1) .15s, opacity .6s ease .15s',
          }}
        />

        {/* 数据点 */}
        {dataPoints.map((p, i) => (
          <circle
            key={`point-${i}`}
            cx={p.x}
            cy={p.y}
            r="3.5"
            fill="var(--trae-bg-brand)"
            style={{
              opacity: mounted ? 1 : 0,
              transition: `opacity .4s ease ${0.3 + i * 0.05}s`,
            }}
          />
        ))}

        {/* 6 轴标签 */}
        <text x="90" y="14" textAnchor="middle" fill="var(--trae-text-tertiary)" fontSize="9" fontFamily="var(--trae-font-family-mono)">
          {sources[0]?.label ?? ''}
        </text>
        <text x="162" y="52" textAnchor="middle" fill="var(--trae-text-tertiary)" fontSize="9" fontFamily="var(--trae-font-family-mono)">
          {sources[1]?.label ?? ''}
        </text>
        <text x="162" y="132" textAnchor="middle" fill="var(--trae-text-tertiary)" fontSize="9" fontFamily="var(--trae-font-family-mono)">
          {sources[2]?.label ?? ''}
        </text>
        <text x="90" y="174" textAnchor="middle" fill="var(--trae-text-tertiary)" fontSize="9" fontFamily="var(--trae-font-family-mono)">
          {sources[3]?.label ?? ''}
        </text>
        <text x="18" y="132" textAnchor="middle" fill="var(--trae-text-tertiary)" fontSize="9" fontFamily="var(--trae-font-family-mono)">
          {sources[4]?.label ?? ''}
        </text>
        <text x="18" y="52" textAnchor="middle" fill="var(--trae-text-tertiary)" fontSize="9" fontFamily="var(--trae-font-family-mono)">
          {sources[5]?.label ?? ''}
        </text>
      </svg>
      <div className="text-center text-[10px] tracking-[0.04em] text-[var(--trae-text-tertiary)]">
        权重分布雷达 · 6 源
      </div>
    </div>
  )
}
