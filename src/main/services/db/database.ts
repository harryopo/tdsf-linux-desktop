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
 *       如果 better-sqlite3 加载失败（ABI 不匹配等），会降级到内存 Map 回退方案。
 * 参考：_legacy-python/src/tdsf_desktop/storage/sqlite_db.py
 */

import type { Database as BetterSqlite3Database, Statement } from 'better-sqlite3'
import * as path from 'node:path'

/** Database 类型别名（避免与类名冲突） */
export type DbConnection = BetterSqlite3Database

/**
 * 动态加载 better-sqlite3，失败时返回 null
 *
 * better-sqlite3 是原生模块，在 Electron 环境下可能出现 ABI 不匹配导致加载失败。
 * 使用动态 require + try/catch 确保即使加载失败也不会崩溃。
 */
function loadBetterSqlite3(): typeof import('better-sqlite3') | null {
  try {
     
    return require('better-sqlite3')
  } catch {
    console.warn('[DatabaseManager] better-sqlite3 加载失败，使用内存 Map 回退方案')
    return null
  }
}

/**
 * SQLite 数据库管理器（单例）
 *
 * 提供：
 *   - getInstance(): 获取单例（首次调用时初始化）
 *   - close(): 关闭连接
 *   - exec(sql): 执行 SQL（建表、PRAGMA 等）
 *   - prepare(sql): 预编译语句
 *   - isVectorEnabled(): 向量搜索是否可用
 *   - isAvailable(): 数据库是否真正可用（better-sqlite3 是否加载成功）
 */
export class DatabaseManager {
  /** 单例实例 */
  private static instance: DatabaseManager | null = null

  /** better-sqlite3 连接实例（dbAvailable=true 时有效） */
  private readonly db: DbConnection | null

  /** 向量搜索扩展是否加载成功 */
  private readonly vectorEnabled: boolean

  /** better-sqlite3 是否加载成功 */
  private readonly dbAvailable: boolean

  /** 内存回退存储（dbAvailable=false 时使用） */
  private readonly memoryStore: Map<string, string>

