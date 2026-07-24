/**
 * 混合检索 - RRF (Reciprocal Rank Fusion) 倒数排名融合
 *
 * 同时利用 FTS5 全文检索（BM25 算法）和 sqlite-vec 向量检索（余弦距离），
 * 通过 RRF 算法融合两路结果，克服单路检索的局限性：
 *   - FTS5 擅长关键词精确匹配（用户输入 "nginx 502" 直接命中相关条目）
 *   - 向量检索擅长语义相似（"如何排查网关错误" 也能命中 nginx 502 案例）
 *   - RRF 融合双路排名，取长补短，召回率和精确率兼顾
 *
 * 论文：Cormack, G.V., Clarke, C.L.A. & Büttcher, S. (2009).
 *       "Reciprocal Rank Fusion outperforms Condorcet and individual
 *        Rank Learning Methods." SIGIR 2009.
 *
 * 与 KnowledgeRepository.search（Jaccard 相似度）的区别：
 *   - Jaccard：基于关键词集合的交集/并集，无法处理词形变化和语义
 *   - 本模块：FTS5 BM25 + 向量 KNN + RRF 融合，工业级检索方案
 *
 * 设计目标：教学价值 + 生产可用
 *   - 中文注释解释每个算法的原理（教学）
 *   - 降级路径保证可运行（生产）
 *   - 严格类型，禁用 any（可维护）
 */

import type { DatabaseManager } from '../db/database'
import type { KnowledgeType } from '@shared/models'

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 混合检索选项
 *
 * 调用方通过 options 控制检索行为，所有字段都有合理默认值。
 */
export interface HybridSearchOptions {
  /** 用户查询字符串（关键词） */
  query: string
  /**
   * 查询向量（可选）
   *
   * 由外部 embedding 模型生成（如 bge-small / text-embedding-3-small），
   * 本文件不负责生成向量，只负责使用向量做 KNN 检索。
   * 未传则跳过向量检索，只走 FTS 路径。
   */
  queryEmbedding?: Float32Array
  /** 知识类型过滤（tutorial=教程 / command_skill=命令技能 / incident_case=故障案例） */
  type?: KnowledgeType
  /** 返回结果数量上限，默认 10 */
  limit?: number
  /** FTS 路径权重，默认 1.0 */
  ftsWeight?: number
  /** 向量路径权重，默认 1.0 */
  vecWeight?: number
  /** FTS 召回数量上限，默认 50（从 FTS 取前 50 条参与融合） */
  ftsLimit?: number
  /** 向量召回数量上限，默认 50（从 vec 取前 50 条参与融合） */
  vecLimit?: number
}

/**
 * 混合检索单条结果
 *
 * 同时包含原始分数和融合分数，便于 UI 展示和调试：
 *   - ftsScore：BM25 原始分（负值，越小越相关；未参与 FTS 时为 0）
 *   - vecDistance：余弦距离（0-2，越小越相关；未参与 vec 时为 -1）
 *   - rrfScore：RRF 融合分（越大越相关，最终排序依据）
 *   - source：标记该条目由哪一路召回（fts / vec / both）
 */
export interface HybridSearchResult {
  /** 知识条目 ID（对应 knowledge_entries.id） */
  id: string
  /** 标题 */
  title: string
  /** 问题描述（教程场景下即摘要 summary） */
  problem: string
  /** 分类（取自 tags[0]，参考 TutorialRepository.toKnowledgeEntry） */
  category?: string
  /** BM25 原始分（负值，越小越相关；未参与 FTS 时为 0） */
  ftsScore: number
  /** 余弦距离原始值（0-2，越小越相关；未参与向量检索时为 -1） */
  vecDistance: number
  /** RRF 融合分（越大越相关，最终排序依据） */
  rrfScore: number
  /** 召回来源：fts=仅 FTS 命中 / vec=仅向量命中 / both=双路同时命中 */
  source: 'fts' | 'vec' | 'both'
}

/**
 * RRF 融合后的条目信息（内部使用）
 */
