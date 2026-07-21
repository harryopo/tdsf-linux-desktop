/**
 * ProcessTable — 进程监控 TOP 5 CPU
 *
 * 设计稿：monitor.html 进程监控 table-panel
 * 数据来源：通过 sshExec 执行 `ps aux --sort=-%cpu | head -6` 获取真实进程列表
 * 刷新：点击刷新按钮重新执行 SSH 命令拉取最新数据
 */
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Loader2 } from 'lucide-react'
import { useServerStore } from '../../stores/server-store'
import { useMonitorStore } from '../../stores/monitor-store'

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
  const borderClass = isLast ? '' : 'border-b border-[var(--trae-border-neutral-l1)]'
  return (
    <tr className="transition-colors duration-200 hover:bg-[var(--trae-bg-overlay-l1)]">
      <td
        className={`whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-[var(--trae-text-secondary)] tabular-nums ${borderClass}`}
      >
        {pid}
      </td>
      <td className={`px-3 py-2.5 font-mono text-[11px] text-[var(--trae-text-default)] truncate max-w-[200px] ${borderClass}`}>
        {name}
      </td>
      <td
        className={`text-right whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-[var(--trae-text-default)] tabular-nums ${borderClass}`}
      >
        {cpu.toFixed(1)}%
      </td>
      <td
        className={`text-right whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-[var(--trae-text-default)] tabular-nums ${borderClass}`}
      >
        {mem.toFixed(1)}%
      </td>
      <td className={`whitespace-nowrap px-3 py-2.5 ${borderClass}`}>
        <span
          className="inline-flex items-center gap-1.5 text-[11px]"
          style={{ color: st.color }}
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: st.dot }} />
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

  return (
    <div className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] overflow-hidden">
      {/* 工具栏 */}
      <div className="flex items-center justify-between gap-2 p-2.5 border-b border-[var(--trae-border-neutral-l1)]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-semibold text-[var(--trae-text-default)]">进程监控</span>
          <span className="inline-flex items-center px-1.5 h-5 whitespace-nowrap text-[11px] bg-[var(--trae-bg-brand-popup)] text-[var(--trae-text-brand)] rounded-[var(--trae-radius-2)]">
            TOP 5 CPU
          </span>
          {processCount !== null && (
            <span className="inline-flex items-center px-1.5 h-5 whitespace-nowrap text-[10px] bg-[var(--trae-bg-overlay-l3)] text-[var(--trae-text-secondary)] rounded-[var(--trae-radius-2)] tabular-nums">
              共 {processCount} 个进程
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={loading || !activeSessionId}
          className="inline-flex items-center justify-center h-8 w-8 bg-[var(--trae-bg-overlay-l2)] border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-4)] cursor-pointer hover:bg-[var(--trae-bg-overlay-l3)] disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="刷新进程列表"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 text-[var(--trae-text-secondary)] ${spinning ? 'animate-spin' : ''}`}
          />
        </button>
      </div>
      {/* 表格 */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[560px]">
          <thead>
            <tr className="bg-[var(--trae-bg-overlay-l1)]">
              <th className="text-left whitespace-nowrap px-3 py-2 text-[10px] font-medium text-[var(--trae-text-tertiary)] tracking-[0.04em] uppercase border-b border-[var(--trae-border-neutral-l1)]">
                PID
              </th>
              <th className="text-left px-3 py-2 text-[10px] font-medium text-[var(--trae-text-tertiary)] tracking-[0.04em] uppercase w-full border-b border-[var(--trae-border-neutral-l1)]">
                进程名
              </th>
              <th className="text-right whitespace-nowrap px-3 py-2 text-[10px] font-medium text-[var(--trae-text-tertiary)] tracking-[0.04em] uppercase border-b border-[var(--trae-border-neutral-l1)]">
                CPU%
              </th>
              <th className="text-right whitespace-nowrap px-3 py-2 text-[10px] font-medium text-[var(--trae-text-tertiary)] tracking-[0.04em] uppercase border-b border-[var(--trae-border-neutral-l1)]">
                内存%
              </th>
              <th className="text-left whitespace-nowrap px-3 py-2 text-[10px] font-medium text-[var(--trae-text-tertiary)] tracking-[0.04em] uppercase border-b border-[var(--trae-border-neutral-l1)]">
                状态
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center">
                  <span className="inline-flex items-center gap-2 text-[11px] text-[var(--trae-text-tertiary)]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    正在获取进程列表...
                  </span>
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-[11px] text-[var(--trae-status-error-default)]">
                  {error}
                </td>
              </tr>
            )}
            {!loading && !error && !activeSessionId && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-[11px] text-[var(--trae-text-tertiary)]">
                  连接服务器后可查看进程列表
                </td>
              </tr>
            )}
            {!loading && !error && activeSessionId && processes.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-[11px] text-[var(--trae-text-tertiary)]">
                  暂无进程数据
                </td>
              </tr>
            )}
            {!loading &&
              processes.map((p, idx) => (
                <ProcessRowComponent
                  key={p.pid}
                  pid={p.pid}
                  name={p.command}
                  cpu={p.cpu}
                  mem={p.mem}
                  status={p.status}
                  isLast={idx === processes.length - 1}
                />
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
