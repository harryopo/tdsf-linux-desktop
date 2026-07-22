/**
 * ProcessTable — 进程监控 TOP 5 CPU
 *
 * 设计稿：monitor.html 第 6 段 进程监控 table-panel
 * Spec: build-runnable-tdsf-from-design · Task 2.4
 *
 * 数据策略：
 * - 优先通过 sshExec 执行 `ps aux --sort=-%cpu | head -6` 获取真实进程列表
 * - 若无活跃会话或真实数据为空，使用 sampleProcesses 作为 fallback（保证页面可演示）
 *
 * 视觉规范：
 * - 边框用 solid hex（var(--trae-border-neutral-l1)）
 * - 表头 var(--trae-bg-overlay-l1) 背景
 * - 进程名/PID 用 var(--trae-font-family-mono) 等宽字体
 * - 状态运行中=success 绿点，睡眠=tertiary 灰点，僵尸=error 红点
 */
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Loader2 } from 'lucide-react'
import { useServerStore } from '../../stores/server-store'
import { useMonitorStore } from '../../stores/monitor-store'
import { sampleProcesses } from './mock-data'

/** 进程运行状态（从 ps STAT 列推断） */
type ProcessStatus = '运行中' | '睡眠' | '僵尸'

/** 单条进程记录 */
interface ProcessRow {
  pid: number
  user: string
  cpu: number
  mem: number
  command: string
  status: ProcessStatus
}

/** 进程状态颜色（运行中=success 绿） */
function statusStyle(status: ProcessStatus): { color: string; dot: string } {
  switch (status) {
    case '运行中':
      return {
        color: 'var(--trae-status-success-default)',
        dot: 'var(--trae-status-success-default)',
      }
    case '睡眠':
      return {
        color: 'var(--trae-text-tertiary)',
        dot: 'var(--trae-text-tertiary)',
      }
    case '僵尸':
      return {
        color: 'var(--trae-status-error-default)',
        dot: 'var(--trae-status-error-default)',
      }
  }
}

/** 从 ps STAT 字段推断进程状态 */
function inferStatus(stat: string): ProcessStatus {
  const first = stat.charAt(0).toUpperCase()
  if (first === 'R') return '运行中'
  if (first === 'Z') return '僵尸'
  return '睡眠' // S, D, T, I 等
}

/**
 * 解析 `ps aux --sort=-%cpu | head -6` 的输出
 * 格式：USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
 */
function parsePsOutput(stdout: string): ProcessRow[] {
  const lines = stdout.trim().split('\n')
  // 跳过表头行
  const dataLines = lines.filter((line) => {
    const trimmed = line.trim()
    return trimmed.length > 0 && !trimmed.startsWith('USER')
  })

  const rows: ProcessRow[] = []
  for (const line of dataLines.slice(0, 5)) {
    // ps aux 输出：前 10 列是固定字段，第 11 列起是 COMMAND（可能含空格）
    const parts = line.trim().split(/\s+/)
    if (parts.length < 11) continue

    const user = parts[0]
    const pid = parseInt(parts[1], 10)
    const cpu = parseFloat(parts[2])
    const mem = parseFloat(parts[3])
    const stat = parts[7] ?? 'S'
    const command = parts.slice(10).join(' ')

    if (isNaN(pid) || isNaN(cpu) || isNaN(mem)) continue

    rows.push({
      pid,
      user,
      cpu,
      mem,
      command,
      status: inferStatus(stat),
    })
  }

  return rows
}

/** 单行进程 */
function ProcessRowComponent({
  pid,
  name,
  cpu,
  mem,
  status,
  isLast,
}: {
  pid: number
  name: string
  cpu: number
  mem: number
  status: ProcessStatus
  isLast: boolean
}) {
  const st = statusStyle(status)
  const noBorderStyle = isLast ? { borderBottom: 'none' } : undefined
  return (
    <tr data-mon-hover className="mon-table-row-nocursor">
      <td
        className="mon-table-td-mono whitespace-nowrap tabular-nums"
        style={{ color: 'var(--trae-text-secondary)', ...noBorderStyle }}
      >
        {pid}
      </td>
      <td className="mon-table-td-mono truncate" style={{ maxWidth: 200, ...noBorderStyle }}>
        {name}
      </td>
      <td
        className="mon-table-td-mono text-right whitespace-nowrap tabular-nums"
        style={noBorderStyle}
      >
        {cpu.toFixed(1)}%
      </td>
      <td
        className="mon-table-td-mono text-right whitespace-nowrap tabular-nums"
        style={noBorderStyle}
      >
        {mem.toFixed(1)}%
      </td>
      <td className="mon-table-td-mono whitespace-nowrap" style={noBorderStyle}>
        <span
          className="inline-flex items-center gap-1.5"
          style={{ color: st.color, fontSize: 'var(--trae-body-sm-font-size)' }}
        >
          <span className="mon-status-dot" style={{ background: st.dot }} />
          {status}
        </span>
      </td>
    </tr>
  )
}

