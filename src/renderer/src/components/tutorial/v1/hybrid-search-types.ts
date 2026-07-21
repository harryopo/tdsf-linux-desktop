/**
 * 混合检索共享类型定义（Sprint 7 任务 F）
 *
 * 设计目标：
 * - 与主进程 HybridSearchResult 结构对齐（字段名一致，便于 IPC 透传）
 * - 提供搜索模式 / 状态机 / 进度等 UI 专用类型
 * - 严格类型，禁用 any
 *
 * 与后端类型的对应关系（src/main/services/tutorial/hybrid-search.ts）：
 *   HybridSearchResult.id          ← knowledge_entries.id
 *   HybridSearchResult.title       ← knowledge_entries.title
 *   HybridSearchResult.problem     ← knowledge_entries.problem
 *   HybridSearchResult.category    ← knowledge_entries.tags[0]
 *   HybridSearchResult.ftsScore    ← bm25() 原始分（负值，越小越相关）
 *   HybridSearchResult.vecDistance ← vec_distance_cosine() 原始值（0-2，越小越相关）
 *   HybridSearchResult.rrfScore    ← RRF 融合分（越大越相关，最终排序依据）
 *   HybridSearchResult.source      ← 'fts' | 'vec' | 'both' 召回来源标记
 */

/**
 * 混合检索单条结果
 *
 * 字段语义：
 * - rrfScore：RRF 融合分，越大越相关（最终排序依据）
 * - ftsScore：BM25 原始分（负值，越小越相关；未参与 FTS 时为 0）
 * - vecDistance：余弦距离原始值（0-2，越小越相关；未参与向量检索时为 -1）
 * - source：召回来源，fts=仅 FTS 命中 / vec=仅向量命中 / both=双路同时命中
 */
