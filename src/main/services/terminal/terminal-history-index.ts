/**
 * 终端命令历史索引
 *
 * Phase 1 零 Token 智能补全的基础设施：
 * - 基于 better-sqlite3 的本地 SQLite 索引
 * - 记录每条命令的原始文本、执行时间、命中次数、最后使用时间
 * - 支持 Frecency（频次 + 衰减）排序
 * - 支持前缀查询（供 Trie 构建）和模糊查询（fallback）
 *
 * 表结构：
 *   terminal_history
 *     id          INTEGER PRIMARY KEY
 *     command     TEXT NOT NULL UNIQUE  -- 命令原始文本（trim 后）
 *     count       INTEGER DEFAULT 1     -- 累计使用次数
 *     firstUsedAt INTEGER               -- 首次使用时间戳（毫秒）
 *     lastUsedAt  INTEGER               -- 最后使用时间戳（毫秒）
 *     directory   TEXT                  -- 执行时工作目录（可选，未来用于上下文排序）
 */

import Database from 'better-sqlite3'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'

/** 单条历史命令记录 */
export interface TerminalHistoryRecord {
  command: string
  count: number
  firstUsedAt: number
  lastUsedAt: number
  directory?: string
}

/** Frecency 分数计算结果 */
export interface FrecencyItem {
  command: string
  score: number
  count: number
  lastUsedAt: number
}

/** 历史索引配置 */
export interface TerminalHistoryIndexOptions {
  /** 数据库文件路径（默认 userData/terminal-history.db） */
  dbPath?: string
}

/** Frecency 半衰期（毫秒）：30 天 */
const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000
/** 最大返回条数 */
const DEFAULT_LIMIT = 50

export class TerminalHistoryIndex {
  private db: Database.Database

  constructor(options: TerminalHistoryIndexOptions = {}) {
    const dbPath = options.dbPath ?? this.defaultDbPath()
    const dbDir = path.dirname(dbPath)
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }
    this.db = new Database(dbPath)
    this.initTables()
  }

  /** 默认数据库存放路径 */
  private defaultDbPath(): string {
    return path.join(os.homedir(), '.tdsf', 'terminal-history.db')
  }

  /** 初始化表与索引 */
  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS terminal_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        command     TEXT NOT NULL UNIQUE,
        count       INTEGER NOT NULL DEFAULT 1,
        firstUsedAt INTEGER NOT NULL,
        lastUsedAt  INTEGER NOT NULL,
        directory   TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_terminal_history_last_used ON terminal_history(lastUsedAt);
      CREATE INDEX IF NOT EXISTS idx_terminal_history_command ON terminal_history(command);
    `)
  }

  /**
   * 记录一次命令使用
   *
   * - 已存在：count + 1，更新 lastUsedAt
   * - 不存在：插入新记录
   *
   * @param command 命令原始文本（会自动 trim）
   * @param directory 执行时工作目录（可选）
   */
  record(command: string, directory?: string): void {
    const normalized = command.trim()
    if (!normalized || normalized.length > 2000) return

    const now = Date.now()
    const stmt = this.db.prepare(`
      INSERT INTO terminal_history (command, count, firstUsedAt, lastUsedAt, directory)
      VALUES (?, 1, ?, ?, ?)
      ON CONFLICT(command) DO UPDATE SET
        count = count + 1,
        lastUsedAt = ?,
        directory = COALESCE(?, directory)
    `)
    stmt.run(normalized, now, now, directory ?? null, now, directory ?? null)
  }

  /**
   * 批量记录命令（用于导入远端 history 文件）
   *
   * @param commands 命令列表（时间从早到晚，lastUsedAt 会递增）
   * @param directory 工作目录（可选）
   */
  importCommands(commands: string[], directory?: string): void {
    const now = Date.now()
    const insert = this.db.prepare(`
      INSERT INTO terminal_history (command, count, firstUsedAt, lastUsedAt, directory)
      VALUES (?, 1, ?, ?, ?)
      ON CONFLICT(command) DO UPDATE SET
        count = count + 1,
        lastUsedAt = MAX(lastUsedAt, ?),
        directory = COALESCE(?, directory)
    `)
    const batchSize = 500
    for (let i = 0; i < commands.length; i += batchSize) {
      const batch = commands.slice(i, i + batchSize)
      const transaction = this.db.transaction((items: string[]) => {
        for (let idx = 0; idx < items.length; idx++) {
          const normalized = items[idx].trim()
          if (!normalized) continue
          // 按批次内顺序均匀分布时间戳，保证越新的命令 lastUsedAt 越大
          const ts = now - (items.length - idx) * 1000
          insert.run(normalized, ts, ts, directory ?? null, ts, directory ?? null)
        }
      })
      transaction(batch)
    }
  }

  /**
   * 前缀查询：返回以 prefix 开头的命令，按 Frecency 排序
   */
  searchByPrefix(prefix: string, limit: number = DEFAULT_LIMIT): FrecencyItem[] {
    if (!prefix) return []
    const stmt = this.db.prepare(`
      SELECT command, count, lastUsedAt
      FROM terminal_history
      WHERE command LIKE ?
      ORDER BY lastUsedAt DESC
      LIMIT ?
    `)
    const rows = stmt.all(`${prefix}%`, limit) as Array<{
      command: string
      count: number
      lastUsedAt: number
    }>
    return this.computeFrecency(rows)
  }

  /**
   * 模糊查询：用于前缀无结果时 fallback
   */
  searchFuzzy(query: string, limit: number = DEFAULT_LIMIT): FrecencyItem[] {
    if (!query) return []
    const tokens = query.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return []
    // 简单实现：命令包含所有 token 即可
    const likePattern = `%${tokens.join('%')}%`
    const stmt = this.db.prepare(`
      SELECT command, count, lastUsedAt
      FROM terminal_history
      WHERE command LIKE ?
      ORDER BY lastUsedAt DESC
      LIMIT ?
    `)
    const rows = stmt.all(likePattern, limit) as Array<{
      command: string
      count: number
      lastUsedAt: number
    }>
    return this.computeFrecency(rows)
  }

  /**
   * 获取全部历史命令（用于构建内存 Trie）
   */
  getAll(limit: number = 10000): FrecencyItem[] {
    const stmt = this.db.prepare(`
      SELECT command, count, lastUsedAt
      FROM terminal_history
      ORDER BY lastUsedAt DESC
      LIMIT ?
    `)
    const rows = stmt.all(limit) as Array<{
      command: string
      count: number
      lastUsedAt: number
    }>
    return this.computeFrecency(rows)
  }

  /**
   * Frecency 分数计算
   *
   * score = count * 0.5 ^ (now - lastUsedAt) / halfLife
   * 使用指数衰减，越近使用分数越高，使用次数也有加成。
   */
  private computeFrecency(
    rows: Array<{ command: string; count: number; lastUsedAt: number }>,
  ): FrecencyItem[] {
    const now = Date.now()
    return rows.map((row) => {
      const ageMs = Math.max(0, now - row.lastUsedAt)
      const decay = Math.pow(0.5, ageMs / HALF_LIFE_MS)
      const score = row.count * decay
      return {
        command: row.command,
        score,
        count: row.count,
        lastUsedAt: row.lastUsedAt,
      }
    })
  }

  /**
   * 清空历史
   */
  clear(): void {
    this.db.exec('DELETE FROM terminal_history')
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db.close()
  }
}
