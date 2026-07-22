/**
 * Charts — 4 个 SVG 图表（24h 数据，1:1 复刻设计稿 monitor.html）
 *
 * 设计稿：monitor.html 第 4 段 图表网格 2x2
 *
 * 1:1 复刻视觉：
 * - 图表卡片：200px 高，p-3，背景 var(--bg-base-secondary)，边框 var(--border-neutral-l1)，圆角 var(--radius-8)
 * - SVG viewBox="0 0 600 140" preserveAspectRatio="none"（拉伸填充）
 * - 网格线 3 条（y=35/70/105），颜色 var(--viz-ui-chart-axis)
 * - x 轴 5 个时间标签（00:00/06:00/12:00/18:00/24:00）
 *
 * 4 个图表：
 * - CpuAreaChart：CPU 使用率面积图（24h），渐变填充 + 描边
 * - MemoryLineChart：内存使用折线图（24h，3 条线：used/buffer/cache）
 * - DiskIoBarChart：磁盘 IO 柱状图（24h，24 个柱子）
 * - NetworkFlowChart：网络流量双折线（24h，入站/出站）
 *
 * 数据策略：
 * - 有监控数据（useMonitorStore）→ 使用实时数据构建路径
 * - 无监控数据 → 使用设计稿示例数据 fallback（sampleCpuAreaPath 等）
 *
 * Spec: build-runnable-tdsf-from-design · Task 2.4 · SubTask 2.4.3
 */
import { useMonitorStore } from '../../stores/monitor-store'
import { useServerStore } from '../../stores/server-store'
import {
  sampleCpuAreaPath,
  sampleMemLines,
  sampleDiskIo,
  sampleNetFlow,
  chartXLabels,
} from './mock-data'

// ===== 常量 =====

const CHART_W = 600
const CHART_H = 140

// ===== 数据 Hook =====

/** 获取当前活跃会话的监控数据 */
function useActiveMonitorData() {
  const activeSessionId = useServerStore((s) => s.activeSessionId)
  const data = useMonitorStore((s) =>
    activeSessionId ? s.getMonitorData(activeSessionId) : []
  )
  return data
}

// ===== SVG 路径构建工具（实时数据用） =====

/** 构建折线 SVG path */
function buildLinePath(values: number[], width: number, height: number, maxVal = 100): string {
  if (values.length < 2) return `M0,${height} L${width},${height}`
  const step = width / (values.length - 1)
  return values
    .map((v, i) => {
      const x = (i * step).toFixed(1)
      const y = (height - (Math.min(v, maxVal) / maxVal) * height).toFixed(1)
      return `${i === 0 ? 'M' : 'L'}${x},${y}`
    })
    .join(' ')
}

/** 构建面积 SVG path（折线 + 底部封闭） */
function buildAreaPath(values: number[], width: number, height: number, maxVal = 100): string {
  const line = buildLinePath(values, width, height, maxVal)
  return `${line} L${width},${height} L0,${height} Z`
}

/** 构建 polyline points 字符串 */
function buildPolylinePoints(values: number[], width: number, height: number, maxVal = 100): string {
  if (values.length < 2) return `0,${height} ${width},${height}`
  const step = width / (values.length - 1)
  return values
    .map((v, i) => {
      const x = (i * step).toFixed(1)
      const y = (height - (Math.min(v, maxVal) / maxVal) * height).toFixed(1)
      return `${x},${y}`
    })
    .join(' ')
}

// ===== 图表卡片容器 =====

