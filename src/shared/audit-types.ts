/**
 * 高危命令拦截记录（历史页「拦截记录」区消费）
 *
 * 数据来自 audit_logs 里 action 以「高危命令拦截」开头的那批行。命令文本在写库前
 * 已经过 AuditRepo.log 的脱敏，这里不再二次处理。
 */
export interface BlockedCommandRecord {
  id: string
  /** 记录时间（ms） */
  timestamp: number
  /** 拦截来源：终端输入 / AI 工具 / MCP ... */
  source: string
  /** 被拦下的命令原文（已脱敏） */
  command: string
  /** 拦截原因（规则命中的说明） */
  reason: string
  /** 命中的片段（可能为空） */
  matched: string
  /** 风险等级（block 等） */
  riskLevel: string
}
