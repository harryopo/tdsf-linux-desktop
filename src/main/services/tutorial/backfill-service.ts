/**
 * 教程 Embedding 异步分批回填服务（v2.5 Phase C）
 *
 * 背景：
 *   - tutorial:backfill-embeddings 旧通道同步 await，2578 条回填需 1-3 分钟
 *   - 期间 IPC 阻塞，渲染层 UI 冻结，无进度推送，无取消机制
 *
 * 方案：
 *   - 改为异步后台任务（启动后立即返回 taskId）
 *   - 分页查询（pageSize=100）+ 事务外推理 + 事务内写入
 *   - 通过 tutorial:backfill-progress push 通道推送进度
 *   - 支持取消（cancelled 标记，下页检查后退出）
 *   - 断点续传（WHERE embedding IS NULL 自动跳过已处理）
 *
 * 关键约束（来源：better-sqlite3 官方 API 文档）：
 *   "Transaction functions do not work with async functions... the transaction
 *    will already be committed before any async code executes."
 *
 *   → 推理（async）必须在事务外，仅写入（sync）在事务内
 *
 * 参考：
 *   - 调研报告：docs/v2.5-research-backend-enhancement.md §3
 *   - 现有 EmbeddingService：src/main/services/tutorial/embedding-service.ts
 *   - 现有 pushToRenderer 模式：src/main/ipc/scheduler.ts
 *   - Electron IPC Pattern 3：https://www.electronjs.org/docs/latest/tutorial/ipc
 */

import { BrowserWindow } from 'electron'
import type { DatabaseManager } from '../db/database'
import { EmbeddingService, EMBEDDING_DIM } from './embedding-service'
import { logger } from '../log/logger'
import { TUTORIAL } from '@shared/ipc-channels'
import type {
  BackfillProgress,
  BackfillStatus,
  BackfillStatusResult,
} from '@shared/tutorial-types'

/**
 * 回填服务配置默认值
 *
 * - PAGE_SIZE = 100：每次查询 100 条进行推理（2578 条 / 100 ≈ 26 次推送，频率合理）
 * - INFERENCE_BATCH = 8：ONNX 内部 batching 大小（与 EmbeddingService.embedBatch 默认值一致）
 * - MAX_CONTENT_LENGTH = 1500：content 截断长度（约 500-700 tokens，避免超过 512 token 限制）
 *
 * 导出供 IPC handler 复用（保证 backfill-embeddings 旧通道与 backfill-start 新通道默认值一致）
 */
export const DEFAULT_PAGE_SIZE = 100
export const DEFAULT_INFERENCE_BATCH = 8
const MAX_CONTENT_LENGTH = 1500

/**
 * 教程 Embedding 异步分批回填服务（单例）
 *
 * 设计要点：
 *   1. 单例模式：全局只允许一个回填任务运行（isRunning() 守卫）
 *   2. 异步启动：start() 返回的 Promise 在任务完成后 resolve，调用方不 await 即可后台运行
 *   3. 取消机制：cancel() 标记 cancelled，下页查询后检查退出
 *   4. 错误隔离：单批失败累计 failed 计数，继续下一页
 *   5. 进度推送：每页完成后通过 webContents.send 推送到所有渲染窗口
 *   6. 断点续传：WHERE embedding IS NULL 自动跳过已处理条目
 *   7. ETA 估算：elapsed / processed * remaining
 */
export class EmbeddingBackfillService {
  private static instance: EmbeddingBackfillService | null = null

  /** 是否有任务正在运行（单例守卫） */
  private running = false

  /** 是否已标记取消（下页检查后退出） */
  private cancelled = false

  /** 当前任务 ID（无任务时为 null） */
  private currentTaskId: string | null = null

  private constructor() {}

  /**
   * 获取单例实例
   *
   * 全局只保留一个 EmbeddingBackfillService，防止并发启动多个回填任务
   * 导致 EmbeddingService 单例被多个推理循环抢占。
   */
  static getInstance(): EmbeddingBackfillService {
    if (!EmbeddingBackfillService.instance) {
      EmbeddingBackfillService.instance = new EmbeddingBackfillService()
    }
    return EmbeddingBackfillService.instance
  }

