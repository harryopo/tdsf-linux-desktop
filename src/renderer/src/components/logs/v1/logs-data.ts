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
} from 'lucide-react'

// ==================== 类型定义 ====================

/** 日志级别 */
export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

/** 日志源分组（主类 vs 服务器系统日志路径） */
export type LogSourceGroup = 'main' | 'system'

/** 日志源条目（左侧 nav） */
export interface LogSourceItem {
  id: string
  label: string
  count: string // "1,247" / "856" / "3.2k"
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
}

// ==================== Mock 数据 ====================

/** 日志源列表（9 项 = 5 主类 + 4 服务器系统日志路径） */
export const LOG_SOURCES: LogSourceItem[] = [
  // 主类（4 项）
  { id: 'system', label: '系统日志', count: '1,247', group: 'main', icon: Terminal },
  { id: 'app', label: '应用日志', count: '856', group: 'main', icon: Cpu },
  { id: 'security', label: '安全日志', count: '43', group: 'main', icon: Shield },
  { id: 'alert', label: '告警日志', count: '18', group: 'main', icon: AlertTriangle },
  // 服务器系统日志（4 项）
  { id: 'messages', label: '/var/log/messages', count: '3.2k', group: 'system', icon: FileText },
  { id: 'syslog', label: '/var/log/syslog', count: '5.8k', group: 'system', icon: FileText },
  { id: 'auth', label: '/var/log/auth.log', count: '421', group: 'system', icon: Lock },
  { id: 'nginx-error', label: '/var/log/nginx/error.log', count: '89', group: 'system', icon: FileText, alert: true },
]

/** 默认激活的日志源 */
export const DEFAULT_LOG_SOURCE_ID = 'system'

/** 日志条目（15 条 = INFO 11 + WARN 2 + ERROR 1 + DEBUG 1，符合 15-20 条要求） */
export const LOG_ENTRIES: LogEntry[] = [
  { id: 1, timestamp: '14:23:01.234', level: 'INFO', source: 'ai-agent', message: '开始分析 nginx P99 延迟异常' },
  { id: 2, timestamp: '14:23:02.567', level: 'INFO', source: 'ai-agent', message: '采集系统指标: CPU 68%, MEM 4.2G, NET 1.2MB/s' },
  { id: 3, timestamp: '14:23:03.123', level: 'INFO', source: 'collector', message: '采集 nginx 状态: worker_connections 10240/10240' },
  { id: 4, timestamp: '14:23:04.456', level: 'WARN', source: 'collector', message: 'worker_connections 已达上限 100%' },
  { id: 5, timestamp: '14:23:05.789', level: 'INFO', source: 'ai-agent', message: '触发推理引擎, 模型: DeepSeek-R1' },
  { id: 6, timestamp: '14:23:08.012', level: 'INFO', source: 'ai-agent', message: '推理完成, 置信度: 0.87, 建议: systemctl restart nginx' },
  { id: 7, timestamp: '14:23:09.345', level: 'INFO', source: 'sandbox', message: '沙箱预演开始' },
  { id: 8, timestamp: '14:23:10.678', level: 'INFO', source: 'sandbox', message: '沙箱预演通过' },
  { id: 9, timestamp: '14:23:11.901', level: 'WARN', source: 'risk-engine', message: '检测到重启操作, 风险等级: 中等' },
  { id: 10, timestamp: '14:23:12.234', level: 'ERROR', source: 'risk-engine', message: '拦截高危命令: rm -rf /var/log/* (非授权)' },
  { id: 11, timestamp: '14:23:13.567', level: 'INFO', source: 'executor', message: '执行命令: sudo systemctl restart nginx' },
  { id: 12, timestamp: '14:23:14.890', level: 'INFO', source: 'executor', message: 'nginx.service restarted successfully' },
  { id: 13, timestamp: '14:23:15.123', level: 'INFO', source: 'verifier', message: '验证: P99 延迟 180ms (阈值 < 200ms)' },
  { id: 14, timestamp: '14:23:16.456', level: 'INFO', source: 'ai-agent', message: '决策完成, 结果: 成功, 耗时: 15.2s' },
  { id: 15, timestamp: '14:23:17.789', level: 'DEBUG', source: 'system', message: '知识库更新: KB-021 匹配次数 +1' },
]

/** 日志级别统计（浮动卡 4 项） */
export const LEVEL_STATS: LevelStat[] = [
  { level: 'INFO', count: 11 },
  { level: 'WARN', count: 2 },
  { level: 'ERROR', count: 1 },
  { level: 'DEBUG', count: 1 },
]

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

/** 最新日志时间戳（status bar 显示） */
export const LATEST_TIMESTAMP = '14:23:17'

/** 系统日志总数（status bar 显示） */
export const TOTAL_LOG_COUNT = '1,247'

// ==================== 辅助函数 ====================

/**
 * 获取日志级别对应的语义色 token
 * - INFO → primary（品牌蓝）
 * - WARN → alert（琥珀）
 * - ERROR → error（红）
 * - DEBUG → text-tertiary（灰）
 */
export function getLevelColor(level: LogLevel): string {
  switch (level) {
    case 'INFO':
      return 'var(--trae-status-primary-default)'
    case 'WARN':
      return 'var(--trae-status-alert-default)'
    case 'ERROR':
      return 'var(--trae-status-error-default)'
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
