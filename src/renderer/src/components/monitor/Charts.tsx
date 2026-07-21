/**
 * Charts — 4 个 SVG 图表（实时数据）
 *
 * 设计稿：monitor.html 第 4 段 图表网格 2x2
 *
 * 包含 4 个独立图表组件：
 * - CpuAreaChart：CPU 使用率面积图（渐变填充 + 描边）
 * - MemoryLineChart：内存使用折线图
 * - DiskIoBarChart：磁盘 IO 柱状图（最近 12 个数据点）
 * - NetworkFlowChart：网络流量双折线（入站 / 出站）
 *
 * 数据来源：useMonitorStore（Zustand），取最近 60 条历史数据
 * 图表 viewBox 300×120，preserveAspectRatio=none 拉伸到容器
 * 网格线：3 条横线（y=30/60/90）
 */
import { useMonitorStore } from '../../stores/monitor-store'
import { useServerStore } from '../../stores/server-store'

// ===== SVG 路径构建工具 =====

const CHART_W = 300
const CHART_H = 120

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

// ===== 数据 Hook =====

/** 获取当前活跃会话的监控数据 */
function useActiveMonitorData() {
  const activeSessionId = useServerStore((s) => s.activeSessionId)
  const data = useMonitorStore((s) =>
    activeSessionId ? s.getMonitorData(activeSessionId) : []
  )
  return data
}

// ===== 图表卡片容器 =====

/** x 轴时间刻度（简化为相对时间） */
const xLabels = ['-60s', '-45s', '-30s', '-15s', 'now']

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
    <div className="flex flex-col h-[200px] p-3 rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] shadow-[var(--trae-shadow-card)]">
      {/* 标题行 */}
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="text-[12px] font-semibold text-[var(--trae-text-default)]">{title}</span>
        {legend ?? rightHint}
      </div>
      {/* SVG 主体 */}
      <div className="flex-1 min-h-0">{children}</div>
      {/* x 轴刻度 */}
      <div className="flex justify-between mt-2 text-[10px] text-[var(--trae-text-tertiary)] tabular-nums">
        {xLabels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  )
}

/** 空数据占位 */
function EmptyState() {
  return (
    <div className="flex items-center justify-center h-full text-[12px] text-[var(--trae-text-tertiary)]">
      等待数据...
    </div>
  )
}

// ===== 4 个图表组件 =====

/** CPU 使用率面积图 */
export function CpuAreaChart() {
  const data = useActiveMonitorData()
  const recent = data.slice(-60)
  const cpuValues = recent.map((d) => d.cpuUsage)
  const latest = cpuValues.length > 0 ? cpuValues[cpuValues.length - 1] : null

  return (
    <ChartCard
      title="CPU使用率(实时)"
      rightHint={
        latest !== null ? (
          <span className="font-mono tabular-nums text-[12px] font-semibold text-[var(--trae-text-brand)]">
            {latest.toFixed(0)}%
          </span>
        ) : undefined
      }
    >
      {recent.length === 0 ? (
        <EmptyState />
      ) : (
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" width="100%" height="100%" className="block">
          <defs>
            <linearGradient id="cpuAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--trae-bg-brand)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--trae-bg-brand)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* 网格线 */}
          <line x1="0" y1="30" x2={CHART_W} y2="30" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
          <line x1="0" y1="60" x2={CHART_W} y2="60" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
          <line x1="0" y1="90" x2={CHART_W} y2="90" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
          {/* 面积填充 */}
          <path
            d={buildAreaPath(cpuValues, CHART_W, CHART_H, 100)}
            fill="url(#cpuAreaGrad)"
          />
          {/* 描边折线 */}
          <path
            d={buildLinePath(cpuValues, CHART_W, CHART_H, 100)}
            fill="none"
            stroke="var(--trae-bg-brand)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </ChartCard>
  )
}

/** 内存使用折线图 */
export function MemoryLineChart() {
  const data = useActiveMonitorData()
  const recent = data.slice(-60)
  const memValues = recent.map((d) => d.memoryUsage)
  const latest = memValues.length > 0 ? memValues[memValues.length - 1] : null

  return (
    <ChartCard
      title="内存使用(实时)"
      legend={
        <div className="flex items-center gap-2 shrink-0 text-[10px] text-[var(--trae-text-secondary)]">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--trae-bg-brand)]" />
            used
          </span>
          {latest !== null && (
            <span className="font-mono tabular-nums text-[11px] font-semibold text-[var(--trae-text-brand)]">
              {latest.toFixed(0)}%
            </span>
          )}
        </div>
      }
    >
      {recent.length === 0 ? (
        <EmptyState />
      ) : (
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" width="100%" height="100%" className="block">
          <line x1="0" y1="30" x2={CHART_W} y2="30" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
          <line x1="0" y1="60" x2={CHART_W} y2="60" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
          <line x1="0" y1="90" x2={CHART_W} y2="90" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
          {/* 内存使用折线 */}
          <path
            d={buildLinePath(memValues, CHART_W, CHART_H, 100)}
            fill="none"
            stroke="var(--trae-bg-brand)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </ChartCard>
  )
}

/** 磁盘 IO 柱状图（最近 12 个数据点） */
export function DiskIoBarChart() {
  const data = useActiveMonitorData()
  const recent = data.slice(-12)
  const diskValues = recent.map((d) => d.diskUsage)

  const barCount = diskValues.length
  const gap = 4
  const barWidth = barCount > 0 ? (CHART_W - gap * (barCount + 1)) / barCount : 0

  return (
    <ChartCard
      title="磁盘IO(实时)"
      rightHint={
        <span className="text-[10px] text-[var(--trae-text-tertiary)] tabular-nums">%</span>
      }
    >
      {recent.length === 0 ? (
        <EmptyState />
      ) : (
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" width="100%" height="100%" className="block">
          <line x1="0" y1="30" x2={CHART_W} y2="30" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
          <line x1="0" y1="60" x2={CHART_W} y2="60" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
          <line x1="0" y1="90" x2={CHART_W} y2="90" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
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
        </svg>
      )}
    </ChartCard>
  )
}

/** 网络流量双折线图（入站 / 出站） */
export function NetworkFlowChart() {
  const data = useActiveMonitorData()
  const recent = data.slice(-60)
  const inValues = recent.map((d) => d.networkIn)
  const outValues = recent.map((d) => d.networkOut)

  // 动态 maxVal：取所有值中的最大值，最小为 100
  const allValues = [...inValues, ...outValues]
  const maxVal = allValues.length > 0 ? Math.max(...allValues, 100) : 100

  return (
    <ChartCard
      title="网络流量(实时)"
      legend={
        <div className="flex items-center gap-2 shrink-0 text-[10px] text-[var(--trae-text-secondary)]">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--trae-bg-brand)]" />
            入站
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#80BBFF' }} />
            出站
          </span>
        </div>
      }
    >
      {recent.length === 0 ? (
        <EmptyState />
      ) : (
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" width="100%" height="100%" className="block">
          <line x1="0" y1="30" x2={CHART_W} y2="30" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
          <line x1="0" y1="60" x2={CHART_W} y2="60" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
          <line x1="0" y1="90" x2={CHART_W} y2="90" stroke="var(--trae-viz-ui-chart-axis)" strokeWidth="1" />
          {/* 入站 */}
          <path
            d={buildLinePath(inValues, CHART_W, CHART_H, maxVal)}
            fill="none"
            stroke="var(--trae-bg-brand)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* 出站 */}
          <path
            d={buildLinePath(outValues, CHART_W, CHART_H, maxVal)}
            fill="none"
            stroke="#80BBFF"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </ChartCard>
  )
}
