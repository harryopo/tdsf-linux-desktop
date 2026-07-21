/**
 * 诊断服务类型定义
 *
 * 定义日志事件、分析结果、检测规则等数据结构。
 */

/**
 * 日志级别
 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'

/**
 * 日志来源（哪个 Sidecar）
 */
export type LogSource = 'sre' | 'analytics' | 'agent' | 'main' | 'renderer'

/**
 * 单条日志事件
 */
export interface LogEvent {
  /** 时间戳（ISO 8601） */
  timestamp: string
  /** 来源 */
  source: LogSource
  /** 级别 */
  level: LogLevel
  /** 原始文本 */
  raw: string
  /** 进程 PID（可选） */
  pid?: number
}

/**
 * 检测规则严重性
 */
export type Severity = 'info' | 'warning' | 'error' | 'critical'

/**
 * 检测规则类别
 */
export type DiagnosticCategory =
  | 'port_conflict'      // 端口冲突
  | 'dependency_missing' // 依赖缺失
  | 'python_exception'   // Python 异常
  | 'import_error'       // import 错误
  | 'uvicorn_error'      // Uvicorn/FastAPI 启动失败
  | 'sidecar_crash'      // Sidecar 崩溃
  | 'health_check_fail'  // 健康检查失败
  | 'llm_config_error'   // LLM 配置错误
  | 'module_not_found'   // 模块找不到
  | 'timeout'            // 超时
  | 'unknown'

/**
 * 检测规则
 */
export interface DiagnosticRule {
  /** 规则 ID */
  id: string
  /** 类别 */
  category: DiagnosticCategory
  /** 严重性 */
  severity: Severity
  /** 规则描述 */
  description: string
  /** 正则匹配模式 */
  pattern: RegExp
  /** 修复建议 */
  remediation?: string
}

/**
 * 诊断结果
 */
export interface DiagnosticFinding {
  /** 规则 ID */
  ruleId: string
  /** 类别 */
  category: DiagnosticCategory
  /** 严重性 */
  severity: Severity
  /** 命中的日志行 */
  matchedLine: string
  /** 来源 */
  source: LogSource
  /** 时间戳 */
  timestamp: string
  /** 修复建议 */
  remediation?: string
  /** 规则描述 */
  description: string
}

/**
 * 诊断报告
 */
export interface DiagnosticReport {
  /** 报告生成时间 */
  generatedAt: string
  /** 总日志数 */
  totalLogs: number
  /** 总检测结果数 */
  totalFindings: number
  /** 按严重性分组 */
  bySeverity: Record<Severity, number>
  /** 按类别分组 */
  byCategory: Record<DiagnosticCategory, number>
  /** 按来源分组 */
  bySource: Record<LogSource, number>
  /** 检测结果列表 */
  findings: DiagnosticFinding[]
  /** 汇总结论 */
  summary: string
  /** 是否健康（无 critical/error） */
  healthy: boolean
}

/**
 * 实时日志推送事件（通过 IPC 推送到渲染进程）
 */
export interface LogPushEvent {
  /** 日志事件 */
  event: LogEvent
  /** 是否触发检测规则 */
  hasFinding: boolean
  /** 若触发，关联的检测结果 */
  finding?: DiagnosticFinding
}
