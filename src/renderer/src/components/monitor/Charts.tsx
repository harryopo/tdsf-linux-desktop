/**
 * Charts — 4 个 recharts 图表（24h 数据，1:1 复刻设计稿 monitor.html）
 *
 * 设计稿：monitor.html 第 4 段 图表网格 2x2
 *
 * M3-1: 从纯 SVG 迁移到 recharts
 * - CpuAreaChart → AreaChart + Area（CPU 使用率 24h 面积图）
 * - MemoryLineChart → LineChart + Line（内存 24h 折线图，3 条 used/buffer/cache）
 * - DiskIoBarChart → BarChart + Bar（磁盘 IO 24h 柱状图）
 * - NetworkFlowChart → LineChart + 双 Line（网络流量 24h 入站/出站）
 *
 * 视觉对齐：
 * - 图表卡片：200px 高，p-3，背景 var(--bg-base-secondary)
 * - 图表主体高度 140px（ResponsiveContainer height={140}）
 * - 网格线 3 条（CartesianGrid horizontal）
 * - x 轴 5 个时间标签（00:00/06:00/12:00/18:00/24:00，由 ChartCard 底部渲染）
 *
 * 数据策略：
 * - 有监控数据（useMonitorStore）→ 实时 map 为 recharts data
 * - 无监控数据 → 解析 sample SVG 数据为 recharts data fallback
 *
 * Spec: build-runnable-tdsf-from-design · Task 2.4 · SubTask 2.4.3
 */
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { useMonitorStore } from '../../stores/monitor-store'
import { useServerStore } from '../../stores/server-store'
import {
  sampleCpuAreaPath,
  sampleDiskIo,
  sampleMemLines,
  sampleNetFlow,
  chartXLabels,
} from './mock-data'
// M3 Task 2：时间范围切换切片工具（Chart 数据源按 range 过滤）
import { sliceMonitorData, type TimeRange } from '../../utils/monitor-time-range'

// ===== 常量 =====

/** 图表主体高度（与原 SVG viewBox 高度一致） */
const CHART_H = 140
/** 原 SVG viewBox 宽度（用于 sample 数据 x 坐标换算） */
const SVG_W = 600
/** 原 SVG viewBox 高度（用于 sample 数据 y 坐标换算） */
const SVG_H = 140

// ===== 数据 Hook =====

/** 获取当前活跃会话的监控数据 */
function useActiveMonitorData() {
  const activeSessionId = useServerStore((s) => s.activeSessionId)
  const data = useMonitorStore((s) =>
    activeSessionId ? s.getMonitorData(activeSessionId) : [],
  )
  return data
}

// ===== sample 数据解析（SVG path/polyline → recharts data） =====

/** x 坐标 0~600 → 时间标签 00:00~24:00（每 25 单位 = 1h） */
function xToTimeLabel(x: number): string {
  const hours = (x / SVG_W) * 24
  const h = Math.round(hours)
  if (h >= 24) return '24:00'
  return `${String(h).padStart(2, '0')}:00`
}

/** 解析 SVG polyline points "0,80 50,75..." 为数据点（y 翻转：SVG 底部为 0） */
function parsePolyline(points: string): Array<{ x: number; y: number }> {
  return points.split(' ').map((p) => {
    const [x, y] = p.split(',').map(Number)
    return { x, y: SVG_H - y }
  })
}

/** 解析 SVG path "M 0,105 L 25,95..." 为数据点（y 翻转） */
function parsePath(pathStr: string): Array<{ x: number; y: number }> {
  const cleaned = pathStr.replace(/^M\s+/, '').replace(/\s+L\s+/g, ' ')
  return cleaned.split(' ').map((p) => {
    const [x, y] = p.split(',').map(Number)
    return { x, y: SVG_H - y }
  })
}

/** 把 SVG y 坐标（0~140）转换为业务百分比（0~100） */
function svgYToPercent(y: number): number {
  return Math.round((y / SVG_H) * 100 * 10) / 10
}

/** sample CPU 面积图 → recharts data */
function buildSampleCpuData(): Array<{ time: string; cpu: number }> {
  return parsePath(sampleCpuAreaPath).map((p) => ({
    time: xToTimeLabel(p.x),
    cpu: svgYToPercent(p.y),
  }))
}

/** sample 内存折线图 → recharts data（3 条线 used/buffer/cache） */
function buildSampleMemData(): Array<{ time: string; used: number; buffer: number; cache: number }> {
  const used = parsePolyline(sampleMemLines.used)
  const buffer = parsePolyline(sampleMemLines.buffer)
  const cache = parsePolyline(sampleMemLines.cache)
  return used.map((p, i) => ({
    time: xToTimeLabel(p.x),
    used: svgYToPercent(p.y),
    buffer: svgYToPercent(buffer[i].y),
    cache: svgYToPercent(cache[i].y),
  }))
}

/** sample 磁盘 IO 柱状图 → recharts data（柱高 h 转换为业务值） */
function buildSampleDiskIoData(): Array<{ time: string; io: number }> {
  return sampleDiskIo.map((bar) => ({
    time: xToTimeLabel(bar.x),
    io: svgYToPercent(bar.h),
  }))
}

/** sample 网络流量 → recharts data（入站/出站双线） */
function buildSampleNetFlowData(): Array<{ time: string; inbound: number; outbound: number }> {
  const inbound = parsePolyline(sampleNetFlow.inbound)
  const outbound = parsePolyline(sampleNetFlow.outbound)
  return inbound.map((p, i) => ({
    time: xToTimeLabel(p.x),
    inbound: svgYToPercent(p.y),
    outbound: svgYToPercent(outbound[i].y),
  }))
}