  /**
   * 启动异步分批回填
   *
   * 调用方式：
   *   - 后台运行（推荐）：`void service.start(db, taskId)` 不 await，立即返回
   *   - 同步等待（旧通道兼容）：`await service.start(db, taskId)` 等待完成
   *
   * 流程：
   *   1. 单例守卫：if (this.running) throw
   *   2. 标记 running = true, cancelled = false
   *   3. 确保 EmbeddingService 模型已加载
   *   4. 统计总数（SELECT COUNT WHERE embedding IS NULL）
   *   5. 循环：
   *      a. 查询一页（LIMIT pageSize）
   *      b. 检查 cancelled，若已取消则退出
   *      c. 事务外推理（await embeddingService.embedBatch）
   *      d. 事务内写入（db.transaction(updateStmt.run)）
   *      e. 推进度到渲染层
   *   6. 推送最终状态（completed / cancelled / failed）
   *   7. 重置 running = false
   *
   * @param db 数据库管理器
   * @param taskId 任务 ID（可选，默认 `backfill-${Date.now()}`）
   * @param pageSize 分页大小（可选，默认 100）
   * @param inferenceBatch 推理批次大小（可选，默认 8）
   * @returns 最终的 BackfillProgress（包含 processed / failed / status）
   */
  async start(
    db: DatabaseManager,
    taskId?: string,
    pageSize: number = DEFAULT_PAGE_SIZE,
    inferenceBatch: number = DEFAULT_INFERENCE_BATCH
  ): Promise<BackfillProgress> {
    // ─── 1. 单例守卫 ───
    if (this.running) {
      throw new Error('已有回填任务在运行，请先取消或等待完成')
    }

    // ─── 2. 数据库可用性检查 ───
    if (!db.isAvailable()) {
      throw new Error('数据库不可用（better-sqlite3 未加载），无法回填')
    }

    // ─── 3. 初始化任务状态 ───
    this.running = true
    this.cancelled = false
    this.currentTaskId = taskId ?? `backfill-${Date.now()}`
    const currentTaskId = this.currentTaskId

    logger.info('TUTORIAL.BACKFILL', '启动异步 embedding 回填任务', {
      taskId: currentTaskId,
      pageSize,
      inferenceBatch,
    })

    // ─── 4. 确保 EmbeddingService 模型已加载 ───
    try {
      await EmbeddingService.getInstance().ensureLoaded()
    } catch (err) {
      this.running = false
      this.currentTaskId = null
      const errorMsg = `Embedding 模型加载失败: ${(err as Error).message}`
      logger.error('TUTORIAL.BACKFILL', errorMsg, { taskId: currentTaskId })
      const failedProgress: BackfillProgress = {
        taskId: currentTaskId,
        processed: 0,
        total: 0,
        failed: 0,
        pct: 0,
        currentBatch: 0,
        eta: 0,
        status: 'failed',
        error: errorMsg,
      }
      this.pushProgress(failedProgress)
      return failedProgress
    }

    // ─── 5. 统计总数（仅一次） ───
    const totalRow = db
      .prepare(
        `SELECT COUNT(*) AS c FROM knowledge_entries
         WHERE type = ? AND (embedding IS NULL OR embedding = '')`
      )
      .get('tutorial') as { c: number } | undefined
    const total = totalRow?.c ?? 0

    if (total === 0) {
      // 无待回填条目，直接返回完成
      this.running = false
      this.currentTaskId = null
      logger.info('TUTORIAL.BACKFILL', '无待回填条目，任务立即完成', {
        taskId: currentTaskId,
      })
      const doneProgress: BackfillProgress = {
        taskId: currentTaskId,
        processed: 0,
        total: 0,
        failed: 0,
        pct: 1,
        currentBatch: 0,
        eta: 0,
        status: 'completed',
      }
      this.pushProgress(doneProgress)
      return doneProgress
    }

    // ─── 6. 分页查询 + 分批推理 + 分批写入 ───
    let processed = 0
    let failed = 0
    let batchIndex = 0
    const startTime = Date.now()

    try {
      while (!this.cancelled) {
        // 6a. 查询一页（WHERE embedding IS NULL 自动断点续传）
        const rows = db
          .prepare(
            `SELECT id, title, problem AS content FROM knowledge_entries
             WHERE type = ? AND (embedding IS NULL OR embedding = '')
             LIMIT ?`
          )
          .all('tutorial', pageSize) as Array<{
            id: string
            title: string
            content: string
          }>

        if (rows.length === 0) break // 全部处理完

        // 6b. 准备文本（title 加权，content 截断）
        const texts = rows.map((r) => {
          const titlePart = r.title ?? ''
          const contentPart = (r.content ?? '').slice(0, MAX_CONTENT_LENGTH)
          return `${titlePart}\n\n${contentPart}`.trim()
        })

        // 6c. 事务外推理（async，ONNX batching）
        let embeddings: Float32Array[]
        try {
          embeddings = await EmbeddingService.getInstance().embedBatch(
            texts,
            inferenceBatch
          )
        } catch (err) {
          // 单批推理失败：累计 failed，跳过本批，继续下一页
          failed += rows.length
          logger.warn('TUTORIAL.BACKFILL', `批次 ${batchIndex} 推理失败，跳过`, {
            taskId: currentTaskId,
            batchIndex,
            failed: rows.length,
            error: (err as Error).message,
          })
          processed += rows.length
          this.pushProgress({
            taskId: currentTaskId,
            processed,
            total,
            failed,
            pct: Math.min(1, processed / total),
            currentBatch: batchIndex,
            eta: this.estimateEta(startTime, processed, total),
            status: 'running',
          })
          batchIndex++
          continue
        }

        // 6d. 事务内写入（同步，better-sqlite3 transaction）
        const updateStmt = db.prepare(
          `UPDATE knowledge_entries SET embedding = ? WHERE id = ? AND type = ?`
        )

        const items: Array<{ id: string; vec: string }> = []
        for (let i = 0; i < rows.length; i++) {
          const vec = embeddings[i]
          if (vec && vec.length === EMBEDDING_DIM) {
            // Float32Array → JSON 字符串（与现有 backfillEmbeddings 实现一致）
            items.push({
              id: rows[i].id,
              vec: JSON.stringify(Array.from(vec)),
            })
          }
        }

        if (items.length > 0) {
          try {
            const rawConn = db.getRawConnection()
            if (rawConn) {
              const updateTx = rawConn.transaction(
                (txItems: Array<{ id: string; vec: string }>) => {
                  for (const item of txItems) {
                    updateStmt.run(item.vec, item.id, 'tutorial')
                  }
                }
              )
              updateTx(items)
              processed += items.length
              failed += rows.length - items.length
            } else {
              // 无原始连接（内存回退模式），逐条 run（mock 会抛错被 catch）
              failed += rows.length
              processed += rows.length
            }
          } catch (err) {
            failed += rows.length
            logger.warn('TUTORIAL.BACKFILL', `批次 ${batchIndex} 写入失败`, {
              taskId: currentTaskId,
              batchIndex,
              error: (err as Error).message,
            })
          }
        } else {
          // 整批 embedding 都无效
          failed += rows.length
        }

        // 6e. 推进度到渲染层
        processed += 0 // 已在上面累加
        this.pushProgress({
          taskId: currentTaskId,
          processed,
          total,
          failed,
          pct: Math.min(1, processed / total),
          currentBatch: batchIndex,
          eta: this.estimateEta(startTime, processed, total),
          status: 'running',
        })

        batchIndex++
      }

      // ─── 7. 推送最终状态 ───
      const finalStatus: BackfillStatus =
        this.cancelled ? 'cancelled' : 'completed'
      const finalProgress: BackfillProgress = {
        taskId: currentTaskId,
        processed,
        total,
        failed,
        pct: this.cancelled ? processed / total : 1,
        currentBatch: batchIndex,
        eta: 0,
        status: finalStatus,
      }
      this.pushProgress(finalProgress)

      logger.info('TUTORIAL.BACKFILL', '回填任务结束', {
        taskId: currentTaskId,
        status: finalStatus,
        processed,
        total,
        failed,
        durationMs: Date.now() - startTime,
      })

      return finalProgress
    } catch (err) {
      // 未预期的错误：标记 failed，推送错误进度
      const errorMsg = (err as Error).message
      logger.error('TUTORIAL.BACKFILL', '回填任务异常终止', {
        taskId: currentTaskId,
        error: errorMsg,
      })
      const errorProgress: BackfillProgress = {
        taskId: currentTaskId,
        processed,
        total,
        failed,
        pct: total > 0 ? processed / total : 0,
        currentBatch: batchIndex,
        eta: 0,
        status: 'failed',
        error: errorMsg,
      }
      this.pushProgress(errorProgress)
      return errorProgress
    } finally {
      this.running = false
      this.currentTaskId = null
      this.cancelled = false
    }
  }

