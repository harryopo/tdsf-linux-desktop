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
import type {
  KbViewHistoryEntry,
  KnowledgeDeleteResult,
  KnowledgeEntry,
  KnowledgeType,
} from '@shared/models'
import { recordToolCall } from './tool-call-log'
import { buildContentSeg } from './knowledge-tokenize'
// 导入部分失败必须留痕，否则界面上只剩一个"成功导入 N 条"
import { logger } from '../log/logger'

/** Jaccard 相似度去重阈值 */
const DEDUP_THRESHOLD = 0.6

/** 默认搜索结果数量 */
const DEFAULT_SEARCH_LIMIT = 10

/**
 * 设置页「功能调用统计」里这一项的名字（单源）
 *
 * 记账行为归仓储所有：混合检索那条路（kb-search.ts）命中后不走 search()，
 * 由它调 recordRetrieval() 借这里记一笔。常量放在这一处，是为了让
 * "谁在记「知识库检索」"永远只有一个答案。
 */
export const KNOWLEDGE_RETRIEVAL_LABEL = '知识库检索'

/**
 * 一次搜索最多取多少候选行
 *
 * 评分在 JS 侧做（中文子串匹配，见 search 的 v2.6 注释），所以不能把 SQL 的 LIMIT
 * 写成用户要的 limit——那会让排名靠后的条目根本没进候选。这里给的是一个上限：
 * 按 useCount 降序取这么多，超出部分不参与本次排名。原来是无上限整表进内存。
 */
const MAX_SEARCH_CANDIDATES = 2000

/**
 * 去重用的候选池：一次导入按 type 各读一遍，不再每条都做整表 SELECT *
 *
 * 为什么不走 FTS5 候选：knowledge_fts 用的是 unicode61 分词，它不切中文，
 * "磁盘满了怎么办" 是一个整词，拿 "磁盘" 去 MATCH 什么都查不到——
 * 用 FTS 做去重候选会让中文条目静默不再合并（合并失效比慢更糟）。
 */
class DedupePool {
  /** type → 该类型下的条目列表 */
  private readonly lists = new Map<string, KnowledgeEntry[]>()
  /** type → 关键词 → 命中该关键词的条目 */
  private readonly postings = new Map<string, Map<string, KnowledgeEntry[]>>()
  /** 已经加载过的 type（读库只做一次） */
  private readonly loaded = new Set<string>()

  /**
   * @param db 只用到 prepare().all()，与仓储同一个连接
   * @param hydrate 行→条目的反序列化（沿用仓储那一份，不另写一套 JSON 解析口径）
   */
  constructor(
    private readonly db: DatabaseManager,
    private readonly hydrate: (row: KnowledgeRow) => KnowledgeEntry
  ) {}

  /** 与 entry 共享至少一个关键词的同类型条目（真相似度在这批候选里算） */
  candidatesFor(entry: KnowledgeEntry): KnowledgeEntry[] {
    this.ensureLoaded(entry.type)
    const index = this.postings.get(entry.type)
    if (!index) return []
    const out: KnowledgeEntry[] = []
    const seen = new Set<string>()
    for (const keyword of entry.keywords) {
      for (const hit of index.get(keyword) ?? []) {
        if (seen.has(hit.id)) continue
        seen.add(hit.id)
        out.push(hit)
      }
    }
    return out
  }

  /** 新写入的条目要进池，否则同批次内的重复条目查不到彼此（旧写法每次重读整表，看得见） */
  track(entry: KnowledgeEntry): void {
    this.ensureLoaded(entry.type)
    const list = this.lists.get(entry.type)!
    list.push(entry)
    const index = this.postings.get(entry.type)!
    for (const keyword of entry.keywords) {
      const bucket = index.get(keyword)
      if (bucket) bucket.push(entry)
      else index.set(keyword, [entry])
    }
  }

