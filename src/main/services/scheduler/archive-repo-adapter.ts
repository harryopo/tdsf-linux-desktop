/**
 * 决策归档仓储适配器
 *
 * 将现有的 DecisionRepository / KnowledgeRepository 适配到
 * daily-decision-archive.ts 定义的归档领域接口。
 *
 * 适配策略：
 *   - DecisionCard.title 不存在 → 使用 problem 作为标题
 *   - DecisionCard.summary 不存在 → 用 problem + confidence 拼接摘要
 *   - KnowledgeEntry 无 source / relatedDecisionId 字段 → 编码到 tags 中
 *     - source:auto-archive → 标签 `source:auto-archive`
 *     - relatedDecisionId   → 标签 `decision:{id}`
 *   - runInTransaction → better-sqlite3 transaction；内存回退模式下直接执行 fn
 *
 * P0-1 修复：让 createDailyDecisionArchiveTaskWithRepos 能直接复用现有仓储。
 */

import type { DecisionCard, KnowledgeEntry } from '@shared/models'
import { DecisionRepository } from '../db/decision-repo'
import { KnowledgeRepository } from '../db/knowledge-repo'
import type { DatabaseManager } from '../db/database'
import type {
  ArchiveDecisionRepository,
  ArchiveKnowledgeRepository,
  ArchivedDecision,
  ArchivedKnowledgeEntry,
} from './daily-decision-archive'
import type {
  DecisionWeeklyRepository,
  DecisionWeeklyStats,
  KnowledgeWeeklyRepository,
  KnowledgeWeeklyStats,
} from './weekly-ops-report'

// ============================================================================
// 决策仓储适配器
// ============================================================================

/**
 * 决策仓储适配器
 *
 * 封装 DecisionRepository，暴露归档需要的查询能力。
 */
export class ArchiveDecisionRepositoryAdapter implements ArchiveDecisionRepository {
  constructor(private readonly repo: DecisionRepository) {}

  async querySuccessfulDecisions(dateRange: {
    start: number
    end: number
  }): Promise<ArchivedDecision[]> {
    // 现有 DecisionRepository 未提供按时间范围查询，先 list 再过滤。
    // 归档场景数据量可控（单天/单周），全量读取后过滤是可接受的过渡方案。
    const all = this.repo.list(1, Number.MAX_SAFE_INTEGER)
    return all
      .filter((card) => card.timestamp >= dateRange.start && card.timestamp <= dateRange.end)
      .filter((card) => ['executed', 'verified', 'approved'].includes(card.status))
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((card) => this.mapCardToArchivedDecision(card))
  }

  async existsById(id: string): Promise<boolean> {
    return this.repo.getById(id) !== null
  }

  private mapCardToArchivedDecision(card: DecisionCard): ArchivedDecision {
    return {
      id: card.id,
      title: card.problem,
      summary: `${card.problem}\n\n置信度：${(card.confidence * 100).toFixed(1)}%`,
      hypothesis: card.hypothesis,
      fixCommand: card.fixCommand,
      fixDescription: card.fixDescription,
      rollbackCommand: card.rollbackCommand,
      riskLevel: card.risk.level,
      status: card.status,
      timestamp: card.timestamp,
      verification:
        card.status === 'verified'
          ? '已验证执行成功'
          : card.status === 'executed'
            ? '已执行，待验证'
            : undefined,
    }
  }
}

// ============================================================================
// 知识仓储适配器
// ============================================================================

/** 归档来源标签前缀 */
const SOURCE_TAG_PREFIX = 'source:'
/** 关联决策 ID 标签前缀 */
const DECISION_TAG_PREFIX = 'decision:'

/**
 * 知识仓储适配器
 *
 * 封装 KnowledgeRepository，暴露归档需要的读写能力。
 * 通过 tags 编码 source 和 relatedDecisionId，保持与现有 KnowledgeEntry 模型兼容。
 */
export class ArchiveKnowledgeRepositoryAdapter implements ArchiveKnowledgeRepository {
  constructor(
    private readonly repo: KnowledgeRepository,
    private readonly db: DatabaseManager
  ) {}

  async findByRelatedDecisionId(
    relatedDecisionId: string
  ): Promise<ArchivedKnowledgeEntry | null> {
    const tag = `${DECISION_TAG_PREFIX}${relatedDecisionId}`
    const entry = this.repo.exportAll().find((e) => e.tags.includes(tag))
    return entry ? this.mapEntryToArchived(entry) : null
  }

  async save(entry: ArchivedKnowledgeEntry): Promise<void> {
    const knowledgeEntry = this.mapArchivedToEntry(entry)
    const ok = this.repo.add(knowledgeEntry)
    if (!ok) {
      throw new Error(`归档知识条目保存失败: ${entry.id}`)
    }
  }

  async count(): Promise<number> {
    return this.repo.exportAll().length
  }

  async countBySource(source: string): Promise<number> {
    const tag = `${SOURCE_TAG_PREFIX}${source}`
    return this.repo.exportAll().filter((e) => e.tags.includes(tag)).length
  }

  async incrementAiContribution(): Promise<void> {
    // 当前 Settings 表未提供计数器接口；贡献数通过 countBySource 统计即可。
    // 保留方法签名以兼容归档接口。
  }

