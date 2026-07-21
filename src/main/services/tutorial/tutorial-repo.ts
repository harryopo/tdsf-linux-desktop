/**
 * 教程仓储 - TutorialRepository
 *
 * 教程本质上是 KnowledgeEntry 的 type='tutorial' 子集，
 * 复用 knowledge_entries 表，节省 schema。
 *
 * 字段映射：
 *   tutorial.id              → knowledge.id
 *   tutorial.title           → knowledge.title
 *   tutorial.summary         → knowledge.problem
 *   tutorial.content (md)    → 拆分：
 *                              - commands[0] → knowledge.commands[0]
 *                              - 完整 md → knowledge.tags (前 5 个关键词)
 *                              - 剩余信息 → JSON.stringify 到 knowledge.rootCause
 *   tutorial.source.url      → knowledge.rollbackCommands[0]
 *   tutorial.category        → knowledge.tags[0]
 *   tutorial.difficulty      → knowledge.tags[1]
 *   tutorial.distros         → knowledge.tags[2..]
 *   tutorial.commands        → knowledge.commands
 *   tutorial.keywords        → knowledge.keywords
 *   tutorial.readingTime     → knowledge.successRate (复用字段，存为 0-100)
 *
 * 为什么不新建表？
 *   - 复用现有 knowledge_entries 表，统一检索（Jaccard/向量）
 *   - 无需 schema 迁移
 *   - 教程/命令/案例共享同一检索基础设施
 */

import type { DatabaseManager } from '../db/database'
import type { KnowledgeEntry } from '@shared/models'
import type { TutorialEntry, TutorialCategory, TutorialDifficulty } from './types'
import { TUTORIAL_CATEGORY_LABELS, TUTORIAL_DIFFICULTY_LABELS } from './types'
import {
  EmbeddingService,
  EmbeddingServiceUnavailableError,
  generateEmbeddings,
  prefixQuery,
  EMBEDDING_DIM
} from './embedding-service'
import { hybridSearch, type HybridSearchResult } from './hybrid-search'

/** 字段名常量（用于 JSON 序列化） */
const FIELD_SOURCE_URL = '__tutorial_source_url'
const FIELD_SOURCE_LICENSE_URL = '__tutorial_source_license_url'
const FIELD_SOURCE_KIND = '__tutorial_source_kind'
const FIELD_CONTENT = '__tutorial_content'
const FIELD_READING_TIME = '__tutorial_reading_time'
const FIELD_CATEGORY = '__tutorial_category'
const FIELD_DIFFICULTY = '__tutorial_difficulty'

/** 教程仓储 */
export class TutorialRepository {
  constructor(private readonly db: DatabaseManager) {}

  /**
   * 将 TutorialEntry 序列化为 KnowledgeEntry
   *
   * Phase 1-c 强化：完整保存 source 标注（name / url / license / licenseUrl / kind / crawledAt）
   * - licenseUrl：CC BY-SA 4.0 详情页 URL（用于 UI 显示"查看协议原文"）
   * - kind：offline-dump / github-clone / online-crawl（用于 UI 标识）
   */
  toKnowledgeEntry(t: TutorialEntry): KnowledgeEntry {
    // 标签组合：分类 + 难度 + 关联发行版
    const tags = [
      TUTORIAL_CATEGORY_LABELS[t.category] ?? t.category,
      TUTORIAL_DIFFICULTY_LABELS[t.difficulty] ?? t.difficulty,
      ...t.distros
    ]
    return {
      id: t.id,
      type: 'tutorial',
      title: t.title,
      problem: t.summary,
      rootCause: JSON.stringify({
        [FIELD_SOURCE_URL]: t.source.url,
        [FIELD_SOURCE_LICENSE_URL]: t.source.licenseUrl,
        [FIELD_SOURCE_KIND]: t.source.kind,
        [FIELD_CONTENT]: t.content,
        [FIELD_READING_TIME]: t.readingTime,
        [FIELD_CATEGORY]: t.category,
        [FIELD_DIFFICULTY]: t.difficulty,
        sourceName: t.source.name,
        sourceLicense: t.source.license,
        crawledAt: t.source.crawledAt
      }),
      commands: t.commands,
      keywords: t.keywords,
      tags,
      successRate: t.readingTime / 60, // 0-1 范围内（小时）
      useCount: 0,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt
    }
  }