/** 图表容器（统一卡片样式 + 标题行 + 时间轴） */
function ChartCard({
  title,
  legend,
  children,
  rightHint,
}: {
  title: string
  legend?: React.ReactNode
  rightHint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div
      className="mon-chart-card-wrap mon-chart-card flex flex-col h-[200px]"
    >
      {/* 标题行 */}
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="mon-chart-title">{title}</span>
        {legend ?? rightHint}
      </div>
      {/* SVG 主体 */}
      <div className="flex-1 min-h-0">{children}</div>
      {/* x 轴刻度 */}
      <div className="mon-chart-axis flex justify-between mt-2">
        {chartXLabels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  )
}

// ===== 4 个图表组件 =====

/** CPU 使用率面积图（24h） */
export function CpuAreaChart() {
  const monitorData = useActiveMonitorData()
  const recent = monitorData.slice(-60)
  const cpuValues = recent.map((d) => d.cpuUsage)
  const latest = cpuValues.length > 0 ? cpuValues[cpuValues.length - 1] : 68

  // 有实时数据用实时，否则用设计稿示例 path
  const linePath = recent.length >= 2 ? buildLinePath(cpuValues, CHART_W, CHART_H, 100) : sampleCpuAreaPath
  const areaPath = recent.length >= 2
    ? buildAreaPath(cpuValues, CHART_W, CHART_H, 100)
    : `${sampleCpuAreaPath} L 600,140 L 0,140 Z`

  return (
    <ChartCard
      title="CPU使用率(24h)"
      rightHint={
        <span className="mon-chart-value">
          {Math.round(latest)}%
        </span>
      }
    >
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" width="100%" height="100%" className="block">
        <defs>
          <linearGradient id="cpuAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--trae-bg-brand)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--trae-bg-brand)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* 网格线 */}
        <line x1="0" y1="35" x2={CHART_W} y2="35" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
        <line x1="0" y1="70" x2={CHART_W} y2="70" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
        <line x1="0" y1="105" x2={CHART_W} y2="105" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
        {/* 面积填充 */}
        <path d={areaPath} fill="url(#cpuAreaGrad)" />
        {/* 描边折线 */}
        <path
          d={linePath}
          fill="none"
          stroke="var(--trae-bg-brand)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </ChartCard>
  )
}

/** 内存使用折线图（24h，3 条线：used/buffer/cache） */
export function MemoryLineChart() {
  const monitorData = useActiveMonitorData()
  const recent = monitorData.slice(-60)
  const memValues = recent.map((d) => d.memoryUsage)

  // 有实时数据用实时（仅 used 线），否则用设计稿示例 3 条线
  const useSample = recent.length < 2

  return (
    <ChartCard
      title="内存使用(24h)"
      legend={
        <div className="mon-chart-legend flex items-center gap-2 shrink-0">
          <span className="flex items-center gap-1">
            <span className="mon-chart-dot" style={{ background: 'var(--trae-bg-brand)' }} />
            used
          </span>
          <span className="flex items-center gap-1">
            <span className="mon-chart-dot" style={{ background: 'var(--trae-bg-brand-hover)' }} />
            buffer
          </span>
          <span className="flex items-center gap-1">
            <span className="mon-chart-dot" style={{ background: 'var(--trae-brand-3)' }} />
            cache
          </span>
        </div>
      }
    >
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" width="100%" height="100%" className="block">
        {/* 网格线 */}
        <line x1="0" y1="35" x2={CHART_W} y2="35" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
        <line x1="0" y1="70" x2={CHART_W} y2="70" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
        <line x1="0" y1="105" x2={CHART_W} y2="105" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
        {useSample ? (
          <>
            {/* used 实线 */}
            <polyline
              points={sampleMemLines.used}
              fill="none"
              stroke="var(--trae-bg-brand)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* buffer 虚线 */}
            <polyline
              points={sampleMemLines.buffer}
              fill="none"
              stroke="var(--trae-bg-brand-hover)"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              strokeLinecap="round"
            />
            {/* cache 虚线 */}
            <polyline
              points={sampleMemLines.cache}
              fill="none"
              stroke="var(--trae-brand-3)"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              strokeLinecap="round"
            />
          </>
        ) : (
          <polyline
            points={buildPolylinePoints(memValues, CHART_W, CHART_H, 100)}
            fill="none"
            stroke="var(--trae-bg-brand)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </ChartCard>
  )
}

/** 磁盘 IO 柱状图（24h，24 个柱子） */
export function DiskIoBarChart() {
  const monitorData = useActiveMonitorData()
  const recent = monitorData.slice(-12)
  const diskValues = recent.map((d) => d.diskUsage)

  const useSample = recent.length < 2

  // 实时数据柱子布局
  const barCount = diskValues.length
  const gap = 4
  const barWidth = barCount > 0 ? (CHART_W - gap * (barCount + 1)) / barCount : 0

  return (
    <ChartCard
      title="磁盘IO(24h)"
      rightHint={
        <span className="mon-chart-hint">MB/s</span>
      }
    >
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" width="100%" height="100%" className="block">
        {/* 网格线 */}
        <line x1="0" y1="35" x2={CHART_W} y2="35" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
        <line x1="0" y1="70" x2={CHART_W} y2="70" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
        <line x1="0" y1="105" x2={CHART_W} y2="105" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
        {useSample ? (
          <g fill="var(--trae-bg-brand)">
            {sampleDiskIo.map((bar, i) => (
              <rect key={i} x={bar.x} y={bar.y} width={bar.w} height={bar.h} />
            ))}
          </g>
        ) : (
          <g fill="var(--trae-bg-brand)">
            {diskValues.map((v, i) => {
              const barH = (Math.min(v, 100) / 100) * CHART_H
              const x = gap + i * (barWidth + gap)
              const y = CHART_H - barH
              return (
                <rect
                  key={i}
                  x={x.toFixed(1)}
                  y={y.toFixed(1)}
                  width={barWidth.toFixed(1)}
                  height={barH.toFixed(1)}
                  rx="2"
                />
              )
            })}
          </g>
        )}
      </svg>
    </ChartCard>
  )
}

/** 网络流量双折线图（24h，入站 / 出站） */
export function NetworkFlowChart() {
  const monitorData = useActiveMonitorData()
  const recent = monitorData.slice(-60)
  const inValues = recent.map((d) => d.networkIn)
  const outValues = recent.map((d) => d.networkOut)

  const useSample = recent.length < 2

  // 动态 maxVal：取所有值中的最大值，最小为 100
  const allValues = [...inValues, ...outValues]
  const maxVal = allValues.length > 0 ? Math.max(...allValues, 100) : 100

  return (
    <ChartCard
      title="网络流量(24h)"
      legend={
        <div className="mon-chart-legend flex items-center gap-2 shrink-0">
          <span className="flex items-center gap-1">
            <span className="mon-chart-dot" style={{ background: 'var(--trae-bg-brand)' }} />
            入站
          </span>
          <span className="flex items-center gap-1">
            <span className="mon-chart-dot" style={{ background: 'var(--trae-brand-3)' }} />
            出站
          </span>
        </div>
      }
    >
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" width="100%" height="100%" className="block">
        {/* 网格线 */}
        <line x1="0" y1="35" x2={CHART_W} y2="35" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
        <line x1="0" y1="70" x2={CHART_W} y2="70" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
        <line x1="0" y1="105" x2={CHART_W} y2="105" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
        {useSample ? (
          <>
            <polyline
              points={sampleNetFlow.inbound}
              fill="none"
              stroke="var(--trae-bg-brand)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points={sampleNetFlow.outbound}
              fill="none"
              stroke="var(--trae-brand-3)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : (
          <>
            {/* 入站 */}
            <polyline
              points={buildPolylinePoints(inValues, CHART_W, CHART_H, maxVal)}
              fill="none"
              stroke="var(--trae-bg-brand)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* 出站 */}
            <polyline
              points={buildPolylinePoints(outValues, CHART_W, CHART_H, maxVal)}
              fill="none"
              stroke="var(--trae-brand-3)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}
      </svg>
    </ChartCard>
  )
}
