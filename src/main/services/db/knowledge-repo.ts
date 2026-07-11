/**
 * 知识库仓储
 *
 * 管理知识库的增删改查、搜索（关键词/向量）、批量导入导出。
 *
 * 知识双轨制（参考 TDSF 框架）：
 *   - command_skill（操作能力）：标准化运维操作手册
 *   - incident_case（故障案例）：历史故障处理案例
 *
 * 搜索算法：
 *   - 关键词搜索：Jaccard 相似度（keywords 集合的交集/并集）
 *   - 向量搜索：sqlite-vec 扩展（不可用时降级到关键词搜索）
 *
 * 自动去重：
 *   导入时对相似度 > 0.6 的条目进行合并（保留使用次数和成功率更高的版本）。
 *   参考 ITOps Agent Platform 的 KnowledgeEngine.mergeSimilarEntries
 *
 * 序列化策略：
 *   commands / keywords / tags / rollbackCommands / embedding 使用 JSON.stringify 存储
 *
 * 参考：_legacy-python/src/tdsf_desktop/storage/schemas.py
 */

import type { DatabaseManager } from './database'
import type { KnowledgeEntry, KnowledgeType } from '@shared/models'

/** Jaccard 相似度去重阈值 */
const DEDUP_THRESHOLD = 0.6

/** 默认搜索结果数量 */
const DEFAULT_SEARCH_LIMIT = 10

/**
 * 知识库仓储
 *
 * 所有方法都依赖外部注入的 DatabaseManager 实例（便于测试 mock）。
 */
export class KnowledgeRepository {
  /** 数据库管理器 */
  private readonly db: DatabaseManager

  /**
   * @param db DatabaseManager 实例
   */
  constructor(db: DatabaseManager) {
    this.db = db
  }