  /**
   * 从 KnowledgeEntry 反序列化为 TutorialEntry
   */
  fromKnowledgeEntry(k: KnowledgeEntry): TutorialEntry | null {
    if (k.type !== 'tutorial') return null
    let extra: Record<string, unknown> = {}
    try {
      extra = k.rootCause ? JSON.parse(k.rootCause) : {}
    } catch {
      return null
    }
    const category = (extra[FIELD_CATEGORY] as TutorialCategory) ?? 'linux-basics'
    const difficulty = (extra[FIELD_DIFFICULTY] as TutorialDifficulty) ?? 'beginner'
    const distros = (k.tags ?? []).filter(
      (t) => ['rhel', 'centos', 'rocky', 'fedora', 'ubuntu', 'debian', 'arch', 'opensuse'].includes(t)
    ) as TutorialEntry['distros']
    return {
      id: k.id,
      title: k.title,
      summary: k.problem,
      source: {
        name: String(extra.sourceName ?? 'Unknown'),
        url: String(extra[FIELD_SOURCE_URL] ?? ''),
        crawledAt: Number(extra.crawledAt ?? 0),
        license: String(extra.sourceLicense ?? 'Unknown'),
        licenseUrl: extra[FIELD_SOURCE_LICENSE_URL] ? String(extra[FIELD_SOURCE_LICENSE_URL]) : undefined,
        kind: extra[FIELD_SOURCE_KIND] as TutorialEntry['source']['kind'] | undefined
      },
      category,
      tags: (k.tags ?? []).filter(
        (t) => !Object.values(TUTORIAL_CATEGORY_LABELS).includes(t)
            && !Object.values(TUTORIAL_DIFFICULTY_LABELS).includes(t)
            && !['rhel', 'centos', 'rocky', 'fedora', 'ubuntu', 'debian', 'arch', 'opensuse'].includes(t)
      ),
      difficulty,
      readingTime: Number(extra[FIELD_READING_TIME] ?? 5),
      content: String(extra[FIELD_CONTENT] ?? ''),
      commands: k.commands ?? [],
      keywords: k.keywords ?? [],
      distros,
      createdAt: k.createdAt,
      updatedAt: k.updatedAt
    }
  }

