/**
 * 教程模块 IPC Handlers
 *
 * 通道列表（v0.6.0 教程爬虫扩展）：
 * - tutorial:list            — 列出所有教程（可选按分类过滤）
 * - tutorial:get             — 按 ID 获取单篇
 * - tutorial:search          — 关键词搜索（Jaccard，返回 TutorialEntry[]）
 * - tutorial:hybrid-search   — 混合检索（FTS5 BM25 + vec0 KNN + RRF 融合）★v0.9.6
 * - tutorial:backfill-embeddings — 回填缺失 embedding（长任务，可分批）★v0.9.6
 * - tutorial:search-status   — 检索状态（向量是否可用 + 模型是否加载 + 总条目数）★v0.9.6
 * - tutorial:recommend-path  — 推荐学习路径（分类依赖 + 难度递进 + 命令关联）★v1.0
 * - tutorial:byCategory      — 按分类获取
 * - tutorial:categories      — 分类汇总（含数量）
 * - tutorial:seedVersion     — 当前种子版本
 * - tutorial:seedReload      — 重新加载种子（仅 dev）
 * - tutorial:listSources     — 列出所有可抓取的源（含元数据）★v0.6.0
 * - tutorial:crawlStart      — 启动爬虫任务（异步推送进度）★v0.6.0
 * - tutorial:crawlStatus     — 查询爬虫状态 ★v0.6.0
 */

import { ipcMain, BrowserWindow } from 'electron'
import type { DatabaseManager } from '../services/db/database'
import { TutorialRepository } from '../services/tutorial/tutorial-repo'
import { loadTutorialSeeds, getSeedVersion } from '../services/tutorial/seed-loader'
import { TutorialCrawlerService } from '../services/tutorial/crawler/tutorial-crawler-service'
import type { CrawlStartArgs } from '@shared/crawler-types'
import type { TutorialCategory } from '../services/tutorial/types'
import { logger } from '../services/log/logger'
// v0.9.6 Sprint 7 任务 E：混合检索 + embedding 回填 + 检索状态查询
// - EmbeddingService：用于 isLoaded() 判断模型是否已加载到内存
// - EMBEDDING_DIM：BGE-small-zh-v1.5 固定 512 维，用于 search-status 返回
import { EmbeddingService, EMBEDDING_DIM } from '../services/tutorial/embedding-service'
// v1.0 Sprint 9：教学路径推荐
// - PathRecommender：4 层融合算法（分类依赖 + 难度递进 + 命令关联 + 混合检索）
import { PathRecommender, type RecommendPathOptions, type TutorialPath } from '../services/tutorial/path-recommender'

/**
 * 注册教程相关 IPC handlers
 *
 * @param db 数据库管理器
 * @param mainWindow 主窗口（用于爬虫进度事件推送，可选）
 */