export interface ProcessTableProps {
  /** 刷新回调（父页可重拉 monitorGetSystemInfo） */
  onRefresh?: () => void | Promise<void>
}

/** 进程监控组件 */
export function ProcessTable({ onRefresh }: ProcessTableProps) {
  const [spinning, setSpinning] = useState(false)
  const [loading, setLoading] = useState(false)
  const [processes, setProcesses] = useState<ProcessRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const activeSessionId = useServerStore((s) => s.activeSessionId)
  const processCount = useMonitorStore((s) => {
    if (!activeSessionId) return null
    const history = s.monitorData.get(activeSessionId)
    if (!history || history.length === 0) return null
    return history[history.length - 1].processCount
  })

  /** 通过 SSH 获取真实进程列表 */
  const fetchProcesses = useCallback(async () => {
    if (!activeSessionId) {
      setProcesses([])
      return
    }

    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.sshExec(
        activeSessionId,
        'ps aux --sort=-%cpu | head -6'
      )
      if (result.exitCode === 0 && result.stdout) {
        const parsed = parsePsOutput(result.stdout)
        setProcesses(parsed)
      } else {
        setError(result.stderr || '获取进程列表失败')
        setProcesses([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取进程列表失败')
      setProcesses([])
    } finally {
      setLoading(false)
    }
  }, [activeSessionId])

  // 挂载时 + activeSessionId 变化时自动拉取
  useEffect(() => {
    if (activeSessionId) {
      void fetchProcesses()
    } else {
      setProcesses([])
      setError(null)
    }
  }, [activeSessionId, fetchProcesses])

  /** 刷新按钮：重新拉取进程列表 + 通知父组件 */
  const handleRefresh = async () => {
    setSpinning(true)
    try {
      await fetchProcesses()
      await onRefresh?.()
    } finally {
      window.setTimeout(() => setSpinning(false), 400)
    }
  }

  /** 显示数据：真实数据优先，无活跃会话或为空时用 sampleProcesses fallback */
  type DisplayRow = { pid: number; name: string; cpu: number; mem: number; status: ProcessStatus }
  const displayProcesses: DisplayRow[] =
    !loading && !error && processes.length > 0
      ? processes.map((p) => ({
          pid: p.pid,
          name: p.command,
          cpu: p.cpu,
          mem: p.mem,
          status: p.status,
        }))
      : sampleProcesses.map((p) => ({
          pid: p.pid,
          name: p.name,
          cpu: p.cpu,
          mem: p.mem,
          status: p.status,
        }))
  const isFallback = !activeSessionId || (!loading && !error && processes.length === 0)

  return (
    <div className="mon-table-panel">
      {/* 工具栏 */}
      <div className="mon-table-toolbar flex items-center justify-between gap-2 p-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="mon-table-panel-title">进程监控</span>
          <span className="mon-table-count-brand">
            TOP 5 CPU
          </span>
          {processCount !== null && (
            <span className="mon-table-count">
              共 {processCount} 个进程
            </span>
          )}
          {isFallback && (
            <span className="mon-table-count-muted">
              示例
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={loading || !activeSessionId}
          className="mon-btn-sm mon-btn-press inline-flex items-center justify-center px-2 bg-[var(--trae-bg-overlay-l2)] border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-4)] cursor-pointer hover:bg-[var(--trae-bg-overlay-l3)] disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="刷新进程列表"
        >
          <RefreshCw
            className={`w-3 h-3 text-[var(--trae-text-secondary)] ${spinning ? 'animate-spin' : ''}`}
          />
        </button>
      </div>
      {/* 表格 */}
      <div className="overflow-x-auto">
        <table className="mon-table" style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th className="whitespace-nowrap">
                PID
              </th>
              <th className="w-full">
                进程名
              </th>
              <th className="text-right whitespace-nowrap">
                CPU%
              </th>
              <th className="text-right whitespace-nowrap">
                内存%
              </th>
              <th className="whitespace-nowrap">
                状态
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="mon-table-td text-center">
                  <span className="inline-flex items-center gap-2" style={{ color: 'var(--trae-text-tertiary)', fontSize: 'var(--trae-body-sm-font-size)' }}>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    正在获取进程列表...
                  </span>
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={5} className="mon-table-td text-center" style={{ color: 'var(--trae-status-error-default)', fontSize: 'var(--trae-body-sm-font-size)' }}>
                  {error}
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              displayProcesses.map((p, idx) => (
                <ProcessRowComponent
                  key={`proc-${p.pid}-${idx}`}
                  pid={p.pid}
                  name={p.name}
                  cpu={p.cpu}
                  mem={p.mem}
                  status={p.status}
                  isLast={idx === displayProcesses.length - 1}
                />
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
