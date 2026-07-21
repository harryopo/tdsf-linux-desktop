/**
 * 断点续传 Checkpoint 服务
 *
 * 教学术语：
 * - Checkpoint (检查点)：长任务中间状态快照
 * - Resume (续传)：崩溃后从检查点恢复
 * - Idempotent (幂等)：相同操作多次结果一致
 *
 * 数据存储：SQLite 表 crawl_checkpoints
 *   - source_id      TEXT PRIMARY KEY
 *   - last_crawled_at INTEGER   (上次抓取时间)
 *   - completed_urls  TEXT       (已抓取 URL 列表，JSON)
 *   - total_bytes     INTEGER    (已下载字节，用于 Range 续传)
 *   - etag            TEXT       (HTTP ETag，缓存命中)
 *   - status          TEXT       ('running' | 'paused' | 'done' | 'failed')
 *   - error_message   TEXT       (失败原因)
 *   - updated_at      INTEGER
 *
 * 使用：
 *   import { CheckpointService } from './checkpoint-service'
 *
 *   const cp = new CheckpointService(db)
 *   await cp.start('tldr-pages')                 // 标记开始
 *   await cp.markUrlDone('tldr-pages', url1)     // 标记 URL 完成
 *   await cp.markUrlDone('tldr-pages', url2)
 *   await cp.complete('tldr-pages')             // 标记完成
 *
 *   // 崩溃后恢复：
 *   const pending = await cp.getPendingUrls('tldr-pages', allUrls)
 *   // pending = allUrls - completedUrls
 */

import type { DatabaseManager } from '../../db/database'

/** Checkpoint 状态 */
export type CheckpointStatus = 'running' | 'paused' | 'done' | 'failed'

/** Checkpoint 数据 */
export interface Checkpoint {
  sourceId: string
  lastCrawledAt: number
  completedUrls: string[]
  totalBytes: number
  etag: string | null
  status: CheckpointStatus
  errorMessage: string | null
  updatedAt: number
}

/** Checkpoint 服务 */
export class CheckpointService {
  constructor(private readonly db: DatabaseManager) {}