export function registerTutorialIpcHandlers(
  db: DatabaseManager,
  mainWindow?: BrowserWindow | null
): void {
  const repo = new TutorialRepository(db)
  // 爬虫服务（单例，每个窗口独立）
  const crawlerService = new TutorialCrawlerService(
    db,
    () => mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  )

  /** tutorial:list — 列出教程 */
  ipcMain.handle(
    'tutorial:list',
    (_event, category?: TutorialCategory) => {
      try {
        if (category) {
          return repo.listByCategory(category)
        }
        return repo.listAll()
      } catch (err) {
        throw new Error(`列出教程失败: ${(err as Error).message}`)
      }
    }
  )

  /** tutorial:get — 获取单篇 */
  ipcMain.handle(
    'tutorial:get',
    (_event, id: string) => {
      try {
        if (!id || typeof id !== 'string') {
          throw new Error('id 无效')
        }
        return repo.getById(id)
      } catch (err) {
        throw new Error(`获取教程失败: ${(err as Error).message}`)
      }
    }
  )

  /** tutorial:search — 关键词搜索 */
  ipcMain.handle(
    'tutorial:search',
    (_event, query: string, limit?: number) => {
      try {
        return repo.search(query, limit ?? 10)
      } catch (err) {
        throw new Error(`搜索教程失败: ${(err as Error).message}`)
      }
    }
  )

  /** tutorial:categories — 分类汇总 */
  ipcMain.handle('tutorial:categories', () => {
    try {
      return repo.categorySummary()
    } catch (err) {
      throw new Error(`获取分类失败: ${(err as Error).message}`)
    }
  })

  /** tutorial:seedVersion — 当前种子版本 */
  ipcMain.handle('tutorial:seedVersion', () => {
    return getSeedVersion()
  })

  /** tutorial:seedReload — 重新加载种子（清空 + 重写） */
  ipcMain.handle('tutorial:seedReload', () => {
    try {
      // 先清空现有 tutorial
      db.prepare('DELETE FROM knowledge_entries WHERE type = ?').run('tutorial')
      // 重新加载
      return loadTutorialSeeds(db)
    } catch (err) {
      throw new Error(`重新加载种子失败: ${(err as Error).message}`)
    }
  })

  // ========== v0.6.0 教程爬虫通道 ==========

  /** tutorial:listSources — 列出所有可抓取源 */
  ipcMain.handle('tutorial:listSources', () => {
    try {
      const list = crawlerService.listSources()
      logger.info('TUTORIAL', `listSources 返回 ${list.length} 个源`)
      return list
    } catch (err) {
      logger.error('TUTORIAL', 'listSources 失败', { err: (err as Error).message })
      throw new Error(`列出爬虫源失败: ${(err as Error).message}`)
    }
  })

  /** tutorial:crawlStart — 启动爬虫任务 */
  ipcMain.handle('tutorial:crawlStart', async (_event, args?: CrawlStartArgs) => {
    try {
      const results = await crawlerService.start(args ?? {})
      return { success: true, results }
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
        results: crawlerService.getStatus().history
      }
    }
  })

  /** tutorial:crawlStatus — 查询爬虫状态 */
  ipcMain.handle('tutorial:crawlStatus', () => {
    return crawlerService.getStatus()
  })

  /** tutorial:crawlCancel — 取消当前爬虫任务 */
  ipcMain.handle('tutorial:crawlCancel', () => {
    crawlerService.cancel()
    return { success: true }
  })

  // ========== v0.7.0 增量：磁盘 + 断点续传 ==========

  /** tutorial:diskInfo — 获取磁盘占用信息 */
  ipcMain.handle('tutorial:diskInfo', async () => {
    try {
      return await crawlerService.getDiskInfo()
    } catch (err) {
      throw new Error(`获取磁盘信息失败: ${(err as Error).message}`)
    }
  })

  /** tutorial:cleanupOrphans — 手动清理孤儿文件 */
  ipcMain.handle('tutorial:cleanupOrphans', async () => {
    try {
      const bytes = await crawlerService.cleanupOrphans()
      return { success: true, cleanedBytes: bytes }
    } catch (err) {
      throw new Error(`清理失败: ${(err as Error).message}`)
    }
  })

  /** tutorial:checkpoints — 获取 checkpoint 状态 */
  ipcMain.handle('tutorial:checkpoints', () => {
    return crawlerService.getCheckpoints()
  })

  /** tutorial:resetCheckpoint — 强制重新抓取某源 */
  ipcMain.handle('tutorial:resetCheckpoint', (_event, sourceId: string) => {
    crawlerService.resetCheckpoint(sourceId)
    return { success: true }
  })

  // ========== v0.9.6 Sprint 7 任务 E：混合检索 + embedding 回填 + 检索状态 ==========

  /**
   * tutorial:hybrid-search — 混合检索（FTS5 BM25 + vec0 KNN + RRF 融合）
   *
   * 通道名说明：
   *   原任务描述为 `tutorial:search`，但该通道已被现有 Jaccard 关键词搜索占用
   *   （返回 TutorialEntry[]）。为遵守"不破坏现有 API"约束，改用 `tutorial:hybrid-search`。
   *
   * 调用流程：
   *   1. 渲染进程传入 query + options（type/limit/useVector）
   *   2. 调用 tutorialRepo.searchHybrid(query, options)
   *   3. 内部自动生成查询向量（如启用且模型可用）→ FTS5 + vec 双路检索 → RRF 融合
   *   4. 返回 HybridSearchResult[]（按 rrfScore 降序）
   *
   * 降级策略（由 searchHybrid 内部处理）：
   *   - useVector=false → 仅 FTS5
   *   - EmbeddingService 不可用 → 自动降级到仅 FTS5
   *   - 向量扩展未加载 → 自动降级到仅 FTS5
   *   - FTS5 虚拟表不存在 → 降级到 LIKE 关键词匹配
   *
   * @param query 用户查询字符串
   * @param options.type 知识类型过滤（默认 'tutorial'）
   * @param options.limit 返回数量上限（默认 10）
   * @param options.useVector 是否启用向量检索（默认 true）
   * @returns HybridSearchResult[]（含 rrfScore / ftsScore / vecDistance / source 字段）
   */
  ipcMain.handle(
    'tutorial:hybrid-search',
    async (
      _event,
      query: string,
      options?: {
        type?: 'tutorial' | 'command_skill' | 'incident_case'
        limit?: number
        useVector?: boolean
      }
    ) => {
      try {
        // 参数防御：query 必须为非空字符串
        if (!query || typeof query !== 'string' || query.trim().length === 0) {
          return []
        }
        // 调用 tutorialRepo.searchHybrid（内部已处理降级逻辑）
        return await repo.searchHybrid(query, options)
      } catch (err) {
        logger.error('TUTORIAL', 'hybrid-search 失败', { err: (err as Error).message })
        // 抛错让渲染进程捕获（与现有 tutorial:* 通道一致的风格）
        throw new Error(`混合检索失败: ${(err as Error).message}`)
      }
    }
  )

  /**
   * tutorial:backfill-embeddings — 回填缺失的 embedding 字段
   *
   * 应用场景：
   *   - 老版本数据未生成 embedding（同步版 upsertMany 入库的历史数据）
   *   - EmbeddingService 当时不可用，后续模型下载成功后补齐
   *   - 数据库迁移后需要重建向量索引
   *
   * 长任务提示：
   *   - 2578 条教程首次回填需 1-3 分钟（取决于 CPU 性能）
   *   - 当前实现为同步等待（未推送进度事件）
   *   - TODO: 后续可改为异步 + 推送 tutorial:backfill-progress 事件
   *
   * @param options.batchSize 每批大小（默认 8，与 generateEmbeddings 内部一致）
   * @returns { total, success, failed } 统计信息
   */
  ipcMain.handle(
    'tutorial:backfill-embeddings',
    async (_event, options?: { batchSize?: number }) => {
      try {
        logger.info('TUTORIAL', '启动 embedding 回填任务', {
          batchSize: options?.batchSize ?? 8
        })
        // 调用 tutorialRepo.backfillEmbeddings（内部已分批 + 事务回填）
        const result = await repo.backfillEmbeddings({
          batchSize: options?.batchSize
        })
        logger.info('TUTORIAL', 'embedding 回填完成', result)
        return result
      } catch (err) {
        logger.error('TUTORIAL', 'backfill-embeddings 失败', {
          err: (err as Error).message
        })
        // 返回错误对象（与 crawlStart 通道风格一致，便于 UI 显示失败原因）
        return {
          total: 0,
          success: 0,
          failed: 0,
          error: (err as Error).message
        }
      }
    }
  )

  /**
   * tutorial:search-status — 获取检索状态
   *
   * 返回当前知识库的检索能力快照，UI 用于：
   *   - 展示"向量检索已启用 / 未启用"状态徽章
   *   - 展示"embedding 模型已加载 / 待加载"状态
   *   - 展示"已索引 N 条教程"
   *   - 让用户判断是否需要点击"回填 embedding"按钮
   *
   * @returns {
   *   vectorEnabled: boolean,        // sqlite-vec 扩展是否加载
   *   embeddingModelLoaded: boolean, // BGE 模型是否已加载到内存
   *   embeddingDim: number,          // embedding 维度（512，BGE-small-zh-v1.5）
   *   totalEntries: number           // tutorial 类型条目总数
   * }
   */
  ipcMain.handle('tutorial:search-status', async () => {
    try {
      return {
        // sqlite-vec 扩展加载状态（database.ts 初始化时检测）
        vectorEnabled: db.isVectorEnabled(),
        // BGE 模型加载状态（EmbeddingService 单例的 extractor 是否就绪）
        embeddingModelLoaded: EmbeddingService.getInstance().isLoaded(),
        // BGE-small-zh-v1.5 固定输出 512 维向量
        embeddingDim: EMBEDDING_DIM,
        // tutorial 类型条目总数（SELECT COUNT(*)）
        totalEntries: repo.count()
      }
    } catch (err) {
      logger.error('TUTORIAL', 'search-status 失败', { err: (err as Error).message })
      // 抛错让渲染进程捕获（与现有 tutorial:* 通道一致的风格）
      throw new Error(`获取检索状态失败: ${(err as Error).message}`)
    }
  })

  // ========== v1.0 Sprint 9：教学路径推荐 ==========

  /**
   * tutorial:recommend-path — 推荐学习路径
   *
   * 算法（4 层融合）：
   *   1. 分类依赖图：linux-basics → user-management → services → troubleshooting
   *   2. 难度递进：beginner → intermediate → advanced（同分类内）
   *   3. 命令关联：commands 共现分析（学完 ls → cd → grep）
   *   4. 混合检索召回：hybridSearch 召回相关教程，按 rrfScore 排序
   *
   * 调用流程：
   *   1. 渲染进程传入 options（goal / currentLevel / preferredCategory / maxSteps）
   *   2. PathRecommender.recommend(options) 计算路径
   *   3. 返回 TutorialPath[]（按目标分类分组）
   *
   * @param options.goal 学习目标（自然语言，如"想学 Docker"）
   * @param options.currentLevel 当前水平（beginner / intermediate / advanced，默认 beginner）
   * @param options.preferredCategory 偏好分类（如 networking）
   * @param options.maxSteps 最大步骤数（默认 8）
   * @returns TutorialPath[]
   */
  ipcMain.handle(
    'tutorial:recommend-path',
    async (
      _event,
      options?: RecommendPathOptions
    ): Promise<TutorialPath[]> => {
      try {
        logger.info('TUTORIAL', '推荐学习路径', options as Record<string, unknown>)
        const recommender = new PathRecommender(db)
        const paths = recommender.recommend(options)
        logger.info('TUTORIAL', `路径推荐完成，返回 ${paths.length} 条路径`)
        return paths
      } catch (err) {
        logger.error('TUTORIAL', 'recommend-path 失败', {
          err: (err as Error).message
        })
        // 抛错让渲染进程捕获
        throw new Error(`路径推荐失败: ${(err as Error).message}`)
      }
    }
  )
}
