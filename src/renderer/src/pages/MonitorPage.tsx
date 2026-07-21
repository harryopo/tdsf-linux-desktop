/**
 * MonitorPage — 实时监控
 *
 * 路由：/monitor
 *
 * 设计稿：monitor.html
 * - Header（标题 + 副标题 + 返回 + 1H/6H/24H 切换 + 刷新）
 * - Critical alert 横幅（磁盘告警）
 * - KPI 4 列网格（CPU / 内存 / 磁盘 / 网络 I/O）
 * - 2x2 图表网格（CPU 面积 / 内存折线 / 磁盘柱状 / 网络双折线）
 * - 告警列表（6 条）
 * - 进程监控 TOP 5 CPU
 *
 * 数据来源：monitor:data IPC 推送 + monitor-store
 *
 * 子组件：components/monitor/*
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, AlertCircle, RefreshCw, Activity } from 'lucide-react'
import { KpiCard } from '@/components/monitor/KpiCard'
import {
  CpuAreaChart,
  DiskIoBarChart,
  MemoryLineChart,
  NetworkFlowChart,
} from '@/components/monitor/Charts'
import { AlertTable } from '@/components/monitor/AlertTable'
import { ProcessTable } from '@/components/monitor/ProcessTable'
import { timeRanges, type TimeRange, type KpiStat } from '@/components/monitor/mock-data'
import { useMonitorStore } from '@/stores/monitor-store'
import { useServerStore } from '@/stores/server-store'
import type { MonitorData } from '@shared/models'

/**
 * 时间范围切换组（1H / 6H / 24H）
 *
 * @param value - 当前选中范围
 * @param onChange - 切换回调
 */
function TimeRangeSwitcher({
  value,
  onChange,
}: {
  value: TimeRange
  onChange: (range: TimeRange) => void
}) {
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] p-0.5"
      role="radiogroup"
      aria-label="时间范围"
    >
      {timeRanges.map((range) => {
        const active = range === value
        return (
          <button
            key={range}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(range)}
            className="inline-flex h-[26px] cursor-pointer items-center justify-center rounded-[var(--trae-radius-4)] border-none px-2.5 text-[11px] font-medium transition-colors duration-150"
            style={{
              color: active ? 'var(--trae-text-onbrand)' : 'var(--trae-text-secondary)',
              background: active ? 'var(--trae-bg-brand)' : 'transparent',
            }}
          >
            {range}
          </button>
        )
      })}
    </div>
  )
}

/** 判断 Electron API 是否可用 */
function isElectronAPIAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI
}

/** 从 MonitorData 历史计算 KPI 统计 */
function computeKpiStats(data: MonitorData[]): KpiStat[] {
  if (data.length === 0) {
    return [
      { label: 'CPU', value: 0, unit: '%', sub: '--', delta: 0, trend: 'up', ringColor: 'var(--trae-bg-brand)', sparkline: [] },
      { label: '内存', value: 0, unit: '%', sub: '--', delta: 0, trend: 'up', ringColor: 'var(--trae-status-success-default)', sparkline: [] },
      { label: '磁盘', value: 0, unit: '%', sub: '--', delta: 0, trend: 'up', ringColor: 'var(--trae-status-alert-default)', sparkline: [] },
      { label: '网络 I/O', value: 0, unit: 'KB/s', sub: '--', delta: 0, trend: 'up', ringColor: 'var(--trae-viz-sky)', sparkline: [] },
    ]
  }
  const latest = data[data.length - 1]
  const prev = data.length > 1 ? data[data.length - 2] : latest
  const cpuSpark = data.slice(-20).map((d) => d.cpuUsage)
  const memSpark = data.slice(-20).map((d) => d.memoryUsage)
  const diskSpark = data.slice(-20).map((d) => d.diskUsage)
  const netSpark = data.slice(-20).map((d) => d.networkIn + d.networkOut)

  return [
    {
      label: 'CPU',
      value: Math.round(latest.cpuUsage),
      unit: '%',
      sub: `${latest.loadAverage?.toFixed(2) ?? '--'} load`,
      delta: Math.round(latest.cpuUsage - prev.cpuUsage),
      trend: latest.cpuUsage >= prev.cpuUsage ? 'up' : 'down',
      ringColor: 'var(--trae-bg-brand)',
      sparkline: cpuSpark,
    },
    {
      label: '内存',
      value: Math.round(latest.memoryUsage),
      unit: '%',
      sub: `${latest.processCount ?? '--'} 进程`,
      delta: Math.round(latest.memoryUsage - prev.memoryUsage),
      trend: latest.memoryUsage >= prev.memoryUsage ? 'up' : 'down',
      ringColor: 'var(--trae-status-success-default)',
      sparkline: memSpark,
    },
    {
      label: '磁盘',
      value: Math.round(latest.diskUsage),
      unit: '%',
      sub: `uptime ${Math.floor(latest.uptime / 3600)}h`,
      delta: Math.round(latest.diskUsage - prev.diskUsage),
      trend: latest.diskUsage >= prev.diskUsage ? 'up' : 'down',
      ringColor: 'var(--trae-status-alert-default)',
      sparkline: diskSpark,
    },
    {
      label: '网络 I/O',
      value: Math.round(latest.networkIn + latest.networkOut),
      unit: 'KB/s',
      sub: `↓${Math.round(latest.networkIn)} ↑${Math.round(latest.networkOut)}`,
      delta: Math.round((latest.networkIn + latest.networkOut) - (prev.networkIn + prev.networkOut)),
      trend: (latest.networkIn + latest.networkOut) >= (prev.networkIn + prev.networkOut) ? 'up' : 'down',
      ringColor: 'var(--trae-viz-sky)',
      sparkline: netSpark,
    },
  ]
}