  /** 私有构造，强制单例 */
  private constructor(dbPath: string) {
    this.memoryStore = new Map()

    const BetterSqlite3 = loadBetterSqlite3()
    if (!BetterSqlite3) {
      // better-sqlite3 加载失败，使用内存 Map 回退
      this.db = null
      this.dbAvailable = false
      this.vectorEnabled = false
      console.warn('[DatabaseManager] 使用内存 Map 回退方案，数据不会持久化')
      return
    }

    this.dbAvailable = true
    // 打开数据库连接（dbPath 为 ':memory:' 时为内存数据库）
    this.db = new BetterSqlite3(dbPath)
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
   * 此方法永远不会抛出异常。
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
        if (DatabaseManager.instance.dbAvailable && DatabaseManager.instance.db) {
          DatabaseManager.instance.db.close()
        }
      } catch {
        // 忽略关闭错误
      }
      DatabaseManager.instance = null
    }
  }

  /**
   * 检查数据库是否真正可用（better-sqlite3 是否加载成功）
   * @returns true 表示 better-sqlite3 可用，false 表示使用内存 Map 回退
   */
  isAvailable(): boolean {
    return this.dbAvailable
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    try {
      if (this.dbAvailable && this.db) {
        this.db.close()
      }
    } catch {
      // 忽略重复关闭
    }
  }

  /**
   * 执行 SQL（无参数，如建表、PRAGMA）
   * @param sql SQL 语句
   */
  exec(sql: string): void {
    if (!this.dbAvailable || !this.db) {
      // 回退模式下忽略 SQL 执行
      return
    }
    this.db.exec(sql)
  }

  /**
   * 预编译 SQL 语句
   * @param sql SQL 语句（使用 ? 或 @name 占位符）
   * @returns 预编译语句（回退模式下返回 mock 对象）
   */
  prepare(sql: string): Statement {
    if (!this.dbAvailable || !this.db) {
      // 回退模式下返回一个安全的 mock Statement
      return this.createMockStatement(sql)
    }
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
  getRawConnection(): DbConnection | null {
    return this.db
  }

  // ────────── 内部方法 ──────────

  /**
   * 创建 mock Statement（回退模式下使用）
   *
   * 所有方法返回空结果，不会抛出异常。
   */
  private createMockStatement(_sql: string): Statement {
    // 使用类型断言绕过 Statement 接口限制
    return {
      run: () => ({ changes: 0, lastInsertRowid: 0n }),
      get: () => undefined,
      all: () => [],
      bind: function (...params: unknown[]) {
        void params
        return this
      },
      finalize: () => {},
    } as unknown as Statement
  }

  /**
   * 尝试加载 sqlite-vec 向量搜索扩展
   *
   * 加载失败时降级到关键词搜索，不影响数据库核心功能。
   * 失败原因可能是：扩展文件缺失、ABI 版本不匹配、平台不支持。
   *
   * @returns true 表示加载成功
   */
  private tryLoadVectorExtension(): boolean {
    if (!this.dbAvailable || !this.db) {
      return false
    }
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
    } catch (err) {
      // 扩展加载失败，降级到关键词搜索（打印错误便于诊断，生产环境可忽略）
      const msg = (err as Error)?.message ?? String(err)
      console.warn('[DatabaseManager] sqlite-vec 扩展加载失败，降级到关键词搜索：', msg)
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
    if (!this.dbAvailable || !this.db) {
      return
    }
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
        sessionId TEXT,
        serverId TEXT,
        durationMs INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_dc_status ON decision_cards(status);
      CREATE INDEX IF NOT EXISTS idx_dc_timestamp ON decision_cards(timestamp);
    `)

    // 迁移：为旧表添加新列（ALTER TABLE 幂等检查）
    this.migrateDecisionCardsTable()

    // 知识库浏览历史表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kb_view_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entryId TEXT NOT NULL,
        title TEXT NOT NULL,
        viewedAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kvh_entryId ON kb_view_history(entryId);
      CREATE INDEX IF NOT EXISTS idx_kvh_viewedAt ON kb_view_history(viewedAt);
    `)

    // v2.3.2 新增：工具调用日志表（用于 ModelSettings 功能调用统计）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tool_call_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        toolName TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tcl_toolName ON tool_call_log(toolName);
      CREATE INDEX IF NOT EXISTS idx_tcl_timestamp ON tool_call_log(timestamp);
    `)

    // v2.3.2 新增：预算告警事件表（用于 ModelSettings 告警历史）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS budget_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL,
        text TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ba_timestamp ON budget_alerts(timestamp);
    `)

    // v2.3.2 新增：教程学习进度表（用于 TutorialPage 跨设备同步，替代 localStorage）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_tutorial_progress (
        tutorialId TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        progress INTEGER NOT NULL,
        visitedAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_uta_updatedAt ON user_tutorial_progress(updatedAt);
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

    // ────────── FTS5 + vec0 虚拟表（Sprint 7 任务 A 新增）──────────
    // 注册向量辅助函数（触发器同步用，必须最先执行）
    this.registerVectorHelpers()
    // 初始化 FTS5 全文检索虚拟表 + 触发器
    this.initFts5Tables()
    // 初始化 decision_cards FTS5 虚拟表（BM25 搜索替代 LIKE）
    this.initDecisionFts()
    // 初始化 vec0 向量虚拟表 + 触发器（仅在 sqlite-vec 加载成功时创建）
    if (this.vectorEnabled) {
      this.initVec0Tables()
    }
    // 迁移：从 knowledge_entries 回填存量数据到 FTS / vec0
    this.backfillSearchTables()
  }

  // ────────── Sprint 7 任务 A：FTS5 + vec0 私有初始化方法 ──────────

  /**
   * 注册向量辅助函数
   *
   * 注册 SQLite 自定义函数 `json_to_vec_f32`：
   *   - 入参：JSON 字符串（如 "[0.1, 0.2, ...]"）
   *   - 返回：Buffer（Float32Array 的二进制表示）
   *
   * 用于触发器中将主表的 embedding TEXT 字段转换为 vec0 虚拟表接受的 BLOB 格式。
   *
   * 教术语义：
   *   - BGE-small-zh-v1.5 输出 512 维 float32 向量
   *   - sqlite-vec vec0 表期望 BLOB（little-endian float32 序列）
   */
  private registerVectorHelpers(): void {
    if (!this.dbAvailable || !this.db) return
    try {
      // 注册自定义函数：JSON 数组字符串 → Float32 BLOB
      // better-sqlite3 的 function() 入参为 sqlite_value（unknown），返回值支持 Buffer
      this.db.function('json_to_vec_f32', (json: unknown): Buffer | null => {
        if (typeof json !== 'string' || json.length === 0) return null
        try {
          const arr: unknown = JSON.parse(json)
          if (!Array.isArray(arr) || arr.length === 0) return null
          const float32 = new Float32Array(arr.length)
          for (let i = 0; i < arr.length; i++) {
            const v = Number(arr[i])
            if (!Number.isFinite(v)) return null
            float32[i] = v
          }
          // Float32Array → Buffer（共享底层 ArrayBuffer，零拷贝）
          return Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength)
        } catch {
          return null
        }
      })
    } catch (err) {
      // 注册失败时降级（不抛异常）
      console.warn('[DatabaseManager] 注册 json_to_vec_f32 失败：', err)
    }
  }

  /**
   * 迁移 decision_cards 表：为旧表添加 serverId / durationMs 列
   *
   * SQLite 不支持 IF NOT EXISTS 语法用于 ALTER TABLE ADD COLUMN，
   * 需先检查 pragma table_info 再决定是否添加。
   */
  private migrateDecisionCardsTable(): void {
    try {
      if (!this.db) return
      const columns = this.db.prepare('PRAGMA table_info(decision_cards)').all() as Array<{ name: string }>
      const colNames = columns.map((c) => c.name)
      if (!colNames.includes('serverId')) {
        this.db.exec('ALTER TABLE decision_cards ADD COLUMN serverId TEXT')
      }
      if (!colNames.includes('durationMs')) {
        this.db.exec('ALTER TABLE decision_cards ADD COLUMN durationMs INTEGER')
      }
    } catch {
      // 忽略迁移错误（表可能不存在或为新创建）
    }
  }

  /**
   * 初始化 FTS5 全文检索虚拟表
   *
   * FTS5 = Full Text Search 5，SQLite 内置全文检索引擎，支持 BM25 排序。
   *
   * 设计要点：
   *   - external content 模式：FTS 表通过 content='knowledge_entries' 引用主表，不重复存储全文
   *   - content_rowid='rowid'：用主表的 rowid（INTEGER 隐式字段）作为关联键
   *     （主表 id 是 TEXT，FTS5 要求 rowid INTEGER，所以借用主表 rowid）
   *   - 索引字段：title / problem / keywords（知识库主检索字段）
   *   - 分词器：unicode61 remove_diacritics 2（拉丁字母去重音 + 中文按字切分）
   *
   * 触发器：自动同步主表 → FTS 表
   *   - knowledge_ai (AFTER INSERT)：插入 FTS
   *   - knowledge_ad (AFTER DELETE)：从 FTS 删除（FTS5 特殊 'delete' 命令）
   *   - knowledge_au (AFTER UPDATE)：先删后插
   */
  private initFts5Tables(): void {
    if (!this.dbAvailable || !this.db) return
    try {
      // 创建 FTS5 影子表（external content 模式）
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
          id UNINDEXED,
          title,
          problem,
          keywords,
          content='knowledge_entries',
          content_rowid='rowid',
          tokenize='unicode61 remove_diacritics 2'
        );
      `)

      // 触发器：AFTER INSERT → 同步到 FTS
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge_entries BEGIN
          INSERT INTO knowledge_fts(rowid, title, problem, keywords)
          VALUES (new.rowid, new.title, new.problem, new.keywords);
        END;
      `)

      // 触发器：AFTER DELETE → 从 FTS 删除（FTS5 'delete' 命令）
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge_entries BEGIN
          INSERT INTO knowledge_fts(knowledge_fts, rowid, title, problem, keywords)
          VALUES ('delete', old.rowid, old.title, old.problem, old.keywords);
        END;
      `)

      // 触发器：AFTER UPDATE → 先删旧值再插新值
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge_entries BEGIN
          INSERT INTO knowledge_fts(knowledge_fts, rowid, title, problem, keywords)
          VALUES ('delete', old.rowid, old.title, old.problem, old.keywords);
          INSERT INTO knowledge_fts(rowid, title, problem, keywords)
          VALUES (new.rowid, new.title, new.problem, new.keywords);
        END;
      `)
    } catch (err) {
      // FTS5 初始化失败时降级（不抛异常，保证数据库核心功能可用）
      console.warn('[DatabaseManager] FTS5 初始化失败，降级到关键词搜索：', err)
    }
  }

  /**
   * 初始化 decision_cards FTS5 全文检索虚拟表
   *
   * 为 decision_cards 表创建 external-content FTS5 虚拟表 decision_fts，
   * 索引 problem / hypothesis / fixCommand 三个字段，支持 BM25 相关性排序。
   *
   * 同步触发器：
   *   - decision_fts_ai (AFTER INSERT)：插入 FTS
   *   - decision_fts_ad (AFTER DELETE)：从 FTS 删除
   *   - decision_fts_au (AFTER UPDATE)：先删后插
   */
  private initDecisionFts(): void {
    if (!this.dbAvailable || !this.db) return
    try {
      // 创建 FTS5 影子表（external content 模式）
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS decision_fts USING fts5(
          id UNINDEXED,
          problem,
          hypothesis,
          fixCommand,
          content='decision_cards',
          content_rowid='rowid',
          tokenize='unicode61 remove_diacritics 2'
        );
      `)

      // 触发器：AFTER INSERT → 同步到 FTS
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS decision_fts_ai AFTER INSERT ON decision_cards BEGIN
          INSERT INTO decision_fts(rowid, id, problem, hypothesis, fixCommand)
          VALUES (new.rowid, new.id, new.problem, new.hypothesis, new.fixCommand);
        END;
      `)

      // 触发器：AFTER DELETE → 从 FTS 删除
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS decision_fts_ad AFTER DELETE ON decision_cards BEGIN
          INSERT INTO decision_fts(decision_fts, rowid, id, problem, hypothesis, fixCommand)
          VALUES ('delete', old.rowid, old.id, old.problem, old.hypothesis, old.fixCommand);
        END;
      `)

      // 触发器：AFTER UPDATE → 先删旧值再插新值
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS decision_fts_au AFTER UPDATE ON decision_cards BEGIN
          INSERT INTO decision_fts(decision_fts, rowid, id, problem, hypothesis, fixCommand)
          VALUES ('delete', old.rowid, old.id, old.problem, old.hypothesis, old.fixCommand);
          INSERT INTO decision_fts(rowid, id, problem, hypothesis, fixCommand)
          VALUES (new.rowid, new.id, new.problem, new.hypothesis, new.fixCommand);
        END;
      `)
    } catch (err) {
      console.warn('[DatabaseManager] decision FTS5 初始化失败，降级到 LIKE 搜索：', err)
    }
  }

  /**
   * 初始化 vec0 向量虚拟表
   *
   * vec0 = sqlite-vec 提供的虚拟表，支持 KNN（K-Nearest Neighbors）向量检索。
   *
   * 设计要点：
   *   - embedding float[512]：BGE-small-zh-v1.5 输出 512 维向量
   *   - type TEXT PARTITION KEY：按类型分区，加速分类过滤（如只搜 command_skill）
   *   - id TEXT PRIMARY KEY：与主表 knowledge_entries.id 对齐
   *
   * 触发器：自动同步主表 → vec0 表（仅当 embedding 不为 NULL 时）
   *   - knowledge_vec_ai (AFTER INSERT, WHEN new.embedding IS NOT NULL)
   *   - knowledge_vec_ad (AFTER DELETE, WHEN old.embedding IS NOT NULL)
   *   - knowledge_vec_au (AFTER UPDATE)：无条件 DELETE 旧值 + 条件 INSERT 新值
   *
   * 注意：主表 embedding 字段是 JSON 字符串（如 "[0.1, 0.2, ...]"），
   *       触发器内通过自定义函数 json_to_vec_f32() 转为 BLOB。
   */
  private initVec0Tables(): void {
    if (!this.dbAvailable || !this.db) return
    try {
      // 创建 vec0 虚拟表
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec USING vec0(
          id TEXT PRIMARY KEY,
          embedding float[512],
          type TEXT PARTITION KEY
        );
      `)

      // 触发器：AFTER INSERT 且 embedding 不为空 → 插入 vec0
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS knowledge_vec_ai
        AFTER INSERT ON knowledge_entries
        WHEN new.embedding IS NOT NULL
        BEGIN
          INSERT INTO knowledge_vec(id, embedding, type)
          VALUES (new.id, json_to_vec_f32(new.embedding), new.type);
        END;
      `)

      // 触发器：AFTER DELETE 且 embedding 不为空 → 从 vec0 删除
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS knowledge_vec_ad
        AFTER DELETE ON knowledge_entries
        WHEN old.embedding IS NOT NULL
        BEGIN
          DELETE FROM knowledge_vec WHERE id = old.id;
        END;
      `)

      // 触发器：AFTER UPDATE → 先删旧向量，再条件插入新向量
      // 无条件 DELETE（即使旧 embedding 为 NULL，DELETE 也是 no-op，安全）
      // 用 INSERT...SELECT WHERE 过滤新 embedding 为 NULL 的情况
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS knowledge_vec_au
        AFTER UPDATE ON knowledge_entries
        BEGIN
          DELETE FROM knowledge_vec WHERE id = old.id;
          INSERT INTO knowledge_vec(id, embedding, type)
          SELECT new.id, json_to_vec_f32(new.embedding), new.type
          WHERE new.embedding IS NOT NULL;
        END;
      `)
    } catch (err) {
      // vec0 初始化失败时降级（不抛异常）
      console.warn('[DatabaseManager] vec0 初始化失败，降级到关键词搜索：', err)
    }
  }

  /**
   * 回填已有数据到 FTS / vec0 表（向后兼容）
   *
   * 适用场景：旧版本数据库已有 knowledge_entries 数据，
   *           升级到 Sprint 7 后需要把存量数据回填到新虚拟表。
   *
   * 策略：检查 FTS / vec0 是否为空且主表是否有数据，是则批量回填。
   */
  private backfillSearchTables(): void {
    if (!this.dbAvailable || !this.db) return
    try {
      // ── 回填 FTS ──
      const ftsCount = this.db
        .prepare('SELECT COUNT(*) AS c FROM knowledge_fts')
        .get() as { c: number } | undefined
      const entriesCount = this.db
        .prepare('SELECT COUNT(*) AS c FROM knowledge_entries')
        .get() as { c: number } | undefined
      if (ftsCount && entriesCount && ftsCount.c === 0 && entriesCount.c > 0) {
        this.db.exec(`
          INSERT INTO knowledge_fts(rowid, title, problem, keywords)
          SELECT rowid, title, problem, keywords FROM knowledge_entries;
        `)
        console.log(`[DatabaseManager] FTS 回填完成：${entriesCount.c} 条`)
      }

      // ── 回填 decision_fts ──
      const dftsCount = this.db
        .prepare('SELECT COUNT(*) AS c FROM decision_fts')
        .get() as { c: number } | undefined
      const cardsCount = this.db
        .prepare('SELECT COUNT(*) AS c FROM decision_cards')
        .get() as { c: number } | undefined
      if (dftsCount && cardsCount && dftsCount.c === 0 && cardsCount.c > 0) {
        this.db.exec(`
          INSERT INTO decision_fts(rowid, id, problem, hypothesis, fixCommand)
          SELECT rowid, id, problem, hypothesis, fixCommand FROM decision_cards;
        `)
        console.log(`[DatabaseManager] decision FTS 回填完成：${cardsCount.c} 条`)
      }

      // ── 回填 vec0 ──
      if (this.vectorEnabled) {
        const vecCount = this.db
          .prepare('SELECT COUNT(*) AS c FROM knowledge_vec')
          .get() as { c: number } | undefined
        const embCount = this.db
          .prepare('SELECT COUNT(*) AS c FROM knowledge_entries WHERE embedding IS NOT NULL')
          .get() as { c: number } | undefined
        if (vecCount && embCount && vecCount.c === 0 && embCount.c > 0) {
          this.db.exec(`
            INSERT INTO knowledge_vec(id, embedding, type)
            SELECT id, json_to_vec_f32(embedding), type
            FROM knowledge_entries
            WHERE embedding IS NOT NULL;
          `)
          console.log(`[DatabaseManager] vec0 回填完成：${embCount.c} 条`)
        }
      }
    } catch (err) {
      // 回填失败不影响主流程
      console.warn('[DatabaseManager] 回填 FTS/vec0 失败：', err)
    }
  }

  // ────────── Sprint 7 任务 A：公开检索方法 ──────────

  /**
   * 执行 FTS5 全文检索（BM25 排序）
   *
   * FTS5 = Full Text Search 5，SQLite 内置全文检索引擎，支持 BM25 相关性排序。
   * 仅当 knowledge_fts 虚拟表初始化成功时可用，否则返回空数组。
   *
   * BM25 分数：FTS5 实现返回负值，越小越相关；调用方按 score ASC 排序即可。
   *
   * @param query 查询字符串（FTS5 语法，如 "磁盘 IO" 或 "cpu AND memory"）
   * @param type 可选类型过滤（command_skill / incident_case / tutorial）
   * @param limit 返回数量上限
   * @returns [{id, score, title, problem}] 数组，按 BM25 分数升序
   */
  prepareFtsSearch(
    query: string,
    type?: string,
    limit: number = 50
  ): { id: string; score: number; title: string; problem: string }[] {
    if (!this.dbAvailable || !this.db) {
      return []
    }
    try {
      if (type) {
        // 带 type 过滤：JOIN 主表用 type 字段过滤
        const rows = this.db
          .prepare(
            `SELECT ke.id AS id, bm25(knowledge_fts) AS score, ke.title AS title, ke.problem AS problem
             FROM knowledge_fts
             JOIN knowledge_entries ke ON ke.rowid = knowledge_fts.rowid
             WHERE knowledge_fts MATCH ? AND ke.type = ?
             ORDER BY score ASC
             LIMIT ?`
          )
          .all(query, type, limit)
        return rows as { id: string; score: number; title: string; problem: string }[]
      }
      // 不带 type 过滤
      const rows = this.db
        .prepare(
          `SELECT ke.id AS id, bm25(knowledge_fts) AS score, ke.title AS title, ke.problem AS problem
           FROM knowledge_fts
           JOIN knowledge_entries ke ON ke.rowid = knowledge_fts.rowid
           WHERE knowledge_fts MATCH ?
           ORDER BY score ASC
           LIMIT ?`
        )
        .all(query, limit)
      return rows as { id: string; score: number; title: string; problem: string }[]
    } catch (err) {
      // FTS5 查询失败 → 降级返回空数组
      console.warn('[DatabaseManager] FTS5 检索失败：', err)
      return []
    }
  }

  /**
   * 执行 decision_cards FTS5 全文检索（BM25 排序）
   *
   * 在 decision_fts 虚拟表中搜索，JOIN decision_cards 取完整字段。
   * 仅当 decision_fts 初始化成功时可用，否则返回空数组。
   *
   * @param query FTS5 查询字符串（已转义的 BM25 语法）
   * @param limit 返回数量上限
   * @returns 匹配的决策卡片摘要 + BM25 分数，按相关性升序
   */
  prepareDecisionFtsSearch(
    query: string,
    limit: number = 50
  ): { id: string; score: number; problem: string; hypothesis: string; fixCommand: string }[] {
    if (!this.dbAvailable || !this.db) {
      return []
    }
    try {
      const rows = this.db
        .prepare(
          `SELECT dc.id AS id, bm25(decision_fts) AS score,
                  dc.problem AS problem, dc.hypothesis AS hypothesis,
                  dc.fixCommand AS fixCommand
           FROM decision_fts
           JOIN decision_cards dc ON dc.rowid = decision_fts.rowid
           WHERE decision_fts MATCH ?
           ORDER BY score ASC
           LIMIT ?`
        )
        .all(query, limit)
      return rows as { id: string; score: number; problem: string; hypothesis: string; fixCommand: string }[]
    } catch (err) {
      console.warn('[DatabaseManager] decision FTS5 检索失败：', err)
      return []
    }
  }

  /**
   * 执行 vec0 KNN 向量检索
   *
   * vec0 = sqlite-vec 提供的虚拟表，支持 KNN（K-Nearest Neighbors）向量检索。
   * 仅当 sqlite-vec 扩展加载成功且 knowledge_vec 表初始化成功时可用。
   *
   * @param queryEmbedding 查询向量（512 维 Float32Array，对应 BGE-small-zh-v1.5）
   * @param type 可选类型过滤（利用 partition key 加速）
   * @param limit 返回数量上限
   * @returns [{id, distance}] 数组，按 distance 升序（距离越小越相似）
   */
  prepareVecSearch(
    queryEmbedding: Float32Array,
    type?: string,
    limit: number = 50
  ): { id: string; distance: number }[] {
    if (!this.dbAvailable || !this.db || !this.vectorEnabled) {
      return []
    }
    try {
      // Float32Array → Buffer（vec0 期望 little-endian float32 BLOB）
      const vecBuffer = Buffer.from(
        queryEmbedding.buffer,
        queryEmbedding.byteOffset,
        queryEmbedding.byteLength
      )
      if (type) {
        // 带 type 过滤（命中 partition key，加速检索）
        const rows = this.db
          .prepare(
            `SELECT id, distance
             FROM knowledge_vec
             WHERE embedding MATCH ? AND type = ?
             ORDER BY distance ASC
             LIMIT ?`
          )
          .all(vecBuffer, type, limit)
        return rows as { id: string; distance: number }[]
      }
      // 不带 type 过滤
      const rows = this.db
        .prepare(
          `SELECT id, distance
           FROM knowledge_vec
           WHERE embedding MATCH ?
           ORDER BY distance ASC
           LIMIT ?`
        )
        .all(vecBuffer, limit)
      return rows as { id: string; distance: number }[]
    } catch (err) {
      // vec0 查询失败 → 降级返回空数组
      console.warn('[DatabaseManager] vec0 检索失败：', err)
      return []
    }
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
