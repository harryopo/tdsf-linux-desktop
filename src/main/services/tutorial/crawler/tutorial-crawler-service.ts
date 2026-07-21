/**
 * 教程爬虫统一服务 - TutorialCrawlerService
 *
 * 教学术语：
 * - Event Emitter (事件发射器)：Node.js 内置的发布订阅模式
 * - IPC Push (推送)：主进程主动向渲染进程发消息
 * - Mutex (互斥锁)：防止并发抓取冲突
 *
 * 职责：
 * 1. 接收 IPC 抓取请求
 * 2. 调度 source adapters (Arch Wiki / LDP / ...)
 * 3. 进度推送到主窗口
 * 4. 持久化到 SQLite
 * 5. 维护抓取状态（防重入）
 */

import { EventEmitter } from 'node:events'
import { BrowserWindow } from 'electron'
import type { DatabaseManager } from '../../db/database'
import { TutorialRepository } from '../tutorial-repo'
import { TutorialSourceRegistry } from './tutorial-source-registry'
import { crawlArchWikiOffline } from './arch-wiki-offline'
import { crawlLdpHowtos } from './ldp-howtos-offline'
import { crawlTldrPages } from './tldr-pages-offline'
import { crawlArtOfCommandLine } from './art-of-command-line-offline'
import { crawlLinuxCommand } from './linux-command-offline'
import { crawlLinuxJourney } from './linux-journey-offline'
import { crawlKernelOrg } from './kernel-org-offline'
import { crawlDebianWiki } from './debian-wiki-offline'
import { crawlUbuntuHelp } from './ubuntu-help-offline'
import { crawlMsLearn } from './ms-learn-offline'
import { CheckpointService } from './checkpoint-service'
import { getDiskBudget, sweepOrphans, type DiskInfo } from './disk-budget'
import { filterLowQuality } from './quality-filter'
import type { CrawlProgress, CrawlResult, CrawlStartArgs, CrawlStatus, TutorialSourceSpec } from '@shared/crawler-types'
import type { TutorialEntry } from '../types'

/** 抓取进度事件 channel（与 preload 约定） */
export const TUTORIAL_CRAWL_PROGRESS_CHANNEL = 'tutorial:crawlProgress'
/** 抓取完成事件 channel */
export const TUTORIAL_CRAWL_DONE_CHANNEL = 'tutorial:crawlDone'

/** 抓取器函数签名 */
type CrawlerFn = (
  onProgress: (p: CrawlProgress) => void,
  signal: AbortSignal
) => Promise<TutorialEntry[]>

/** 抓取器映射表（id → 实现） */
const CRAWLERS: Record<string, CrawlerFn> = {
  // Phase 1-a: 离线 dump（官方 tar.gz / 索引页）
  'arch-wiki': crawlArchWikiOffline,
  'ldp-howtos': crawlLdpHowtos,
  // Phase 1-d: GitHub 克隆（公开仓库，零爬虫礼仪风险）
  'tldr-pages': crawlTldrPages,
  'art-of-command-line': crawlArtOfCommandLine,
  'linux-command': crawlLinuxCommand,
  'linux-journey': crawlLinuxJourney,
  // Phase 2-d/e: 在线抓取（kernel.org / wiki.debian.org）
  'kernel-org': crawlKernelOrg,
  'wiki-debian': crawlDebianWiki,
  // Phase 2 补完（v0.7.0 Sprint 1）：ubuntu-help / ms-learn
  'ubuntu-help': crawlUbuntuHelp,
  'ms-learn': crawlMsLearn
  // Phase 2 后续接入：redhat-docs / digitalocean / linuxize / tecmint
}

/**
 * 教程爬虫服务
 */
export class TutorialCrawlerService {
  private readonly repo: TutorialRepository
  private readonly registry: TutorialSourceRegistry
  private readonly checkpoint: CheckpointService
  private readonly diskBudget = getDiskBudget()
  private readonly emitter = new EventEmitter()
  private status: CrawlStatus = { running: false, history: [] }
  private mutex: Promise<void> = Promise.resolve()
  private abortController: AbortController | null = null

  constructor(
    private readonly db: DatabaseManager,
    private readonly getMainWindow: () => BrowserWindow | null
  ) {
    this.repo = new TutorialRepository(db)
    this.registry = TutorialSourceRegistry.getInstance()
    this.checkpoint = new CheckpointService(db)
    this.checkpoint.ensureTable()
  }

  /** 监听进度事件 */
  onProgress(listener: (p: CrawlProgress) => void): () => void {
    this.emitter.on('progress', listener)
    return () => this.emitter.off('progress', listener)
  }

  /** 监听完成事件 */
  onDone(listener: (r: CrawlResult) => void): () => void {
    this.emitter.on('done', listener)
    return () => this.emitter.off('done', listener)
  }

  /** 获取所有源 */
  listSources(): TutorialSourceSpec[] {
    return this.registry.getAll()
  }

