/**
 * AlertTable — 告警列表
 *
 * 设计稿：monitor.html 第 5 段 告警列表 table-panel
 *
 * - 顶部工具栏：标题 + 计数 + 筛选按钮 + 搜索框
 * - 表格 5 列：时间 / 级别 / 服务器 / 描述 / 状态
 * - 风险级别用风险色 surface（critical/error、high/warning、medium/alert、low/cyan）
 * - 状态色：未处理=error / 处理中=warning / 已处理=success
 *
 * 数据来源：从 useMonitorStore 实时监控数据动态计算告警，或由父组件通过 props 传入
 */
import { useState, useMemo } from 'react'
import { Filter, Search, ChevronDown, ChevronRight } from 'lucide-react'
import type { AlertRecord, AlertStatus, RiskLevel } from './mock-data'
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
        text: '#04CBE5',
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

/** 从监控数据动态计算告警列表 */
function computeAlertsFromMonitorData(
  sessionId: string,
  hostname: string
): AlertRecord[] {
  const monitorStore = useMonitorStore.getState()
  const history = monitorStore.getMonitorData(sessionId)
  if (history.length === 0) return []

  const alerts: AlertRecord[] = []
  const latest = history[history.length - 1]
  const time = new Date(latest.timestamp).toLocaleTimeString('zh-CN', { hour12: false })

  // 磁盘使用率 > 85 → critical
  if (latest.diskUsage > 85) {
    alerts.push({
      time,
      level: 'critical',
      server: hostname,
      desc: `磁盘使用率过高：${latest.diskUsage.toFixed(1)}% 超过阈值 85%`,
      status: '未处理',
    })
  }

  // CPU 使用率 > 90 → warning (high)
  if (latest.cpuUsage > 90) {
    alerts.push({
      time,
      level: 'high',
      server: hostname,
      desc: `CPU 使用率过高：${latest.cpuUsage.toFixed(1)}% 超过阈值 90%`,
      status: '未处理',
    })
  }

  // 内存使用率 > 85 → warning (high)
  if (latest.memoryUsage > 85) {
    alerts.push({
      time,
      level: 'high',
      server: hostname,
      desc: `内存使用率过高：${latest.memoryUsage.toFixed(1)}% 超过阈值 85%`,
      status: '未处理',
    })
  }

  // 网络流量异常：入站 + 出站 > 10000 KB/s → info (low)
  if (latest.networkIn + latest.networkOut > 10000) {
    alerts.push({
      time,
      level: 'low',
      server: hostname,
      desc: `网络流量异常：总流量 ${((latest.networkIn + latest.networkOut) / 1024).toFixed(1)} MB/s 超过阈值`,
      status: '未处理',
    })
  }

  // 从历史数据中补充已恢复的告警（标记为已处理）
  const prevPoints = history.slice(-10, -1)
  for (const point of prevPoints) {
    const t = new Date(point.timestamp).toLocaleTimeString('zh-CN', { hour12: false })
    if (point.diskUsage > 85 && latest.diskUsage <= 85) {
      alerts.push({
        time: t,
        level: 'critical',
        server: hostname,
        desc: `磁盘使用率过高：${point.diskUsage.toFixed(1)}%（已恢复）`,
        status: '已处理',
      })
    }
    if (point.cpuUsage > 90 && latest.cpuUsage <= 90) {
      alerts.push({
        time: t,
        level: 'high',
        server: hostname,
        desc: `CPU 使用率过高：${point.cpuUsage.toFixed(1)}%（已恢复）`,
        status: '已处理',
      })
    }
    if (point.memoryUsage > 85 && latest.memoryUsage <= 85) {
      alerts.push({
        time: t,
        level: 'high',
        server: hostname,
        desc: `内存使用率过高：${point.memoryUsage.toFixed(1)}%（已恢复）`,
        status: '已处理',
      })
    }
  }

  return alerts
}

