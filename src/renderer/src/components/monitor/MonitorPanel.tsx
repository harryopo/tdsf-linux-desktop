/**
 * 监控面板组件 - MonitorPanel
 *
 * 职责：
 * - 系统信息卡片（hostname / os / kernel / cpu / 内存）
 * - 实时指标卡片（CPU / 内存 / 磁盘 / 网络 / 负载 / 进程数）
 * - Recharts 实时折线图（CPU + 内存趋势，最近 60 秒）
 * - 异常告警（CPU > 80% 红色，磁盘 > 90% 红色）
 *
 * 数据流：
 * - 主进程 monitor:data 事件 → 监听回调 → monitor-store.addMonitorData
 * - 组件从 monitor-store 读取数据渲染
 */
import { useEffect, useMemo } from 'react'
import { Alert } from 'antd'
import { WarningOutlined } from '@ant-design/icons'
import { useMonitorStore } from '../../stores/monitor-store'
import { useServerStore } from '../../stores/server-store'
import CpuChart from './CpuChart'
import MemoryChart from './MemoryChart'
import type { MonitorData, SystemInfo } from '@shared/models'
import './MonitorPanel.css'

/** 格式化字节为可读字符串 */
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes < 1024 * 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`
}

/** 格式化运行时间 */
const formatUptime = (seconds: number): string => {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}天 ${hours}小时`
  if (hours > 0) return `${hours}小时 ${minutes}分钟`
  return `${minutes}分钟`
}

/** 实时指标卡片 */
const MetricCard: React.FC<{
  label: string
  value: string
  warning?: boolean
}> = ({ label, value, warning }) => (
  <div className={`monitor-metric-card ${warning ? 'warning' : ''}`}>
    <span className="monitor-metric-label">{label}</span>
    <span className="monitor-metric-value">{value}</span>
  </div>
)

/** 系统信息行 */
const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="monitor-info-row">
    <span className="monitor-info-label">{label}</span>
    <span className="monitor-info-value text-ellipsis">{value}</span>
  </div>
)

/** MonitorPanel 监控面板 */
const MonitorPanel: React.FC = () => {
  const activeSessionId = useServerStore((s) => s.activeSessionId)
  const monitorData = useMonitorStore((s) => s.monitorData)
  const systemInfo = useMonitorStore((s) => s.systemInfo)
  const addMonitorData = useMonitorStore((s) => s.addMonitorData)

  /** 注册监控数据事件监听 */
  useEffect(() => {
    window.electronAPI.onMonitorData((sessionId: string, data: MonitorData) => {
      addMonitorData(sessionId, data)
    })
  }, [addMonitorData])

  /** 当前活跃会话的监控数据 */
  const currentData = useMemo(
    () => (activeSessionId ? monitorData.get(activeSessionId) ?? [] : []),
    [activeSessionId, monitorData]
  )

  /** 当前活跃会话的系统信息 */
  const currentSystemInfo = useMemo(
    () => (activeSessionId ? systemInfo.get(activeSessionId) ?? null : null),
    [activeSessionId, systemInfo]
  )

  /** 最新监控数据 */
  const latest = currentData.length > 0 ? currentData[currentData.length - 1] : null

  /** 告警列表 */
  const alerts = useMemo(() => {
    const list: string[] = []
    if (latest) {
      if (latest.cpuUsage > 80) {
        list.push(`CPU 使用率过高: ${latest.cpuUsage.toFixed(1)}%`)
      }
      if (latest.diskUsage > 90) {
        list.push(`磁盘使用率过高: ${latest.diskUsage.toFixed(1)}%`)
      }
      if (latest.memoryUsage > 90) {
        list.push(`内存使用率过高: ${latest.memoryUsage.toFixed(1)}%`)
      }
      if (latest.loadAverage > 10) {
        list.push(`系统负载过高: ${latest.loadAverage.toFixed(2)}`)
      }
    }
    return list
  }, [latest])

  // 无活跃会话时显示空状态
  if (!activeSessionId) {
    return (
      <div className="monitor-panel-empty">
        <p>请先连接服务器查看监控数据</p>
      </div>
    )
  }

  return (
    <div className="monitor-panel">
      {/* ===== 告警区域 ===== */}
      {alerts.length > 0 && (
        <div className="monitor-alerts">
          {alerts.map((alert, i) => (
            <Alert
              key={i}
              message={alert}
              type="error"
              showIcon
              icon={<WarningOutlined />}
              style={{ marginBottom: 4 }}
            />
          ))}
        </div>
      )}

      {/* ===== 系统信息卡片 ===== */}
      {currentSystemInfo && (
        <div className="monitor-section">
          <div className="monitor-section-title">系统信息</div>
          <div className="monitor-info-card">
            <InfoRow label="主机名" value={currentSystemInfo.hostname} />
            <InfoRow label="操作系统" value={currentSystemInfo.os} />
            <InfoRow label="内核版本" value={currentSystemInfo.kernel} />
            <InfoRow label="架构" value={currentSystemInfo.architecture} />
            <InfoRow label="CPU 型号" value={currentSystemInfo.cpuModel} />
            <InfoRow label="CPU 核数" value={`${currentSystemInfo.cpuCores} 核`} />
            <InfoRow label="总内存" value={formatBytes(currentSystemInfo.totalMemory)} />
            <InfoRow label="总磁盘" value={formatBytes(currentSystemInfo.totalDisk)} />
          </div>
        </div>
      )}

      {/* ===== 实时指标卡片 ===== */}
      {latest && (
        <div className="monitor-section">
          <div className="monitor-section-title">实时指标</div>
          <div className="monitor-metrics-grid">
            <MetricCard
              label="CPU"
              value={`${latest.cpuUsage.toFixed(1)}%`}
              warning={latest.cpuUsage > 80}
            />
            <MetricCard
              label="内存"
              value={`${latest.memoryUsage.toFixed(1)}%`}
              warning={latest.memoryUsage > 90}
            />
            <MetricCard
              label="磁盘"
              value={`${latest.diskUsage.toFixed(1)}%`}
              warning={latest.diskUsage > 90}
            />
            <MetricCard label="负载" value={latest.loadAverage.toFixed(2)} />
            <MetricCard
              label="网络入"
              value={`${latest.networkIn.toFixed(1)} KB/s`}
            />
            <MetricCard
              label="网络出"
              value={`${latest.networkOut.toFixed(1)} KB/s`}
            />
            <MetricCard label="进程数" value={`${latest.processCount}`} />
            <MetricCard label="运行时间" value={formatUptime(latest.uptime)} />
          </div>
        </div>
      )}

      {/* ===== 实时图表 ===== */}
      <div className="monitor-section">
        <div className="monitor-section-title">趋势图表（最近 60 秒）</div>
        <div className="monitor-charts">
          <CpuChart data={currentData} />
          <MemoryChart data={currentData} />
        </div>
      </div>
    </div>
  )
}

export default MonitorPanel
