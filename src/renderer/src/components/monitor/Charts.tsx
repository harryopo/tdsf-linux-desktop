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
 * - 图表卡片：200px 高，p-3，背景 var(--trae-bg-base-secondary)
 * - 图表主体高度 140px（ResponsiveContainer height={140}）
 * - 网格线 3 条（CartesianGrid horizontal）
 * - x 轴 5 个时间标签（00:00/06:00/12:00/18:00/24:00，由 ChartCard 底部渲染）
 *
 * 数据策略（v2.3.7）：
 * - 有监控数据（useMonitorStore）→ 实时 map 为 recharts data
 * - 无监控数据 → 显示 EmptyMonitorState 占位，不再回退 sample 数据
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
// v2.3.7 修复：移除 sample* mock 数据导入，统一显示 EmptyMonitorState
import type { TimeRange } from './monitor-model'
import { spanLabel } from './monitor-model'
import { EmptyMonitorState } from './EmptyMonitorState'
// M3 Task 2：时间范围切换切片工具（Chart 数据源按 range 过滤）
import { sliceMonitorData } from '../../utils/monitor-time-range'

// ===== 常量 =====

/** 图表主体高度（与原 SVG viewBox 高度一致） */
const CHART_H = 140

// ===== 数据 Hook =====

/** 获取当前活跃会话的监控数据（无会话时拿到稳定空数组，不能在调用处现造 []） */
function useActiveMonitorData() {
  const activeSessionId = useServerStore((s) => s.activeSessionId)
  return useMonitorStore((s) => s.getMonitorData(activeSessionId))
}


/** 格式化时间戳为 HH:MM */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 从真实采样点里取最多 count 个均匀分布的时间刻度（没数据就不画轴） */
function axisFrom(points: Array<{ timestamp: number }>, count = 5): string[] {
  if (points.length === 0) return []
  if (points.length === 1) return [formatTime(points[0].timestamp)]
  const step = (points.length - 1) / (Math.min(count, points.length) - 1)
  const out: string[] = []
  for (let i = 0; i < Math.min(count, points.length); i++) {
    const label = formatTime(points[Math.round(i * step)].timestamp)
    if (!out.includes(label)) out.push(label)
  }
  return out
}

// ===== 图表卡片容器 =====

/** 图表容器（统一卡片样式 + 标题行 + 时间轴） */
function ChartCard({
  title,
  legend,
  children,
  rightHint,
  axis = [],
}: {
  title: string
  legend?: React.ReactNode
  rightHint?: React.ReactNode
  children: React.ReactNode
  /** x 轴刻度：必须由当前真实采样点算出来，不给默认值、不接受写死的时间 */
  axis?: string[]
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
      {/* x 轴刻度：无数据就不渲染，免得给空图配一条假时间轴 */}
      {axis.length > 0 ? (
        <div className="mon-chart-axis flex justify-between mt-2">
          {axis.map((label, i) => (
            <span key={`${label}-${i}`}>{label}</span>
          ))}
        </div>
      ) : null}
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

  // 无实时数据时显示 Empty 状态（v2.3.7：彻底移除 sample data fallback）
  if (recent.length === 0) {
    return (
      <ChartCard title={`CPU使用率${spanLabel(recent)}`}>
        <EmptyMonitorState
          title="暂无CPU监控数据"
          description="连接服务器后将显示实时CPU使用率曲线"
          showAction={false}
        />
      </ChartCard>
    )
  }

  const data = recent.map((d) => ({
    time: formatTime(d.timestamp),
    cpu: Number(d.cpuUsage.toFixed(1)),
  }))
  const latest = data[data.length - 1].cpu

  return (
    <ChartCard
      title={`CPU使用率${spanLabel(recent)}`}
      axis={axisFrom(recent)}
      rightHint={<span className="mon-chart-value">{Math.round(latest)}%</span>}
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

  // 无实时数据时显示 Empty 状态
  if (recent.length === 0) {
    return (
      <ChartCard title={`内存使用${spanLabel(recent)}`} legend={<span />}>
        <EmptyMonitorState
          title="暂无内存监控数据"
          description="连接服务器后将显示实时内存使用曲线"
          showAction={false}
        />
      </ChartCard>
    )
  }

  const data = recent.map((d) => ({
    time: formatTime(d.timestamp),
    used: Number(d.memoryUsage.toFixed(1)),
    buffer: 0,
    cache: 0,
  }))

  return (
    <ChartCard
      title={`内存使用${spanLabel(recent)}`}
      axis={axisFrom(recent)}
      legend={
        <div className="mon-chart-legend flex items-center gap-2 shrink-0">
          <span className="flex items-center gap-1">
            <span className="mon-chart-dot" style={{ background: 'var(--accent-solid)' }} />
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

  // 无实时数据时显示 Empty 状态
  if (recent.length === 0) {
    return (
      <ChartCard title={`磁盘IO${spanLabel(recent)}`} rightHint={<span className="mon-chart-hint">MB/s</span>}>
        <EmptyMonitorState
          title="暂无磁盘IO数据"
          description="连接服务器后将显示实时磁盘IO柱状图"
          showAction={false}
        />
      </ChartCard>
    )
  }

  const data = recent.map((d) => ({
    time: formatTime(d.timestamp),
    io: Number(((d.diskUsage / 100) * 100).toFixed(1)),
  }))

  return (
    <ChartCard
      title={`磁盘IO${spanLabel(recent)}`}
      axis={axisFrom(recent)}
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

  // 无实时数据时显示 Empty 状态
  if (recent.length === 0) {
    return (
      <ChartCard title={`网络流量${spanLabel(recent)}`} legend={<span />}>
        <EmptyMonitorState
          title="暂无网络流量数据"
          description="连接服务器后将显示实时网络流量曲线"
          showAction={false}
        />
      </ChartCard>
    )
  }

  // 动态 maxVal：取所有值中的最大值，最小为 100
  const allValues = recent.flatMap((d) => [d.networkIn, d.networkOut])
  const maxVal = allValues.length > 0 ? Math.max(...allValues, 100) : 100

  const data = recent.map((d) => ({
    time: formatTime(d.timestamp),
    inbound: Number(((d.networkIn / maxVal) * 100).toFixed(1)),
    outbound: Number(((d.networkOut / maxVal) * 100).toFixed(1)),
  }))

  return (
    <ChartCard
      title={`网络流量${spanLabel(recent)}`}
      axis={axisFrom(recent)}
      legend={
        <div className="mon-chart-legend flex items-center gap-2 shrink-0">
          <span className="flex items-center gap-1">
            <span className="mon-chart-dot" style={{ background: 'var(--accent-solid)' }} />
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
