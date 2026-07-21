/**
 * AlertTable — 告警列表 table-panel
 *
 * 设计稿：monitor.html 第 5 段 告警列表 table-panel
 * Spec: build-runnable-tdsf-from-design · Task 2.4 · SubTask 2.4.4
 *
 * 实现：
 * - 6 行告警，含级别 tag（critical / high / medium / low）
 * - 每行 `goto-alert-row-N` data-dom-id（N=1~6）
 * - 列：级别 / 标题 / 来源 / 时间 / 状态（5 列）
 * - 点击行弹出右侧 Drawer 展示详情（DEC-3 决策，通过 onOpenDrawer 回调上抛）
 *
 * 数据策略：
 * - 优先使用父组件传入的 alerts（实时计算）
 * - 若父组件未传且无活跃会话，使用 sampleAlerts 作为 fallback（保证页面可演示）
 *
 * 视觉规范（spec §B）：
 * - 边框用 solid hex（var(--trae-border-neutral-l1)）
 * - 状态色 surface 用 rgba（允许）
 * - hover 仅改变背景，无 border + scale 同时变化
 */
import { useState, useMemo } from 'react'
import { Filter, Search } from 'lucide-react'
import type { AlertRecord, AlertStatus, RiskLevel } from './mock-data'
import { sampleAlerts } from './mock-data'
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

/** 从监控数据动态计算告警列表（实时路径，有活跃会话时使用） */
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

  if (latest.diskUsage > 85) {
    alerts.push({
      time,
      level: 'critical',
      server: hostname,
      desc: `磁盘使用率过高：${latest.diskUsage.toFixed(1)}% 超过阈值 85%`,
      status: '未处理',
      source: '/dev/sda1 · /var/log',
      impact: '根分区空间不足可能导致日志写入失败、服务异常崩溃、数据库锁表',
      suggestions: [
        '清理 /var/log 旧日志：find /var/log -type f -name "*.log.*" -mtime +7 -delete',
        '归档并压缩：tar -czf /tmp/log-$(date +%F).tar.gz /var/log/*.log && rm /var/log/*.log',
        '配置 logrotate 自动轮转：编辑 /etc/logrotate.d/nginx',
      ],
    })
  }

  if (latest.cpuUsage > 90) {
    alerts.push({
      time,
      level: 'high',
      server: hostname,
      desc: `CPU 使用率过高：${latest.cpuUsage.toFixed(1)}% 超过阈值 90%`,
      status: '未处理',
      source: '/proc/loadavg',
      impact: '响应延迟增加，可能引发雪崩',
      suggestions: [
        '定位高 CPU 进程：top -bn1 | head -20',
        '检查 nginx 配置：grep -r "limit_req" /etc/nginx/',
        '考虑横向扩容：增加 Web 节点 + 负载均衡',
      ],
    })
  }

  return alerts
}

/** 单行告警（无展开行，点击整行触发 Drawer） */
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
      className="cursor-pointer transition-colors duration-200 hover:bg-[var(--trae-bg-overlay-l1)]"
    >
      <td className="whitespace-nowrap px-3 py-2.5 border-b border-[var(--trae-border-neutral-l1)]">
        <span
          className="inline-flex items-center px-1.5 h-[18px] whitespace-nowrap text-[10px] uppercase tracking-[0.04em] rounded-[var(--trae-radius-2)]"
          style={{ background: risk.surface, color: risk.text }}
        >
          {record.level}
        </span>
      </td>
      <td className="truncate px-3 py-2.5 text-[11px] text-[var(--trae-text-default)] max-w-[260px] border-b border-[var(--trae-border-neutral-l1)]">
        {record.desc}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-[11px] text-[var(--trae-text-secondary)] border-b border-[var(--trae-border-neutral-l1)]">
        {record.server}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-[11px] tabular-nums text-[var(--trae-text-secondary)] border-b border-[var(--trae-border-neutral-l1)]">
        {record.time}
      </td>
      <td
        className="whitespace-nowrap px-3 py-2.5 text-[11px] border-b border-[var(--trae-border-neutral-l1)]"
        style={{ color: statusColor(record.status) }}
      >
        ● {record.status}
      </td>
    </tr>
  )
}

export interface AlertTableProps {
  /** 父组件传入已计算好的告警列表（可选） */
  alerts?: AlertRecord[]
  /** 点击行打开 Drawer 回调 */
  onOpenDrawer?: (alert: AlertRecord) => void
}

/** 告警列表组件 */
export function AlertTable({ alerts: propAlerts, onOpenDrawer }: AlertTableProps) {
  const [search, setSearch] = useState('')
  const [filterOn, setFilterOn] = useState(false)

  const activeSessionId = useServerStore((s) => s.activeSessionId)
  const systemInfo = useMonitorStore((s) =>
    activeSessionId ? s.systemInfo.get(activeSessionId) : undefined
  )

  // 数据策略：propAlerts > 实时计算 > sampleAlerts fallback
  const computedAlerts = useMemo(() => {
    if (propAlerts) return propAlerts
    if (!activeSessionId) return sampleAlerts
    const hostname = systemInfo?.hostname ?? '未知服务器'
    const live = computeAlertsFromMonitorData(activeSessionId, hostname)
    return live.length > 0 ? live : sampleAlerts
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

  return (
    <div className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] overflow-hidden">
      {/* 工具栏 */}
      <div className="flex items-center justify-between gap-2 p-2.5 border-b border-[var(--trae-border-neutral-l1)]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[12px] font-semibold text-[var(--trae-text-default)]">告警列表</span>
          <span className="inline-flex items-center justify-center px-1.5 h-[18px] whitespace-nowrap text-[10px] bg-[var(--trae-bg-overlay-l3)] text-[var(--trae-text-secondary)] rounded-[var(--trae-radius-2)] tabular-nums">
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
                ? 'inline-flex items-center gap-1 h-[26px] px-2 text-[10px] text-[var(--trae-text-onbrand)] bg-[var(--trae-bg-brand)] border border-[var(--trae-bg-brand)] rounded-[var(--trae-radius-4)] cursor-pointer'
                : 'inline-flex items-center gap-1 h-[26px] px-2 text-[10px] text-[var(--trae-text-secondary)] bg-[var(--trae-bg-overlay-l2)] border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-4)] cursor-pointer hover:bg-[var(--trae-bg-overlay-l3)]'
            }
          >
            <Filter className="w-3 h-3" />
            <span>筛选</span>
          </button>
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
              {['级别', '标题', '来源', '时间', '状态'].map((head) => (
                <th
                  key={head}
                  className={`text-left px-3 py-2 text-[10px] font-medium text-[var(--trae-text-tertiary)] tracking-[0.04em] uppercase border-b border-[var(--trae-border-neutral-l1)] ${
                    head === '标题' ? 'w-full' : 'whitespace-nowrap'
                  }`}
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
                <td colSpan={5} className="px-3 py-6 text-center text-[11px] text-[var(--trae-text-tertiary)]">
                  暂无告警，系统运行正常
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
