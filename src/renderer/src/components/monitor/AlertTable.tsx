/**
 * AlertTable — 告警列表 table-panel
 *
 * 设计稿：monitor.html 第 5 段 告警列表 table-panel（第 881-885 行表头）
 * Spec: build-runnable-tdsf-from-design · Task 2.4 · SubTask 2.4.4
 *
 * 实现：
 * - 6 行告警，含级别 tag（critical / high / medium / low）
 * - 每行 `goto-alert-row-N` data-dom-id（N=1~6）
 * - 列：时间 / 级别 / 服务器 / 描述 / 状态（5 列，1:1 对齐设计稿）
 *   - 「来源」列移除（保留在 AlertDrawer 详情中展示）
 * - 点击行弹出右侧 Drawer 展示详情（DEC-3 决策，通过 onOpenDrawer 回调上抛）
 *
 * 数据策略（P1 修复：移除 DEV 假数据 fallback）：
 * - 优先使用父组件传入的 alerts（实时计算）
 * - 其次基于 monitor store 实时数据计算告警
 * - 若均无数据：返回空数组（colSpan=5 显示「暂无告警」占位行，DEV 与生产一致）
 *
 * 视觉规范（spec §B）：
 * - 边框用 solid hex（var(--trae-border-neutral-l1)）
 * - 状态色 surface 用 rgba（允许）
 * - hover 仅改变背景，无 border + scale 同时变化
 */
import { useState, useMemo } from 'react'
import { Filter, Search } from 'lucide-react'
import type { AlertRecord, AlertStatus, RiskLevel, AlertThresholds } from './monitor-model'
import { deriveAlerts } from './monitor-model'
import { useAlertThresholds } from '@/hooks/useAlertThresholds'
import { useMonitorStore } from '../../stores/monitor-store'
import { useServerStore } from '../../stores/server-store'

/** 风险级别 → CSS 变量（surface + text） */
function riskClasses(level: RiskLevel): { surface: string; text: string } {
  switch (level) {
    case 'critical':
      return {
        surface: 'var(--trae-status-error-surface-l1)',
        text: 'var(--trae-status-error-default)',
      }
    case 'high':
      return {
        surface: 'var(--trae-status-warning-surface-l1)',
        text: 'var(--trae-status-warning-default)',
      }
    case 'medium':
      return {
        surface: 'var(--trae-status-alert-surface-l1)',
        text: 'var(--trae-status-alert-default)',
      }
    case 'low':
      return {
        surface: 'rgba(4, 203, 229, 0.16)',
        text: 'var(--trae-accent-cyan)',
      }
  }
}

/** 状态 → 文字色 */
function statusColor(status: AlertStatus): string {
  switch (status) {
    case '未处理':
      return 'var(--trae-status-error-default)'
    case '处理中':
      return 'var(--trae-status-warning-default)'
    case '已处理':
      return 'var(--trae-status-success-default)'
  }
}

/**
 * 从监控数据算出当前成立的告警（列表与横幅共用 deriveAlerts）
 *
 * 导出给判据直接驱动（tests/components/monitor/alert-ack-state.test.ts）：
 * "标记已处理到底改不改状态"这件事只有跑这个函数才能量到，界面层测的是它渲染的结果。
 *
 * prune 用的键集合必须来自 deriveAlerts 的产出。以前这里只认 disk/cpu 且阈值写死，
 * 而横幅会产出 `会话|memory`，于是列表每一拍把横幅刚标记的那条确认删掉。
 */
export function computeAlertsFromMonitorData(
  sessionId: string,
  hostname: string,
  thresholds: AlertThresholds
): AlertRecord[] {
  const monitorStore = useMonitorStore.getState()
  const history = monitorStore.getMonitorData(sessionId)
  if (history.length === 0) {
    monitorStore.pruneSessionAcks(sessionId, [])
    return []
  }

  const alerts = deriveAlerts({
    sessionId,
    hostname,
    latest: history[history.length - 1],
    thresholds,
    acked: monitorStore.ackedAlerts,
  })

  // 这一轮不再成立的确认一律作废：指标回落了＝这轮结束，下次再越线重新算未处理
  monitorStore.pruneSessionAcks(
    sessionId,
    alerts.map((a) => a.id)
  )
  return alerts
}

/** 单行告警（无展开行，点击整行触发 Drawer）
 *  列顺序 1:1 对齐设计稿 monitor.html 第 889-942 行：
 *  时间 / 级别 / 服务器 / 描述 / 状态
 */