  /** 合并后原条目的关键词变了，整池重建该 type（合并是少数路径，重建代价只在命中时发生） */
  replace(entry: KnowledgeEntry): void {
    this.ensureLoaded(entry.type)
    const list = this.lists.get(entry.type)!
    const idx = list.findIndex((e) => e.id === entry.id)
    if (idx >= 0) list[idx] = entry
    else list.push(entry)
    const index = new Map<string, KnowledgeEntry[]>()
    for (const item of list) {
      for (const keyword of item.keywords) {
        const bucket = index.get(keyword)
        if (bucket) bucket.push(item)
        else index.set(keyword, [item])
      }
    }
    this.postings.set(entry.type, index)
  }

  private ensureLoaded(type: KnowledgeType): void {
    if (this.loaded.has(type)) return
    this.loaded.add(type)
    // idx_kb_type 在这里派上用场：按类型取候选，取一次用完整批导入
    const rows = this.db
      .prepare(`SELECT * FROM knowledge_entries WHERE type = ?`)
      .all(type) as KnowledgeRow[]
    const list: KnowledgeEntry[] = []
    const index = new Map<string, KnowledgeEntry[]>()
    for (const row of rows) {
      let entry: KnowledgeEntry
      try {
        entry = this.hydrate(row)
      } catch {
        // 一行脏数据不该让整批导入看不见候选（宁可少合并，不可整批当新条目重复插进去）
        continue
      }
      list.push(entry)
      for (const keyword of entry.keywords) {
        const bucket = index.get(keyword)
        if (bucket) bucket.push(entry)
        else index.set(keyword, [entry])
      }
    }
    this.lists.set(type, list)
    this.postings.set(type, index)
  }
}

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
   * 空查询语义（v2.4 修复）：query 为空（或分词后为空）时，视为"浏览全部"，
   * 返回全部条目（可按 type 过滤），按 useCount 降序 —— 供 KnowledgePage
   * 初始加载全量知识列表用。此前空查询直接返回 []，叠加渲染层移除 mock 后
   * 导致知识库页面完全空白。
   *
   * @param query 查询字符串（空 = 浏览全部）
   * @param type 知识类型过滤（可选）
   * @param limit 返回数量上限
   * @returns 匹配的知识条目数组（有查询词时按相似度降序，空查询按 useCount 降序）
   */
  search(query: string, type?: KnowledgeType, limit: number = DEFAULT_SEARCH_LIMIT): KnowledgeEntry[] {
    const queryKeywords = this.tokenize(query)

    // 设置页「功能调用统计」的唯一记账点。为什么记在这里而不是 kb:search 的 IPC 里：
    // 所有真检索都过这一层（AI 的 kb_search 工具、MCP 知识工具、各 subagent、命令面板、
    // 记忆召回），而 IPC 只覆盖其中一条——结果就是"AI 查了不记、用户翻页面猛记"。
    // 空查询=浏览全部（见上面的注释），那是列表加载不是检索，不记账。
    // 边界要说准：knowledge-subagent / search-subagent 的 hybridSearch 那一腿走的是
    // FTS5+向量，不经这里，因此不计入本项（那条路当前不在聊天主链路上）。
    if (queryKeywords.length > 0) {
      this.recordRetrieval()
    }

    // 候选从库里取，但取多少是有上限的（原来无上限整表进内存，库一大每次搜索都搬全表）
    const rows = type
      ? this.db
          .prepare(
            `SELECT * FROM knowledge_entries WHERE type = ? ORDER BY useCount DESC LIMIT ?`
          )
          .all(type, MAX_SEARCH_CANDIDATES)
      : this.db
          .prepare(`SELECT * FROM knowledge_entries ORDER BY useCount DESC LIMIT ?`)
          .all(MAX_SEARCH_CANDIDATES)

    // 空查询 = 浏览全部：按 useCount 降序返回前 limit 条（不做相似度过滤）
    if (queryKeywords.length === 0) {
      return (rows as KnowledgeRow[])
        .map((row) => this.deserialize(row))
        .sort((a, b) => b.useCount - a.useCount)
        .slice(0, limit)
    }

    const querySet = new Set(queryKeywords)

    // v2.6 修复：原实现只对 keywords 做 token 精确相等的 Jaccard，中文查询（无空格
    // 分词）几乎必然零命中。改为双向子串匹配 + Jaccard 加权综合评分：
    // - 正向：查询 token 是“标题/问题/关键词/标签”拼接文本的子串（如 nginx、502）
    // - 反向：条目关键词/标签（长度≥2）是查询 token 的子串（如关键词“磁盘”⊂“磁盘满了怎么办”）
    // - Jaccard(query, keywords) 作加权项，保证关键词命中多的条目排序靠前
    const scored: Array<{ entry: KnowledgeEntry; score: number }> = []
    for (const row of rows as KnowledgeRow[]) {
      const entry = this.deserialize(row)
      const entrySet = new Set(entry.keywords.map((k) => k.toLowerCase()))
      const haystack = `${entry.title} ${entry.problem} ${entry.keywords.join(' ')} ${entry.tags.join(' ')}`.toLowerCase()
      const needles = [...entrySet, ...entry.tags.map((t) => t.toLowerCase())].filter((k) => k.length >= 2)

      let hit = 0
      for (const token of querySet) {
        if (haystack.includes(token) || needles.some((k) => token.includes(k))) {
          hit++
        }
      }
      const hitRatio = hit / querySet.size
      const score = hitRatio + jaccardSimilarity(querySet, entrySet)
      if (score > 0) {
        scored.push({ entry, score })
      }
    }

    // 按相似度降序排序，取前 limit 条
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit).map((s) => s.entry)
  }

  /**
   * 记一次「知识库检索」
   *
   * 给不走 search() 的检索路径用（目前是 kb-search.ts 的混合检索分支：
   * 它命中后就直接用融合结果，不会再调 search 一遍）。
   * 一次检索只能落到这里一次——两条路径是互斥分支，不是前后补记。
   */
  recordRetrieval(): void {
    recordToolCall(this.db, KNOWLEDGE_RETRIEVAL_LABEL)
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
            contentSeg, createdAt, updatedAt)
           VALUES (@id, @type, @title, @problem, @rootCause, @commands, @rollbackCommands,
                   @verification, @keywords, @tags, @successRate, @useCount, @embedding,
                   @contentSeg, @createdAt, @updatedAt)`
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
               contentSeg=@contentSeg, updatedAt=@updatedAt
           WHERE id=@id`
        )
        .run(serialized)
      return true
    } catch {
      return false
    }
  }

  /**
   * 删除知识条目（主表 + FTS + 向量三份一起走）
   *
   * knowledge_fts 与 knowledge_vec 都是靠 knowledge_entries 上的 AFTER DELETE
   * 触发器同步的影子表，所以这里只删主表一行——但正因为如此，触发器一炸
   * （FTS 表缺失、库被锁…）整条 DELETE 会失败，那种情况必须报 error，
   * 不能压成 false 让界面说出"这条已经不在了"。
   */
  delete(id: string): KnowledgeDeleteResult {
    try {
      const result = this.db.prepare('DELETE FROM knowledge_entries WHERE id = ?').run(id)
      return result.changes > 0 ? { kind: 'deleted' } : { kind: 'not-found' }
    } catch (err) {
      return { kind: 'error', message: err instanceof Error ? err.message : String(err) }
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
   * 返回的是**真的写进库的条数**：add()/update() 内部 catch 后返回 false，
   * 原来这里不看返回值也照样 successCount++，于是整批一条都没写进去时，
   * UI 仍然显示"成功导入 N 条"——那句假数字的唯一来源就是这个返回值。
   *
   * @param entries 知识条目数组
   * @returns 实际成功写入（新增或合并）的条数
   */
  importEntries(entries: KnowledgeEntry[]): number {
    const raw = this.db.getRawConnection()
    if (!raw) {
      // 数据库不可用时返回 0
      return 0
    }
    // 候选池按 type 各读一次，取代原来"每条导入都整表 SELECT *"（M 条导入 = M 次全表扫）
    const pool = new DedupePool(this.db, (row) => this.deserialize(row))
    let successCount = 0
    let mergedCount = 0
    let failedCount = 0
    const transaction = raw.transaction(() => {
      for (const entry of entries) {
        try {
          // 检查是否已存在相似条目（同批次内先前的条目也算候选，与旧实现一致）
          const existing = this.findSimilarEntry(entry, pool)
          if (existing) {
            // 合并：保留使用次数和成功率更高的版本
            // 合并必须落在"库里那一行"的 id 上。mergeEntries 以 useCount 较高者为底本，
            // 底本可能是导进来的那条（它的 id 库里根本没有）——照 merged.id 去 UPDATE
            // 就是 getById 拿不到 → 静默算失败，本机那条旧条目原样留着，合并没发生。
            const merged = { ...this.mergeEntries(existing, entry), id: existing.id }
            if (!this.update(merged.id, merged)) {
              failedCount++
              continue
            }
            pool.replace(merged)
            mergedCount++
          } else {
            if (!this.add(entry)) {
              failedCount++
              continue
            }
            pool.track(entry)
          }
          successCount++
        } catch {
          // 单条失败跳过，继续处理下一条
          failedCount++
        }
      }
    })
    transaction()
    if (failedCount > 0) {
      // 失败要留痕：只回一个数字的话，用户看到"导入成功"，库里却静默少了几条
      logger.warn('DB', '知识库批量导入未全部成功', {
        total: entries.length,
        success: successCount,
        merged: mergedCount,
        failed: failedCount,
      })
    }
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
   * 按标签取条目（归档幂等检查用）
   *
   * 为什么单独有这个方法：归档每处理一条决策都要查"这条决策是否已归档过"，
   * 之前走的是 exportAll() 再 JS filter —— N 条决策 = N 次全表读 + N 次整行反序列化，
   * 库越大越慢，而它要的只是"命中一个标签的第一条"。
   *
   * tags 列存的是 JSON 数组文本（["a","b"]），所以匹配带引号的完整值
   * `"tag"` 就等价于"这个标签在不在数组里"，不会误命中前缀（decision:1 不会中 decision:12）。
   * LIKE 的 % 与 _ 按字面量转义（id 里带下划线很常见）。
   *
   * @param tag 完整标签
   * @param limit 最多返回几条（幂等检查只取第一条）
   */
  findByTag(tag: string, limit: number = 1): KnowledgeEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM knowledge_entries WHERE tags LIKE ? ESCAPE '\\' ORDER BY updatedAt DESC LIMIT ?`
      )
      .all(`%${tagLikeNeedle(tag)}%`, limit) as KnowledgeRow[]
    return rows.map((r) => this.deserialize(r))
  }

  /**
   * 全库条数（归档算贡献率的分母用）
   *
   * 原来调用方写的是 exportAll().length —— 为了一个数字把整表读出来再逐行反序列化。
   */
  countAll(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM knowledge_entries').get() as
      | { n: number }
      | undefined
    return row?.n ?? 0
  }

  /**
   * 按标签数条目（归档算"AI 贡献了多少条"用）
   *
   * 与 findByTag 同一个匹配口径，但只回计数：
   * 原来是 exportAll() 把整表读进内存再 filter，还要给每行做反序列化。
   */
  countByTag(tag: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM knowledge_entries WHERE tags LIKE ? ESCAPE '\\'`)
      .get(`%${tagLikeNeedle(tag)}%`) as { n: number } | undefined
    return row?.n ?? 0
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
   * 记录浏览：自增 useCount + 写入浏览历史表
   *
   * @param id 知识条目 ID
   */
  recordView(id: string): void {
    try {
      // 1. 自增 useCount
      this.incrementUseCount(id)

      // 2. 写入浏览历史
      const entry = this.getById(id)
      if (!entry) return
      this.db
        .prepare('INSERT INTO kb_view_history (entryId, title, viewedAt) VALUES (?, ?, ?)')
        .run(id, entry.title, Date.now())
    } catch {
      // 忽略错误
    }
  }

  /**
   * 获取热门知识（按 useCount 降序）
   *
   * @param limit 返回数量，默认 5
   * @returns KnowledgeEntry[]
   */
  getHot(limit: number = 5): KnowledgeEntry[] {
    try {
      const rows = this.db
        .prepare('SELECT * FROM knowledge_entries ORDER BY useCount DESC LIMIT ?')
        .all(limit) as KnowledgeRow[]
      return rows.map((r) => this.deserialize(r))
    } catch {
      return []
    }
  }

  /**
   * 获取最近浏览记录
   *
   * 从 kb_view_history 表按时间倒序查询。
   *
   * @param limit 返回数量，默认 5
   * @returns KbViewHistoryEntry[]
   */
  getRecentViews(limit: number = 5): KbViewHistoryEntry[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT entryId, title, viewedAt FROM kb_view_history
           ORDER BY viewedAt DESC LIMIT ?`
        )
        .all(limit) as Array<{ entryId: string; title: string; viewedAt: number }>
      return rows.map((r) => ({
        entryId: r.entryId,
        title: r.title,
        viewedAt: r.viewedAt,
      }))
    } catch {
      return []
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
   *
   * 候选来自 DedupePool（按 type 各读一次 + 关键词倒排），不再每条导入都整表 SELECT *；
   * 相似度只在共享了至少一个关键词的候选上算——Jaccard 要 > 0.6 必然有公共关键词，
   * 所以这一步不改变结果，只把"每条一次全表扫"变成"每批一次全表扫"。
   * 命中多条时取最相似的那条（旧实现取第一个命中的，顺序由 SQLite 返回顺序决定）。
   *
   * @param entry 待比较的条目
   * @param pool 本批导入共用的候选池
   * @returns 相似的已有条目，无则返回 null
   */
  private findSimilarEntry(entry: KnowledgeEntry, pool: DedupePool): KnowledgeEntry | null {
    const entrySet = new Set(entry.keywords)
    let best: KnowledgeEntry | null = null
    let bestSim = DEDUP_THRESHOLD
    for (const candidate of pool.candidatesFor(entry)) {
      const sim = jaccardSimilarity(entrySet, new Set(candidate.keywords))
      if (sim > bestSim) {
        bestSim = sim
        best = candidate
      }
    }
    return best
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
      // 全文检索列：入库时切好词（#181）。放在 serialize 里，新增/更新/导入三条路都自动带上
      contentSeg: buildContentSeg({
        title: entry.title,
        problem: entry.problem,
        keywords: entry.keywords,
        tags: entry.tags,
        commands: entry.commands,
      }),
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
 * tags 列（JSON 数组文本）里精确匹配一个标签所需的 LIKE 片段
 *
 * 单源在这里，findByTag 与 countByTag 共用，避免两处口径分叉：
 * - JSON.stringify 把标签变成带引号的 `"tag"`，于是匹配的是整个数组元素，
 *   `decision:1` 不会误命中 `decision:12`；
 * - 再转义 LIKE 自己的 % 与 _（id 里带下划线很常见，不转义就成了通配符）。
 */
export function tagLikeNeedle(tag: string): string {
  return JSON.stringify(tag).replace(/%/g, '\\%').replace(/_/g, '\\_')
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
  contentSeg?: string | null
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
  contentSeg: string
  createdAt: number
  updatedAt: number
}
