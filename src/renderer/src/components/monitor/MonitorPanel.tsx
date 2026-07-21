/**
 * 监控面板组件 - MonitorPanel
 *
 * 职责：
 * - 系统信息卡片（hostname / os / kernel / cpu / 内存）
 * - 实时指标卡片（CPU / 内存 / 磁盘 / 网络 / 负载 / 进程数）
 * - Recharts 实时折线图（CPU + 内存趋势，最近 60 秒）
 * - 异常告警（CPU > 80% 红色，磁盘 > 90% 红色）
 *
 * 数据流（主进程推送，渲染进程被动接收）：
 * - monitor:data 事件 → onMonitorData → monitor-store.addMonitorData
 * - monitor:systemInfo 事件 → onMonitorSystemInfo → monitor-store.setSystemInfo
 *
 * 监控启动保障：
 * - 组件挂载时检查 activeSessionId 是否有监控数据
 * - 若无数据则尝试调用 monitorStart 启动监控（覆盖 ServerList 启动失败的场景）
 */
import { useEffect, useMemo, useState } from 'react'
import { Alert, Spin } from 'antd'
import {
  WarningOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  HddOutlined,
  ThunderboltOutlined,
  ApiOutlined,
  AppstoreOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons'
import { useMonitorStore } from '../../stores/monitor-store'
import { useServerStore } from '../../stores/server-store'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import CpuChart from './CpuChart'
import MemoryChart from './MemoryChart'
import { StaggerList, SectionTitle } from '../common'
import type { MonitorData, SystemInfo } from '@shared/models'
import './MonitorPanel.css'

/** 格式化字节为可读字符串 */
const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return '0 B'
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

/** 实时指标 label → 语义图标映射（v2.1 精致微调：一眼识别） */
const METRIC_ICONS: Record<string, React.ReactNode> = {
  'CPU': <DashboardOutlined />,
  '内存': <DatabaseOutlined />,
  '磁盘': <HddOutlined />,
  '负载': <ThunderboltOutlined />,
  '网络入': <ApiOutlined />,
  '网络出': <ApiOutlined />,
  '进程数': <AppstoreOutlined />,
  '运行时间': <ClockCircleOutlined />,
}

/** 实时指标卡片 */
const MetricCard: React.FC<{
  label: string
  value: string
  warning?: boolean
}> = ({ label, value, warning }) => (
  <div className={`monitor-metric-card ${warning ? 'warning' : ''}`}>
    <div className="monitor-metric-header">
      <span className="monitor-metric-icon">{METRIC_ICONS[label] ?? <DashboardOutlined />}</span>
      <span className="monitor-metric-label">{label}</span>
    </div>
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
  const setSystemInfo = useMonitorStore((s) => s.setSystemInfo)

  /** 是否正在启动监控（用于显示加载状态） */
  const [starting, setStarting] = useState(false)
  /** 监控启动错误信息（用于显示错误提示） */
  const [startError, setStartError] = useState<string | null>(null)

  /**
   * 注册监控数据事件监听（组件卸载时自动清理）
   *
   * 包含两个监听器：
   * - onMonitorData: 实时指标推送（每 interval 秒一次）
   * - onMonitorSystemInfo: 系统静态信息推送（首次采集时推送一次）
   */
  useEffect(() => {
    if (!isElectronAPIAvailable()) return
    const offMonitorData = window.electronAPI.onMonitorData(
      (sessionId: string, data: MonitorData) => {
        addMonitorData(sessionId, data)
      }
    )
    const offSystemInfo = window.electronAPI.onMonitorSystemInfo(
      (sessionId: string, info: SystemInfo) => {
        setSystemInfo(sessionId, info)
      }
    )
    return () => {
      offMonitorData()
      offSystemInfo()
    }
  }, [addMonitorData, setSystemInfo])

  /**
   * 监控启动保障机制
   *
   * 当 activeSessionId 变化时，检查该会话是否已有监控数据：
   * - 若无数据，主动调用 monitorStart 启动监控
   * - 覆盖 ServerList 中 monitorStart 失败的场景
   * - 启动后主进程会自动推送 systemInfo 和 monitorData
   */
  useEffect(() => {
    if (!activeSessionId || !isElectronAPIAvailable()) return
    // 已有数据则无需重启监控
    const existing = useMonitorStore.getState().monitorData.get(activeSessionId)
    if (existing && existing.length > 0) return

    let cancelled = false
    setStarting(true)
    setStartError(null)

    window.electronAPI
      .monitorStart(activeSessionId, 3)
      .then(() => {
        if (!cancelled) {
          // 监控启动成功，等待主进程推送数据
          // systemInfo 会在首次 tick 时自动推送
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err)
          setStartError(`监控启动失败: ${msg}`)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setStarting(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeSessionId])

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

  // 启动中且无数据时显示加载状态
  if (starting && currentData.length === 0) {
    return (
      <div className="monitor-panel-empty">
        <Spin size="small" />
        <p style={{ marginTop: 12 }}>正在启动监控...</p>
      </div>
    )
  }

  // 启动失败且无数据时显示错误
  if (startError && currentData.length === 0) {
    return (
      <div className="monitor-panel-empty">
        <Alert
          message={startError}
          type="error"
          showIcon
          style={{ maxWidth: 360 }}
        />
        <p style={{ marginTop: 12, fontSize: 12, color: 'var(--color-text-secondary)' }}>
          请检查 SSH 连接是否正常，或切换到终端视图查看日志
        </p>
      </div>
    )
  }

  // 已连接但暂未收到数据（监控已启动但首个 tick 未完成）
  if (!latest && !currentSystemInfo) {
    return (
      <div className="monitor-panel-empty">
        <Spin size="small" />
        <p style={{ marginTop: 12 }}>正在采集监控数据...</p>
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
          <SectionTitle icon={<DashboardOutlined />} title="系统信息" size="sm" />
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
          <SectionTitle icon={<AppstoreOutlined />} title="实时指标" size="sm" />
          <StaggerList
            className="monitor-metrics-grid"
            stagger={40}
            duration={220}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-4)' }}
          >
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
          </StaggerList>
        </div>
      )}

      {/* ===== 实时图表 ===== */}
      <div className="monitor-section">
        <SectionTitle icon={<DatabaseOutlined />} title="趋势图表（最近 60 秒）" size="sm" />
        <div className="monitor-charts">
          <CpuChart data={currentData} />
          <MemoryChart data={currentData} />
        </div>
      </div>
    </div>
  )
}

export default MonitorPanel