  /** 获取当前抓取状态 */
  getStatus(): CrawlStatus {
    return { ...this.status }
  }

  /**
   * 获取磁盘信息（用于 UI 展示）
   */
  async getDiskInfo(): Promise<DiskInfo> {
    return this.diskBudget.getDiskInfo()
  }

  /**
   * 手动触发孤儿文件清理
   */
  async cleanupOrphans(): Promise<number> {
    return sweepOrphans()
  }

  /** 获取 checkpoint 状态 */
  getCheckpoints() {
    return this.checkpoint.getAll()
  }

  /** 强制重新抓取某个源 */
  resetCheckpoint(sourceId: string): void {
    this.checkpoint.clear(sourceId)
  }

  /**
   * 启动抓取任务
   *
   * @param args 抓取参数
   * @returns 抓取结果汇总
   */
  async start(args: CrawlStartArgs = {}): Promise<CrawlResult[]> {
    // 启动时清理 24h 前的孤儿文件（避免 C 盘膨胀）
    if (this.db.isAvailable()) {
      sweepOrphans().catch((err) => {
        console.warn(`[TutorialCrawlerService] 孤儿清理失败: ${(err as Error).message}`)
      })
    }
    // 互斥锁：防止并发
    return new Promise((resolve, reject) => {
      this.mutex = this.mutex.then(async () => {
        try {
          const results = await this._doStart(args)
          resolve(results)
        } catch (err) {
          reject(err)
        } finally {
          this.abortController = null
        }
      })
    })
  }