/**
 * MonitorPage 主组件
 */
export function MonitorPage() {
  const navigate = useNavigate()
  const [range, setRange] = useState<TimeRange>('24H')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [serverLabel, setServerLabel] = useState('未连接')

  const activeSessionId = useServerStore((s) => s.activeSessionId)
  const monitorData = useMonitorStore((s) =>
    activeSessionId ? s.getMonitorData(activeSessionId) : [],
  )
  const systemInfo = useMonitorStore((s) =>
    activeSessionId ? s.getSystemInfo(activeSessionId) : null,
  )

  // 订阅 monitor:data 推送
  useEffect(() => {
    if (!isElectronAPIAvailable()) return
    const offData = window.electronAPI.onMonitorData((sessionId, data) => {
      useMonitorStore.getState().addMonitorData(sessionId, data)
      setLoading(false)
    })
    const offInfo = window.electronAPI.onMonitorSystemInfo((sessionId, info) => {
      useMonitorStore.getState().setSystemInfo(sessionId, info)
    })
    return () => { offData(); offInfo() }
  }, [])

  // 连接后启动监控 + 获取系统信息
  useEffect(() => {
    if (!activeSessionId || !isElectronAPIAvailable()) return
    setLoading(true)
    window.electronAPI.monitorStart(activeSessionId, 5000)
    window.electronAPI.monitorGetSystemInfo(activeSessionId).then((info) => {
      if (info) {
        useMonitorStore.getState().setSystemInfo(activeSessionId, info)
        setServerLabel(`${info.hostname} · ${info.os}`)
      }
    }).catch(() => { /* ignore */ })
    // 3秒后如果仍无数据，标记为已加载（可能服务器静默）
    const timer = setTimeout(() => setLoading(false), 3000)
    return () => {
      clearTimeout(timer)
      window.electronAPI.monitorStop(activeSessionId).catch(() => {})
    }
  }, [activeSessionId])

  // 更新服务器标签
  useEffect(() => {
    if (systemInfo) {
      setServerLabel(`${systemInfo.hostname} · ${systemInfo.os}`)
    }
  }, [systemInfo])

  const kpiStats = useMemo(() => computeKpiStats(monitorData), [monitorData])

  // 磁盘告警检测
  const diskAlert = useMemo(() => {
    const latest = monitorData[monitorData.length - 1]
    if (latest && latest.diskUsage > 85) {
      return { message: `磁盘使用率 ${Math.round(latest.diskUsage)}% 超过阈值 85%，请及时清理`, time: new Date().toLocaleTimeString('zh-CN') }
    }
    return null
  }, [monitorData])

  const handleRefresh = useCallback(() => {
    if (!activeSessionId || !isElectronAPIAvailable()) return
    setRefreshing(true)
    window.electronAPI.monitorStart(activeSessionId, 5000)
    window.electronAPI.monitorGetSystemInfo(activeSessionId).then((info) => {
      if (info) useMonitorStore.getState().setSystemInfo(activeSessionId, info)
    }).catch(() => {}).finally(() => {
      setTimeout(() => setRefreshing(false), 800)
    })
  }, [activeSessionId])

  // 未连接状态
  if (!activeSessionId) {
    return (
      <main className="w-full min-h-full bg-[var(--trae-bg-base-default)] text-[var(--trae-text-default)] p-4 flex flex-col items-center justify-center gap-4">
        <Activity className="w-12 h-12 text-[var(--trae-text-tertiary)]" />
        <p className="text-[13px] text-[var(--trae-text-secondary)]">请先在工作台连接服务器</p>
        <button
          type="button"
          onClick={() => navigate('/workbench')}
          className="inline-flex items-center gap-1.5 h-[28px] px-4 text-[12px] font-medium text-[var(--trae-text-onbrand)] bg-[var(--trae-bg-brand)] rounded-[var(--trae-radius-6)] cursor-pointer hover:bg-[var(--trae-bg-brand-hover)] transition-colors duration-150"
        >
          前往工作台
        </button>
      </main>
    )
  }

  return (
    <main className="w-full min-h-full bg-[var(--trae-bg-base-default)] text-[var(--trae-text-default)] p-4 flex flex-col">
      {/* 1. page-header */}
      <header
        className="flex items-start justify-between gap-4 pb-2.5 mb-2.5"
        style={{ borderBottom: '1px solid var(--trae-border-neutral-l1)' }}
      >
        <div className="flex flex-col gap-1.5 min-w-0">
          <h1
            className="text-[28px] font-semibold leading-[36px] text-[var(--trae-text-default)]"
            style={{ textWrap: 'balance' } as React.CSSProperties}
          >
            实时监控
          </h1>
          <p className="text-[10px] text-[var(--trae-text-tertiary)] leading-[14px] truncate">
            {serverLabel}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => navigate('/workbench')}
            className="inline-flex items-center gap-1.5 h-[26px] px-3 text-[11px] font-medium text-[var(--trae-text-default)] bg-[var(--trae-bg-overlay-l2)] border border-[var(--trae-border-neutral-l2)] rounded-[var(--trae-radius-6)] cursor-pointer hover:bg-[var(--trae-bg-overlay-l3)] transition-colors duration-150"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>返回</span>
          </button>
          <TimeRangeSwitcher value={range} onChange={setRange} />
          <button
            type="button"
            onClick={handleRefresh}
            aria-label="刷新监控数据"
            className="inline-flex items-center justify-center w-7 h-7 bg-[var(--trae-bg-overlay-l2)] border border-[var(--trae-border-neutral-l2)] rounded-[var(--trae-radius-6)] cursor-pointer hover:bg-[var(--trae-bg-overlay-l3)] transition-colors duration-150"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[var(--trae-text-secondary)] ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* 2. 顶部 alert 横幅（磁盘告警，仅在有真实告警时显示） */}
      {diskAlert && (
        <div
          role="alert"
          className="flex items-start gap-2 mb-3 p-2.5 rounded-[var(--trae-radius-6)]"
          style={{
            background: 'var(--trae-status-error-surface-l1)',
            border: '1px solid var(--trae-status-error-surface-l2)',
            borderLeft: '3px solid var(--trae-status-error-default)',
          }}
        >
          <AlertCircle
            className="w-3.5 h-3.5 shrink-0 mt-0.5"
            style={{ color: 'var(--trae-status-error-default)' }}
          />
          <p className="flex-1 min-w-0 text-[11px] leading-[16px] text-[var(--trae-text-default)]">
            {diskAlert.message}
          </p>
          <span className="shrink-0 whitespace-nowrap text-[10px] text-[var(--trae-text-tertiary)]">
            {diskAlert.time}
          </span>
        </div>
      )}

      {/* 3. KPI 环形图 4 列网格 */}
      {loading && monitorData.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-[12px] text-[var(--trae-text-tertiary)]">
          正在获取监控数据…
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
          {kpiStats.map((stat) => (
            <KpiCard key={stat.label} stat={stat} />
          ))}
        </div>
      )}

      {/* 4. 图表 2x2 网格 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mb-3">
        <CpuAreaChart />
        <MemoryLineChart />
        <DiskIoBarChart />
        <NetworkFlowChart />
      </div>

      {/* 5. 告警列表 */}
      <AlertTable />

      {/* 6. 进程监控 */}
      <ProcessTable onRefresh={handleRefresh} />
    </main>
  )
}