  /**
   * 确保表存在
   */
  ensureTable(): void {
    if (!this.db.isAvailable()) return
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS crawl_checkpoints (
        source_id TEXT PRIMARY KEY,
        last_crawled_at INTEGER NOT NULL,
        completed_urls TEXT NOT NULL DEFAULT '[]',
        total_bytes INTEGER NOT NULL DEFAULT 0,
        etag TEXT,
        status TEXT NOT NULL,
        error_message TEXT,
        updated_at INTEGER NOT NULL
      )
    `)
  }

  /**
   * 启动新任务（覆盖已有 checkpoint）
   */
  start(sourceId: string): void {
    this.ensureTable()
    if (!this.db.isAvailable()) return
    const now = Date.now()
    this.db
      .prepare(
        `INSERT OR REPLACE INTO crawl_checkpoints
         (source_id, last_crawled_at, completed_urls, total_bytes, etag, status, error_message, updated_at)
         VALUES (?, ?, '[]', 0, NULL, 'running', NULL, ?)`
      )
      .run(sourceId, now, now)
  }

  /**
   * 标记 URL 完成
   */
  markUrlDone(sourceId: string, url: string): void {
    if (!this.db.isAvailable()) return
    const cp = this.get(sourceId)
    if (!cp) return
    if (cp.completedUrls.includes(url)) return
    const updated = [...cp.completedUrls, url]
    this.db
      .prepare(
        `UPDATE crawl_checkpoints
         SET completed_urls = ?, updated_at = ?
         WHERE source_id = ?`
      )
      .run(JSON.stringify(updated), Date.now(), sourceId)
  }

  /**
   * 批量标记 URL 完成（性能优化）
   */
  markUrlsDone(sourceId: string, urls: string[]): void {
    if (!this.db.isAvailable() || urls.length === 0) return
    const cp = this.get(sourceId)
    if (!cp) return
    const existing = new Set(cp.completedUrls)
    for (const url of urls) existing.add(url)
    this.db
      .prepare(
        `UPDATE crawl_checkpoints
         SET completed_urls = ?, updated_at = ?
         WHERE source_id = ?`
      )
      .run(JSON.stringify(Array.from(existing)), Date.now(), sourceId)
  }

  /**
   * 更新已下载字节数（用于 HTTP Range 续传）
   */
  updateBytes(sourceId: string, bytes: number, etag: string | null = null): void {
    if (!this.db.isAvailable()) return
    this.db
      .prepare(
        `UPDATE crawl_checkpoints
         SET total_bytes = ?, etag = ?, updated_at = ?
         WHERE source_id = ?`
      )
      .run(bytes, etag, Date.now(), sourceId)
  }

  /**
   * 标记任务完成
   */
  complete(sourceId: string): void {
    if (!this.db.isAvailable()) return
    this.db
      .prepare(
        `UPDATE crawl_checkpoints
         SET status = 'done', updated_at = ?
         WHERE source_id = ?`
      )
      .run(Date.now(), sourceId)
  }

  /**
   * 标记任务失败
   */
  fail(sourceId: string, error: string): void {
    if (!this.db.isAvailable()) return
    this.db
      .prepare(
        `UPDATE crawl_checkpoints
         SET status = 'failed', error_message = ?, updated_at = ?
         WHERE source_id = ?`
      )
      .run(error, Date.now(), sourceId)
  }

  /**
   * 标记任务暂停
   */
  pause(sourceId: string): void {
    if (!this.db.isAvailable()) return
    this.db
      .prepare(
        `UPDATE crawl_checkpoints
         SET status = 'paused', updated_at = ?
         WHERE source_id = ?`
      )
      .run(Date.now(), sourceId)
  }

  /**
   * 清除 checkpoint（强制重新抓取）
   */
  clear(sourceId: string): void {
    if (!this.db.isAvailable()) return
    this.db
      .prepare('DELETE FROM crawl_checkpoints WHERE source_id = ?')
      .run(sourceId)
  }

  /**
   * 获取 checkpoint
   */
  get(sourceId: string): Checkpoint | null {
    if (!this.db.isAvailable()) return null
    const row = this.db
      .prepare('SELECT * FROM crawl_checkpoints WHERE source_id = ?')
      .get(sourceId) as CheckpointRow | undefined
    if (!row) return null
    return this.deserialize(row)
  }

  /**
   * 获取所有 checkpoint
   */
  getAll(): Checkpoint[] {
    if (!this.db.isAvailable()) return []
    const rows = this.db
      .prepare('SELECT * FROM crawl_checkpoints ORDER BY updated_at DESC')
      .all() as CheckpointRow[]
    return rows.map((r) => this.deserialize(r))
  }

  /**
   * 计算待抓取 URL（allUrls - completedUrls）
   */
  getPendingUrls(sourceId: string, allUrls: string[]): string[] {
    const cp = this.get(sourceId)
    if (!cp) return allUrls
    const doneSet = new Set(cp.completedUrls)
    return allUrls.filter((u) => !doneSet.has(u))
  }

  /**
   * 是否需要重新抓取（基于 last_crawled_at 和 force 参数）
   */
  shouldRecrawl(sourceId: string, force: boolean = false, maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): boolean {
    if (force) return true
    const cp = this.get(sourceId)
    if (!cp) return true
    if (cp.status !== 'done') return true
    return Date.now() - cp.lastCrawledAt > maxAgeMs
  }

  // ────────── 内部 ──────────

  private deserialize(row: CheckpointRow): Checkpoint {
    let urls: string[] = []
    try {
      urls = JSON.parse(row.completed_urls)
    } catch {
      urls = []
    }
    return {
      sourceId: row.source_id,
      lastCrawledAt: row.last_crawled_at,
      completedUrls: urls,
      totalBytes: row.total_bytes,
      etag: row.etag,
      status: row.status as CheckpointStatus,
      errorMessage: row.error_message,
      updatedAt: row.updated_at
    }
  }
}

interface CheckpointRow {
  source_id: string
  last_crawled_at: number
  completed_urls: string
  total_bytes: number
  etag: string | null
  status: string
  error_message: string | null
  updated_at: number
}