/** 单行告警（支持展开详情） */
function AlertRow({
  record,
  expanded,
  onToggle,
}: {
  record: AlertRecord
  expanded: boolean
  onToggle: () => void
}) {
  const risk = riskClasses(record.level)
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer transition-colors duration-200 hover:bg-[var(--trae-bg-overlay-l1)]"
      >
        <td className="whitespace-nowrap px-3 py-2.5 text-[11px] tabular-nums text-[var(--trae-text-secondary)] border-b border-[var(--trae-border-neutral-l1)]">
          <span className="inline-flex items-center gap-1">
            {expanded ? (
              <ChevronDown className="w-3 h-3 text-[var(--trae-text-tertiary)]" />
            ) : (
              <ChevronRight className="w-3 h-3 text-[var(--trae-text-tertiary)]" />
            )}
            {record.time}
          </span>
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 border-b border-[var(--trae-border-neutral-l1)]">
          <span
            className="inline-flex items-center px-1.5 h-4 whitespace-nowrap text-[10px] rounded-[var(--trae-radius-2)]"
            style={{ background: risk.surface, color: risk.text }}
          >
            {record.level}
          </span>
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-[11px] text-[var(--trae-text-default)] border-b border-[var(--trae-border-neutral-l1)]">
          {record.server}
        </td>
        <td className="truncate px-3 py-2.5 text-[11px] text-[var(--trae-text-default)] max-w-[280px] border-b border-[var(--trae-border-neutral-l1)]">
          {record.desc}
        </td>
        <td
          className="whitespace-nowrap px-3 py-2.5 text-[11px] border-b border-[var(--trae-border-neutral-l1)]"
          style={{ color: statusColor(record.status) }}
        >
          {record.status}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-[var(--trae-bg-overlay-l1)]">
          <td colSpan={5} className="px-6 py-3 text-[11px] text-[var(--trae-text-secondary)] border-b border-[var(--trae-border-neutral-l1)]">
            <div className="space-y-1">
              <p><span className="font-medium text-[var(--trae-text-default)]">告警时间：</span>{record.time}</p>
              <p><span className="font-medium text-[var(--trae-text-default)]">服务器：</span>{record.server}</p>
              <p><span className="font-medium text-[var(--trae-text-default)]">风险级别：</span>{record.level}</p>
              <p><span className="font-medium text-[var(--trae-text-default)]">详细描述：</span>{record.desc}</p>
              <p><span className="font-medium text-[var(--trae-text-default)]">处理状态：</span>{record.status}</p>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export interface AlertTableProps {
  /** 可选：父组件传入已计算好的告警列表 */
  alerts?: AlertRecord[]
}

/** 告警列表组件 */
export function AlertTable({ alerts: propAlerts }: AlertTableProps) {
  const [search, setSearch] = useState('')
  const [filterOn, setFilterOn] = useState(false)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const activeSessionId = useServerStore((s) => s.activeSessionId)
  const systemInfo = useMonitorStore((s) =>
    activeSessionId ? s.systemInfo.get(activeSessionId) : undefined
  )

  // 从监控数据动态计算告警，或使用父组件传入的数据
  const computedAlerts = useMemo(() => {
    if (propAlerts) return propAlerts
    if (!activeSessionId) return []
    const hostname = systemInfo?.hostname ?? '未知服务器'
    return computeAlertsFromMonitorData(activeSessionId, hostname)
  }, [propAlerts, activeSessionId, systemInfo])

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

  /** 行点击：展开/收起详情 */
  const handleToggle = (record: AlertRecord) => {
    const key = `${record.time}-${record.server}`
    setExpandedKey((prev) => (prev === key ? null : key))
  }

  return (
    <div className="mb-3 rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] overflow-hidden">
      {/* 工具栏 */}
      <div className="flex items-center justify-between gap-2 p-2.5 border-b border-[var(--trae-border-neutral-l1)]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[12px] font-semibold text-[var(--trae-text-default)]">告警列表</span>
          <span className="inline-flex items-center justify-center px-1.5 h-4 whitespace-nowrap text-[10px] bg-[var(--trae-bg-overlay-l3)] text-[var(--trae-text-secondary)] rounded-[var(--trae-radius-2)] tabular-nums">
            共{visibleAlerts.length}条
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* 筛选按钮 */}
          <button
            type="button"
            onClick={() => setFilterOn((v) => !v)}
            title={filterOn ? '取消筛选未处理' : '筛选未处理'}
            className={
              filterOn
                ? 'inline-flex items-center gap-1 h-[26px] px-2 text-[10px] text-[var(--trae-text-onbrand)] bg-[var(--trae-bg-brand)] border border-[var(--trae-bg-brand)] rounded-[var(--trae-radius-4)] cursor-pointer'
                : 'inline-flex items-center gap-1 h-[26px] px-2 text-[10px] text-[var(--trae-text-secondary)] bg-[var(--trae-bg-overlay-l2)] border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-4)] cursor-pointer hover:bg-[var(--trae-bg-overlay-l3)]'
            }
          >
            <Filter className="w-3 h-3" />
            <span>筛选</span>
          </button>
          {/* 搜索框 */}
          <div className="inline-flex items-center gap-1 h-[26px] px-2 bg-[var(--trae-bg-overlay-l1)] border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-4)]">
            <Search className="w-3 h-3 text-[var(--trae-text-tertiary)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索告警..."
              className="text-[10px] bg-transparent border-none outline-none text-[var(--trae-text-default)] w-[100px]"
            />
          </div>
        </div>
      </div>
      {/* 表格 */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[640px]">
          <thead>
            <tr className="bg-[var(--trae-bg-overlay-l1)]">
              {['时间', '级别', '服务器', '描述', '状态'].map((head) => (
                <th
                  key={head}
                  className={`text-left px-3 py-2 text-[10px] font-medium text-[var(--trae-text-tertiary)] tracking-[0.04em] uppercase border-b border-[var(--trae-border-neutral-l1)] ${
                    head === '描述' ? 'w-full' : 'whitespace-nowrap'
                  }`}
                >
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleAlerts.map((alert) => (
              <AlertRow
                key={`${alert.time}-${alert.server}`}
                record={alert}
                expanded={expandedKey === `${alert.time}-${alert.server}`}
                onToggle={() => handleToggle(alert)}
              />
            ))}
            {visibleAlerts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-[11px] text-[var(--trae-text-tertiary)]">
                  {activeSessionId ? '暂无告警，系统运行正常' : '连接服务器后可查看告警列表'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