  /**
   * 关键词搜索（Jaccard 相似度）
   *
   * 将查询字符串分词后与每条知识的 keywords 集合计算 Jaccard 相似度，
   * 按相似度降序返回。
   *
   * @param query 查询字符串
   * @param type 知识类型过滤（可选）
   * @param limit 返回数量上限
   * @returns 匹配的知识条目数组（按相似度降序）
   */
  search(query: string, type?: KnowledgeType, limit: number = DEFAULT_SEARCH_LIMIT): KnowledgeEntry[] {
    const queryKeywords = this.tokenize(query)
    if (queryKeywords.length === 0) {
      return []
    }
    const querySet = new Set(queryKeywords)

    // 查询所有候选条目（按 type 过滤）
    const rows = type
      ? this.db.prepare('SELECT * FROM knowledge_entries WHERE type = ?').all(type)
      : this.db.prepare('SELECT * FROM knowledge_entries').all()

    // 计算每条目与查询的 Jaccard 相似度
    const scored: Array<{ entry: KnowledgeEntry; score: number }> = []
    for (const row of rows as KnowledgeRow[]) {
      const entry = this.deserialize(row)
      const entrySet = new Set(entry.keywords)
      const score = jaccardSimilarity(querySet, entrySet)
      if (score > 0) {
        scored.push({ entry, score })
      }
    }

    // 按相似度降序排序，取前 limit 条
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit).map((s) => s.entry)
  }

  /**
   * 向量搜索
   *
   * 使用 sqlite-vec 扩展进行 KNN 搜索。
   * 当扩展不可用或查询向量缺失时降级到关键词搜索。
   *
   * @param queryEmbedding 查询向量
   * @param limit 返回数量上限
   * @returns 匹配的知识条目数组
   */
  searchByVector(queryEmbedding: number[], limit: number = DEFAULT_SEARCH_LIMIT): KnowledgeEntry[] {
    // 向量扩展不可用 → 降级（返回空数组，调用方应改用关键词搜索）
    if (!this.db.isVectorEnabled()) {
      return []
    }
    try {
      // sqlite-vec 的 vec_distance_cosine 函数计算余弦距离
      const queryVec = JSON.stringify(queryEmbedding)
      const rows = this.db
        .prepare(
          `SELECT * FROM knowledge_entries
           WHERE embedding IS NOT NULL
           ORDER BY vec_distance_cosine(embedding, ?) ASC
           LIMIT ?`
        )
        .all(queryVec, limit) as KnowledgeRow[]
      return rows.map((r) => this.deserialize(r))
    } catch {
      // 向量查询失败 → 降级返回空数组
      return []
    }
  }

  /**
   * 添加知识条目
   *
   * @param entry 知识条目
   * @returns true 表示添加成功
   */
  add(entry: KnowledgeEntry): boolean {
    try {
      const serialized = this.serialize(entry)
      this.db
        .prepare(
          `INSERT INTO knowledge_entries
           (id, type, title, problem, rootCause, commands, rollbackCommands,
            verification, keywords, tags, successRate, useCount, embedding,
            createdAt, updatedAt)
           VALUES (@id, @type, @title, @problem, @rootCause, @commands, @rollbackCommands,
                   @verification, @keywords, @tags, @successRate, @useCount, @embedding,
                   @createdAt, @updatedAt)`
        )
        .run(serialized)
      return true
    } catch {
      return false
    }
  }

  /**
   * 更新知识条目（部分字段）
   *
   * @param id 条目 ID
   * @param partial 要更新的字段
   * @returns true 表示更新成功
   */
  update(id: string, partial: Partial<KnowledgeEntry>): boolean {
    const existing = this.getById(id)
    if (!existing) {
      return false
    }
    const merged: KnowledgeEntry = {
      ...existing,
      ...partial,
      id: existing.id, // ID 不可变
      updatedAt: Date.now()
    }
    try {
      const serialized = this.serialize(merged)
      this.db
        .prepare(
          `UPDATE knowledge_entries
           SET type=@type, title=@title, problem=@problem, rootCause=@rootCause,
               commands=@commands, rollbackCommands=@rollbackCommands,
               verification=@verification, keywords=@keywords, tags=@tags,
               successRate=@successRate, useCount=@useCount, embedding=@embedding,
               updatedAt=@updatedAt
           WHERE id=@id`
        )
        .run(serialized)
      return true
    } catch {
      return false
    }
  }

  /**
   * 删除知识条目
   * @param id 条目 ID
   * @returns true 表示删除成功
   */
  delete(id: string): boolean {
    try {
      const result = this.db.prepare('DELETE FROM knowledge_entries WHERE id = ?').run(id)
      return result.changes > 0
    } catch {
      return false
    }
  }

  /**
   * 根据 ID 获取知识条目
   * @param id 条目 ID
   * @returns 知识条目，不存在返回 null
   */
  getById(id: string): KnowledgeEntry | null {
    const row = this.db
      .prepare('SELECT * FROM knowledge_entries WHERE id = ?')
      .get(id) as KnowledgeRow | undefined
    return row ? this.deserialize(row) : null
  }

  /**
   * 批量导入知识条目
   *
   * 自动去重：对相似度 > 0.6 的条目合并（保留使用次数更高的版本）。
   * 使用事务保证原子性，任一条目失败不影响其他条目。
   *
   * @param entries 知识条目数组
   * @returns 成功导入的数量
   */
  importEntries(entries: KnowledgeEntry[]): number {
    let successCount = 0
    const raw = this.db.getRawConnection()
    const transaction = raw.transaction(() => {
      for (const entry of entries) {
        try {
          // 检查是否已存在相似条目
          const existing = this.findSimilarEntry(entry)
          if (existing) {
            // 合并：保留使用次数和成功率更高的版本
            const merged = this.mergeEntries(existing, entry)
            this.update(merged.id, merged)
          } else {
            this.add(entry)
          }
          successCount++
        } catch {
          // 单条失败跳过，继续处理下一条
        }
      }
    })
    transaction()
    return successCount
  }

  /**
   * 导出全部知识条目
   * @param type 知识类型过滤（可选）
   * @returns 知识条目数组
   */
  exportAll(type?: KnowledgeType): KnowledgeEntry[] {
    const rows = type
      ? (this.db.prepare('SELECT * FROM knowledge_entries WHERE type = ?').all(type) as KnowledgeRow[])
      : (this.db.prepare('SELECT * FROM knowledge_entries').all() as KnowledgeRow[])
    return rows.map((r) => this.deserialize(r))
  }

  /**
   * 使用次数 +1
   * @param id 条目 ID
   */
  incrementUseCount(id: string): void {
    try {
      this.db
        .prepare('UPDATE knowledge_entries SET useCount = useCount + 1 WHERE id = ?')
        .run(id)
    } catch {
      // 忽略错误
    }
  }

  /**
   * 更新成功率
   *
   * 基于增量更新：success=true 时成功率上升，false 时下降。
   * 使用加权平均：newRate = oldRate * 0.9 + (success?1:0) * 0.1
   *
   * @param id 条目 ID
   * @param success 本次使用是否成功
   */
  updateSuccessRate(id: string, success: boolean): void {
    try {
      const entry = this.getById(id)
      if (!entry) return
      const newRate = entry.successRate * 0.9 + (success ? 1 : 0) * 0.1
      this.db
        .prepare('UPDATE knowledge_entries SET successRate = ? WHERE id = ?')
        .run(newRate, id)
    } catch {
      // 忽略错误
    }
  }

  // ────────── 内部方法 ──────────

  /**
   * 分词
   *
   * 简单分词：按空格/标点切分 + 中文按字切分 + 转小写。
   * 生产环境可替换为 jieba 等专业分词库。
   *
   * @param text 输入文本
   * @returns 关键词数组
   */
  private tokenize(text: string): string[] {
    if (!text) return []
    // 按非字母数字字符切分
    const tokens = text
      .toLowerCase()
      .split(/[\s,，。、；;:：!！?？()（）\[\]【】"'`/\\|]+/)
      .filter((t) => t.length > 0)
    return tokens
  }

  /**
   * 查找与给定条目相似度 > 0.6 的已有条目
   * @param entry 待比较的条目
   * @returns 相似的已有条目，无则返回 null
   */
  private findSimilarEntry(entry: KnowledgeEntry): KnowledgeEntry | null {
    const candidates = this.exportAll(entry.type)
    const entrySet = new Set(entry.keywords)
    for (const candidate of candidates) {
      const candidateSet = new Set(candidate.keywords)
      const sim = jaccardSimilarity(entrySet, candidateSet)
      if (sim > DEDUP_THRESHOLD) {
        return candidate
      }
    }
    return null
  }

  /**
   * 合并两个相似条目
   *
   * 保留使用次数和成功率更高的版本作为基础，
   * 合并 keywords 和 tags（并集）。
   *
   * @param a 条目 A
   * @param b 条目 B
   * @returns 合并后的条目
   */
  private mergeEntries(a: KnowledgeEntry, b: KnowledgeEntry): KnowledgeEntry {
    // 以使用次数高的为基础
    const base = a.useCount >= b.useCount ? a : b
    const other = a.useCount >= b.useCount ? b : a
    return {
      ...base,
      keywords: Array.from(new Set([...base.keywords, ...other.keywords])),
      tags: Array.from(new Set([...base.tags, ...other.tags])),
      useCount: a.useCount + b.useCount,
      successRate: Math.max(a.successRate, b.successRate),
      updatedAt: Date.now()
    }
  }

  /**
   * 序列化知识条目（用于 SQL 参数）
   * @param entry 知识条目
   * @returns 序列化后的对象
   */
  private serialize(entry: KnowledgeEntry): SerializedKnowledgeRow {
    return {
      id: entry.id,
      type: entry.type,
      title: entry.title,
      problem: entry.problem,
      rootCause: entry.rootCause ?? null,
      commands: JSON.stringify(entry.commands),
      rollbackCommands: entry.rollbackCommands ? JSON.stringify(entry.rollbackCommands) : null,
      verification: entry.verification ?? null,
      keywords: JSON.stringify(entry.keywords),
      tags: JSON.stringify(entry.tags),
      successRate: entry.successRate,
      useCount: entry.useCount,
      embedding: entry.embedding ? JSON.stringify(entry.embedding) : null,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt
    }
  }

  /**
   * 反序列化数据库行
   * @param row 数据库行
   * @returns 知识条目
   */
  private deserialize(row: KnowledgeRow): KnowledgeEntry {
    return {
      id: row.id,
      type: row.type as KnowledgeType,
      title: row.title,
      problem: row.problem,
      rootCause: row.rootCause ?? undefined,
      commands: safeParseArray(row.commands),
      rollbackCommands: row.rollbackCommands ? safeParseArray(row.rollbackCommands) : undefined,
      verification: row.verification ?? undefined,
      keywords: safeParseArray(row.keywords),
      tags: safeParseArray(row.tags),
      successRate: row.successRate,
      useCount: row.useCount,
      embedding: row.embedding ? safeParseArray(row.embedding) as unknown as number[] : undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }
  }
}

// ────────── 工具函数 ──────────

/**
 * Jaccard 相似度
 *
 * 计算两个集合的交集/并集大小之比。
 *   J(A, B) = |A ∩ B| / |A ∪ B|
 *
 * @param a 集合 A
 * @param b 集合 B
 * @returns 相似度 [0, 1]，空集返回 0
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const item of a) {
    if (b.has(item)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * 安全解析 JSON 数组
 * @param json JSON 字符串
 * @returns 数组，解析失败返回空数组
 */
function safeParseArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** 数据库行类型（原始字段，TEXT 类型为 string|null） */
interface KnowledgeRow {
  id: string
  type: string
  title: string
  problem: string
  rootCause: string | null
  commands: string
  rollbackCommands: string | null
  verification: string | null
  keywords: string
  tags: string
  successRate: number
  useCount: number
  embedding: string | null
  createdAt: number
  updatedAt: number
}

/** 序列化后的行类型（用于 SQL 参数绑定） */
interface SerializedKnowledgeRow {
  id: string
  type: string
  title: string
  problem: string
  rootCause: string | null
  commands: string
  rollbackCommands: string | null
  verification: string | null
  keywords: string
  tags: string
  successRate: number
  useCount: number
  embedding: string | null
  createdAt: number
  updatedAt: number
}
