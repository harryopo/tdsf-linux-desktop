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
import { ServerProbeCard } from '@/components/monitor/ServerProbeCard'
import { EmptyMonitorState } from '@/components/monitor/EmptyMonitorState'
import {
  timeRanges,
  computeKpiStats,
  deriveAlerts,
  deriveMonitorFreshness,
  MONITOR_STALE_AFTER_MS,
  type TimeRange,
  type KpiStat,
  type AlertRecord,
  type MonitorFreshness,
} from '@/components/monitor/monitor-model'
import { useMonitorStore } from '@/stores/monitor-store'
import { useServerStore, MONITOR_INTERVAL_MS } from '@/stores/server-store'
// 告警阈值与告警列表读同一个 hook（键名只在一处出现；两侧口径必须一致）
import { useAlertThresholds } from '@/hooks/useAlertThresholds'
// M3 Task 2：时间范围切换切片工具（KPI 数据源按 range 过滤）
import { selectMonitorSeries } from '@/utils/monitor-time-range'
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

/** 采样时间 → HH:MM:SS（横幅上用，秒要看得见：用户判断"多久没更新"靠它） */
function clockOf(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * 非 live 状态下横幅说什么
 *
 * 这些话必须与"系统运行正常"互斥：横幅是全页最先读的一行，
 * 数据停更了还写"正常"，等于替一台失联的机器背书。
 */
function freshnessDesc(freshness: MonitorFreshness): string {
  switch (freshness) {
    case 'disconnected':
      return '连接已断开 · 监控已停止更新'
    case 'connecting':
      return '正在重连 · 监控数据暂停更新'
    case 'stalled':
      return `${Math.round(MONITOR_STALE_AFTER_MS / 1000)} 秒没有收到新采样 · 监控可能已停止`
    case 'waiting':
      return '已连接，正在等待第一批采集数据'
    default:
      return ''
  }
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
  /**
   * 体检要写的是"哪台机器"：优先用连接配置里的那个地址（它就是用户认得的名字，
   * 也会进报告文件名）。systemInfo.hostname 是从远端 uname 输出里读的一行，
   * 拿它当文件名会拖出一串带空格和 # 的怪名字，所以只作兜底。
   */
  const probeHostFromConfig = useServerStore((s) => {
    const sid = s.activeSessionId
    if (!sid) return null
    const serverId = Object.entries(s.sessionMap).find(([, v]) => v === sid)?.[0]
    return serverId ? (s.servers.find((x) => x.id === serverId)?.host ?? null) : null
  })
  const probeHost = probeHostFromConfig ?? systemInfo?.hostname ?? null

  /** 当前会话属于哪台已保存的服务器（后面要拿它的连接状态） */
  const activeServerId = useServerStore((s) => {
    const sid = s.activeSessionId
    if (!sid) return null
    return Object.entries(s.sessionMap).find(([, v]) => v === sid)?.[0] ?? null
  })
  /**
   * 连接状态：心跳断开 / 重连中时采集必然断流。
   *
   * 以前这里一个字都不读它——`ssh:state-changed` 推送早就到了 server-store，
   * 监控页却只认 activeSessionId，于是断线后继续把最后一帧当"现在"（#257）。
   */
  const connectionState = useServerStore((s) =>
    activeServerId ? s.connectionStates[activeServerId] : undefined
  )

  /** 只看"多久没更新"，5 秒一跳就够（采样本身 3 秒一次） */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!activeSessionId) return
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [activeSessionId])

  const lastSampleAt = monitorData.length > 0 ? monitorData[monitorData.length - 1].timestamp : null
  const freshness = deriveMonitorFreshness({
    hasSession: !!activeSessionId,
    connectionState,
    lastSampleAt,
    now,
    staleAfterMs: MONITOR_STALE_AFTER_MS,
  })

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
    return computeKpiStats(selectMonitorSeries(monitorData, range))
  }, [monitorData, range])

  // 顶部告警横幅：与告警列表用同一个生产者 deriveAlerts、同一套阈值（useAlertThresholds）。
  // 以前这里和列表各写一份判定：列表只认 disk/cpu 且把 85/90 写死，横幅认 disk/cpu/memory
  // 且读设置页阈值。口径不一致时"这条告警此刻成不成立"有两个答案，
  // 列表按自己那份键集合清理已处理状态，就会把横幅刚标记的那条抹掉。
  const thresholds = useAlertThresholds()
  const ackedAlerts = useMonitorStore((s) => s.ackedAlerts)
  const criticalAlert = useMemo<AlertRecord | null>(() => {
    const latest = monitorData[monitorData.length - 1]
    if (!latest || !activeSessionId) return null
    // deriveAlerts 的顺序即优先级（磁盘 > CPU > 内存），横幅取第一条
    return (
      deriveAlerts({
        sessionId: activeSessionId,
        hostname: systemInfo?.hostname ?? '当前服务器',
        latest,
        thresholds,
        acked: ackedAlerts,
      })[0] ?? null
    )
  }, [monitorData, systemInfo, activeSessionId, thresholds, ackedAlerts])

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

  // 页头副标题带"最后更新"：横幅说停更，这里给出停在哪一秒
  const subtitle = lastSampleAt
    ? `${serverLabel} · 最后更新 ${clockOf(lastSampleAt)}`
    : serverLabel

  return (
    <main className="flex h-full w-full flex-col bg-canvas" data-monitor-freshness={freshness}>
      <PageHeader
        icon={Activity}
        title="实时监控"
        subtitle={subtitle}
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
          四态渲染，顺序即优先级：
            未连接 → 停更/重连（这一档必须先于"正常"）→ 有告警 → 正常 */}
      {!activeSessionId ? (
        <div className="mon-alert mon-alert-normal flex items-center gap-2 mb-3">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 text-ink-mute" />
          <p className="mon-alert-desc flex-1 min-w-0 text-ink-dim">
            未连接服务器 · 连接后显示实时监控
          </p>
        </div>
      ) : freshness !== 'live' ? (
        <div
          role="status"
          data-dom-id="monitor-stale-banner"
          className={`mon-alert flex items-center gap-2 mb-3 ${
            freshness === 'waiting' ? 'mon-alert-wait' : 'mon-alert-stale'
          }`}
        >
          <AlertCircle
            className="w-3.5 h-3.5 shrink-0"
            style={{
              color:
                freshness === 'waiting'
                  ? 'var(--text-tertiary)'
                  : 'var(--status-warning-text)',
            }}
          />
          <p className="mon-alert-desc flex-1 min-w-0">{freshnessDesc(freshness)}</p>
          {lastSampleAt ? (
            <span className="mon-alert-time shrink-0 whitespace-nowrap">
              最后一条 {clockOf(lastSampleAt)}
            </span>
          ) : null}
        </div>
      ) : criticalAlert ? (
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
        <EmptyMonitorState
          className="mb-3"
          // 有会话但一条采样都没有：这不是"未连接"，说成未连接会把排查方向指错
          title={activeSessionId ? '还没有收到采集数据' : undefined}
          description={
            activeSessionId
              ? '已连接，正在等待第一轮监控采集；若长时间没有数据，请检查连接状态'
              : undefined
          }
        />
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
        <AlertTable onOpenDrawer={openDrawer} live={freshness === 'live'} />
      </div>

      {/* 6. 进程监控 */}
      <ProcessTable onRefresh={handleRefresh} />

      {/* 7. 服务器体检（#212）：profiler:run 这条引擎此前只有 AI 能调，人没有入口 */}
      <ServerProbeCard sessionId={activeSessionId} host={probeHost} />
      </div>

      {/* 7. 告警详情 Drawer（DEC-3 决策，不新建 alert-detail.html） */}
      <AlertDrawer open={drawerOpen} alert={selectedAlert} onClose={closeDrawer} />
    </main>
  )
}