export interface HybridSearchResult {
  /** 知识条目 ID（对应 knowledge_entries.id，可拼接为 /tutorial/:id 路由） */
  id: string
  /** 标题 */
  title: string
  /** 问题描述（教程场景下即摘要 summary） */
  problem: string
  /** 分类（取自 tags[0]，可能为 undefined） */
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
 * 搜索模式
 *
 * - keyword：仅关键词检索（FTS5 BM25），响应快，适合精确匹配
 * - semantic：混合检索（FTS5 + 向量 KNN + RRF 融合），支持语义相似
 *            首次使用需下载 BGE-small-zh-v1.5 模型（约 24MB，10-30 秒）
 */
export type SearchMode = 'keyword' | 'semantic'

/**
 * Embedding 服务状态（用于 UI 引导首次下载）
 *
 * 字段语义（与 preload/index.ts 中 TutorialSearchStatus 保持一致）：
 * - embeddingModelLoaded：BGE 模型是否已加载到内存（首次调用后常驻）
 * - vectorEnabled：sqlite-vec 扩展是否已加载（数据库层能力）
 * - embeddingDim：embedding 维度（BGE-small-zh-v1.5 固定 512）
 * - totalEntries：tutorial 类型条目总数（用于 UI 提示规模）
 *
 * 注意：任务 E 的 IPC 通道 tutorial:search-status 已通过 preload 暴露，
 * 当主进程未实现或 API 不可用时 UI 应降级（status=null，不阻塞搜索）。
 */
export interface SearchStatus {
  /** BGE 模型是否已加载到内存 */
  embeddingModelLoaded: boolean
  /** sqlite-vec 扩展是否已加载 */
  vectorEnabled: boolean
  /** embedding 维度（BGE-small-zh-v1.5 固定 512） */
  embeddingDim: number
  /** tutorial 类型条目总数 */
  totalEntries: number
}

/**
 * Backfill 进度信息（用于 EmbeddingBanner 显示下载/回填进度）
 *
 * 触发场景：
 * - 用户点击「下载模型」→ 主进程调用 EmbeddingService.ensureLoaded()
 * - 用户点击「回填向量」→ 主进程调用 backfillEmbeddings()
 *
 * 进度计算：
 * - 模型下载阶段：current/total 表示下载字节数（total 可能未知，用 -1 表示）
 * - 向量回填阶段：current/total 表示已处理条目数 / 总条目数
 */
export interface BackfillProgress {
  /** 当前阶段：'downloading-model' | 'generating-embeddings' | 'done' | 'error' */
  phase: 'downloading-model' | 'generating-embeddings' | 'done' | 'error'
  /** 当前进度（条目数或字节数） */
  current: number
  /** 总进度（条目数或字节数，-1 表示未知） */
  total: number
  /** 错误信息（phase='error' 时有值） */
  errorMessage?: string
}

/**
 * Backfill 响应（tutorialBackfillEmbeddings 返回值）
 *
 * 字段语义（与 preload/index.ts 中 TutorialBackfillResult 保持一致）：
 * - total：待回填的总条目数
 * - success：成功生成向量的条目数
 * - failed：回填失败的条目数
 * - error：失败时的错误信息（成功时为 undefined）
 */
export interface BackfillResult {
  /** 总条目数 */
  total: number
  /** 成功生成向量的条目数 */
  success: number
  /** 失败的条目数 */
  failed: number
  /** 错误信息（失败时存在，与 crawlStart 通道风格一致） */
  error?: string
}

/**
 * 搜索结果标准化为 UI 友好格式（保留原始字段，添加派生字段）
 *
 * - scorePercent：rrfScore 转换为 0-100 的百分比（用于 UI 展示）
 *   公式：Math.round(Math.min(100, Math.max(0, rrfScore * 1000)))
 *   说明：rrfScore 通常是 0.01-0.03 的小数，放大 1000 倍后落在 10-30 区间
 *        再用 Math.min/Math.max 限制在 0-100 之间，便于进度条展示
 */
export interface SearchResultItem extends HybridSearchResult {
  /** UI 展示用相似度百分比（0-100） */
  scorePercent: number
  /** 摘要前 100 字（用于列表展示） */
  summaryTruncated: string
}

/**
 * 把 HybridSearchResult 转换为 UI 友好的 SearchResultItem
 *
 * @param result 原始检索结果
 * @returns UI 友好的检索结果项
 */
export function toSearchResultItem(result: HybridSearchResult): SearchResultItem {
  // rrfScore 通常是 0.01-0.03 的小数，放大 1000 倍后落在 10-30 区间
  // 用 Math.min/Math.max 限制在 0-100 之间，便于进度条展示
  const scorePercent = Math.round(
    Math.min(100, Math.max(0, result.rrfScore * 1000))
  )

  // 摘要前 100 字（避免长摘要破坏布局）
  const summaryTruncated =
    result.problem.length > 100
      ? `${result.problem.slice(0, 100)}…`
      : result.problem

  return {
    ...result,
    scorePercent,
    summaryTruncated,
  }
}

/**
 * 召回来源的中文标签（用于 UI 展示）
 */
export const SOURCE_LABELS: Record<HybridSearchResult['source'], string> = {
  fts: '关键词',
  vec: '语义',
  both: '双路命中',
}

/**
 * 召回来源的颜色（用于 UI 标签）
 * - fts：中性灰（普通匹配）
 * - vec：品牌蓝（语义匹配，强调）
 * - both：成功绿（双路命中，最高优先级）
 */
export const SOURCE_COLORS: Record<
  HybridSearchResult['source'],
  { color: string; background: string; border: string }
> = {
  fts: {
    color: 'var(--trae-text-secondary)',
    background: 'var(--trae-bg-overlay-l2)',
    border: 'var(--trae-border-neutral-l1)',
  },
  vec: {
    color: 'var(--trae-text-brand)',
    background: 'var(--trae-bg-brand-popup)',
    border: 'var(--trae-border-brand)',
  },
  both: {
    color: 'var(--trae-status-success-default)',
    background: 'var(--trae-status-success-surface-l1)',
    border: 'var(--trae-status-success-default)',
  },
}
