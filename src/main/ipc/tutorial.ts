/**
 * 教程模块 IPC Handlers
 *
 * 只注册界面真在用的八条通道：
 * - tutorial:list            — 列出所有教程（可选按分类过滤）
 * - tutorial:get             — 按 ID 获取单篇
 * - tutorial:search          — 关键词搜索（Jaccard，返回 TutorialEntry[]）
 * - tutorial:categories      — 分类汇总（含数量）
 * - tutorial:hybrid-search   — 混合检索（FTS5 BM25 + vec0 KNN + RRF 融合）
 * - tutorial:recommend-path  — 推荐学习路径（分类依赖 + 难度递进 + 命令关联）
 * - tutorial:progress        — 查询学习进度
 * - tutorial:updateProgress  — 写入学习进度
 *
 * 2026-10-24（#211）删掉的是"内容从哪来"那一侧的十九把管理键：抓取（start / status /
 * cancel / 两条进度推送 / listSources）、磁盘与孤儿清理、断点续传、异步回填四把加旧的
 * 同步回填、种子版本与重载、检索状态、统计。它们在渲染层零调用，界面上从来没有
 * "抓取管理"这一格；教程内容的来源是随包种子（seed-loader 在主进程启动时跑）
 * 与知识库导入（#180），不需要一条运行时爬虫。实现体（crawler 目录、backfill-service、
 * crawler-types 与那批一次性脚本）同批整删，代码只留在 git 历史。
 * 判据：`tests/unit/tutorial-ipc-surface.test.ts`。
 *
 * 顺带：注册函数不再收 mainWindow——那个参数只为爬虫进度推送而存在。
 */

import { ipcMain } from 'electron'
import { TUTORIAL } from '@shared/ipc-channels'
import type { DatabaseManager } from '../services/db/database'
import type { TutorialProgress } from '@shared/models'
import { TutorialRepository } from '../services/tutorial/tutorial-repo'
import type { TutorialCategory } from '../services/tutorial/types'
import { logger } from '../services/log/logger'
// v1.0 Sprint 9：教学路径推荐
// - PathRecommender：4 层融合算法（分类依赖 + 难度递进 + 命令关联 + 混合检索）
import { PathRecommender, type RecommendPathOptions, type TutorialPath } from '../services/tutorial/path-recommender'

/**
 * 注册教程相关 IPC handlers
 *
 * @param db 数据库管理器
 */
export function registerTutorialIpcHandlers(db: DatabaseManager): void {
  const repo = new TutorialRepository(db)

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
  ipcMain.handle(TUTORIAL.CATEGORIES, () => {
    try {
      return repo.categorySummary()
    } catch (err) {
      throw new Error(`获取分类失败: ${(err as Error).message}`)
    }
  })

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
   * tutorial:recommend-path — 推荐学习路径
   *
   * 算法（4 层融合）：
   *   1. 分类依赖图：linux-basics → user-management → services → troubleshooting
   *   2. 难度递进：beginner → intermediate → advanced（同分类内）
   *   3. 命令关联：commands 共现分析（学完 ls → cd → grep）
   *   4. 混合检索召回：hybridSearch 召回相关教程，按 rrfScore 排序
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

  /**
   * tutorial:progress — 查询所有教程学习进度
   *
   * 用于 TutorialPage 替代 localStorage 过渡方案，实现跨设备同步。
   * 数据库不可用或表为空时返回空数组（前端展示为"未开始学习"）。
   *
   * @returns TutorialProgress[] 按 updatedAt 倒序（最近学习的在前）
   */
  ipcMain.handle(TUTORIAL.PROGRESS, (): TutorialProgress[] => {
    try {
      if (!db.isAvailable()) return []
      const rows = db
        .prepare(
          `SELECT tutorialId, status, progress, visitedAt, updatedAt
           FROM user_tutorial_progress
           ORDER BY updatedAt DESC`
        )
        .all() as Array<{
          tutorialId: string
          status: string
          progress: number
          visitedAt: number
          updatedAt: number
        }>
      return rows.map((r) => ({
        tutorialId: r.tutorialId,
        status: r.status === 'completed' ? 'completed' : 'visited',
        progress: r.progress,
        visitedAt: r.visitedAt,
        updatedAt: r.updatedAt,
      }))
    } catch (err) {
      logger.error('TUTORIAL', 'tutorial:progress 失败', { err: (err as Error).message })
      return []
    }
  })

  /**
   * tutorial:updateProgress — 更新单条教程学习进度（UPSERT）
   *
   * 写入策略：
   *   - 首次写入：visitedAt = updatedAt = Date.now()
   *   - 再次更新：保留原 visitedAt，仅更新 status / progress / updatedAt
   *
   * 幂等性：同一 tutorialId 多次调用只产生一行记录（INSERT OR REPLACE）。
   *
   * @param tutorialId 教程 ID
   * @param status 学习状态（visited / completed）
   * @param progress 进度百分比 [0, 100]
   * @returns true 表示写入成功
   */
  ipcMain.handle(
    TUTORIAL.UPDATE_PROGRESS,
    (_event, tutorialId: string, status: 'visited' | 'completed', progress: number): boolean => {
      try {
        if (!tutorialId || typeof tutorialId !== 'string') {
          throw new Error('tutorialId 参数无效')
        }
        if (status !== 'visited' && status !== 'completed') {
          throw new Error('status 参数无效，必须为 visited 或 completed')
        }
        const safeProgress = Math.min(Math.max(Math.floor(progress ?? 0), 0), 100)
        const now = Date.now()

        // 查询是否已存在记录（保留原 visitedAt）
        const existing = db
          .prepare('SELECT visitedAt FROM user_tutorial_progress WHERE tutorialId = ?')
          .get(tutorialId) as { visitedAt: number } | undefined
        const visitedAt = existing?.visitedAt ?? now

        // UPSERT：INSERT OR REPLACE 保留主键唯一性
        db.prepare(
          `INSERT OR REPLACE INTO user_tutorial_progress
           (tutorialId, status, progress, visitedAt, updatedAt)
           VALUES (?, ?, ?, ?, ?)`
        ).run(tutorialId, status, safeProgress, visitedAt, now)

        logger.info('TUTORIAL', 'tutorial:updateProgress 写入成功', {
          tutorialId,
          status,
          progress: safeProgress,
        })
        return true
      } catch (err) {
        logger.error('TUTORIAL', 'tutorial:updateProgress 失败', {
          err: (err as Error).message,
          tutorialId,
        })
        return false
      }
    }
  )
}