  /**
   * 取消当前抓取任务
   *
   * 取消后：
   * - 当前 HTTP 请求会被 AbortController 中断
   * - 已完成源的 result 会保留在 status.history
   * - 未开始的源不再执行
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.status.cancelled = true
      this.emitProgress({
        sourceId: 'system',
        sourceLabel: '系统',
        phase: 'error',
        message: '用户已取消抓取任务',
        progress: this.status.current?.progress ?? 0,
        processed: this.status.current?.processed ?? 0,
        total: this.status.current?.total ?? 0,
        error: '用户已取消'
      })
    }
  }

  private async _doStart(args: CrawlStartArgs): Promise<CrawlResult[]> {
    if (this.status.running) {
      throw new Error('已有抓取任务在进行中，请等待完成')
    }

    this.abortController = new AbortController()
    const signal = this.abortController.signal

    // 1. 确定要抓取的源
    let targets: TutorialSourceSpec[]

    if (args.sourceIds && args.sourceIds.length > 0) {
      // 指定了源 ID
      targets = args.sourceIds
        .map((id) => this.registry.get(id))
        .filter((s): s is TutorialSourceSpec => s !== undefined)
    } else {
      // 未指定 → 用 Phase 1 默认启用的源
      targets = this.registry.getPhase1DefaultSources()
    }

    // 2. 过滤未实现的爬虫器
    const validTargets = targets.filter((s) => CRAWLERS[s.id])
    if (validTargets.length === 0) {
      throw new Error(
        `没有可抓取的源。当前 Phase 1 已实现: ${Object.keys(CRAWLERS).join(', ')}\n` +
        `请求的源: ${targets.map((s) => s.id).join(', ')}`
      )
    }

    // 3. 更新状态
    this.status = {
      running: true,
      history: [],
      startedAt: Date.now(),
      cancelled: false
    }
    this.emitProgress({
      sourceId: 'system',
      sourceLabel: '系统',
      phase: 'parsing',
      message: `准备抓取 ${validTargets.length} 个源: ${validTargets.map((s) => s.label).join(', ')}`,
      progress: 0,
      processed: 0,
      total: validTargets.length
    })

    // 4. 串行抓取（避免网络/IO 资源竞争）
    const results: CrawlResult[] = []
    for (let i = 0; i < validTargets.length; i++) {
      // 每个源开始前检查是否已取消
      if (signal.aborted) {
        this.emitProgress({
          sourceId: 'system',
          sourceLabel: '系统',
          phase: 'error',
          message: `已取消，剩余 ${validTargets.length - i} 个源未执行`,
          progress: i / validTargets.length,
          processed: i,
          total: validTargets.length,
          error: '用户已取消'
        })
        break
      }

      const source = validTargets[i]
      const crawler = CRAWLERS[source.id]
      const startMs = Date.now()

      // 标记 checkpoint 开始（断点续传）
      this.checkpoint.start(source.id)

      // 申请临时目录（disk-budget）
      let tempDir: string | null = null
      try {
        tempDir = await this.diskBudget.allocDir(source.id)
      } catch {
        // 申请失败也不阻塞抓取（部分源不需要临时目录）
      }

      try {
        // 抓取
        const rawEntries = await crawler((p) => {
          // 把 phase 设为 downloading 时也算整体进度
          const overallProgress = (i + p.progress) / validTargets.length
          this.emitProgress({
            ...p,
            message: `[${i + 1}/${validTargets.length}] ${p.message}`,
            progress: overallProgress
          })
        }, signal)

        // 质量过滤（5 维评分，threshold=0.3）
        const existingEntries = this.repo.listAll()
        const filterResult = filterLowQuality(rawEntries, {
          threshold: 0.3,
          minLength: 200,
          enableDedup: true,
          existingEntries
        })

        if (filterResult.dropped.length > 0) {
          this.emitProgress({
            sourceId: source.id,
            sourceLabel: source.label,
            phase: 'parsing',
            message: `🧹 质量过滤：丢弃 ${filterResult.dropped.length} 条（保留 ${filterResult.entries.length}）`,
            progress: (i + 0.85) / validTargets.length,
            processed: filterResult.entries.length,
            total: rawEntries.length
          })
        }

        // 持久化（已过滤）
        this.emitProgress({
          sourceId: source.id,
          sourceLabel: source.label,
          phase: 'persisting',
          message: `写入 SQLite（${filterResult.entries.length} 条）...`,
          progress: (i + 0.9) / validTargets.length,
          processed: filterResult.entries.length,
          total: filterResult.entries.length
        })
        const stats = this.repo.upsertMany(filterResult.entries)
        const durationMs = Date.now() - startMs

        // 标记 checkpoint 完成
        this.checkpoint.complete(source.id)

        // 累计过滤统计到 status
        if (!this.status.totalFiltered) this.status.totalFiltered = 0
        this.status.totalFiltered += filterResult.dropped.length

        // 错误信息携带过滤摘要（兼容 CrawlResult 字段）
        const filterSummary =
          filterResult.dropped.length > 0
            ? [
                `已过滤 ${filterResult.dropped.length} 条低质量（${Object.entries(
                  filterResult.stats.byReason
                )
                  .slice(0, 2)
                  .map(([k, v]) => `${k}:${v}`)
                  .join(', ')}）`
              ]
            : []

        const result: CrawlResult = {
          sourceId: source.id,
          sourceLabel: source.label,
          inserted: stats.inserted,
          updated: stats.updated,
          skipped: stats.skipped + filterResult.dropped.length,
          failed: rawEntries.length - filterResult.entries.length - stats.skipped,
          durationMs,
          errors: filterSummary
        }
        results.push(result)
        this.status.history.push(result)

        this.emitProgress({
          sourceId: source.id,
          sourceLabel: source.label,
          phase: 'done',
          message: `✅ ${source.label} 完成：新增 ${stats.inserted}，更新 ${stats.updated}，过滤 ${filterResult.dropped.length}（${(durationMs / 1000).toFixed(1)}s）`,
          progress: (i + 1) / validTargets.length,
          processed: filterResult.entries.length,
          total: rawEntries.length
        })
        this.emitDone(result)
      } catch (err) {
        const durationMs = Date.now() - startMs
        const errorMsg = (err as Error).message

        // checkpoint 标记失败
        this.checkpoint.fail(source.id, errorMsg)

        // 如果是用户取消导致的异常，不再记录为失败源，直接结束本轮
        if (signal.aborted || this.status.cancelled || errorMsg.includes('已取消')) {
          this.emitProgress({
            sourceId: source.id,
            sourceLabel: source.label,
            phase: 'error',
            message: `⏹️ ${source.label} 已取消`,
            progress: (i + 1) / validTargets.length,
            processed: 0,
            total: 0,
            error: '用户已取消'
          })
          break
        }

        const result: CrawlResult = {
          sourceId: source.id,
          sourceLabel: source.label,
          inserted: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          durationMs,
          errors: [errorMsg]
        }
        results.push(result)
        this.status.history.push(result)

        this.emitProgress({
          sourceId: source.id,
          sourceLabel: source.label,
          phase: 'error',
          message: `❌ ${source.label} 失败：${errorMsg}`,
          progress: (i + 1) / validTargets.length,
          processed: 0,
          total: 0,
          error: errorMsg
        })
        this.emitDone(result)
      } finally {
        // 释放临时目录（关键：成功/失败/取消都清）
        if (tempDir) {
          await this.diskBudget.releaseDir(tempDir).catch((err) => {
            console.warn(`[TutorialCrawlerService] 临时目录清理失败: ${(err as Error).message}`)
          })
        }
      }
    }

    this.status.running = false
    return results
  }

  private emitProgress(p: CrawlProgress): void {
    this.status.current = p
    this.emitter.emit('progress', p)
    // 推送到渲染端
    const win = this.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(TUTORIAL_CRAWL_PROGRESS_CHANNEL, p)
    }
  }

  private emitDone(r: CrawlResult): void {
    this.emitter.emit('done', r)
    const win = this.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(TUTORIAL_CRAWL_DONE_CHANNEL, r)
    }
  }
}
