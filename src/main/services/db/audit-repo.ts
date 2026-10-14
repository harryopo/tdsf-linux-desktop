/**
 * 审计日志仓储（audit_logs 表的唯一读写口）
 *
 * 背景：audit_logs 建表语句一直有（database.ts），但全仓没有任何 INSERT，
 * 所以风险控制页那四个「记录命令执行 / 文件修改 / AI 决策 / SSH 连接」开关
 * 是纯粹的摆设——拨什么都不影响行为。这个模块把表接上，四把开关改由这里读。
 *
 * 三条硬规矩：
 * 1. **写失败不许把业务带崩**。数据库降级（A4 之后降级是可见的、不再静默）时
 *    log() 返回 false 就完事，调用方不需要 try/catch，也不能因为记不上日志就拒绝执行命令。
 * 2. **开关只影响记不记，不影响做不做**。关掉「记录命令执行」不等于放行高危命令——
 *    拦截由 command-gate 独立决定，这里是 fail-closed 的另一半。
 * 3. 时间戳统一用毫秒（与 idx_audit_timestamp 上的保留期计算配套）。
 */
import { randomUUID } from 'node:crypto'
import type { DatabaseManager } from './database'
import { ConfigStore } from '../storage/config-store'
// 审计本身写失败时必须留痕：裸 console.warn 在打包后的 Windows 里等于什么都没发生
import { logger } from '../log/logger'
// 唯一的脱敏实现住在 services/security（providers/redact 那份是它的再导出，避免两处规则表）
import { redactSecrets } from '../security/redact'

/** 审计类别，与设置页四个开关一一对应 */
export type AuditCategory = 'cmd_exec' | 'file_mod' | 'ai_decision' | 'ssh_conn'

/** 类别 -> 设置页那个开关的配置键 */
const CATEGORY_CONFIG_KEY: Record<AuditCategory, string> = {
  cmd_exec: 'risk.auditCmdExec',
  file_mod: 'risk.auditFileMod',
  ai_decision: 'risk.auditAiDecision',
  ssh_conn: 'risk.auditSshConn',
}

/** 审计保留天数配置键（设置页只读展示项，这里真的按它清理） */
export const AUDIT_RETENTION_KEY = 'risk.auditRetention'
export const AUDIT_RETENTION_DEFAULT_DAYS = 180

export interface AuditInput {
  category: AuditCategory
  /** 人类可读的动作描述，如「SSH 执行」/「AI 决策确认」 */
  action: string
  command?: string
  exitCode?: number | null
  userId?: string
  sessionId?: string
  riskLevel?: string
  /** 结构化补充，序列化进 details 列 */
  details?: Record<string, unknown>
}

export interface AuditRow {
  id: string
  timestamp: number
  action: string
  command: string | null
  exitCode: number | null
  userId: string | null
  sessionId: string | null
  riskLevel: string | null
  details: string | null
}

/** 该类别是否要记。缺省全开：没配过设置的新用户应该有完整审计 */
export function isAuditCategoryEnabled(category: AuditCategory, raw?: unknown): boolean {
  const value = raw === undefined ? readConfig(CATEGORY_CONFIG_KEY[category]) : raw
  return value !== false
}

function readConfig(key: string): unknown {
  try {
    return ConfigStore.get(key)
  } catch {
    // 主进程启动早期或测试环境里 ConfigStore 可能还没就绪：按默认开处理
    return undefined
  }
}

export class AuditRepo {
  constructor(private readonly db: DatabaseManager) {}

  /**
   * 记一条审计。返回 true = 真的落库了；false = 被开关关掉或库不可用/写失败。
   * 不抛异常：审计是旁路，不能反过来挡住业务。
   */
  log(input: AuditInput): boolean {
    if (!isAuditCategoryEnabled(input.category)) return false
    if (!this.db.isAvailable()) return false
    try {
      this.db
        .prepare(
          `INSERT INTO audit_logs
             (id, timestamp, action, command, exitCode, userId, sessionId, riskLevel, details)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          Date.now(),
          `${input.category}:${input.action}`,
          // 审计表是"用户回头读自己历史"的地方，里面存的命令原文可以是
          // `mysql -u root password=...`。此前只有 file_mod 那一格手工脱敏
          // （ipc/ssh.ts:527），cmd_exec / ai_decision 两格走的是原文——同一张表两种口径。
          // 收口挪到写库这一处：四个类别与以后新增的类别都受管，不靠调用点自觉。
          input.command === undefined ? null : redactSecrets(input.command),
          input.exitCode ?? null,
          input.userId ?? null,
          input.sessionId ?? null,
          input.riskLevel ?? null,
          input.details ? redactSecrets(JSON.stringify(input.details)) : null,
        )
      return true
    } catch (err) {
      logger.warn('DB', '写审计日志失败（业务继续）', { error: (err as Error).message })
      return false
    }
  }

  /** 最近的审计记录（倒序）。库不可用返回空数组，不抛。 */
  list(limit = 200): AuditRow[] {
    if (!this.db.isAvailable()) return []
    try {
      const rows = this.db
        .prepare(
          `SELECT id, timestamp, action, command, exitCode, userId, sessionId, riskLevel, details
             FROM audit_logs ORDER BY timestamp DESC LIMIT ?`,
        )
        .all(limit) as AuditRow[]
      return rows
    } catch (err) {
      logger.warn('DB', '读审计日志失败', { error: (err as Error).message })
      return []
    }
  }

  /**
   * 按保留期清理旧记录，返回删掉的条数。
   * 保留天数取 risk.auditRetention（脏值/越界回默认 180 天）。
   */
  pruneExpired(now = Date.now()): number {
    const days = resolveRetentionDays(ConfigStore.get(AUDIT_RETENTION_KEY))
    if (!this.db.isAvailable()) return 0
    try {
      const info = this.db
        .prepare('DELETE FROM audit_logs WHERE timestamp < ?')
        .run(now - days * 24 * 60 * 60 * 1000)
      return Number(info.changes ?? 0)
    } catch (err) {
      logger.warn('DB', '清理审计日志失败', { error: (err as Error).message })
      return 0
    }
  }
}

/** 保留天数：只认正整数，其余回默认（和确认超时一个口径，别把表清光） */
export function resolveRetentionDays(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return AUDIT_RETENTION_DEFAULT_DAYS
  const days = Math.round(raw)
  return days >= 1 && days <= 3650 ? days : AUDIT_RETENTION_DEFAULT_DAYS
}