export interface RrfFusedEntry {
  /** RRF 融合分 */
  rrfScore: number
  /** 在 FTS 结果中的排名（1-based），未参与 FTS 时为 undefined */
  ftsRank?: number
  /** 在向量结果中的排名（1-based），未参与向量检索时为 undefined */
  vecRank?: number
  /** 召回来源 */
  source: 'fts' | 'vec' | 'both'
}

// ============================================================================
// RRF 核心算法
// ============================================================================

/**
 * RRF 倒数排名融合（Reciprocal Rank Fusion）
 *
 * 公式：
 *   score(d) = Σ_i  w_i / (k + rank_i(d))
 *
 * 参数说明：
 *   - rank_i(d)：文档 d 在第 i 路检索结果中的排名（从 1 开始）
 *   - k：平滑常数，默认 60（Cormack et al. 2009 论文经验值）
 *        作用：避免排名 1 的文档得分过高（rank=1 时贡献 1/(k+1)，rank=2 时 1/(k+2)，
 *              差异被 k 平滑掉，不会让 top-1 主导整个融合结果）
 *   - w_i：第 i 路的权重（默认 1.0，可通过 ftsWeight / vecWeight 调整）
 *
 * 为什么用 RRF 而不是直接加权求和分数？
 *   1. 量纲不同：BM25 分数是负值（-10 ~ 0），余弦距离是正值（0 ~ 2），无法直接相加
 *   2. 鲁棒性强：RRF 只关心排名，对分数的绝对值不敏感，避免某一路分数尺度异常主导结果
 *   3. 无需训练：与 supervised rank learning（如 LambdaMART）不同，RRF 是无参方法
 *   4. 效果相当：论文证明 RRF 在多种任务上优于 Condorcet 和单独的 rank learning
 *
 * 算法步骤：
 *   1. 初始化 Map<id, FusedEntry>
 *   2. 遍历 FTS 结果，按 rank 计算 1/(k+rank) 贡献，累加到 Map
 *   3. 遍历 vec 结果，按 rank 计算 1/(k+rank) 贡献，累加到 Map
 *      （若 id 已存在，分数累加，source 标记为 'both'）
 *   4. 返回 Map，调用方按 rrfScore 降序排序
 *
 * @param ftsResults FTS5 检索结果（已按相关度排序，最相关在前）
 * @param vecResults vec0 检索结果（已按距离排序，最近邻在前）
 * @param k RRF 平滑常数，默认 60
 * @param ftsWeight FTS 路径权重，默认 1.0
 * @param vecWeight 向量路径权重，默认 1.0
 * @returns Map<id, RrfFusedEntry> 融合后的分数和来源信息
 */
export function reciprocalRankFusion(
  ftsResults: Array<{ id: string; score: number }>,
  vecResults: Array<{ id: string; distance: number }>,
  k = 60,
  ftsWeight = 1.0,
  vecWeight = 1.0
): Map<string, RrfFusedEntry> {
  const fused = new Map<string, RrfFusedEntry>()

  // ─── FTS 路径：按 rank 累加贡献 ───
  // rank 从 1 开始（rank=1 表示 FTS 结果中的第 1 名）
  ftsResults.forEach((item, index) => {
    const rank = index + 1
    const contribution = ftsWeight / (k + rank)
    const existing = fused.get(item.id)
    if (existing) {
      // 已被 vec 路径加入 → 累加分数，标记为 both
      existing.rrfScore += contribution
      existing.ftsRank = rank
      existing.source = 'both'
    } else {
      // 首次出现 → 创建条目，标记为 fts
      fused.set(item.id, {
        rrfScore: contribution,
        ftsRank: rank,
        source: 'fts'
      })
    }
  })

  // ─── 向量路径：按 rank 累加贡献 ───
  vecResults.forEach((item, index) => {
    const rank = index + 1
    const contribution = vecWeight / (k + rank)
    const existing = fused.get(item.id)
    if (existing) {
      // 已被 FTS 路径加入 → 累加分数，标记为 both
      existing.rrfScore += contribution
      existing.vecRank = rank
      existing.source = 'both'
    } else {
      // 首次出现 → 创建条目，标记为 vec
      fused.set(item.id, {
        rrfScore: contribution,
        vecRank: rank,
        source: 'vec'
      })
    }
  })

  return fused
}

