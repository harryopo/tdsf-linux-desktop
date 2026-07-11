/**
 * 内存监控图表组件 - MemoryChart
 *
 * 职责：
 * - Recharts AreaChart 展示内存使用率趋势
 * - 实时数据更新（最近 60 秒）
 * - 苹果极简风格：渐变填充、细线条
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
import type { MonitorData } from '@shared/models'
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
        <span className="monitor-chart-title">内存使用率</span>
        <span className="monitor-chart-current">
          {data.length > 0 ? `${data[data.length - 1].memoryUsage.toFixed(1)}%` : '--'}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
          <defs>
            <linearGradient id="memoryGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34c759" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#34c759" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e7" vertical={false} />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10, fill: '#86868b' }}
            axisLine={{ stroke: '#e5e5e7' }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: '#86868b' }}
            axisLine={false}
            tickLine={false}
            unit="%"
          />
          <Tooltip
            contentStyle={{
              background: '#1d1d1f',
              border: 'none',
              borderRadius: '8px',
              fontSize: '12px',
              color: '#fff',
            }}
            labelStyle={{ color: '#86868b' }}
            formatter={(value: number) => [`${value}%`, '内存']}
          />
          <Area
            type="monotone"
            dataKey="memory"
            stroke="#34c759"
            strokeWidth={2}
            fill="url(#memoryGradient)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export default MemoryChart
