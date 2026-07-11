/**
 * CPU 监控图表组件 - CpuChart
 *
 * 职责：
 * - Recharts LineChart 展示 CPU 使用率趋势
 * - 实时数据更新（最近 60 秒）
 * - 苹果极简风格：细线条、无网格、浅色坐标轴
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
import type { MonitorData } from '@shared/models'
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
        <span className="monitor-chart-title">CPU 使用率</span>
        <span className="monitor-chart-current">
          {data.length > 0 ? `${data[data.length - 1].cpuUsage.toFixed(1)}%` : '--'}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
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
            formatter={(value: number) => [`${value}%`, 'CPU']}
          />
          <Line
            type="monotone"
            dataKey="cpu"
            stroke="#0071e3"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#0071e3' }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default CpuChart
