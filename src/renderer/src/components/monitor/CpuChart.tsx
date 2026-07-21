/**
 * CPU 监控图表组件 - CpuChart
 *
 * 职责：
 * - Recharts LineChart 展示 CPU 使用率趋势
 * - 实时数据更新（最近 60 秒）
 * - 苹果极简风格：细线条、无网格、浅色坐标轴
 * - 亮色/暗黑模式自动适配（读取 theme-store）
 *
 * 数据来源：monitor-store 中对应 sessionId 的历史数据
 */
import { useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { DashboardOutlined } from '@ant-design/icons'
import type { MonitorData } from '@shared/models'
import { useThemeStore } from '../../stores/theme-store'
import './MonitorPanel.css'

/** CpuChart 组件 Props */
interface CpuChartProps {
  /** 监控数据历史 */
  data: MonitorData[]
}

/** 格式化时间戳为 HH:MM:SS */
const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

/** CpuChart CPU 监控图表 */
const CpuChart: React.FC<CpuChartProps> = ({ data }) => {
  const theme = useThemeStore((s) => s.theme)

  /** v2.2：颜色全部 token 化，不再硬编码 */
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

  /** 转换数据为 Recharts 所需格式 */
  const chartData = useMemo(
    () =>
      data.map((item) => ({
        time: formatTime(item.timestamp),
        cpu: Number(item.cpuUsage.toFixed(1)),
      })),
    [data]
  )

  return (
    <div className="monitor-chart-container">
      <div className="monitor-chart-header">
        <DashboardOutlined className="monitor-chart-icon" />
        <span className="monitor-chart-title">CPU 使用率</span>
        <span className="monitor-chart-current">
          {data.length > 0 ? `${data[data.length - 1].cpuUsage.toFixed(1)}%` : '--'}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
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
            formatter={(value: number) => [`${value}%`, 'CPU']}
          />
          <Line
            type="monotone"
            dataKey="cpu"
            stroke="var(--color-link)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: 'var(--color-link)' }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default CpuChart
