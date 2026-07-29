/**
 * MonitorPage — 实时监控
 *
 * 路由：/monitor
 * Spec: build-runnable-tdsf-from-design · Task 2.4
 *
 * 设计稿：monitor.html
 * - Header（标题 + 副标题 + 1H/6H/24H 切换 + 刷新）
 * - Critical alert 横幅（goto-alert-detail data-dom-id + 点击弹出 Drawer）
 * - KPI 4 列网格（CPU / 内存 / 磁盘 / 网络 I/O）
 * - 2×2 图表网格（CPU 面积 / 内存折线 / 磁盘柱状 / 网络双折线）
 * - 告警列表 table-panel（6 行 + goto-alert-row-N data-dom-id + 点击行弹出 Drawer）
 * - 进程监控 TOP 5 CPU
 * - AlertDrawer（DEC-3 决策告警详情抽屉）
 *
 * 数据策略（P1 修复：彻底移除 DEV 假数据 fallback）：
 * - 只使用实时 monitor:data IPC 推送的真实数据
 * - 未连接或数据为空时一律显示 EmptyMonitorState 空态（DEV 与生产一致，
 *   避免开发预览时把假服务器/假告警当真实状态）
 *
 * 视觉规范（spec §B）：
 * - 边框用 solid hex（var(--trae-border-neutral-l1/l2)）
 * - background rgba 允许保留
 * - 卡片 hover 仅改变阴影，无 border + scale 同时变化
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { AlertCircle, RefreshCw, Activity } from 'lucide-react'
import { KpiCard } from '@/components/monitor/KpiCard'
import {
  CpuAreaChart,
  DiskIoBarChart,
  MemoryLineChart,
  NetworkFlowChart,
} from '@/components/monitor/Charts'
import { AlertTable } from '@/components/monitor/AlertTable'
import { AlertDrawer } from '@/components/monitor/AlertDrawer'
import { ProcessTable } from '@/components/monitor/ProcessTable'
import { EmptyMonitorState } from '@/components/monitor/EmptyMonitorState'
import {
  timeRanges,
  type TimeRange,
  type KpiStat,
  type AlertRecord,
} from '@/components/monitor/mock-data'
import { useMonitorStore } from '@/stores/monitor-store'
import { useServerStore } from '@/stores/server-store'
// v2.7：告警阈值消费设置页 monitor.threshold.* 配置（不再硬编码 85）
import { usePersistentState } from '@/hooks/usePersistentState'
import type { MonitorData } from '@shared/models'
// M3 Task 2：时间范围切换切片工具（KPI 数据源按 range 过滤）
import { sliceMonitorData } from '@/utils/monitor-time-range'
import './MonitorPage.css'

/**
 * 时间范围切换组（1H / 6H / 24H）
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
      className="mon-range-group inline-flex items-center p-0.5 gap-0.5"
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
            className={`mon-btn-sm mon-range-label mon-btn-press inline-flex items-center justify-center px-2 ${active ? 'active' : ''}`}
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
function computeKpiStats(data: MonitorData[]): KpiStat[] | null {
  if (data.length === 0) return null
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
      ringColor: 'var(--trae-bg-brand)',
      sparkline: memSpark,
    },
    {
      label: '磁盘',
      value: Math.round(latest.diskUsage),
      unit: '%',
      sub: `uptime ${Math.floor(latest.uptime / 3600)}h`,
      delta: Math.round(latest.diskUsage - prev.diskUsage),
      trend: latest.diskUsage >= prev.diskUsage ? 'up' : 'down',
      ringColor: 'var(--trae-status-warning-default)',
      sparkline: diskSpark,
    },
    {
      label: '网络 I/O',
      value: Math.round(latest.networkIn + latest.networkOut),
      unit: 'KB/s',
      sub: `↓${Math.round(latest.networkIn)} ↑${Math.round(latest.networkOut)}`,
      delta: Math.round((latest.networkIn + latest.networkOut) - (prev.networkIn + prev.networkOut)),
      trend: (latest.networkIn + latest.networkOut) >= (prev.networkIn + prev.networkOut) ? 'up' : 'down',
      ringColor: 'var(--trae-bg-brand)',
      sparkline: netSpark,
    },
  ]
}

/**
 * MonitorPage 主组件
 */
