/**
 * 审计日志模块
 *
 * 记录所有运维操作的审计日志，满足 TDSF 框架的 L4 审计要求。
 *
 * 审计范围：
 *   - SSH 命令执行（含退出码、耗时）
 *   - 修复命令执行（含风险评估等级）
 *   - 决策卡片状态变更
 *   - 用户登录/登出
 *
 * 核心功能：
 *   - log(entry): 记录一条审计日志
 *   - query(filters): 按条件查询日志
 *   - clearOldLogs(days): 清理 N 天前的日志
 *
 * 参考：_legacy-python/src/tdsf_desktop/storage/schemas.py
 */

import type { DatabaseManager } from './database'
import type { RiskLevel } from '@shared/models'

/**
 * 审计日志条目
 */
export interface AuditLogEntry {
  /** 日志 ID */
  id: string
  /** 时间戳（毫秒） */
  timestamp: number
  /** 操作类型（如 'ssh_exec', 'fix_execute', 'decision_update'） */
  action: string
  /** 执行的命令（可选） */
  command?: string
  /** 退出码（可选，0 表示成功） */
  exitCode?: number
  /** 用户 ID（可选） */
  userId?: string
  /** 会话 ID（可选） */
  sessionId?: string
  /** 风险等级（可选） */
  riskLevel?: RiskLevel
  /** 详细信息（JSON 字符串，可选） */
  details?: string
}

/**
 * 审计日志查询过滤条件
 */
export interface AuditLogQuery {
  /** 起始时间戳（毫秒，可选） */
  startTime?: number
  /** 结束时间戳（毫秒，可选） */
  endTime?: number
  /** 操作类型（可选） */
  action?: string
  /** 会话 ID（可选） */
  sessionId?: string
  /** 风险等级（可选） */
  riskLevel?: RiskLevel
  /** 返回数量上限（默认 100） */
  limit?: number
}

/** 默认查询数量上限 */
const DEFAULT_QUERY_LIMIT = 100

/**
 * 审计日志记录器
 *
 * 所有方法都依赖外部注入的 DatabaseManager 实例。
 */
export class AuditLogger {
  /** 数据库管理器 */
  private readonly db: DatabaseManager

  /**
   * @param db DatabaseManager 实例
   */
  constructor(db: DatabaseManager) {
    this.db = db
  }

  /**
   * 记录一条审计日志
   *
   * @param entry 日志条目
   */
  log(entry: AuditLogEntry): void {
    try {
      this.db
        .prepare(
          `INSERT INTO audit_logs
           (id, timestamp, action, command, exitCode, userId, sessionId, riskLevel, details)
           VALUES (@id, @timestamp, @action, @command, @exitCode, @userId, @sessionId, @riskLevel, @details)`
        )
        .run({
          id: entry.id,
          timestamp: entry.timestamp,
          action: entry.action,
          command: entry.command ?? null,
          exitCode: entry.exitCode ?? null,
          userId: entry.userId ?? null,
          sessionId: entry.sessionId ?? null,
          riskLevel: entry.riskLevel ?? null,
          details: entry.details ?? null
        })
    } catch {
      // 审计日志失败不应影响主流程，静默忽略
    }
  }

  /**
   * 查询审计日志
   *
   * 支持按时间范围、操作类型、会话 ID、风险等级过滤。
   * 按时间戳降序排列（最新的在前）。
   *
   * @param filters 过滤条件
   * @returns 日志条目数组
   */
  query(filters: AuditLogQuery): AuditLogEntry[] {
    const conditions: string[] = []
    const params: Record<string, unknown> = {}

    if (filters.startTime !== undefined) {
      conditions.push('timestamp >= @startTime')
      params.startTime = filters.startTime
    }
    if (filters.endTime !== undefined) {
      conditions.push('timestamp <= @endTime')
      params.endTime = filters.endTime
    }
    if (filters.action) {
      conditions.push('action = @action')
      params.action = filters.action
    }
    if (filters.sessionId) {
      conditions.push('sessionId = @sessionId')
      params.sessionId = filters.sessionId
    }
    if (filters.riskLevel) {
      conditions.push('riskLevel = @riskLevel')
      params.riskLevel = filters.riskLevel
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = filters.limit ?? DEFAULT_QUERY_LIMIT

    const sql = `SELECT * FROM audit_logs ${whereClause} ORDER BY timestamp DESC LIMIT ${limit}`
    const rows = this.db.prepare(sql).all(params) as AuditRow[]
    return rows.map((r) => this.deserialize(r))
  }

  /**
   * 清理 N 天前的日志
   *
   * @param days 保留天数（清理此天数之前的日志）
   * @returns 删除的日志数量
   */
  clearOldLogs(days: number): number {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    try {
      const result = this.db
        .prepare('DELETE FROM audit_logs WHERE timestamp < ?')
        .run(cutoff)
      return result.changes
    } catch {
      return 0
    }
  }

  // ────────── 内部方法 ──────────

  /**
   * 反序列化数据库行
   * @param row 数据库行
   * @returns 审计日志条目
   */
  private deserialize(row: AuditRow): AuditLogEntry {
    return {
      id: row.id,
      timestamp: row.timestamp,
      action: row.action,
      command: row.command ?? undefined,
      exitCode: row.exitCode ?? undefined,
      userId: row.userId ?? undefined,
      sessionId: row.sessionId ?? undefined,
      riskLevel: (row.riskLevel as RiskLevel | null) ?? undefined,
      details: row.details ?? undefined
    }
  }
}

/** 数据库行类型 */
interface AuditRow {
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