// ============================================================================
// FTS5 查询转义
// ============================================================================

/**
 * 将用户查询转义为 FTS5 安全的查询字符串
 *
 * FTS5 查询语法（部分）：
 *   - 单词用空格分隔 = AND（默认）
 *   - OR 关键字 = OR
 *   - NOT / - = 排除
 *   - "短语" = 短语匹配（顺序敏感）
 *   - * = 前缀匹配（如 "ssh*" 匹配 "ssh", "sshd", "ssh_config"）
 *   - ( ) = 分组
 *   - : = 列限定（如 "title:ssh"）
 *   - ^ = 列权重提升
 *
 * 安全风险：
 *   - 用户直接输入 "ssh AND OR NOT" 会导致语法错误
 *   - 输入 "ssh*" 可能产生意外的前缀匹配
 *   - 输入 'ssh"config' 会破坏短语语法
 *
 * 转义策略（参考 SQLite FTS5 官方文档 "Full-text Query Syntax"）：
 *   1. 按空白字符分词（包括中英文空格、制表符、换行）
 *   2. 过滤纯标点符号的词（如 "，"、"！"）
 *   3. 每个词内的双引号转义为 ""（FTS5 短语语法的转义规则）
 *   4. 每个词用双引号包裹（变为短语，防止被解释为语法关键字或操作符）
 *   5. 用空格连接（FTS5 默认 = AND）
 *
 * 示例：
 *   escapeFtsQuery('ssh 配置')      → '"ssh" "配置"'    （AND 查询）
 *   escapeFtsQuery('nginx 502*')   → '"nginx" "502*"'  （* 被双引号包裹后失效）
 *   escapeFtsQuery('"ssh" OR x')   → '"ssh" "x"'       （OR 被双引号包裹后失效）
 *   escapeFtsQuery('')             → ''                （空查询返回空）
 *
 * @param query 用户原始查询
 * @returns FTS5 安全的查询字符串，空查询返回空字符串
 */