export function MonitorPage() {
  const [range, setRange] = useState<TimeRange>('24H')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  // P1 修复：移除硬编码假服务器标签 'prod-web-01 · 192.168.1.10'，未连接时诚实显示
  const [serverLabel, setServerLabel] = useState('未连接服务器')
  // AlertDrawer 状态
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedAlert, setSelectedAlert] = useState<AlertRecord | null>(null)

  const activeSessionId = useServerStore((s) => s.activeSessionId)
  const monitorData = useMonitorStore((s) =>
    activeSessionId ? s.getMonitorData(activeSessionId) : [],
  )
  const systemInfo = useMonitorStore((s) =>
    activeSessionId ? s.getSystemInfo(activeSessionId) : null,
  )

  // monitor:data / systemInfo 订阅已提升到应用入口全局绑定
  // （stores/agent-stream-subscription.ts），监控页未挂载时也不丢推送。
  // 本页挂载时若已有历史数据，直接结束 loading。
  useEffect(() => {
    if (monitorData.length > 0) setLoading(false)
  }, [monitorData.length])

  // 连接后启动监控 + 获取系统信息
  // P0 修复：卸载时不再 monitorStop —— 让监控在后台持续采集，数据持续进 store，
  // 用户来回切页面不再中断采集（此前离开监控页即 stop，回来又是空白）。
  useEffect(() => {
    if (!activeSessionId || !isElectronAPIAvailable()) return
    if (monitorData.length === 0) setLoading(true)
    window.electronAPI.monitorStart(activeSessionId, 5000)
    window.electronAPI.monitorGetSystemInfo(activeSessionId).then((info) => {
      if (info) {
        useMonitorStore.getState().setSystemInfo(activeSessionId, info)
        setServerLabel(`${info.hostname} · ${info.os}`)
      }
    }).catch(() => { /* ignore */ })
    const timer = setTimeout(() => setLoading(false), 3000)
    return () => {
      clearTimeout(timer)
    }
  }, [activeSessionId, monitorData.length])

  // 无活跃会话时立即清除 loading，直接展示空态（不再回退假数据）
  useEffect(() => {
    if (!activeSessionId) {
      setLoading(false)
      setServerLabel('未连接服务器')
    }
  }, [activeSessionId])

  // 更新服务器标签
  useEffect(() => {
    if (systemInfo) {
      setServerLabel(`${systemInfo.hostname} · ${systemInfo.os}`)
    }
  }, [systemInfo])

  // KPI 数据（nullable）：只用真实数据，无数据返回 null → EmptyMonitorState
  // P1 修复：移除 DEV sampleKpiStats fallback（开发预览时假 KPI 会被当真实状态）
  // M3 Task 2：KPI 数据源按 range 切片（取切片后最后一条作为 latest）
  const kpiStats = useMemo<KpiStat[] | null>(() => {
    const sliced = sliceMonitorData(monitorData, range)
    return computeKpiStats(sliced)
  }, [monitorData, range])

  // 顶部 critical 告警横幅数据（nullable）：只基于真实监控数据生成
  // P1 修复：移除 DEV 假告警"磁盘92%…2分钟前"fallback 与假主机名 'prod-web-01'
  // v2.7：阈值不再硬编码 85 —— 消费设置页「告警阈值」monitor.threshold.* 配置，
  // CPU/内存/磁盘三项均接入（磁盘优先展示，其次 CPU、内存）
  const [cpuThreshold] = usePersistentState('monitor.threshold.cpu', 90)
  const [memoryThreshold] = usePersistentState('monitor.threshold.memory', 90)
  const [diskThreshold] = usePersistentState('monitor.threshold.disk', 85)
  const criticalAlert = useMemo<AlertRecord | null>(() => {
    const latest = monitorData[monitorData.length - 1]
    if (!latest) return null
    const server = systemInfo?.hostname ?? '当前服务器'
    if (latest.diskUsage > diskThreshold) {
      return {
        time: '刚刚',
        level: 'critical',
        server,
        desc: `磁盘使用率${Math.round(latest.diskUsage)}%超过阈值${diskThreshold}%，建议清理 /var/log 旧日志`,
        status: '未处理',
        source: '/dev/sda1 · /var/log',
        impact: '根分区空间不足可能导致日志写入失败、服务异常崩溃、数据库锁表',
        suggestions: [
          '清理 /var/log 旧日志：find /var/log -type f -name "*.log.*" -mtime +7 -delete',
          '归档并压缩：tar -czf /tmp/log-$(date +%F).tar.gz /var/log/*.log && rm /var/log/*.log',
          '配置 logrotate 自动轮转：编辑 /etc/logrotate.d/nginx',
        ],
      }
    }
    if (latest.cpuUsage > cpuThreshold) {
      return {
        time: '刚刚',
        level: 'critical',
        server,
        desc: `CPU 使用率${Math.round(latest.cpuUsage)}%超过阈值${cpuThreshold}%，建议排查高负载进程`,
        status: '未处理',
        source: 'CPU · 全部核心',
        impact: '持续高 CPU 可能导致服务响应变慢、请求超时甚至雪崩',
        suggestions: [
          '定位高 CPU 进程：top -o %CPU 或 ps aux --sort=-%cpu | head',
          '查看负载趋势：uptime（对比 CPU 核数）',
          '必要时限流或扩容：systemctl 重启异常服务 / 增加实例',
        ],
      }
    }
    if (latest.memoryUsage > memoryThreshold) {
      return {
        time: '刚刚',
        level: 'critical',
        server,
        desc: `内存使用率${Math.round(latest.memoryUsage)}%超过阈值${memoryThreshold}%，存在 OOM 风险`,
        status: '未处理',
        source: '内存 · RSS/Cache',
        impact: '内存耗尽时内核 OOM Killer 会强杀进程，可能误杀数据库/关键服务',
        suggestions: [
          '定位内存大户：ps aux --sort=-%mem | head',
          '查看可回收缓存：free -m（buff/cache 可被回收）',
          '检查 OOM 历史：dmesg | grep -i "out of memory"',
        ],
      }
    }
    return null
  }, [monitorData, systemInfo, cpuThreshold, memoryThreshold, diskThreshold])

  // 打开 Drawer（接收指定告警）
  const openDrawer = useCallback((alert: AlertRecord) => {
    setSelectedAlert(alert)
    setDrawerOpen(true)
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
  }, [])

  const handleRefresh = useCallback(() => {
    if (!activeSessionId || !isElectronAPIAvailable()) return
    setRefreshing(true)
    window.electronAPI.monitorStart(activeSessionId, 5000)
    window.electronAPI.monitorGetSystemInfo(activeSessionId).then((info) => {
      if (info) useMonitorStore.getState().setSystemInfo(activeSessionId, info)
    }).catch(() => {}).finally(() => {
      // P1 修复：请求结束即停止转圈，移除 800ms 人为延迟（假"刷新中"动画）
      setRefreshing(false)
    })
  }, [activeSessionId])

  return (
    <main className="mon-main h-full w-full overflow-y-auto">
      {/* 1. page-header */}
      <header
        className="mon-header mon-header-bar flex items-start justify-between gap-4"
      >
        <div className="flex flex-col gap-1.5 min-w-0">
          <h1 className="mon-title">
            实时监控
          </h1>
          <p className="mon-subtitle truncate">
            {serverLabel}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <TimeRangeSwitcher value={range} onChange={setRange} />
          <button
            type="button"
            onClick={handleRefresh}
            disabled={!activeSessionId}
            aria-label="刷新监控数据"
            className="mon-btn-icon mon-btn-refresh mon-btn-press inline-flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[var(--trae-text-secondary)] ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* 2. 顶部 critical 告警横幅（goto-alert-detail data-dom-id + 点击弹出 Drawer）
          三态渲染：有告警 → 红色横幅；无告警 → 灰色占位 */}
      {criticalAlert ? (
        <div
          role="alert"
          data-dom-id="goto-alert-detail"
          onClick={() => openDrawer(criticalAlert)}
          className="mon-alert mon-alert-critical flex items-start gap-2 mb-3"
        >
          <AlertCircle
            className="w-3.5 h-3.5 shrink-0 mt-0.5"
            style={{ color: 'var(--trae-status-error-default)' }}
          />
          <p className="mon-alert-desc flex-1 min-w-0">
            {criticalAlert.desc}
          </p>
          <span className="mon-alert-time shrink-0 whitespace-nowrap">
            {criticalAlert.time}
          </span>
        </div>
      ) : (
        <div
          className="mon-alert mon-alert-normal flex items-center gap-2 mb-3"
        >
          <AlertCircle
            className="w-3.5 h-3.5 shrink-0"
            style={{ color: 'var(--trae-status-success-default)' }}
          />
          <p className="mon-alert-desc flex-1 min-w-0" style={{ color: 'var(--trae-text-secondary)' }}>
            系统运行正常，暂无 critical 告警
          </p>
        </div>
      )}

      {/* 3. KPI 环形图 4 列网格
          三态渲染：loading skeleton / kpiStats / EmptyMonitorState */}
      {loading && monitorData.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="mon-kpi-card flex h-[100px] items-center justify-center"
            >
              <Activity className="w-4 h-4 text-[var(--trae-text-tertiary)] animate-pulse" />
            </div>
          ))}
        </div>
      ) : kpiStats ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
          {kpiStats.map((stat) => (
            <KpiCard key={stat.label} stat={stat} />
          ))}
        </div>
      ) : (
        <EmptyMonitorState className="mb-3" />
      )}

      {/* 4. 图表 2×2 网格 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mb-3">
        <CpuAreaChart range={range} />
        <MemoryLineChart range={range} />
        <DiskIoBarChart range={range} />
        <NetworkFlowChart range={range} />
      </div>

      {/* 5. 告警列表（全宽，1:1 对齐设计稿 monitor.html） */}
      <div className="mb-3">
        <AlertTable onOpenDrawer={openDrawer} />
      </div>

      {/* 6. 进程监控 */}
      <ProcessTable onRefresh={handleRefresh} />

      {/* 7. 告警详情 Drawer（DEC-3 决策，不新建 alert-detail.html） */}
      <AlertDrawer open={drawerOpen} alert={selectedAlert} onClose={closeDrawer} />
    </main>
  )
}
