/**
 * LogsPage v1 复刻组件 — Mock 数据 + 类型定义
 *
 * 设计稿：tdsf-linux-redesign/pages/logs.html
 *
 * 数据：
 *   - 9 个日志源（5 主类 + 1 个分隔 + 4 服务器系统日志路径）
 *   - 15 条日志（INFO 11 + WARN 2 + ERROR 1 + DEBUG 1，符合 15-20 条要求）
 *   - 4 项日志级别统计
 */
import type { LucideIcon } from 'lucide-react'
import {
  Terminal,
  Cpu,
  Shield,
  AlertTriangle,
  FileText,
  Lock,
  Sparkles,
} from 'lucide-react'
import type { LogStats } from '@shared/models'

// ==================== 类型定义 ====================

/** 日志级别 */
export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

/** 日志源分组（主类 vs 服务器系统日志路径） */
export type LogSourceGroup = 'main' | 'system'

/** 日志源条目（左侧 nav） */
export interface LogSourceItem {
  id: string
  label: string
  /**
   * 条数。真实条数由 LogsPage 按当前日志与远程读取结果算出后传入；
   * 这里不再预置设计稿写的假条数（原为 '1,247' / '3.2k' 之类）。
   */
  count?: string
  group: LogSourceGroup
  icon: LucideIcon
  /** 告警色（如 /var/log/nginx/error.log 用 alert 色） */
  alert?: boolean
}

/** 单条日志条目 */
export interface LogEntry {
  id: number
  timestamp: string // "14:23:01.234"
  level: LogLevel
  source: string // "ai-agent" / "collector" / ...
  message: string
}

/** 日志级别统计（浮动卡） */
export interface LevelStat {
  level: LogLevel
  count: number
  /** 级别对应的语义色 token（INFO/WARN/ERROR/DEBUG 各自的颜色） */
  color: string
}

// ==================== 日志源白名单 ====================

/** 日志源列表（10 项 = 5 主类 + 5 服务器系统日志路径）；条数一律由页面按真实读取结果填 */
export const LOG_SOURCES: LogSourceItem[] = [
  // 主类（5 项：系统/应用/安全/AI决策/告警，与设计稿 1:1）
  { id: 'system', label: '系统日志', group: 'main', icon: Terminal },
  { id: 'app', label: '应用日志', group: 'main', icon: Cpu },
  { id: 'security', label: '安全日志', group: 'main', icon: Shield },
  { id: 'ai-decision', label: 'AI决策日志', group: 'main', icon: Sparkles },
  { id: 'alert', label: '告警日志', group: 'main', icon: AlertTriangle },
  // 服务器系统日志（5 项）：两套主流发行版的认证日志文件名不同，只列一个
  // 就等于在另一半机器上摆一个永远读不出东西的入口（2026-10-14 真机实测：
  // openEuler 上 /var/log/syslog 与 /var/log/auth.log 都不存在，而 /var/log/secure 有 5816 行）
  { id: 'messages', label: '/var/log/messages', group: 'system', icon: FileText },
  { id: 'syslog', label: '/var/log/syslog', group: 'system', icon: FileText },
  { id: 'auth', label: '/var/log/auth.log', group: 'system', icon: Lock },
  { id: 'secure', label: '/var/log/secure', group: 'system', icon: Lock },
  { id: 'nginx-error', label: '/var/log/nginx/error.log', group: 'system', icon: FileText, alert: true },
]

/**
 * 文件不存在时该说什么：点名发行版差异，而不是"不存在或为空"这种两头都盖的说法。
 *
 * 教学工具的用户不知道 syslog 是 Debian 系的叫法，看到"不存在"只会以为连错了机器。
 */
const MISSING_HINT: Record<string, string> = {
  '/var/log/messages': 'RHEL / CentOS / openEuler 系才有；Debian / Ubuntu 请看 /var/log/syslog',
  '/var/log/syslog': 'Debian / Ubuntu 系才有；RHEL / CentOS / openEuler 请看 /var/log/messages',
  '/var/log/auth.log': 'Debian / Ubuntu 系的认证日志；RHEL / CentOS / openEuler 请看 /var/log/secure',
  '/var/log/secure': 'RHEL / CentOS / openEuler 系的认证日志；Debian / Ubuntu 请看 /var/log/auth.log',
  '/var/log/nginx/error.log': '这台机器上没装 nginx，或 nginx 还没写过错误日志',
}

export function missingLogFileHint(path: string): string {
  return MISSING_HINT[path] ?? '这台机器上没有这个文件'
}

/** 默认激活的日志源 */
export const DEFAULT_LOG_SOURCE_ID = 'system'

/** Level filter 选项（5 项） */
export const LEVEL_FILTERS: Array<{ id: LogLevel | 'ALL'; label: string }> = [
  { id: 'ALL', label: '全部' },
  { id: 'INFO', label: 'INFO' },
  { id: 'WARN', label: 'WARN' },
  { id: 'ERROR', label: 'ERROR' },
  { id: 'DEBUG', label: 'DEBUG' },
]

/** 终端背景色（与设计稿 --log-terminal-bg 一致） */
export const LOG_TERMINAL_BG = '#0F1011'

// ==================== 辅助函数 ====================

/**
 * 获取日志级别对应的语义色 token
 * - INFO → primary（品牌蓝）
 * - WARN → alert（琥珀）
 * - ERROR → error（红）
 * - DEBUG → text-tertiary（灰）
 */
