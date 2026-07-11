/**
 * 证据溯源校验模块（Ground-Check）
 *
 * 验证证据确实来自真实的工具调用（SSH 命令执行、监控数据采集等），
 * 而非 LLM 凭空编造。这是 TDSF 可信决策框架的核心防线之一。
 *
 * 校验逻辑：
 *   1. 证据内容必须在某条工具调用记录的输出中出现（内容匹配）
 *   2. 证据来源描述必须与工具调用的输入/工具名相关（来源匹配）
 *   3. 证据时间戳不早于工具调用时间戳（时序合理）
 */

import type { Evidence, EvidenceSource } from '../../shared/models'

/** 工具调用记录 */
export interface ToolCallRecord {
  /** 工具/命令名称（如 "ssh_exec", "cat", "free"） */
  toolName: string
  /** 工具输入（如执行的命令参数或文件路径） */
  input: string
  /** 工具输出 */
  output: string
  /** 调用时间戳（毫秒） */
  timestamp: number
  /** 会话 ID */
  sessionId: string
}

/**
 * 验证单条证据是否来自真实工具调用
 * @param evidence - 待验证的证据
 * @param toolCallLog - 工具调用记录列表
 * @returns true 表示验证通过（证据有真实来源可溯源）
 */
export function verifyEvidence(evidence: Evidence, toolCallLog: ToolCallRecord[]): boolean {
  // knowledge 类型不依赖工具调用，直接通过（需在空日志检查之前）
  if (evidence.source === 'knowledge') return true
  if (toolCallLog.length === 0) return false
  for (const record of toolCallLog) {
    if (isEvidenceFromToolCall(evidence, record)) return true
  }
  return false
}

/**
 * 批量验证证据，返回带有 verified 标记的证据列表
 * @param evidences - 待验证的证据列表
 * @param toolCallLog - 工具调用记录列表
 * @returns 每条证据的 verified 字段已更新的新列表
 */
export function verifyAllEvidences(
  evidences: Evidence[],
  toolCallLog: ToolCallRecord[]
): Evidence[] {
  return evidences.map((evidence) => ({
    ...evidence,
    verified: verifyEvidence(evidence, toolCallLog)
  }))
}

/**
 * 判断单条证据是否来自指定的工具调用记录
 * 需同时满足：内容匹配 + 来源匹配 + 时序合理
 * @param evidence - 证据
 * @param record - 工具调用记录
 * @returns true 表示证据可溯源到此记录
 */
function isEvidenceFromToolCall(evidence: Evidence, record: ToolCallRecord): boolean {
  const contentMatched = matchesContent(evidence.content, record.output)
  const sourceMatched = matchesSource(evidence, record)
  const timeValid = evidence.timestamp >= record.timestamp
  return contentMatched && sourceMatched && timeValid
}

/**
 * 检查证据内容是否出现在工具输出中
 * 支持完全包含和前缀片段匹配（取内容前 30 个字符）
 * @param content - 证据内容
 * @param output - 工具输出
 * @returns true 表示内容匹配
 */
function matchesContent(content: string, output: string): boolean {
  if (!content || !output) return false
  if (output.includes(content)) return true
  const snippet = content.slice(0, 30).trim()
  return snippet.length > 0 && output.includes(snippet)
}

/**
 * 检查证据来源是否与工具调用相关
 * @param evidence - 证据
 * @param record - 工具调用记录
 * @returns true 表示来源相关
 */
function matchesSource(evidence: Evidence, record: ToolCallRecord): boolean {
  // 工具输入包含来源描述（如 input="/var/log/syslog" 匹配 sourceDetail）
  if (evidence.sourceDetail && record.input.includes(evidence.sourceDetail)) return true
  // 来源描述包含工具名
  if (evidence.sourceDetail && evidence.sourceDetail.includes(record.toolName)) return true
  // 来源类型与工具名匹配
  return sourceTypeMatchesTool(evidence.source, record.toolName)
}

/**
 * 判断证据来源类型是否与工具名匹配
 * @param source - 证据来源类型
 * @param toolName - 工具名
 * @returns true 表示类型匹配
 */
function sourceTypeMatchesTool(source: EvidenceSource, toolName: string): boolean {
  const tool = toolName.toLowerCase()
  switch (source) {
    case 'log':
      return /cat|tail|head|journalctl|grep|less|dmesg|zcat|awk|sed/i.test(tool)
    case 'metric':
      return /free|df|ps|top|stat|uptime|vmstat|iostat|sar|mpstat/i.test(tool)
    case 'command':
      return /exec|run|ssh|sh|bash|shell/i.test(tool)
    case 'config':
      return /cat|grep|find|stat|ls/i.test(tool)
    case 'knowledge':
      return true
    default:
      return false
  }
}