  /**
   * 列出所有教程（按更新时间倒序）
   */
  listAll(): TutorialEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM knowledge_entries WHERE type = ? ORDER BY "updatedAt" DESC')
      .all('tutorial') as Array<Record<string, unknown>>
    return rows
      .map((r) => this.rowToEntry(r))
      .filter((t): t is TutorialEntry => t !== null)
  }

  /**
   * 按分类列出教程
   */
  listByCategory(category: TutorialCategory): TutorialEntry[] {
    const all = this.listAll()
    return all.filter((t) => t.category === category)
  }

  /**
   * 按 ID 获取单篇教程
   */
  getById(id: string): TutorialEntry | null {
    const row = this.db
      .prepare('SELECT * FROM knowledge_entries WHERE id = ? AND type = ?')
      .get(id, 'tutorial') as Record<string, unknown> | undefined
    if (!row) return null
    return this.rowToEntry(row)
  }

  /**
   * 统计每个分类的教程数量
   */
  categorySummary(): { category: TutorialCategory; count: number; label: string }[] {
    const all = this.listAll()
    const counts = new Map<TutorialCategory, number>()
    for (const t of all) {
      counts.set(t.category, (counts.get(t.category) ?? 0) + 1)
    }
    return Object.keys(TUTORIAL_CATEGORY_LABELS).map((cat) => ({
      category: cat as TutorialCategory,
      count: counts.get(cat as TutorialCategory) ?? 0,
      label: TUTORIAL_CATEGORY_LABELS[cat as TutorialCategory]
    }))
  }

  /**
   * 关键词搜索（Jaccard 相似度，复用 knowledge-repo 逻辑简化版）
   */
  search(query: string, limit = 10): TutorialEntry[] {
    const tokens = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0)
    if (tokens.length === 0) return []

    const querySet = new Set(tokens)
    const candidates = this.listAll()
    const scored = candidates
      .map((t) => {
        const text = `${t.title} ${t.summary} ${t.keywords.join(' ')} ${t.tags.join(' ')}`.toLowerCase()
        const tokens_in_text = new Set(text.split(/\s+/))
        const intersection = new Set([...querySet].filter((x) => tokens_in_text.has(x)))
        const union = new Set([...querySet, ...tokens_in_text])
        const score = union.size === 0 ? 0 : intersection.size / union.size
        return { t, score }
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
    return scored.map((s) => s.t)
  }

  /**
   * 批量 upsert（爬虫用）
   * - 已存在 ID：更新 content / crawledAt
   * - 不存在：插入
   *
   * @returns 统计 { inserted, updated, skipped }
   */
  upsertMany(entries: TutorialEntry[]): { inserted: number; updated: number; skipped: number } {
    if (entries.length === 0) {
      return { inserted: 0, updated: 0, skipped: 0 }
    }

    let inserted = 0
    let updated = 0
    let skipped = 0

    const raw = this.db.getRawConnection()
    if (!raw) {
      return { inserted: 0, updated: 0, skipped: entries.length }
    }
    const tx = raw.transaction((batch: TutorialEntry[]) => {
      for (const t of batch) {
        const knowledgeEntry = this.toKnowledgeEntry(t)
        const existing = this.db
          .prepare('SELECT id FROM knowledge_entries WHERE id = ? AND type = ?')
          .get(knowledgeEntry.id, 'tutorial') as { id: string } | undefined

        if (existing) {
          // 更新
          this.db
            .prepare(
              `UPDATE knowledge_entries SET
                title = @title,
                problem = @problem,
                "rootCause" = @rootCause,
                commands = @commands,
                keywords = @keywords,
                tags = @tags,
                "successRate" = @successRate,
                "updatedAt" = @updatedAt
              WHERE id = @id AND type = @type`
            )
            .run({
              ...knowledgeEntry,
              commands: JSON.stringify(knowledgeEntry.commands),
              keywords: JSON.stringify(knowledgeEntry.keywords),
              tags: JSON.stringify(knowledgeEntry.tags)
            })
          updated++
        } else {
          // 插入
          this.db
            .prepare(
              `INSERT INTO knowledge_entries
                (id, type, title, problem, "rootCause", commands, keywords, tags,
                 "successRate", "useCount", "createdAt", "updatedAt")
              VALUES
                (@id, @type, @title, @problem, @rootCause, @commands, @keywords, @tags,
                 @successRate, @useCount, @createdAt, @updatedAt)`
            )
            .run({
              ...knowledgeEntry,
              commands: JSON.stringify(knowledgeEntry.commands),
              keywords: JSON.stringify(knowledgeEntry.keywords),
              tags: JSON.stringify(knowledgeEntry.tags)
            })
          inserted++
        }
      }
    })

    try {
      tx(entries)
    } catch (err) {
      console.error('[TutorialRepository.upsertMany] 事务失败:', (err as Error).message)
      skipped = entries.length
      return { inserted, updated, skipped }
    }

    return { inserted, updated, skipped }
  }

  /**
   * 批量 upsert 异步版本（带 embedding 生成）
   *
   * 与同步版 `upsertMany()` 的区别：
   *   - 入库前为每条 entry 生成 BGE-small-zh-v1.5 向量（512 维）
   *   - 向量以 JSON 字符串形式写入 knowledge_entries.embedding 字段
   *   - 触发器会调用 `json_to_vec_f32(new.embedding)` 自动同步到 knowledge_vec 虚拟表
   *   - 同时 FTS5 触发器会自动同步 title/problem/keywords 到 knowledge_fts
   *
   * 降级策略：
   *   - `skipEmbedding=true`：跳过向量生成，等价于同步版（embedding=NULL）
   *   - EmbeddingService 不可用（模型下载失败）：跳过向量生成，记录警告，**仍写入主表**
   *     （后续可用 `backfillEmbeddings()` 补齐）
   *
   * 进度回调：
   *   - 2578 条教程首次入库会触发模型下载（约 24MB，10-30 秒）
   *   - 向量生成按 batchSize=8 分批，每批完成后回调 onProgress
   *   - 调用方可在 UI 显示"已处理 100/2578"
   *
   * @param entries 教程数组
   * @param options.skipEmbedding 是否跳过向量生成（默认 false）
   * @param options.onProgress 进度回调 (current, total)
   * @returns 统计 { inserted, updated, skipped }
   */
  async upsertManyAsync(
    entries: TutorialEntry[],
    options?: {
      skipEmbedding?: boolean
      onProgress?: (current: number, total: number) => void
    }
  ): Promise<{ inserted: number; updated: number; skipped: number }> {
    if (entries.length === 0) {
      return { inserted: 0, updated: 0, skipped: 0 }
    }

    // ─── 步骤 1：批量生成 embedding（除非 skipEmbedding） ───
    // Map<id, number[]>：用 number[] 是为了 JSON.stringify 后与 knowledge-repo.ts 格式一致
    const embeddingMap = new Map<string, number[]>()

    if (!options?.skipEmbedding) {
      try {
        // 调用任务 C 的 generateEmbeddings（内部已分批 + 进度回调）
        // 把每条 entry 拼成 "title\n\ncontent" 作为 embedding 输入（与 generateEmbeddings 内部一致）
        const floatMap = await generateEmbeddings(
          entries.map((e) => ({ id: e.id, title: e.title, content: e.content })),
          (pct) => {
            if (options?.onProgress) {
              options.onProgress(Math.floor(pct * entries.length), entries.length)
            }
          }
        )
        // Float32Array → number[]（便于 JSON.stringify）
        for (const [id, vec] of floatMap) {
          embeddingMap.set(id, Array.from(vec))
        }
      } catch (err) {
        // 降级：模型加载失败 → 不阻塞入库，主表照写，后续 backfill 补齐
        if (err instanceof EmbeddingServiceUnavailableError) {
          console.warn(
            '[TutorialRepository.upsertManyAsync] Embedding 服务不可用，跳过向量生成：',
            err.message
          )
        } else {
          console.warn(
            '[TutorialRepository.upsertManyAsync] 生成 embedding 失败，跳过向量生成：',
            (err as Error).message
          )
        }
      }
    }

    // ─── 步骤 2：事务批量 upsert 主表（与同步版逻辑一致，仅多写 embedding 字段） ───
    let inserted = 0
    let updated = 0
    let skipped = 0

    const raw = this.db.getRawConnection()
    if (!raw) {
      return { inserted: 0, updated: 0, skipped: entries.length }
    }

    const tx = raw.transaction((batch: TutorialEntry[]) => {
      for (const t of batch) {
        const knowledgeEntry = this.toKnowledgeEntry(t)
        const embeddingJson = embeddingMap.has(t.id)
          ? JSON.stringify(embeddingMap.get(t.id))
          : null
        const existing = this.db
          .prepare('SELECT id FROM knowledge_entries WHERE id = ? AND type = ?')
          .get(knowledgeEntry.id, 'tutorial') as { id: string } | undefined

        if (existing) {
          // 更新（含 embedding 字段；触发器会自动同步到 knowledge_fts 和 knowledge_vec）
          this.db
            .prepare(
              `UPDATE knowledge_entries SET
                title = @title,
                problem = @problem,
                "rootCause" = @rootCause,
                commands = @commands,
                keywords = @keywords,
                tags = @tags,
                "successRate" = @successRate,
                embedding = @embedding,
                "updatedAt" = @updatedAt
              WHERE id = @id AND type = @type`
            )
            .run({
              id: knowledgeEntry.id,
              type: knowledgeEntry.type,
              title: knowledgeEntry.title,
              problem: knowledgeEntry.problem,
              rootCause: knowledgeEntry.rootCause,
              commands: JSON.stringify(knowledgeEntry.commands),
              keywords: JSON.stringify(knowledgeEntry.keywords),
              tags: JSON.stringify(knowledgeEntry.tags),
              successRate: knowledgeEntry.successRate,
              embedding: embeddingJson,
              updatedAt: knowledgeEntry.updatedAt
            })
          updated++
        } else {
          // 插入（含 embedding 字段）
          this.db
            .prepare(
              `INSERT INTO knowledge_entries
                (id, type, title, problem, "rootCause", commands, keywords, tags,
                 "successRate", "useCount", embedding, "createdAt", "updatedAt")
              VALUES
                (@id, @type, @title, @problem, @rootCause, @commands, @keywords, @tags,
                 @successRate, @useCount, @embedding, @createdAt, @updatedAt)`
            )
            .run({
              id: knowledgeEntry.id,
              type: knowledgeEntry.type,
              title: knowledgeEntry.title,
              problem: knowledgeEntry.problem,
              rootCause: knowledgeEntry.rootCause,
              commands: JSON.stringify(knowledgeEntry.commands),
              keywords: JSON.stringify(knowledgeEntry.keywords),
              tags: JSON.stringify(knowledgeEntry.tags),
              successRate: knowledgeEntry.successRate,
              useCount: knowledgeEntry.useCount,
              embedding: embeddingJson,
              createdAt: knowledgeEntry.createdAt,
              updatedAt: knowledgeEntry.updatedAt
            })
          inserted++
        }
      }
    })

    try {
      tx(entries)
    } catch (err) {
      console.error('[TutorialRepository.upsertManyAsync] 事务失败:', (err as Error).message)
      skipped = entries.length
      return { inserted, updated, skipped }
    }

    // 完成进度回调
    if (options?.onProgress) {
      options.onProgress(entries.length, entries.length)
    }

    return { inserted, updated, skipped }
  }

  /**
   * 混合检索（FTS5 BM25 + vec0 KNN + RRF 融合）
   *
   * 调用任务 B 的 `hybridSearch()` 完成双路检索 + 倒数排名融合：
   *   - FTS5 路径：关键词精确匹配（如 "nginx 502" 直接命中相关条目）
   *   - 向量路径：语义相似（如 "如何排查网关错误" 也能命中 nginx 502 案例）
   *   - RRF 融合：取长补短，召回率 + 精确率兼顾
   *
   * 降级策略：
   *   - `useVector=false`：仅走 FTS5 路径
   *   - EmbeddingService 不可用（模型下载失败）：自动降级到仅 FTS5
   *   - 向量扩展未加载（db.isVectorEnabled()=false）：自动降级到仅 FTS5
   *   - FTS5 虚拟表不存在：hybridSearch 内部降级到 LIKE 关键词匹配
   *
   * @param query 用户查询字符串
   * @param options.type 知识类型过滤（默认 'tutorial'）
   * @param options.limit 返回数量上限（默认 10）
   * @param options.useVector 是否启用向量检索（默认 true）
   * @returns 混合检索结果数组（按 rrfScore 降序）
   */
  async searchHybrid(
    query: string,
    options?: {
      type?: 'tutorial' | 'command_skill' | 'incident_case'
      limit?: number
      useVector?: boolean
    }
  ): Promise<HybridSearchResult[]> {
    const type = options?.type ?? 'tutorial'
    const limit = options?.limit ?? 10
    const wantVector = options?.useVector ?? true

    // ─── 步骤 1：生成查询向量（如启用且模型可用） ───
    let queryEmbedding: Float32Array | undefined

    if (wantVector) {
      try {
        // 查询侧必须加 BGE 前缀（文档侧不加，这是 BGE 模型的特殊要求）
        const prefixed = prefixQuery(query)
        const vec = await EmbeddingService.getInstance().embed(prefixed)

        // 防御：维度校验（避免空向量参与检索）
        if (vec.length === EMBEDDING_DIM && vec.some((v) => v !== 0)) {
          queryEmbedding = vec
        }
      } catch (err) {
        // 降级：模型不可用 → 跳过向量检索，仅用 FTS5
        console.warn(
          '[TutorialRepository.searchHybrid] 生成查询向量失败，降级到仅 FTS5 检索：',
          (err as Error).message
        )
      }
    }

    // ─── 步骤 2：调用 hybridSearch（内部已处理 FTS5/vec 双路 + RRF 融合 + 降级） ───
    return hybridSearch(this.db, {
      query,
      queryEmbedding,
      type,
      limit
    })
  }

  /**
   * 回填缺失的 embedding 字段（迁移工具）
   *
   * 应用场景：
   *   - 老版本数据未生成 embedding（同步版 upsertMany 入库的 2578 条历史数据）
   *   - EmbeddingService 当时不可用，后续模型下载成功后补齐
   *   - 数据库迁移后需要重建向量索引
   *
   * 流程：
   *   1. SELECT 找出 type='tutorial' AND embedding IS NULL 的所有条目
   *   2. 按 batchSize=8 分批调 generateEmbeddings()
   *   3. UPDATE 回填到主表（触发器会自动同步 knowledge_vec 虚拟表）
   *   4. 每批完成后回调 onProgress
   *
   * @param options.batchSize 每批大小（默认 8，与 generateEmbeddings 内部一致）
   * @param options.onProgress 进度回调 (current, total)
   * @returns 统计 { total, success, failed }
   */
  async backfillEmbeddings(
    options?: {
      batchSize?: number
      onProgress?: (current: number, total: number) => void
    }
  ): Promise<{ total: number; success: number; failed: number }> {
    const batchSize = options?.batchSize ?? 8

    // ─── 步骤 1：扫描所有缺失 embedding 的教程 ───
    // 只取 id/title/problem，拼成 "title\n\nproblem" 作为 embedding 输入
    // 注：content 存在 rootCause JSON 里，这里取 problem 即可（节省内存 + 加速）
    const rows = this.db
      .prepare(
        `SELECT id, title, problem FROM knowledge_entries
         WHERE type = ? AND embedding IS NULL
         ORDER BY "updatedAt" ASC`
      )
      .all('tutorial') as Array<{ id: string; title: string; problem: string }>

    const total = rows.length
    if (total === 0) {
      options?.onProgress?.(0, 0)
      return { total: 0, success: 0, failed: 0 }
    }

    let success = 0
    let failed = 0

    // ─── 步骤 2：分批生成 embedding 并 UPDATE 回填 ───
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)

      try {
        // 复用 generateEmbeddings（内部已分批 + ensureLoaded + 内存降级）
        // 把 problem 当作 content 传入（与 generateEmbeddings 拼接逻辑一致）
        const floatMap = await generateEmbeddings(
          batch.map((r) => ({ id: r.id, title: r.title, content: r.problem }))
        )

        // UPDATE 回填（逐条更新，避免单事务过大）
        const updateStmt = this.db.prepare(
          `UPDATE knowledge_entries SET embedding = ? WHERE id = ? AND type = ?`
        )
        const updateTx = this.db.getRawConnection()?.transaction((items: Array<{ id: string; vec: number[] }>) => {
          for (const item of items) {
            updateStmt.run(JSON.stringify(item.vec), item.id, 'tutorial')
          }
        })

        const items: Array<{ id: string; vec: number[] }> = []
        for (const row of batch) {
          const vec = floatMap.get(row.id)
          if (vec && vec.length === EMBEDDING_DIM) {
            items.push({ id: row.id, vec: Array.from(vec) })
          }
        }

        if (items.length > 0 && updateTx) {
          updateTx(items)
          success += items.length
          failed += batch.length - items.length
        } else {
          // 没生成成功 或 事务不可用
          failed += batch.length
        }
      } catch (err) {
        console.warn(
          `[TutorialRepository.backfillEmbeddings] 批次 ${i}-${i + batch.length} 失败：`,
          (err as Error).message
        )
        failed += batch.length
      }

      // 进度回调
      if (options?.onProgress) {
        options.onProgress(Math.min(i + batchSize, total), total)
      }
    }

    return { total, success, failed }
  }

  /**
   * 统计 tutorial 类型条目总数
   *
   * 用于 IPC `tutorial:search-status` 通道返回当前知识库规模，
   * 让 UI 能展示"已索引 N 条教程"。
   *
   * 实现：SELECT COUNT(*) FROM knowledge_entries WHERE type='tutorial'
   * 性能：SQLite COUNT(*) 走索引，O(log n)，无需全表扫描
   *
   * @returns tutorial 类型条目总数
   */
  count(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM knowledge_entries WHERE type = ?')
      .get('tutorial') as { cnt: number } | undefined
    return row?.cnt ?? 0
  }

  /**
   * 统计指定 sourceName 的教程数
   */
  countBySourceName(sourceName: string): number {
    const all = this.listAll()
    return all.filter((t) => t.source.name === sourceName).length
  }

  /**
   * 单行 → TutorialEntry
   */
  private rowToEntry(row: Record<string, unknown>): TutorialEntry | null {
    try {
      const extra: Record<string, unknown> = row.rootCause
        ? JSON.parse(String(row.rootCause))
        : {}
      const category = (extra[FIELD_CATEGORY] as TutorialCategory) ?? 'linux-basics'
      const difficulty = (extra[FIELD_DIFFICULTY] as TutorialDifficulty) ?? 'beginner'
      const tagsArr: string[] = row.tags ? JSON.parse(String(row.tags)) : []
      const distros = tagsArr.filter((t) =>
        ['rhel', 'centos', 'rocky', 'fedora', 'ubuntu', 'debian', 'arch', 'opensuse'].includes(t)
      ) as TutorialEntry['distros']
      const keywords: string[] = row.keywords ? JSON.parse(String(row.keywords)) : []
      const commands: string[] = row.commands ? JSON.parse(String(row.commands)) : []
      return {
        id: String(row.id),
        title: String(row.title),
        summary: String(row.problem),
        source: {
          name: String(extra.sourceName ?? 'Unknown'),
          url: String(extra[FIELD_SOURCE_URL] ?? ''),
          crawledAt: Number(extra.crawledAt ?? 0),
          license: String(extra.sourceLicense ?? 'Unknown'),
          licenseUrl: extra[FIELD_SOURCE_LICENSE_URL] ? String(extra[FIELD_SOURCE_LICENSE_URL]) : undefined,
          kind: extra[FIELD_SOURCE_KIND] as TutorialEntry['source']['kind'] | undefined
        },
        category,
        tags: tagsArr.filter(
          (t) => !Object.values(TUTORIAL_CATEGORY_LABELS).includes(t)
            && !Object.values(TUTORIAL_DIFFICULTY_LABELS).includes(t)
            && !['rhel', 'centos', 'rocky', 'fedora', 'ubuntu', 'debian', 'arch', 'opensuse'].includes(t)
        ),
        difficulty,
        readingTime: Number(extra[FIELD_READING_TIME] ?? 5),
        content: String(extra[FIELD_CONTENT] ?? ''),
        commands,
        keywords,
        distros,
        createdAt: Number(row.createdAt ?? Date.now()),
        updatedAt: Number(row.updatedAt ?? Date.now())
      }
    } catch (e) {
      console.warn('[TutorialRepository] 解析失败:', (e as Error).message)
      return null
    }
  }
}