function AlertRow({
  record,
  rowId,
  onClick,
}: {
  record: AlertRecord
  rowId: number
  onClick: () => void
}) {
  const risk = riskClasses(record.level)
  return (
    <tr
      data-dom-id={`goto-alert-row-${rowId}`}
      onClick={onClick}
      data-mon-hover
      className="mon-table-row"
    >
      <td className="mon-table-td whitespace-nowrap tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
        {record.time}
      </td>
      <td className="mon-table-td whitespace-nowrap">
        <span
          className="mon-level-tag uppercase tracking-[0.04em]"
          style={{ background: risk.surface, color: risk.text }}
        >
          {record.level}
        </span>
      </td>
      <td className="mon-table-td whitespace-nowrap">
        {record.server}
      </td>
      <td className="mon-table-td truncate" style={{ maxWidth: 260 }}>
        {record.desc}
      </td>
      <td
        className="mon-table-td whitespace-nowrap"
        style={{ color: statusColor(record.status) }}
      >
        {record.status}
      </td>
    </tr>
  )
}

export interface AlertTableProps {
  /** 父组件传入已计算好的告警列表（可选） */
  alerts?: AlertRecord[]
  /** 点击行打开 Drawer 回调 */
  onOpenDrawer?: (alert: AlertRecord) => void
  /**
   * 这一帧数据是否"还活着"（由页面的新鲜度判定传下来，默认 true）
   *
   * 空列表在"活着"和"停更"两种情况下含义不同：前者可以说"运行正常"，
   * 后者只能说"不知道"——空列表本身就是因为没有新数据可算。
   */
  live?: boolean
}

/** 告警列表组件 */
export function AlertTable({ alerts: propAlerts, onOpenDrawer, live = true }: AlertTableProps) {
  const [search, setSearch] = useState('')
  const [filterOn, setFilterOn] = useState(false)

  const activeSessionId = useServerStore((s) => s.activeSessionId)
  const systemInfo = useMonitorStore((s) =>
    activeSessionId ? s.systemInfo.get(activeSessionId) : undefined
  )
  const thresholds = useAlertThresholds()

  // 数据策略（P1 修复：移除 DEV sampleAlerts fallback，假告警会被当真实告警）：
  // propAlerts > 实时计算 > 空列表（显示空态）
  const computedAlerts = useMemo(() => {
    if (propAlerts) return propAlerts
    if (!activeSessionId) {
      return []
    }
    const hostname = systemInfo?.hostname ?? '未知服务器'
    return computeAlertsFromMonitorData(activeSessionId, hostname, thresholds)
  }, [propAlerts, activeSessionId, systemInfo, thresholds])

  /** 筛选未处理告警 + 搜索关键词匹配 */
  const visibleAlerts = computedAlerts.filter((alert) => {
    if (filterOn && alert.status !== '未处理') return false
    if (!search.trim()) return true
    const kw = search.trim().toLowerCase()
    return (
      alert.time.toLowerCase().includes(kw) ||
      alert.level.toLowerCase().includes(kw) ||
      alert.server.toLowerCase().includes(kw) ||
      alert.desc.toLowerCase().includes(kw) ||
      alert.status.toLowerCase().includes(kw)
    )
  })

  return (
    <div className="mon-table-panel">
      {/* 工具栏 */}
      <div className="mon-table-toolbar flex items-center justify-between gap-2 p-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="mon-table-panel-title">告警列表</span>
          <span className="mon-table-count">
            共{visibleAlerts.length}条
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setFilterOn((v) => !v)}
            title={filterOn ? '取消筛选未处理' : '筛选未处理'}
            className={
              filterOn
                ? 'mon-btn-sm mon-btn-press inline-flex items-center gap-1 px-2 text-[var(--trae-text-onbrand)] bg-accent-solid border border-[var(--trae-bg-brand)] rounded-[var(--trae-radius-4)] cursor-pointer'
                : 'mon-btn-sm mon-btn-press inline-flex items-center gap-1 px-2 text-ink-dim bg-[var(--trae-bg-overlay-l2)] border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-4)] cursor-pointer hover:bg-hover'
            }
          >
            <Filter className="w-3 h-3" />
            <span>筛选</span>
          </button>
          <div
            data-field-shell
            className="mon-btn-sm inline-flex items-center gap-1 px-2 bg-[var(--trae-bg-overlay-l1)] border border-[var(--trae-border-neutral-l1)] rounded-(--ui-radius-control)"
          >
            <Search className="w-3 h-3 text-ink-mute" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索告警..."
              className="w-[100px] border-none bg-transparent text-ink text-caption"
            />
          </div>
        </div>
      </div>
      {/* 表格 */}
      <div className="overflow-x-auto">
        <table className="mon-table" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              {['时间', '级别', '服务器', '描述', '状态'].map((head) => (
                <th
                  key={head}
                  className={`${head === '描述' ? 'w-full' : 'whitespace-nowrap'}`}
                >
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleAlerts.map((alert, idx) => (
              <AlertRow
                key={`alert-row-${idx + 1}-${alert.time}-${alert.server}`}
                record={alert}
                rowId={idx + 1}
                onClick={() => onOpenDrawer?.(alert)}
              />
            ))}
            {visibleAlerts.length === 0 && (
              <tr>
                <td colSpan={5} className="mon-table-td text-center" style={{ color: 'var(--text-muted)' }}>
                  {live ? '暂无告警，系统运行正常' : '数据已停止更新，无法判断当前是否有告警'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