export function escapeFtsQuery(query: string): string {
  if (!query || typeof query !== 'string') return ''

  // 步骤 1：按空白字符分词（包括中英文空格、制表符、换行）
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    // 步骤 2：过滤纯标点符号的词（避免 "：" "，" 等产生空短语）
    .filter((t) => !/^[\s,，。、；;:：!！?？()（）\[\]【】"'`/\\|*\-+.]+$/.test(t))

  if (tokens.length === 0) return ''

  // 步骤 3-4：每个词转义双引号 + 用双引号包裹
  const escaped = tokens.map((t) => {
    // FTS5 短语语法：内部双引号转义为 ""（两个连续双引号）
    const inner = t.replace(/"/g, '""')
    return `"${inner}"`
  })

  // 步骤 5：用空格连接 = AND 语义（FTS5 默认操作符）
  return escaped.join(' ')
}

// ============================================================================
// 混合检索主函数
// ============================================================================

/**
 * 混合检索主函数（对外 API）
 *
 * 完整流程：
 *   1. FTS5 检索：用 query 在 knowledge_fts 虚拟表中查 BM25 分（如有 query）
 *   2. 向量检索：用 queryEmbedding 做 KNN 搜索（如有向量且扩展已加载）
 *   3. RRF 融合：用倒数排名融合两路结果
 *   4. 排序：按 rrfScore 降序，取前 limit 条
 *   5. 回填：用 IN 查询一次性取回所有命中条目的原始字段（title/problem/category）
 *
 * 降级策略：
 *   - query 为空字符串 → 跳过 FTS 路径
 *   - queryEmbedding 未传 或 db.isVectorEnabled()=false → 跳过向量路径
 *   - FTS 虚拟表不存在（database.ts 未升级） → 降级到 LIKE 关键词匹配
 *   - 向量查询失败（维度不匹配等） → 该路径返回空数组
 *   - 两路都跳过 → 返回空数组
 *
 * 性能优化：
 *   - FTS 和 vec 各自召回 limit(默认50) 条候选，避免全表扫描
 *   - 回填阶段用 IN (?,?,?) 一次性查询，避免 N+1 问题
 *   - RRF 用 Map O(n) 完成，无排序开销（排序发生在最终阶段）
 *
 * @param db DatabaseManager 实例
 * @param options 检索选项
 * @returns 融合后的检索结果数组（按 rrfScore 降序）
 */
export function hybridSearch(
  db: DatabaseManager,
  options: HybridSearchOptions
): HybridSearchResult[] {
  // 解构选项，应用默认值
  const {
    query,
    queryEmbedding,
    type,
    limit = 10,
    ftsWeight = 1.0,
    vecWeight = 1.0,
    ftsLimit = 50,
    vecLimit = 50
  } = options

  // ─── 步骤 1：FTS5 检索 ───
  // query 为空时跳过 FTS（纯向量检索场景）
  const ftsResults =
    query && query.trim().length > 0
      ? runFtsSearch(db, query, type, ftsLimit)
      : []

  // ─── 步骤 2：向量检索 ───
  // queryEmbedding 未传 或 向量扩展未加载 → 跳过
  const vecResults =
    queryEmbedding && db.isVectorEnabled()
      ? runVecSearch(db, queryEmbedding, type, vecLimit)
      : []

  // ─── 步骤 3：RRF 融合 ───
  const fusedMap = reciprocalRankFusion(
    ftsResults.map((r) => ({ id: r.id, score: r.score })),
    vecResults.map((r) => ({ id: r.id, distance: r.distance })),
    60, // k=60（Cormack 2009 论文经验值）
    ftsWeight,
    vecWeight
  )

  // ─── 步骤 4：按 rrfScore 降序排序，取前 limit 条 ───
  const sortedIds = Array.from(fusedMap.entries())
    .sort((a, b) => b[1].rrfScore - a[1].rrfScore)
    .slice(0, limit)
    .map(([id]) => id)

  if (sortedIds.length === 0) return []

  // ─── 步骤 5：回填原始字段 ───
  // 用 IN (?,?,...) 一次性查询，避免 N+1 问题
  const placeholders = sortedIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT id, type, title, problem, tags FROM knowledge_entries WHERE id IN (${placeholders})`
    )
    .all(...sortedIds) as Array<{
    id: string
    type: string
    title: string
    problem: string
    tags: string | null
  }>

  // 构造 id → row 映射（用于 O(1) 查找）
  const rowMap = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    rowMap.set(row.id, row)
  }

  // 组装最终结果（保持 sortedIds 的顺序，即 rrfScore 降序）
  const results: HybridSearchResult[] = []
  for (const id of sortedIds) {
    const row = rowMap.get(id)
    if (!row) continue // 数据可能已被删除，跳过

    const fused = fusedMap.get(id)
    if (!fused) continue // 理论上不会发生

    // 查找原始 ftsScore 和 vecDistance（从两路结果中按 id 查找）
    const ftsHit = ftsResults.find((r) => r.id === id)
    const vecHit = vecResults.find((r) => r.id === id)

    // 解析 tags 第 0 个作为 category
    // 参考 TutorialRepository.toKnowledgeEntry：tags[0]=分类标签（如 "Linux 基础"）
    let category: string | undefined
    if (row.tags) {
      try {
        const tagsArr = JSON.parse(row.tags) as unknown
        if (Array.isArray(tagsArr) && tagsArr.length > 0 && typeof tagsArr[0] === 'string') {
          category = tagsArr[0]
        }
      } catch {
        // JSON 解析失败 → 忽略，category 保持 undefined
      }
    }

    results.push({
      id: row.id,
      title: row.title,
      problem: row.problem,
      category,
      ftsScore: ftsHit ? ftsHit.score : 0,
      vecDistance: vecHit ? vecHit.distance : -1,
      rrfScore: fused.rrfScore,
      source: fused.source
    })
  }

  return results
}

// ============================================================================
// 内部辅助函数
// ============================================================================

/**
 * 执行 FTS5 检索
 *
 * 优先使用 knowledge_fts 虚拟表（BM25 算法）；
 * 若虚拟表不存在（database.ts 尚未升级建表）或查询失败，降级到 LIKE 关键词匹配。
 *
 * BM25 分数符号说明：
 *   - SQLite bm25() 函数返回负值（参考 https://www.sqlite.org/fts5.html#the_bm25_function）
 *   - 数值越小（越负）表示越相关
 *   - 例如 -10.5 比 -3.2 更相关
 *   - UI 展示时建议取负号（-score）让正数越大越相关
 *
 * @param db DatabaseManager 实例
 * @param query 用户原始查询（未转义）
 * @param type 知识类型过滤（可选）
 * @param limit 召回数量上限
 * @returns 按 BM25 分数升序排列（最相关在前），score 即 bm25() 原始值
 */
function runFtsSearch(
  db: DatabaseManager,
  query: string,
  type: KnowledgeType | undefined,
  limit: number
): Array<{ id: string; score: number }> {
  const ftsQuery = escapeFtsQuery(query)
  if (!ftsQuery) return []

  try {
    // 优先尝试 knowledge_fts 虚拟表（需 database.ts 升级后通过 initTables 建表）
    // 假设 knowledge_fts 是外部内容表（external content table），通过 id 关联 knowledge_entries
    // 参考 SQLite FTS5 文档："External Content Tables" 章节
    const sql = type
      ? `SELECT k.id, bm25(knowledge_fts) AS score
         FROM knowledge_fts
         JOIN knowledge_entries k ON k.id = knowledge_fts.id
         WHERE knowledge_fts MATCH ? AND k.type = ?
         ORDER BY score ASC
         LIMIT ?`
      : `SELECT k.id, bm25(knowledge_fts) AS score
         FROM knowledge_fts
         JOIN knowledge_entries k ON k.id = knowledge_fts.id
         WHERE knowledge_fts MATCH ?
         ORDER BY score ASC
         LIMIT ?`

    const stmt = db.prepare(sql)
    const rows = (
      type ? stmt.all(ftsQuery, type, limit) : stmt.all(ftsQuery, limit)
    ) as Array<{ id: string; score: number }>

    return rows
  } catch {
    // 降级：FTS 表不存在 或 查询语法错误 → 使用 LIKE 关键词匹配
    // 注：try/catch 同时捕获 prepare 和 all 阶段的错误
    return runFallbackKeywordSearch(db, query, type, limit)
  }
}

/**
 * 降级关键词搜索（FTS5 虚拟表不可用时使用）
 *
 * 使用 LIKE 模糊匹配 title 和 keywords 字段，按命中次数加权排序。
 *
 * 评分规则（模拟 BM25 的负值语义，便于 RRF 排名）：
 *   - title 命中一个词 +2 分（标题权重高）
 *   - keywords 命中一个词 +1 分
 *   - 最终 score = -(命中总分)（取负模拟 BM25，越小越相关）
 *
 * 局限性：
 *   - 无 IDF 加权（BM25 的核心特性）
 *   - 无词形变化处理（"running" 匹配不到 "run"）
 *   - 仅作为 FTS5 不可用时的兜底方案
 *
 * @param db DatabaseManager 实例
 * @param query 用户原始查询
 * @param type 知识类型过滤（可选）
 * @param limit 返回数量上限
 * @returns 按命中分升序排列（最相关在前）
 */
function runFallbackKeywordSearch(
  db: DatabaseManager,
  query: string,
  type: KnowledgeType | undefined,
  limit: number
): Array<{ id: string; score: number }> {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)

  if (tokens.length === 0) return []

  // 构造 LIKE 条件：每个词匹配 title 或 keywords（OR 连接）
  // 注：SQLite LIKE 默认大小写不敏感（PRAGMA case_sensitive_like = OFF）
  const conditions = tokens.map(() => '(title LIKE ? OR keywords LIKE ?)').join(' OR ')
  const params: Array<string> = []
  for (const t of tokens) {
    params.push(`%${t}%`, `%${t}%`)
  }

  // 拼 WHERE 子句：关键词条件 + 类型过滤
  let sql = `SELECT id, title, keywords FROM knowledge_entries`
  const whereClauses: string[] = []
  if (tokens.length > 0) {
    whereClauses.push(`(${conditions})`)
  }
  if (type) {
    whereClauses.push('type = ?')
    params.push(type)
  }
  if (whereClauses.length > 0) {
    sql += ` WHERE ${whereClauses.join(' AND ')}`
  }

  try {
    const rows = db.prepare(sql).all(...params) as Array<{
      id: string
      title: string
      keywords: string
    }>

    // 计算命中次数（title 命中权重 2，keywords 命中权重 1）
    const scored = rows.map((row) => {
      let hits = 0
      const titleLower = row.title.toLowerCase()
      for (const t of tokens) {
        const tLower = t.toLowerCase()
        if (titleLower.includes(tLower)) hits += 2
        if (row.keywords && row.keywords.includes(t)) hits += 1
      }
      // 取负模拟 BM25 语义（越小越相关）
      return { id: row.id, score: -hits }
    })

    // 升序排序（最相关在前，与 BM25 一致）
    scored.sort((a, b) => a.score - b.score)
    return scored.slice(0, limit)
  } catch {
    // SQL 执行失败 → 返回空数组
    return []
  }
}

/**
 * 执行向量检索（KNN 最近邻搜索）
 *
 * 使用 sqlite-vec 扩展提供的 vec_distance_cosine 函数。
 * 当扩展不可用、向量维度不匹配、或查询失败时返回空数组。
 *
 * vec0 距离说明：
 *   - 余弦距离 = 1 - cos(θ)，范围 [0, 2]
 *     - 0 表示方向完全相同（最相似）
 *     - 1 表示正交（无关）
 *     - 2 表示方向完全相反（最不相似）
 *   - embedding 字段在数据库中以 JSON 字符串存储（如 "[0.1, 0.2, ...]"）
 *   - vec_distance_cosine 函数接受 JSON 字符串格式的向量
 *
 * 注：当前实现采用 ORDER BY + LIMIT 模式（线性扫描），
 *     与 KnowledgeRepository.searchByVector 保持一致。
 *     当 database.ts 升级为 vec0 虚拟表后，可改为 `vec0 MATCH ? AND k=?` 的 KNN 语法，
 *     利用虚拟表索引获得 O(log n) 性能。
 *
 * @param db DatabaseManager 实例
 * @param queryEmbedding 查询向量（Float32Array）
 * @param type 知识类型过滤（可选）
 * @param limit 返回数量上限
 * @returns 按距离升序排列（最近邻在前）
 */
function runVecSearch(
  db: DatabaseManager,
  queryEmbedding: Float32Array,
  type: KnowledgeType | undefined,
  limit: number
): Array<{ id: string; distance: number }> {
  if (!db.isVectorEnabled()) return []

  // 将 Float32Array 转为 JSON 数组字符串
  // sqlite-vec 的 vec_distance_cosine 接受 JSON 字符串格式：[1.0, 2.0, 3.0, ...]
  const queryVecJson = JSON.stringify(Array.from(queryEmbedding))

  const sql = type
    ? `SELECT id, vec_distance_cosine(embedding, ?) AS distance
       FROM knowledge_entries
       WHERE embedding IS NOT NULL AND type = ?
       ORDER BY distance ASC
       LIMIT ?`
    : `SELECT id, vec_distance_cosine(embedding, ?) AS distance
       FROM knowledge_entries
       WHERE embedding IS NOT NULL
       ORDER BY distance ASC
       LIMIT ?`

  try {
    const stmt = db.prepare(sql)
    const rows = (
      type ? stmt.all(queryVecJson, type, limit) : stmt.all(queryVecJson, limit)
    ) as Array<{ id: string; distance: number }>

    return rows
  } catch {
    // 查询失败（向量扩展实际不可用、维度不匹配、embedding 字段格式错误等）
    // → 返回空数组，让 FTS 路径单独承担检索
    return []
  }
}

// ============================================================================
// 测试用例已迁移到 tests/services/tutorial/hybrid-search.test.ts
// 迁移时间：v2.5 Phase D1
// 迁移原因：注释形式的测试无法被 CI 执行，转为 vitest 用例保证覆盖
// ============================================================================