// ===== 实时数据格式化 =====

/** 格式化时间戳为 HH:MM */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
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
      {/* 图表主体 */}
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

// ===== 共享坐标轴样式 =====

const AXIS_TICK_STYLE = {
  fontSize: '10px',
  fill: 'var(--trae-text-tertiary)',
} as const

// ===== 4 个图表组件 =====

/** CPU 使用率面积图（24h） */
export function CpuAreaChart({ range }: { range?: TimeRange } = {}) {
  const monitorData = useActiveMonitorData()
  const sliced = sliceMonitorData(monitorData, range ?? '24H')
  const recent = sliced.slice(-60)
  const useSample = recent.length < 2

  const data = useSample
    ? buildSampleCpuData()
    : recent.map((d) => ({
        time: formatTime(d.timestamp),
        cpu: Number(d.cpuUsage.toFixed(1)),
      }))
  const latest = data.length > 0 ? data[data.length - 1].cpu : 68

  return (
    <ChartCard
      title="CPU使用率(24h)"
      rightHint={
        <span className="mon-chart-value">
          {Math.round(latest)}%
        </span>
      }
    >
      <ResponsiveContainer width="100%" height={CHART_H}>
        <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
          <defs>
            <linearGradient id="cpuAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--trae-bg-brand)" stopOpacity={0.4} />
              <stop offset="100%" stopColor="var(--trae-bg-brand)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--trae-viz-ui-chart-axis)"
            vertical={false}
          />
          <XAxis
            dataKey="time"
            tick={false}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[0, 100]}
            tick={AXIS_TICK_STYLE}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <Area
            type="monotone"
            dataKey="cpu"
            stroke="var(--trae-bg-brand)"
            strokeWidth={2}
            fill="url(#cpuAreaGrad)"
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

/** 内存使用折线图（24h，3 条线：used/buffer/cache） */
export function MemoryLineChart({ range }: { range?: TimeRange } = {}) {
  const monitorData = useActiveMonitorData()
  const sliced = sliceMonitorData(monitorData, range ?? '24H')
  const recent = sliced.slice(-60)
  const useSample = recent.length < 2

  const data = useSample
    ? buildSampleMemData()
    : recent.map((d) => ({
        time: formatTime(d.timestamp),
        used: Number(d.memoryUsage.toFixed(1)),
        buffer: 0,
        cache: 0,
      }))

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
      <ResponsiveContainer width="100%" height={CHART_H}>
        <LineChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--trae-viz-ui-chart-axis)"
            vertical={false}
          />
          <XAxis
            dataKey="time"
            tick={false}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[0, 100]}
            tick={AXIS_TICK_STYLE}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <Line
            type="monotone"
            dataKey="used"
            stroke="var(--trae-bg-brand)"
            strokeWidth={2}
            isAnimationActive={false}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="buffer"
            stroke="var(--trae-bg-brand-hover)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            isAnimationActive={false}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="cache"
            stroke="var(--trae-brand-3)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            isAnimationActive={false}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

/** 磁盘 IO 柱状图（24h） */
export function DiskIoBarChart({ range }: { range?: TimeRange } = {}) {
  const monitorData = useActiveMonitorData()
  const sliced = sliceMonitorData(monitorData, range ?? '24H')
  const recent = sliced.slice(-24)
  const useSample = recent.length < 2

  const data = useSample
    ? buildSampleDiskIoData()
    : recent.map((d) => ({
        time: formatTime(d.timestamp),
        io: Number(((d.diskUsage / 100) * 100).toFixed(1)),
      }))

  return (
    <ChartCard
      title="磁盘IO(24h)"
      rightHint={
        <span className="mon-chart-hint">MB/s</span>
      }
    >
      <ResponsiveContainer width="100%" height={CHART_H}>
        <BarChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--trae-viz-ui-chart-axis)"
            vertical={false}
          />
          <XAxis
            dataKey="time"
            tick={false}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[0, 100]}
            tick={AXIS_TICK_STYLE}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <Bar
            dataKey="io"
            fill="var(--trae-bg-brand)"
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

/** 网络流量双折线图（24h，入站 / 出站） */
export function NetworkFlowChart({ range }: { range?: TimeRange } = {}) {
  const monitorData = useActiveMonitorData()
  const sliced = sliceMonitorData(monitorData, range ?? '24H')
  const recent = sliced.slice(-60)
  const useSample = recent.length < 2

  // 动态 maxVal：取所有值中的最大值，最小为 100
  const allValues = useSample
    ? []
    : recent.flatMap((d) => [d.networkIn, d.networkOut])
  const maxVal = allValues.length > 0 ? Math.max(...allValues, 100) : 100

  const data = useSample
    ? buildSampleNetFlowData()
    : recent.map((d) => ({
        time: formatTime(d.timestamp),
        inbound: Number(((d.networkIn / maxVal) * 100).toFixed(1)),
        outbound: Number(((d.networkOut / maxVal) * 100).toFixed(1)),
      }))

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
      <ResponsiveContainer width="100%" height={CHART_H}>
        <LineChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--trae-viz-ui-chart-axis)"
            vertical={false}
          />
          <XAxis
            dataKey="time"
            tick={false}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[0, 100]}
            tick={AXIS_TICK_STYLE}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <Line
            type="monotone"
            dataKey="inbound"
            stroke="var(--trae-bg-brand)"
            strokeWidth={2}
            isAnimationActive={false}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="outbound"
            stroke="var(--trae-brand-3)"
            strokeWidth={2}
            isAnimationActive={false}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