/**
 * 获取日志级别对应的文字色 token
 *
 * 一律取 `--status-*-text`（为"文字压在软背景上"调过的那一档），不取
 * `--trae-status-*-default`（品牌原色）。原色压在 28% 的同色软底上，浅色模式下
 * WARN 那枚 tag 实测 3.4:1，看不清；深色下侥幸过线只是因为原色本身偏亮。
 * 令牌层专门为文字留了一档，用错那一档就是把自己暴露在明暗翻转上。
 */
export function getLevelColor(level: LogLevel): string {
  switch (level) {
    case 'INFO':
      return 'var(--status-info-text)'
    case 'WARN':
      return 'var(--status-warning-text)'
    case 'ERROR':
      return 'var(--status-error-text)'
    case 'DEBUG':
      return 'var(--trae-text-tertiary)'
  }
}

/**
 * 获取日志级别对应的软背景色 token（行背景 + 级别 tag 背景）
 */
export function getLevelSoftColor(level: LogLevel): string {
  switch (level) {
    case 'INFO':
      return 'var(--trae-status-primary-surface-l1)'
    case 'WARN':
      return 'var(--trae-status-alert-surface-l2)'
    case 'ERROR':
      return 'var(--trae-status-error-surface-l2)'
    case 'DEBUG':
      return 'var(--trae-bg-overlay-l1)'
  }
}

// ==================== IPC 返回值适配（v1.0 P0 真实日志流接线） ====================

/**
 * IPC `log:read` 通道返回的原始日志条目结构（与 electron.d.ts logRead 返回类型对齐）。
 *
 * 字段映射（IPC → LogEntry）：
 *   - ts（ISO 字符串 / ms 时间戳）→ timestamp（显示用 HH:mm:ss.SSS）
 *   - level（DEBUG/INFO/WARN/ERROR/FATAL）→ level（FATAL 归并到 ERROR）
 *   - category / source → source（设计稿列宽 104px，超长截断）
 *   - message → message
 *   - date（YYYY-MM-DD）→ 用于 status bar 显示
 *
 * 注意：IPC 返回的 level 可能包含 'FATAL'，本组件 LEVEL_FILTERS 只有 4 档，
 *       FATAL 归并到 ERROR 显示（避免 UI 出现未配置的级别 tab）。
 */
export interface IpcLogEntry {
  ts: string | number
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'
  category?: string
  message: string
  meta?: unknown
  correlationId?: string
  source: string
  date?: string
}

/**
 * 将 IPC 返回的日志条目转换为 LogViewer 可渲染的 LogEntry。
 *
 * @param ipc IPC 返回的原始条目
 * @param idx 序号（用于生成稳定 key，避免同毫秒冲突）
 */
export function ipcLogEntryToLogEntry(ipc: IpcLogEntry, idx: number): LogEntry {
  // 时间戳格式化：IPC 返回 ISO 字符串或 ms 时间戳，统一转为 HH:mm:ss.SSS
  const tsMs = typeof ipc.ts === 'number' ? ipc.ts : new Date(ipc.ts).getTime()
  const d = new Date(tsMs)
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  const timestamp = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`

  // FATAL 归并到 ERROR（LEVEL_FILTERS 只有 4 档）
  const level: LogLevel = ipc.level === 'FATAL' ? 'ERROR' : ipc.level as LogLevel

  // source 优先用 category，回退到 source 字段
  const source = ipc.category || ipc.source || 'system'

  return {
    id: idx + 1,
    timestamp,
    level,
    source,
    message: ipc.message,
  }
}

/**
 * 批量转换 IPC 日志条目数组。
 */
export function ipcLogEntriesToLogEntries(ipcEntries: IpcLogEntry[]): LogEntry[] {
  return ipcEntries.map(ipcLogEntryToLogEntry)
}

/**
 * 将 LogStats IPC 返回值映射为 LevelStat[]（浮动统计卡用）。
 *
 * @param stats 来自 logStats() IPC 的统计数据（byLevel 为 Record<string, number>）
 * @returns 4 项级别统计（INFO/WARN/ERROR/DEBUG），count 来自 byLevel，color 用 token
 *
 * 说明：byLevel 的 key 在后端可能为大写级别名（INFO/WARN/ERROR/DEBUG/FATAL），
 *      这里对每个级别同时尝试大写与小写 key，兼容后端实现差异；FATAL 归并到 ERROR。
 */
export function mapLogStats(stats: LogStats): LevelStat[] {
  const byLevel = stats.byLevel ?? {}
  // 兼容大小写 key（后端可能返回 INFO 或 info）
  const pick = (upper: string, lower: string): number => {
    const v = byLevel[upper] ?? byLevel[lower]
    return typeof v === 'number' ? v : 0
  }
  // FATAL 归并到 ERROR
  const errorCount = pick('ERROR', 'error') + pick('FATAL', 'fatal')
  return [
    { level: 'INFO', count: pick('INFO', 'info'), color: 'var(--trae-bg-brand)' },
    { level: 'WARN', count: pick('WARN', 'warn'), color: 'var(--trae-status-alert-default)' },
    { level: 'ERROR', count: errorCount, color: 'var(--trae-status-error-default)' },
    { level: 'DEBUG', count: pick('DEBUG', 'debug'), color: 'var(--trae-text-tertiary)' },
  ]
}
