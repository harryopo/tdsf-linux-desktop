/**
 * 决策历史仓储
 *
 * 管理 DecisionCard 决策卡片的持久化存储。
 *
 * 核心功能：
 *   - save(card): 保存决策卡片
 *   - getById(id): 根据 ID 获取
 *   - list(page, pageSize): 分页查询（按时间倒序）
 *   - updateStatus(id, status): 更新状态
 *   - delete(id): 删除
 *   - search(query): 按问题/假设/命令搜索
 *
 * 序列化策略：
 *   - evidences（证据数组）→ JSON.stringify
 *   - risk（风险评估对象）→ JSON.stringify
 *
 * 参考：_legacy-python/src/tdsf_desktop/storage/schemas.py
 */

import type { DatabaseManager } from './database'
import type { DecisionCard, Evidence, RiskAssessment } from '@shared/models'

/** 默认每页数量 */
const DEFAULT_PAGE_SIZE = 20

/**
 * 决策历史仓储
 */
export class DecisionRepository {
  /** 数据库管理器 */
  private readonly db: DatabaseManager

  /**
   * @param db DatabaseManager 实例
   */
  constructor(db: DatabaseManager) {
    this.db = db
  }

  /**
   * 保存决策卡片
   *
   * 如果 ID 已存在则覆盖更新（INSERT OR REPLACE）。
   *
   * @param card 决策卡片
   * @returns true 表示保存成功
   */
  save(card: DecisionCard): boolean {
    try {
      const serialized = this.serialize(card)
      this.db
        .prepare(
          `INSERT OR REPLACE INTO decision_cards
           (id, problem, hypothesis, evidences, confidence, risk,
            fixCommand, fixDescription, rollbackCommand, status,
            timestamp, sessionId)
           VALUES (@id, @problem, @hypothesis, @evidences, @confidence, @risk,
                   @fixCommand, @fixDescription, @rollbackCommand, @status,
                   @timestamp, @sessionId)`
        )
        .run(serialized)
      return true
    } catch {
      return false
    }
  }

  /**
   * 根据 ID 获取决策卡片
   * @param id 卡片 ID
   * @returns 决策卡片，不存在返回 null
   */
  getById(id: string): DecisionCard | null {
    const row = this.db
      .prepare('SELECT * FROM decision_cards WHERE id = ?')
      .get(id) as DecisionRow | undefined
    return row ? this.deserialize(row) : null
  }

  /**
   * 分页查询决策卡片
   *
   * 按时间戳降序排列（最新的在前）。
   *
   * @param page 页码（从 1 开始，默认 1）
   * @param pageSize 每页数量（默认 20）
   * @returns 决策卡片数组
   */
  list(page: number = 1, pageSize: number = DEFAULT_PAGE_SIZE): DecisionCard[] {
    const offset = Math.max(0, (page - 1) * pageSize)
    const rows = this.db
      .prepare(
        `SELECT * FROM decision_cards
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`
      )
      .all(pageSize, offset) as DecisionRow[]
    return rows.map((r) => this.deserialize(r))
  }

  /**
   * 更新决策卡片状态
   *
   * @param id 卡片 ID
   * @param status 新状态
   * @returns true 表示更新成功
   */
  updateStatus(id: string, status: DecisionCard['status']): boolean {
    try {
      const result = this.db
        .prepare('UPDATE decision_cards SET status = ? WHERE id = ?')
        .run(status, id)
      return result.changes > 0
    } catch {
      return false
    }
  }

  /**
   * 删除决策卡片
   * @param id 卡片 ID
   * @returns true 表示删除成功
   */
  delete(id: string): boolean {
    try {
      const result = this.db
        .prepare('DELETE FROM decision_cards WHERE id = ?')
        .run(id)
      return result.changes > 0
    } catch {
      return false
    }
  }

  /**
   * 搜索决策卡片
   *
   * 在 problem / hypothesis / fixCommand 三个字段中搜索关键词。
   *
   * @param query 搜索关键词
   * @returns 匹配的决策卡片数组（按时间倒序）
   */
  search(query: string): DecisionCard[] {
    if (!query.trim()) return []
    const pattern = `%${query}%`
    const rows = this.db
      .prepare(
        `SELECT * FROM decision_cards
         WHERE problem LIKE ? OR hypothesis LIKE ? OR fixCommand LIKE ?
         ORDER BY timestamp DESC`
      )
      .all(pattern, pattern, pattern) as DecisionRow[]
    return rows.map((r) => this.deserialize(r))
  }

  // ────────── 内部方法 ──────────

  /**
   * 序列化决策卡片
   * @param card 决策卡片
   * @returns 序列化后的对象
   */
  private serialize(card: DecisionCard): SerializedDecisionRow {
    return {
      id: card.id,
      problem: card.problem,
      hypothesis: card.hypothesis,
      evidences: JSON.stringify(card.evidences),
      confidence: card.confidence,
      risk: JSON.stringify(card.risk),
      fixCommand: card.fixCommand,
      fixDescription: card.fixDescription ?? null,
      rollbackCommand: card.rollbackCommand ?? null,
      status: card.status,
      timestamp: card.timestamp,
      sessionId: card.sessionId ?? null
    }
  }

  /**
   * 反序列化数据库行
   * @param row 数据库行
   * @returns 决策卡片
   */
  private deserialize(row: DecisionRow): DecisionCard {
    return {
      id: row.id,
      problem: row.problem,
      hypothesis: row.hypothesis,
      evidences: safeParseArray(row.evidences) as Evidence[],
      confidence: row.confidence,
      risk: safeParseObject(row.risk) as unknown as RiskAssessment,
      fixCommand: row.fixCommand,
      fixDescription: row.fixDescription ?? '',
      rollbackCommand: row.rollbackCommand ?? undefined,
      status: row.status as DecisionCard['status'],
      timestamp: row.timestamp,
      sessionId: row.sessionId ?? undefined
    }
  }
}

// ────────── 工具函数 ──────────

/**
 * 安全解析 JSON 数组
 * @param json JSON 字符串
 * @returns 数组，解析失败返回空数组
 */
function safeParseArray(json: string): unknown[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * 安全解析 JSON 对象
 * @param json JSON 字符串
 * @returns 对象，解析失败返回默认空对象
 */
function safeParseObject(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json)
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

/** 数据库行类型（原始字段） */
interface DecisionRow {
  id: string
  problem: string
  hypothesis: string
  evidences: string
  confidence: number
  risk: string
  fixCommand: string
  fixDescription: string | null
  rollbackCommand: string | null
  status: string
  timestamp: number
  sessionId: string | null
}

/** 序列化后的行类型 */
interface SerializedDecisionRow {
  id: string
  problem: string
  hypothesis: string
  evidences: string
  confidence: number
  risk: string
  fixCommand: string
  fixDescription: string | null
  rollbackCommand: string | null
  status: string
  timestamp: number
  sessionId: string | null
}