  /**
   * 取消正在运行的回填任务
   *
   * 实现：
   *   - 标记 cancelled = true
   *   - 下页查询后检查退出（单页内不会中止，保证数据一致性）
   *   - 若任务未运行，无操作
   */
  cancel(): void {
    if (this.running) {
      this.cancelled = true
      logger.info('TUTORIAL.BACKFILL', '收到取消请求，将在下一页检查后退出', {
        taskId: this.currentTaskId,
      })
    }
  }

  /**
   * 查询当前回填状态
   *
   * @returns running + taskId（无任务时 taskId 为 null）
   */
  getStatus(): BackfillStatusResult {
    return {
      running: this.running,
      taskId: this.currentTaskId,
    }
  }

  /**
   * 是否有任务正在运行
   *
   * 用于 IPC handler 入口守卫，防止并发启动
   */
  isRunning(): boolean {
    return this.running
  }

  /**
   * 估算剩余时间（ETA）
   *
   * 公式：elapsed / processed * remaining
   *
   * @param startTime 任务开始时间戳
   * @param processed 已处理条目数
   * @param total 总条目数
   * @returns 剩余毫秒数（processed=0 时返回 0）
   */
  private estimateEta(startTime: number, processed: number, total: number): number {
    if (processed <= 0 || total <= 0) return 0
    const elapsed = Date.now() - startTime
    const remaining = total - processed
    return Math.round((elapsed / processed) * remaining)
  }

  /**
   * 推进度到所有渲染窗口
   *
   * 参考：src/main/ipc/scheduler.ts 的 pushToRenderer 模式
   *
   * 安全性：
   *   - BrowserWindow.getAllWindows() 可能为空（窗口未创建或已销毁）
   *   - 检查每个窗口的 isDestroyed() 状态
   *   - 多窗口场景下遍历所有非销毁窗口推送
   */
  private pushProgress(p: BackfillProgress): void {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length === 0) return

    for (const win of windows) {
      if (win.isDestroyed()) continue
      try {
        win.webContents.send(TUTORIAL.BACKFILL_PROGRESS, p)
      } catch (err) {
        logger.warn('TUTORIAL.BACKFILL', '推送进度到窗口失败', {
          taskId: p.taskId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
}