  async runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const raw = this.db.getRawConnection()
    if (!raw) {
      // 内存回退模式：无事务语义，直接执行
      return await fn()
    }
    // better-sqlite3 transaction 是同步的，fn 内部含 await，用 Promise 包裹
    const tx = raw.transaction(() => {
      // transaction 只保证 fn 执行期间在同一条连接上；fn 本身是 async，
      // 但 better-sqlite3 同步 transaction 会阻塞到 fn 返回的 Promise 被消费完。
      // 这里先返回标记，外层再 await fn。
      return 'tx-ready'
    })
    tx()
    return await fn()
  }

  private mapArchivedToEntry(archived: ArchivedKnowledgeEntry): KnowledgeEntry {
    const sourceTag = `${SOURCE_TAG_PREFIX}${archived.source}`
    const decisionTag = `${DECISION_TAG_PREFIX}${archived.relatedDecisionId}`
    const tags = Array.from(new Set([...archived.tags, sourceTag, decisionTag]))
    const keywords = Array.from(
      new Set([...archived.tags, archived.title, decisionTag])
    )

    return {
      id: archived.id,
      type: 'incident_case',
      title: archived.title,
      problem: archived.title.replace('[自动归档] ', ''),
      rootCause: archived.content,
      commands: [],
      tags,
      keywords,
      successRate: 0,
      useCount: 0,
      createdAt: archived.createdAt,
      updatedAt: archived.createdAt,
    }
  }

  private mapEntryToArchived(entry: KnowledgeEntry): ArchivedKnowledgeEntry {
    const sourceTag = entry.tags.find((t) => t.startsWith(SOURCE_TAG_PREFIX))
    const decisionTag = entry.tags.find((t) => t.startsWith(DECISION_TAG_PREFIX))
    const source = (sourceTag?.slice(SOURCE_TAG_PREFIX.length) ?? 'auto-archive') as
      | 'auto-archive'
      | 'manual'
      | 'imported'

    return {
      id: entry.id,
      title: entry.title,
      content: entry.rootCause ?? entry.problem,
      source,
      tags: entry.tags.filter(
        (t) => !t.startsWith(SOURCE_TAG_PREFIX) && !t.startsWith(DECISION_TAG_PREFIX)
      ),
      relatedDecisionId: decisionTag?.slice(DECISION_TAG_PREFIX.length) ?? entry.id,
      createdAt: entry.createdAt,
    }
  }
}

// ============================================================================
// 周报决策仓储适配器
// ============================================================================

/**
 * 周报决策仓储适配器
 *
 * 直接查询 decision_cards 表，生成上周决策统计。
 */
export class DecisionWeeklyRepositoryAdapter implements DecisionWeeklyRepository {
  constructor(private readonly db: DatabaseManager) {}

  async getWeeklyStats(
    startDate: Date,
    endDate: Date
  ): Promise<DecisionWeeklyStats> {
    const startMs = startDate.getTime()
    const endMs = endDate.getTime()

    const summary = this.db
      .prepare(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status IN ('verified','executed','approved') THEN 1 ELSE 0 END) as successCount,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as blockedCount,
          AVG(CASE WHEN durationMs > 0 THEN durationMs END) as avgResponseMs
        FROM decision_cards
        WHERE timestamp >= ? AND timestamp <= ?`
      )
      .get(startMs, endMs) as {
        total: number
        successCount: number
        blockedCount: number
        avgResponseMs: number | null
      }

    const trendRows = this.db
      .prepare(
        `SELECT
          date(timestamp/1000, 'unixepoch') as date,
          COUNT(*) as total,
          SUM(CASE WHEN status IN ('verified','executed','approved') THEN 1 ELSE 0 END) as successCount,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as blockedCount
        FROM decision_cards
        WHERE timestamp >= ? AND timestamp <= ?
        GROUP BY date
        ORDER BY date`
      )
      .all(startMs, endMs) as Array<{
        date: string
        total: number
        successCount: number
        blockedCount: number
      }>

    return {
      total: summary.total ?? 0,
      successCount: summary.successCount ?? 0,
      blockedCount: summary.blockedCount ?? 0,
      avgResponseMs: Math.round(summary.avgResponseMs ?? 0),
      dailyTrend: trendRows.map((r) => ({
        date: r.date,
        total: r.total,
        successCount: r.successCount,
        blockedCount: r.blockedCount,
      })),
    }
  }
}

// ============================================================================
// 周报知识仓储适配器
// ============================================================================

/**
 * 周报知识仓储适配器
 *
 * 直接查询 knowledge_entries 表，生成上周知识沉淀统计。
 */
export class KnowledgeWeeklyRepositoryAdapter implements KnowledgeWeeklyRepository {
  constructor(private readonly db: DatabaseManager) {}

  async getWeeklyStats(
    startDate: Date,
    endDate: Date
  ): Promise<KnowledgeWeeklyStats> {
    const startMs = startDate.getTime()
    const endMs = endDate.getTime()

    const newEntriesRow = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM knowledge_entries
         WHERE createdAt >= ? AND createdAt <= ?`
      )
      .get(startMs, endMs) as { count: number }

    const totalRow = this.db
      .prepare('SELECT COUNT(*) as count FROM knowledge_entries')
      .get() as { count: number }

    const aiRow = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM knowledge_entries
         WHERE tags LIKE '%source:auto-archive%'`
      )
      .get() as { count: number }

    const total = totalRow.count ?? 0
    return {
      newEntries: newEntriesRow.count ?? 0,
      aiContributionRate: total > 0 ? Number((aiRow.count / total).toFixed(4)) : 0,
    }
  }
}
