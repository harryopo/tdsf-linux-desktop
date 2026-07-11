/**
 * SQLite 数据库管理器
 *
 * 基于 better-sqlite3 提供 SQLite 数据库的初始化、连接管理和向量搜索扩展。
 *
 * 核心功能：
 *   - 单例模式（一个进程一个 Database 实例）
 *   - WAL 模式（提升并发读写性能）
 *   - 自动建表（knowledge_entries / decision_cards / audit_logs / settings）
 *   - sqlite-vec 扩展加载（失败时降级到关键词搜索）
 *
 * 数据库文件位置：
 *   Electron 环境下位于 app.getPath('userData')/tdsf.db
 *   测试环境（无 Electron）下位于 :memory: 或临时文件
 *
 * 注意：better-sqlite3 是原生模块，在 Electron 主进程需通过 electron-rebuild 重新编译。
 * 参考：_legacy-python/src/tdsf_desktop/storage/sqlite_db.py
 */

import Database from 'better-sqlite3'
import type { Database as BetterSqlite3Database, Statement } from 'better-sqlite3'
import * as path from 'node:path'

/** Database 类型别名（避免与类名冲突） */
export type DbConnection = BetterSqlite3Database

/**
 * SQLite 数据库管理器（单例）
 *
 * 提供：
 *   - getInstance(): 获取单例（首次调用时初始化）
 *   - close(): 关闭连接
 *   - exec(sql): 执行 SQL（建表、PRAGMA 等）
 *   - prepare(sql): 预编译语句
 *   - isVectorEnabled(): 向量搜索是否可用
 */
export class DatabaseManager {
  /** 单例实例 */
  private static instance: DatabaseManager | null = null

  /** better-sqlite3 连接实例 */
  private readonly db: DbConnection

  /** 向量搜索扩展是否加载成功 */
  private readonly vectorEnabled: boolean

  /** 私有构造，强制单例 */
  private constructor(dbPath: string) {
    // 打开数据库连接（dbPath 为 ':memory:' 时为内存数据库）
    this.db = new Database(dbPath)
    // 启用 WAL 模式（提升并发读写性能，内存数据库下会被忽略）
    try {
      this.db.pragma('journal_mode = WAL')
    } catch {
      // 内存数据库不支持 WAL，忽略错误
    }
    // 尝试加载 sqlite-vec 向量搜索扩展
    this.vectorEnabled = this.tryLoadVectorExtension()
    // 初始化所有表
    this.initTables()
  }

  /**
   * 获取单例实例
   *
   * 首次调用时使用 dbPath 初始化，后续调用忽略 dbPath 参数返回已有实例。
   * 在 Electron 主进程中，应在 app.whenReady() 后调用，传入 userData 目录下的路径。
   *
   * @param dbPath 数据库文件路径（仅首次调用生效）
   * @returns 单例实例
   */
  static getInstance(dbPath?: string): DatabaseManager {
    if (!DatabaseManager.instance) {
      const resolvedPath = dbPath ?? ':memory:'
      DatabaseManager.instance = new DatabaseManager(resolvedPath)
    }
    return DatabaseManager.instance
  }

  /**
   * 重置单例（仅用于测试）
   *
   * 关闭现有连接并清除单例，下次 getInstance 会重新初始化。
   * @internal
   */
  static resetInstance(): void {
    if (DatabaseManager.instance) {
      try {
        DatabaseManager.instance.db.close()
      } catch {
        // 忽略关闭错误
      }
      DatabaseManager.instance = null
    }
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    try {
      this.db.close()
    } catch {
      // 忽略重复关闭
    }
  }

  /**
   * 执行 SQL（无参数，如建表、PRAGMA）
   * @param sql SQL 语句
   */
  exec(sql: string): void {
    this.db.exec(sql)
  }

  /**
   * 预编译 SQL 语句
   * @param sql SQL 语句（使用 ? 或 @name 占位符）
   * @returns 预编译语句
   */
  prepare(sql: string): Statement {
    return this.db.prepare(sql)
  }

  /**
   * 检查向量搜索是否可用
   * @returns true 表示 sqlite-vec 扩展加载成功
   */
  isVectorEnabled(): boolean {
    return this.vectorEnabled
  }

  /**
   * 获取原始 better-sqlite3 连接（供高级用法使用）
   * @internal
   */
  getRawConnection(): DbConnection {
    return this.db
  }

  // ────────── 内部方法 ──────────

  /**
   * 尝试加载 sqlite-vec 向量搜索扩展
   *
   * 加载失败时降级到关键词搜索，不影响数据库核心功能。
   * 失败原因可能是：扩展文件缺失、ABI 版本不匹配、平台不支持。
   *
   * @returns true 表示加载成功
   */
  private tryLoadVectorExtension(): boolean {
    try {
      // @photostructure/sqlite-vec 提供 loadExtension 函数
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sqliteVec = require('@photostructure/sqlite-vec')
      if (typeof sqliteVec.load === 'function') {
        sqliteVec.load(this.db)
        return true
      }
      // 某些版本导出 install 而非 load
      if (typeof sqliteVec.install === 'function') {
        sqliteVec.install(this.db)
        return true
      }
      return false
    } catch {
      // 扩展加载失败，降级到关键词搜索
      return false
    }
  }

  /**
   * 初始化所有表
   *
   * 使用 CREATE TABLE IF NOT EXISTS，重复调用安全。
   * 表结构参考 _legacy-python/src/tdsf_desktop/storage/schemas.py
   */
  private initTables(): void {
    // 知识库表（command_skills + incident_cases 双轨制）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_entries (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        problem TEXT NOT NULL,
        rootCause TEXT,
        commands TEXT NOT NULL,
        rollbackCommands TEXT,
        verification TEXT,
        keywords TEXT NOT NULL,
        tags TEXT NOT NULL,
        successRate REAL NOT NULL DEFAULT 0,
        useCount INTEGER NOT NULL DEFAULT 0,
        embedding TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kb_type ON knowledge_entries(type);
      CREATE INDEX IF NOT EXISTS idx_kb_title ON knowledge_entries(title);
    `)

    // 决策历史表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS decision_cards (
        id TEXT PRIMARY KEY,
        problem TEXT NOT NULL,
        hypothesis TEXT NOT NULL,
        evidences TEXT NOT NULL,
        confidence REAL NOT NULL,
        risk TEXT NOT NULL,
        fixCommand TEXT NOT NULL,
        fixDescription TEXT,
        rollbackCommand TEXT,
        status TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        sessionId TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_dc_status ON decision_cards(status);
      CREATE INDEX IF NOT EXISTS idx_dc_timestamp ON decision_cards(timestamp);
    `)

    // 审计日志表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        action TEXT NOT NULL,
        command TEXT,
        exitCode INTEGER,
        userId TEXT,
        sessionId TEXT,
        riskLevel TEXT,
        details TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_logs(sessionId);
    `)

    // 设置表（键值对存储）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `)
  }
}

/**
 * 解析数据库文件路径（Electron 环境下使用）
 *
 * 在主进程入口 app.whenReady() 后调用：
 *   const dbPath = resolveDbPath(app.getPath('userData'))
 *   DatabaseManager.getInstance(dbPath)
 *
 * @param userDataDir Electron userData 目录
 * @returns 数据库文件完整路径
 */
export function resolveDbPath(userDataDir: string): string {
  return path.join(userDataDir, 'tdsf.db')
}
