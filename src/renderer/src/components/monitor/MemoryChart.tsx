/**
 * 内存监控图表组件 - MemoryChart
 *
 * 职责：
 * - Recharts AreaChart 展示内存使用率趋势
 * - 实时数据更新（最近 60 秒）
 * - 苹果极简风格：渐变填充、细线条
 * - 亮色/暗黑模式自动适配（读取 theme-store）
 *
 * 数据来源：monitor-store 中对应 sessionId 的历史数据
 */
import { useMemo } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { DatabaseOutlined } from '@ant-design/icons'
import type { MonitorData } from '@shared/models'
import { useThemeStore } from '../../stores/theme-store'
import './MonitorPanel.css'

/** MemoryChart 组件 Props */
interface MemoryChartProps {
  /** 监控数据历史 */
  data: MonitorData[]
}

/** 格式化时间戳为 HH:MM:SS */
const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

/** MemoryChart 内存监控图表 */
const MemoryChart: React.FC<MemoryChartProps> = ({ data }) => {
  const theme = useThemeStore((s) => s.theme)

  /** v2.2：颜色全部 token 化 */
  const colors = useMemo(
    () => ({
      grid: 'var(--color-border)',
      axisLine: 'var(--color-border-strong)',
      tick: 'var(--color-text-tertiary)',
      tooltipBg: 'var(--color-bg-elevated)',
      tooltipBorder: 'var(--color-border)',
      tooltipLabel: 'var(--color-text-tertiary)',
      tooltipText: 'var(--color-text-primary)',
    }),
    [theme]
  )

  /** v2.2：每个实例唯一 gradient ID，避免多图表冲突 */
  const gradientId = useMemo(
    () => `memoryGradient-${Math.random().toString(36).slice(2, 9)}`,
    []
  )

  /** 转换数据为 Recharts 所需格式 */
  const chartData = useMemo(
    () =>
      data.map((item) => ({
        time: formatTime(item.timestamp),
        memory: Number(item.memoryUsage.toFixed(1)),
      })),
    [data]
  )

  return (
    <div className="monitor-chart-container">
      <div className="monitor-chart-header">
        <DatabaseOutlined className="monitor-chart-icon" />
        <span className="monitor-chart-title">内存使用率</span>
        <span className="monitor-chart-current">
          {data.length > 0 ? `${data[data.length - 1].memoryUsage.toFixed(1)}%` : '--'}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 'var(--font-size-xs)', fill: colors.tick }}
            axisLine={{ stroke: colors.axisLine }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 'var(--font-size-xs)', fill: colors.tick }}
            axisLine={false}
            tickLine={false}
            unit="%"
          />
          <Tooltip
            contentStyle={{
              background: colors.tooltipBg,
              border: `1px solid ${colors.tooltipBorder}`,
              borderRadius: '8px',
              fontSize: 'var(--font-size-xs)',
              color: colors.tooltipText,
            }}
            labelStyle={{ color: colors.tooltipLabel }}
            formatter={(value: number) => [`${value}%`, '内存']}
          />
          <Area
            type="monotone"
            dataKey="memory"
            stroke="var(--color-success)"
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export default MemoryChart
