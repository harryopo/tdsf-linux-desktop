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
import { IconButton, PageHeader } from '@/ui'
import { KpiCard } from '@/components/monitor/KpiCard'
import {
  CpuAreaChart,
  DiskUsageBarChart,
  MemoryLineChart,
  NetworkFlowChart,
} from '@/components/monitor/Charts'
import { AlertTable } from '@/components/monitor/AlertTable'
import { AlertDrawer } from '@/components/monitor/AlertDrawer'
import { ProcessTable } from '@/components/monitor/ProcessTable'
import { EmptyMonitorState } from '@/components/monitor/EmptyMonitorState'
import {
  timeRanges,
  computeKpiStats,
  alertKey,
  alertStatusOf,
  type TimeRange,
  type KpiStat,
  type AlertKind,
  type AlertRecord,
  type AlertStatus,
} from '@/components/monitor/monitor-model'
import { useMonitorStore } from '@/stores/monitor-store'
import { useServerStore, MONITOR_INTERVAL_MS } from '@/stores/server-store'
// v2.7：告警阈值消费设置页 monitor.threshold.* 配置（不再硬编码 85）
import { usePersistentState } from '@/hooks/usePersistentState'
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
  const monitorData = useMonitorStore((s) => s.getMonitorData(activeSessionId))
  const systemInfo = useMonitorStore((s) =>
    activeSessionId ? s.getSystemInfo(activeSessionId) : null,
  )

  // monitor:data / systemInfo 订阅已提升到应用入口全局绑定
  // （stores/agent-stream-subscription.ts），监控页未挂载时也不丢推送。
  // 本页挂载时若已有历史数据，直接结束 loading。
  useEffect(() => {
    if (monitorData.length > 0) setLoading(false)
  }, [monitorData.length])

  // 会话换了就取一次静态信息；实时指标的采集由 setActiveSession 统一拉起
  // （见 server-store 的 MONITOR_INTERVAL_MS，本页不再自己传间隔）。
  // P0 修复：卸载时不再 monitorStop —— 让监控在后台持续采集，数据持续进 store，
  // 用户来回切页面不再中断采集（此前离开监控页即 stop，回来又是空白）。
  // 依赖只留 activeSessionId：原来把 monitorData.length 也放进依赖，
  // 于是每来一批指标就重发一次"取静态信息"的 SSH 批量命令。
  useEffect(() => {
    if (!activeSessionId || !isElectronAPIAvailable()) return
    const hasHistory =
      useMonitorStore.getState().getMonitorData(activeSessionId).length > 0
    if (!hasHistory) setLoading(true)
    window.electronAPI
      .monitorGetSystemInfo(activeSessionId)
      .then((info) => {
        if (info) {
          useMonitorStore.getState().setSystemInfo(activeSessionId, info)
          setServerLabel(`${info.hostname} · ${info.os}`)
        }
      })
      .catch(() => {
        /* 静态信息取不到不影响实时指标继续走 */
      })
    const timer = setTimeout(() => setLoading(false), 3000)
    return () => {
      clearTimeout(timer)
    }
  }, [activeSessionId])

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
    if (!latest || !activeSessionId) return null
    const server = systemInfo?.hostname ?? '当前服务器'
    // 已处理状态读那一份 store：横幅与告警列表必须同一个口径，
    // 不然用户在抽屉里标记完，横幅还照常红着（或反过来）。
    const acked = useMonitorStore.getState().ackedAlerts
    const statusOf = (kind: AlertKind): AlertStatus =>
      alertStatusOf(alertKey(activeSessionId, kind), acked)

    if (latest.diskUsage > diskThreshold) {
      return {
        id: alertKey(activeSessionId, 'disk'),
        time: '刚刚',
        level: 'critical',
        server,
        desc: `磁盘使用率${Math.round(latest.diskUsage)}%超过阈值${diskThreshold}%，建议清理 /var/log 旧日志`,
        status: statusOf('disk'),
        // 采集侧真实跑的是 df -h /（见 services/ssh/monitor.ts），设备名与 /var/log 都没读过
        source: 'df -h /（根分区）',
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
        id: alertKey(activeSessionId, 'cpu'),
        time: '刚刚',
        level: 'critical',
        server,
        desc: `CPU 使用率${Math.round(latest.cpuUsage)}%超过阈值${cpuThreshold}%，建议排查高负载进程`,
        status: statusOf('cpu'),
        source: 'top -bn1',
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
        id: alertKey(activeSessionId, 'memory'),
        time: '刚刚',
        level: 'critical',
        server,
        desc: `内存使用率${Math.round(latest.memoryUsage)}%超过阈值${memoryThreshold}%，存在 OOM 风险`,
        status: statusOf('memory'),
        // 采集侧用 free 取内存（不是 RSS/Cache 拆分，那条口径没有依据）
        source: 'free',
        impact: '内存耗尽时内核 OOM Killer 会强杀进程，可能误杀数据库/关键服务',
        suggestions: [
          '定位内存大户：ps aux --sort=-%mem | head',
          '查看可回收缓存：free -m（buff/cache 可被回收）',
          '检查 OOM 历史：dmesg | grep -i "out of memory"',
        ],
      }
    }
    return null
  }, [monitorData, systemInfo, activeSessionId, cpuThreshold, memoryThreshold, diskThreshold])

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
    // 刷新时顺手确保采集在跑（同会话重复启动是幂等的），间隔用全局唯一口径
    window.electronAPI.monitorStart(activeSessionId, MONITOR_INTERVAL_MS)
    window.electronAPI.monitorGetSystemInfo(activeSessionId).then((info) => {
      if (info) useMonitorStore.getState().setSystemInfo(activeSessionId, info)
    }).catch(() => {}).finally(() => {
      // P1 修复：请求结束即停止转圈，移除 800ms 人为延迟（假"刷新中"动画）
      setRefreshing(false)
    })
  }, [activeSessionId])

  return (
    <main className="flex h-full w-full flex-col bg-canvas">
      <PageHeader
        icon={Activity}
        title="实时监控"
        subtitle={serverLabel}
        actions={
          <>
            <TimeRangeSwitcher value={range} onChange={setRange} />
            <IconButton
              label="刷新监控数据"
              size="lg"
              onClick={handleRefresh}
              disabled={!activeSessionId}
            >
              <RefreshCw className={refreshing ? 'size-4 animate-spin' : 'size-4'} />
            </IconButton>
          </>
        }
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
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
            style={{ color: 'var(--status-error-text)' }}
          />
          <p className="mon-alert-desc flex-1 min-w-0">
            {criticalAlert.desc}
          </p>
          {/* 标记过就写出来：横幅不因"已处理"而消失（指标还在超阈值），
              但用户能看出这一条自己已经认领过，而不是又冒出来一遍。 */}
          {criticalAlert.status === '已处理' && (
            <span
              className="mon-alert-acked shrink-0 whitespace-nowrap"
              data-dom-id="alert-banner-acked"
            >
              已处理 · 仍在超阈值
            </span>
          )}
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
            style={{ color: 'var(--status-success-text)' }}
          />
          <p className="mon-alert-desc flex-1 min-w-0" style={{ color: 'var(--text-tertiary)' }}>
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
              <Activity className="w-4 h-4 text-ink-mute animate-pulse" />
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
        <DiskUsageBarChart range={range} />
        <NetworkFlowChart range={range} />
      </div>

      {/* 5. 告警列表（全宽，1:1 对齐设计稿 monitor.html） */}
      <div className="mb-3">
        <AlertTable onOpenDrawer={openDrawer} />
      </div>

      {/* 6. 进程监控 */}
      <ProcessTable onRefresh={handleRefresh} />
      </div>

      {/* 7. 告警详情 Drawer（DEC-3 决策，不新建 alert-detail.html） */}
      <AlertDrawer open={drawerOpen} alert={selectedAlert} onClose={closeDrawer} />
    </main>
  )
}
