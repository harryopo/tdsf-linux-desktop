var __getOwnPropNames = Object.getOwnPropertyNames;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// node_modules/.pnpm/@photostructure+sqlite-vec@1.2.0/node_modules/@photostructure/sqlite-vec/index.cjs
var require_sqlite_vec = __commonJS({
  "node_modules/.pnpm/@photostructure+sqlite-vec@1.2.0/node_modules/@photostructure/sqlite-vec/index.cjs"(exports, module) {
    var { join: join3 } = __require("node:path");
    var { arch, platform } = __require("node:process");
    var { readdirSync, statSync } = __require("node:fs");
    var ENTRYPOINT_BASE_NAME = "vec0";
    function extensionSuffix(platform2) {
      if (platform2 === "win32") return "dll";
      if (platform2 === "darwin") return "dylib";
      return "so";
    }
    function isMusl() {
      if (platform !== "linux") return false;
      try {
        const files = readdirSync("/lib");
        return files.some((f) => f.startsWith("ld-musl-"));
      } catch {
        return false;
      }
    }
    function asarUnpack(filePath) {
      return filePath.replace("app.asar", "app.asar.unpacked");
    }
    function getLoadablePath() {
      const platformDir = platform === "linux" && isMusl() ? `${platform}-${arch}-musl` : `${platform}-${arch}`;
      const loadablePath = join3(
        __dirname,
        "dist",
        platformDir,
        `${ENTRYPOINT_BASE_NAME}.${extensionSuffix(platform)}`
      );
      if (!statSync(loadablePath, { throwIfNoEntry: false })) {
        const supported = [
          "darwin-x64",
          "darwin-arm64",
          "linux-x64",
          "linux-x64-musl",
          "linux-arm64",
          "linux-arm64-musl",
          "win32-x64",
          "win32-arm64"
        ];
        throw new Error(
          `Loadable extension for sqlite-vec not found for ${platformDir} at ${loadablePath}. Supported platforms: ${supported.join(", ")}.`
        );
      }
      return asarUnpack(loadablePath);
    }
    function load(db) {
      db.loadExtension(getLoadablePath());
    }
    module.exports = { getLoadablePath, load };
  }
});

// scripts/verify-rag-e2e.ts
import { createRequire } from "node:module";

// src/main/services/db/database.ts
function loadBetterSqlite3() {
  try {
    return __require("better-sqlite3");
  } catch {
    console.warn("[DatabaseManager] better-sqlite3 \u52A0\u8F7D\u5931\u8D25\uFF0C\u4F7F\u7528\u5185\u5B58 Map \u56DE\u9000\u65B9\u6848");
    return null;
  }
}
var DatabaseManager = class _DatabaseManager {
  /** 单例实例 */
  static instance = null;
  /** better-sqlite3 连接实例（dbAvailable=true 时有效） */
  db;
  /** 向量搜索扩展是否加载成功 */
  vectorEnabled;
  /** better-sqlite3 是否加载成功 */
  dbAvailable;
  /** 内存回退存储（dbAvailable=false 时使用） */
  memoryStore;
  /** 私有构造，强制单例 */
  constructor(dbPath) {
    this.memoryStore = /* @__PURE__ */ new Map();
    const BetterSqlite3 = loadBetterSqlite3();
    if (!BetterSqlite3) {
      this.db = null;
      this.dbAvailable = false;
      this.vectorEnabled = false;
      console.warn("[DatabaseManager] \u4F7F\u7528\u5185\u5B58 Map \u56DE\u9000\u65B9\u6848\uFF0C\u6570\u636E\u4E0D\u4F1A\u6301\u4E45\u5316");
      return;
    }
    this.dbAvailable = true;
    this.db = new BetterSqlite3(dbPath);
    try {
      this.db.pragma("journal_mode = WAL");
    } catch {
    }
    this.vectorEnabled = this.tryLoadVectorExtension();
    this.initTables();
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
  static getInstance(dbPath) {
    if (!_DatabaseManager.instance) {
      const resolvedPath = dbPath ?? ":memory:";
      _DatabaseManager.instance = new _DatabaseManager(resolvedPath);
    }
    return _DatabaseManager.instance;
  }
  /**
   * 重置单例（仅用于测试）
   *
   * 关闭现有连接并清除单例，下次 getInstance 会重新初始化。
   * @internal
   */
  static resetInstance() {
    if (_DatabaseManager.instance) {
      try {
        if (_DatabaseManager.instance.dbAvailable && _DatabaseManager.instance.db) {
          _DatabaseManager.instance.db.close();
        }
      } catch {
      }
      _DatabaseManager.instance = null;
    }
  }
  /**
   * 检查数据库是否真正可用（better-sqlite3 是否加载成功）
   * @returns true 表示 better-sqlite3 可用，false 表示使用内存 Map 回退
   */
  isAvailable() {
    return this.dbAvailable;
  }
  /**
   * 关闭数据库连接
   */
  close() {
    try {
      if (this.dbAvailable && this.db) {
        this.db.close();
      }
    } catch {
    }
  }
  /**
   * 执行 SQL（无参数，如建表、PRAGMA）
   * @param sql SQL 语句
   */
  exec(sql) {
    if (!this.dbAvailable || !this.db) {
      return;
    }
    this.db.exec(sql);
  }
  /**
   * 预编译 SQL 语句
   * @param sql SQL 语句（使用 ? 或 @name 占位符）
   * @returns 预编译语句（回退模式下返回 mock 对象）
   */
  prepare(sql) {
    if (!this.dbAvailable || !this.db) {
      return this.createMockStatement(sql);
    }
    return this.db.prepare(sql);
  }
  /**
   * 检查向量搜索是否可用
   * @returns true 表示 sqlite-vec 扩展加载成功
   */
  isVectorEnabled() {
    return this.vectorEnabled;
  }
  /**
   * 获取原始 better-sqlite3 连接（供高级用法使用）
   * @internal
   */
  getRawConnection() {
    return this.db;
  }
  // ────────── 内部方法 ──────────
  /**
   * 创建 mock Statement（回退模式下使用）
   *
   * 所有方法返回空结果，不会抛出异常。
   */
  createMockStatement(_sql) {
    const self = this;
    return {
      run: () => ({ changes: 0, lastInsertRowid: 0n }),
      get: () => void 0,
      all: () => [],
      bind: function(...params) {
        void params;
        return this;
      },
      finalize: () => {
      }
    };
  }
  /**
   * 尝试加载 sqlite-vec 向量搜索扩展
   *
   * 加载失败时降级到关键词搜索，不影响数据库核心功能。
   * 失败原因可能是：扩展文件缺失、ABI 版本不匹配、平台不支持。
   *
   * @returns true 表示加载成功
   */
  tryLoadVectorExtension() {
    if (!this.dbAvailable || !this.db) {
      return false;
    }
    try {
      const sqliteVec = require_sqlite_vec();
      if (typeof sqliteVec.load === "function") {
        sqliteVec.load(this.db);
        return true;
      }
      if (typeof sqliteVec.install === "function") {
        sqliteVec.install(this.db);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
  /**
   * 初始化所有表
   *
   * 使用 CREATE TABLE IF NOT EXISTS，重复调用安全。
   * 表结构参考 _legacy-python/src/tdsf_desktop/storage/schemas.py
   */
  initTables() {
    if (!this.dbAvailable || !this.db) {
      return;
    }
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
    `);
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
    `);
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
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
    this.registerVectorHelpers();
    this.initFts5Tables();
    if (this.vectorEnabled) {
      this.initVec0Tables();
    }
    this.backfillSearchTables();
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
  registerVectorHelpers() {
    if (!this.dbAvailable || !this.db) return;
    try {
      this.db.function("json_to_vec_f32", (json) => {
        if (typeof json !== "string" || json.length === 0) return null;
        try {
          const arr = JSON.parse(json);
          if (!Array.isArray(arr) || arr.length === 0) return null;
          const float32 = new Float32Array(arr.length);
          for (let i = 0; i < arr.length; i++) {
            const v = Number(arr[i]);
            if (!Number.isFinite(v)) return null;
            float32[i] = v;
          }
          return Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength);
        } catch {
          return null;
        }
      });
    } catch (err) {
      console.warn("[DatabaseManager] \u6CE8\u518C json_to_vec_f32 \u5931\u8D25\uFF1A", err);
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
  initFts5Tables() {
    if (!this.dbAvailable || !this.db) return;
    try {
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
      `);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge_entries BEGIN
          INSERT INTO knowledge_fts(rowid, title, problem, keywords)
          VALUES (new.rowid, new.title, new.problem, new.keywords);
        END;
      `);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge_entries BEGIN
          INSERT INTO knowledge_fts(knowledge_fts, rowid, title, problem, keywords)
          VALUES ('delete', old.rowid, old.title, old.problem, old.keywords);
        END;
      `);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge_entries BEGIN
          INSERT INTO knowledge_fts(knowledge_fts, rowid, title, problem, keywords)
          VALUES ('delete', old.rowid, old.title, old.problem, old.keywords);
          INSERT INTO knowledge_fts(rowid, title, problem, keywords)
          VALUES (new.rowid, new.title, new.problem, new.keywords);
        END;
      `);
    } catch (err) {
      console.warn("[DatabaseManager] FTS5 \u521D\u59CB\u5316\u5931\u8D25\uFF0C\u964D\u7EA7\u5230\u5173\u952E\u8BCD\u641C\u7D22\uFF1A", err);
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
  initVec0Tables() {
    if (!this.dbAvailable || !this.db) return;
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec USING vec0(
          id TEXT PRIMARY KEY,
          embedding float[512],
          type TEXT PARTITION KEY
        );
      `);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS knowledge_vec_ai
        AFTER INSERT ON knowledge_entries
        WHEN new.embedding IS NOT NULL
        BEGIN
          INSERT INTO knowledge_vec(id, embedding, type)
          VALUES (new.id, json_to_vec_f32(new.embedding), new.type);
        END;
      `);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS knowledge_vec_ad
        AFTER DELETE ON knowledge_entries
        WHEN old.embedding IS NOT NULL
        BEGIN
          DELETE FROM knowledge_vec WHERE id = old.id;
        END;
      `);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS knowledge_vec_au
        AFTER UPDATE ON knowledge_entries
        BEGIN
          DELETE FROM knowledge_vec WHERE id = old.id;
          INSERT INTO knowledge_vec(id, embedding, type)
          SELECT new.id, json_to_vec_f32(new.embedding), new.type
          WHERE new.embedding IS NOT NULL;
        END;
      `);
    } catch (err) {
      console.warn("[DatabaseManager] vec0 \u521D\u59CB\u5316\u5931\u8D25\uFF0C\u964D\u7EA7\u5230\u5173\u952E\u8BCD\u641C\u7D22\uFF1A", err);
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
  backfillSearchTables() {
    if (!this.dbAvailable || !this.db) return;
    try {
      const ftsCount = this.db.prepare("SELECT COUNT(*) AS c FROM knowledge_fts").get();
      const entriesCount = this.db.prepare("SELECT COUNT(*) AS c FROM knowledge_entries").get();
      if (ftsCount && entriesCount && ftsCount.c === 0 && entriesCount.c > 0) {
        this.db.exec(`
          INSERT INTO knowledge_fts(rowid, title, problem, keywords)
          SELECT rowid, title, problem, keywords FROM knowledge_entries;
        `);
        console.log(`[DatabaseManager] FTS \u56DE\u586B\u5B8C\u6210\uFF1A${entriesCount.c} \u6761`);
      }
      if (this.vectorEnabled) {
        const vecCount = this.db.prepare("SELECT COUNT(*) AS c FROM knowledge_vec").get();
        const embCount = this.db.prepare("SELECT COUNT(*) AS c FROM knowledge_entries WHERE embedding IS NOT NULL").get();
        if (vecCount && embCount && vecCount.c === 0 && embCount.c > 0) {
          this.db.exec(`
            INSERT INTO knowledge_vec(id, embedding, type)
            SELECT id, json_to_vec_f32(embedding), type
            FROM knowledge_entries
            WHERE embedding IS NOT NULL;
          `);
          console.log(`[DatabaseManager] vec0 \u56DE\u586B\u5B8C\u6210\uFF1A${embCount.c} \u6761`);
        }
      }
    } catch (err) {
      console.warn("[DatabaseManager] \u56DE\u586B FTS/vec0 \u5931\u8D25\uFF1A", err);
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
  prepareFtsSearch(query, type, limit = 50) {
    if (!this.dbAvailable || !this.db) {
      return [];
    }
    try {
      if (type) {
        const rows2 = this.db.prepare(
          `SELECT ke.id AS id, bm25(knowledge_fts) AS score, ke.title AS title, ke.problem AS problem
             FROM knowledge_fts
             JOIN knowledge_entries ke ON ke.rowid = knowledge_fts.rowid
             WHERE knowledge_fts MATCH ? AND ke.type = ?
             ORDER BY score ASC
             LIMIT ?`
        ).all(query, type, limit);
        return rows2;
      }
      const rows = this.db.prepare(
        `SELECT ke.id AS id, bm25(knowledge_fts) AS score, ke.title AS title, ke.problem AS problem
           FROM knowledge_fts
           JOIN knowledge_entries ke ON ke.rowid = knowledge_fts.rowid
           WHERE knowledge_fts MATCH ?
           ORDER BY score ASC
           LIMIT ?`
      ).all(query, limit);
      return rows;
    } catch (err) {
      console.warn("[DatabaseManager] FTS5 \u68C0\u7D22\u5931\u8D25\uFF1A", err);
      return [];
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
  prepareVecSearch(queryEmbedding, type, limit = 50) {
    if (!this.dbAvailable || !this.db || !this.vectorEnabled) {
      return [];
    }
    try {
      const vecBuffer = Buffer.from(
        queryEmbedding.buffer,
        queryEmbedding.byteOffset,
        queryEmbedding.byteLength
      );
      if (type) {
        const rows2 = this.db.prepare(
          `SELECT id, distance
             FROM knowledge_vec
             WHERE embedding MATCH ? AND type = ?
             ORDER BY distance ASC
             LIMIT ?`
        ).all(vecBuffer, type, limit);
        return rows2;
      }
      const rows = this.db.prepare(
        `SELECT id, distance
           FROM knowledge_vec
           WHERE embedding MATCH ?
           ORDER BY distance ASC
           LIMIT ?`
      ).all(vecBuffer, limit);
      return rows;
    } catch (err) {
      console.warn("[DatabaseManager] vec0 \u68C0\u7D22\u5931\u8D25\uFF1A", err);
      return [];
    }
  }
};

// src/shared/tutorial-types.ts
var TUTORIAL_CATEGORY_LABELS = {
  "linux-basics": "\u{1F427} Linux \u57FA\u7840",
  "user-management": "\u{1F465} \u7528\u6237\u6743\u9650",
  "package-management": "\u{1F4E6} \u8F6F\u4EF6\u7BA1\u7406",
  "networking": "\u{1F310} \u7F51\u7EDC",
  "security": "\u{1F512} \u5B89\u5168",
  "storage": "\u{1F4BE} \u5B58\u50A8",
  "services": "\u2699\uFE0F \u670D\u52A1\u7BA1\u7406",
  "virtualization": "\u{1F5A5}\uFE0F \u865A\u62DF\u5316",
  "containers": "\u{1F4E6} \u5BB9\u5668",
  "web-server": "\u{1F310} Web \u670D\u52A1\u5668",
  "database": "\u{1F5C4}\uFE0F \u6570\u636E\u5E93",
  "shell-scripting": "\u{1F4DC} Shell \u811A\u672C",
  "monitoring": "\u{1F4CA} \u76D1\u63A7",
  "troubleshooting": "\u{1F198} \u6392\u969C",
  "cloud": "\u2601\uFE0F \u4E91"
};
var TUTORIAL_DIFFICULTY_LABELS = {
  beginner: "\u5165\u95E8",
  intermediate: "\u4E2D\u7EA7",
  advanced: "\u9AD8\u7EA7"
};

// src/main/services/tutorial/embedding-service.ts
import { pipeline, env } from "@xenova/transformers";
import { app } from "electron";
import { join } from "path";
var MODEL_ID = "Xenova/bge-small-zh-v1.5";
var EMBEDDING_DIM = 512;
var BGE_QUERY_PREFIX_ZH = "\u4E3A\u8FD9\u4E2A\u53E5\u5B50\u751F\u6210\u8868\u793A\u4EE5\u7528\u4E8E\u68C0\u7D22\u76F8\u5173\u6587\u7AE0\uFF1A";
var BGE_QUERY_PREFIX_EN = "Represent this sentence for searching relevant passages: ";
var EmbeddingServiceUnavailableError = class extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
    this.name = "EmbeddingServiceUnavailableError";
  }
  cause;
};
env.allowLocalModels = false;
env.useBrowserCache = false;
env.remoteHost = "https://hf-mirror.com";
function containsChinese(text) {
  return /[\u4e00-\u9fa5]/.test(text);
}
function prefixQuery(query) {
  const isChinese = containsChinese(query);
  return isChinese ? `${BGE_QUERY_PREFIX_ZH}${query}` : `${BGE_QUERY_PREFIX_EN}${query}`;
}
var EmbeddingService = class _EmbeddingService {
  static instance = null;
  /** pipeline 实例（feature-extraction 类型） */
  extractor = null;
  /** 懒加载 Promise（防止并发首次调用重复下载） */
  initPromise = null;
  constructor() {
  }
  /**
   * 获取单例实例
   * 全局只保留一个 EmbeddingService，模型只加载一次
   */
  static getInstance() {
    if (!_EmbeddingService.instance) {
      _EmbeddingService.instance = new _EmbeddingService();
    }
    return _EmbeddingService.instance;
  }
  /**
   * 懒加载模型（首次调用时下载）
   *
   * 设计：
   * - 用 initPromise 防止并发首次调用导致重复下载
   * - 失败后清空 initPromise，允许重试
   * - 抛出 EmbeddingServiceUnavailableError 让上层处理
   *
   * 模型大小：约 24MB（BGE-small-zh-v1.5 ONNX 量化版）
   * 首次下载时间：国内通过 hf-mirror.com 约 10-30 秒
   */
  async ensureLoaded() {
    if (this.extractor) return;
    if (!this.initPromise) {
      this.initPromise = this.loadModel();
    }
    try {
      await this.initPromise;
    } catch (err) {
      this.initPromise = null;
      throw err;
    }
  }
  /**
   * 实际加载模型的内部方法
   */
  async loadModel() {
    try {
      env.cacheDir = join(app.getPath("userData"), "models");
      this.extractor = await pipeline("feature-extraction", MODEL_ID, {
        quantized: true
      });
    } catch (err) {
      const msg = err?.message ?? String(err);
      throw new EmbeddingServiceUnavailableError(
        `BGE embedding \u6A21\u578B\u52A0\u8F7D\u5931\u8D25\uFF08model=${MODEL_ID}\uFF09\uFF1A${msg}\u3002\u8BF7\u68C0\u67E5\u7F51\u7EDC\uFF08hf-mirror.com\uFF09\u6216\u78C1\u76D8\u7A7A\u95F4\u3002`,
        err
      );
    }
  }
  /**
   * 生成单条文本的 embedding
   *
   * @param text 输入文本（已含或不含 BGE 前缀均可，由调用方决定）
   * @returns 512 维 Float32Array
   *
   * 教学要点：
   * - pooling: 'cls' 表示用 [CLS] token 的输出作为整句向量（BGE 推荐方式）
   * - normalize: true 做 L2 归一化（向量长度=1，便于余弦相似度计算）
   */
  async embed(text) {
    await this.ensureLoaded();
    if (!text || text.trim().length === 0) {
      return new Float32Array(EMBEDDING_DIM);
    }
    try {
      const output = await this.extractor(text, {
        pooling: "cls",
        normalize: true
      });
      const data = output?.data;
      if (!data || data.length !== EMBEDDING_DIM) {
        throw new Error(
          `Embedding \u7EF4\u5EA6\u5F02\u5E38\uFF1A\u671F\u671B ${EMBEDDING_DIM}\uFF0C\u5B9E\u9645 ${data?.length ?? 0}`
        );
      }
      return data;
    } catch (err) {
      const msg = err?.message ?? String(err);
      if (this.isMemoryError(msg)) {
        console.warn("[EmbeddingService] \u68C0\u6D4B\u5230\u5185\u5B58\u4E0D\u8DB3\uFF0Cdispose \u540E\u91CD\u8BD5\u4E00\u6B21:", msg);
        this.dispose();
        try {
          await this.ensureLoaded();
          const retry = await this.extractor(text, {
            pooling: "cls",
            normalize: true
          });
          const data = retry?.data;
          if (!data || data.length !== EMBEDDING_DIM) {
            throw new Error("\u91CD\u8BD5\u540E embedding \u7EF4\u5EA6\u4ECD\u5F02\u5E38");
          }
          return data;
        } catch (retryErr) {
          throw new EmbeddingServiceUnavailableError(
            `Embedding \u63A8\u7406\u5931\u8D25\uFF08\u91CD\u8BD5\u540E\u4ECD\u5931\u8D25\uFF09\uFF1A${retryErr.message}`,
            retryErr
          );
        }
      }
      throw new EmbeddingServiceUnavailableError(
        `Embedding \u63A8\u7406\u5931\u8D25\uFF1A${msg}`,
        err
      );
    }
  }
  /**
   * 批量生成 embedding（比循环调用单条更快）
   *
   * 性能优势：
   * - 利用 ONNX Runtime 内部 batching
   * - 减少 JS↔Native 调用次数
   * - 适合教程入库场景（2578 条一次性处理）
   *
   * @param texts 文本数组
   * @param batchSize 每批大小（默认 8，过大会占用过多内存）
   * @returns 与 texts 等长的 Float32Array 数组
   */
  async embedBatch(texts, batchSize = 8) {
    await this.ensureLoaded();
    if (texts.length === 0) return [];
    const results = new Array(texts.length);
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const placeholders = [];
      const emptyIndices = [];
      batch.forEach((t, j) => {
        if (!t || t.trim().length === 0) {
          placeholders.push("\u7A7A");
          emptyIndices.push(i + j);
        } else {
          placeholders.push(t);
        }
      });
      try {
        const output = await this.extractor(placeholders, {
          pooling: "cls",
          normalize: true
        });
        const data = output?.data;
        const dims = output?.dims;
        if (!data || !dims || dims.length < 2) {
          throw new Error("\u6279\u91CF embedding \u8F93\u51FA\u683C\u5F0F\u5F02\u5E38");
        }
        const dim = dims[dims.length - 1];
        if (dim !== EMBEDDING_DIM) {
          throw new Error(
            `\u6279\u91CF embedding \u7EF4\u5EA6\u5F02\u5E38\uFF1A\u671F\u671B ${EMBEDDING_DIM}\uFF0C\u5B9E\u9645 ${dim}`
          );
        }
        for (let j = 0; j < batch.length; j++) {
          const start = j * dim;
          const slice = data.slice(start, start + dim);
          results[i + j] = new Float32Array(slice);
        }
        for (const idx of emptyIndices) {
          results[idx] = new Float32Array(EMBEDDING_DIM);
        }
      } catch (err) {
        const msg = err?.message ?? String(err);
        if (this.isMemoryError(msg)) {
          console.warn("[EmbeddingService] \u6279\u91CF\u63A8\u7406\u5185\u5B58\u4E0D\u8DB3\uFF0C\u7F29\u5C0F batch \u91CD\u8BD5:", msg);
          this.dispose();
          await this.ensureLoaded();
          for (let j = 0; j < batch.length; j++) {
            const globalIdx = i + j;
            if (emptyIndices.includes(globalIdx)) {
              results[globalIdx] = new Float32Array(EMBEDDING_DIM);
            } else {
              results[globalIdx] = await this.embed(batch[j]);
            }
          }
        } else {
          throw new EmbeddingServiceUnavailableError(
            `\u6279\u91CF embedding \u63A8\u7406\u5931\u8D25\uFF08batch index=${i}\uFF09\uFF1A${msg}`,
            err
          );
        }
      }
    }
    return results;
  }
  /**
   * 判断模型是否已加载到内存
   *
   * 用于 IPC `tutorial:search-status` 通道返回当前 embedding 服务状态，
   * 让 UI 能展示"模型已加载 / 待加载"。
   *
   * 注意：
   * - 仅检查 extractor 实例是否存在（同步快速判断）
   * - 不触发模型下载（与 ensureLoaded 不同，不会阻塞）
   * - 返回 false 不代表模型不可用，只是尚未加载到内存
   *
   * @returns true 表示 extractor 已加载，可直接调用 embed/embedBatch
   */
  isLoaded() {
    return this.extractor !== null;
  }
  /**
   * 释放模型内存
   *
   * 使用场景：
   * - 内存不足时主动释放（dispose 后重新 ensureLoaded）
   * - 应用退出时清理资源
   * - 长时间不使用时（如配置低内存模式）
   */
  dispose() {
    if (this.extractor) {
      try {
        if (typeof this.extractor.dispose === "function") {
          this.extractor.dispose();
        }
      } catch (err) {
        console.warn("[EmbeddingService] dispose \u65F6\u51FA\u9519\uFF08\u5FFD\u7565\uFF09\uFF1A", err.message);
      }
      this.extractor = null;
      this.initPromise = null;
    }
  }
  /**
   * 判断是否为内存相关错误
   */
  isMemoryError(msg) {
    const lower = msg.toLowerCase();
    return lower.includes("out of memory") || lower.includes("oom") || lower.includes("heap") || lower.includes("allocation failed");
  }
};
async function generateEmbeddings(entries, onProgress) {
  const result = /* @__PURE__ */ new Map();
  if (entries.length === 0) {
    onProgress?.(1);
    return result;
  }
  const service = EmbeddingService.getInstance();
  await service.ensureLoaded();
  const texts = entries.map((e) => {
    const titlePart = e.title ?? "";
    const contentPart = (e.content ?? "").slice(0, 1500);
    return `${titlePart}

${contentPart}`.trim();
  });
  const batchSize = 8;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batchTexts = texts.slice(i, i + batchSize);
    const batchEntries = entries.slice(i, i + batchSize);
    const embeddings = await service.embedBatch(batchTexts, batchSize);
    for (let j = 0; j < batchEntries.length; j++) {
      result.set(batchEntries[j].id, embeddings[j]);
    }
    if (onProgress) {
      const pct = Math.min(1, (i + batchSize) / texts.length);
      onProgress(pct);
    }
  }
  return result;
}

// src/main/services/tutorial/hybrid-search.ts
function reciprocalRankFusion(ftsResults, vecResults, k = 60, ftsWeight = 1, vecWeight = 1) {
  const fused = /* @__PURE__ */ new Map();
  ftsResults.forEach((item, index) => {
    const rank = index + 1;
    const contribution = ftsWeight / (k + rank);
    const existing = fused.get(item.id);
    if (existing) {
      existing.rrfScore += contribution;
      existing.ftsRank = rank;
      existing.source = "both";
    } else {
      fused.set(item.id, {
        rrfScore: contribution,
        ftsRank: rank,
        source: "fts"
      });
    }
  });
  vecResults.forEach((item, index) => {
    const rank = index + 1;
    const contribution = vecWeight / (k + rank);
    const existing = fused.get(item.id);
    if (existing) {
      existing.rrfScore += contribution;
      existing.vecRank = rank;
      existing.source = "both";
    } else {
      fused.set(item.id, {
        rrfScore: contribution,
        vecRank: rank,
        source: "vec"
      });
    }
  });
  return fused;
}
function escapeFtsQuery(query) {
  if (!query || typeof query !== "string") return "";
  const tokens = query.trim().split(/\s+/).filter((t) => t.length > 0).filter((t) => !/^[\s,，。、；;:：!！?？()（）\[\]【】"'`/\\|*\-+.]+$/.test(t));
  if (tokens.length === 0) return "";
  const escaped = tokens.map((t) => {
    const inner = t.replace(/"/g, '""');
    return `"${inner}"`;
  });
  return escaped.join(" ");
}
function hybridSearch(db, options) {
  const {
    query,
    queryEmbedding,
    type,
    limit = 10,
    ftsWeight = 1,
    vecWeight = 1,
    ftsLimit = 50,
    vecLimit = 50
  } = options;
  const ftsResults = query && query.trim().length > 0 ? runFtsSearch(db, query, type, ftsLimit) : [];
  const vecResults = queryEmbedding && db.isVectorEnabled() ? runVecSearch(db, queryEmbedding, type, vecLimit) : [];
  const fusedMap = reciprocalRankFusion(
    ftsResults.map((r) => ({ id: r.id, score: r.score })),
    vecResults.map((r) => ({ id: r.id, distance: r.distance })),
    60,
    // k=60（Cormack 2009 论文经验值）
    ftsWeight,
    vecWeight
  );
  const sortedIds = Array.from(fusedMap.entries()).sort((a, b) => b[1].rrfScore - a[1].rrfScore).slice(0, limit).map(([id]) => id);
  if (sortedIds.length === 0) return [];
  const placeholders = sortedIds.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT id, type, title, problem, tags FROM knowledge_entries WHERE id IN (${placeholders})`
  ).all(...sortedIds);
  const rowMap = /* @__PURE__ */ new Map();
  for (const row of rows) {
    rowMap.set(row.id, row);
  }
  const results = [];
  for (const id of sortedIds) {
    const row = rowMap.get(id);
    if (!row) continue;
    const fused = fusedMap.get(id);
    if (!fused) continue;
    const ftsHit = ftsResults.find((r) => r.id === id);
    const vecHit = vecResults.find((r) => r.id === id);
    let category;
    if (row.tags) {
      try {
        const tagsArr = JSON.parse(row.tags);
        if (Array.isArray(tagsArr) && tagsArr.length > 0 && typeof tagsArr[0] === "string") {
          category = tagsArr[0];
        }
      } catch {
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
    });
  }
  return results;
}
function runFtsSearch(db, query, type, limit) {
  const ftsQuery = escapeFtsQuery(query);
  if (!ftsQuery) return [];
  try {
    const sql = type ? `SELECT k.id, bm25(knowledge_fts) AS score
         FROM knowledge_fts
         JOIN knowledge_entries k ON k.id = knowledge_fts.id
         WHERE knowledge_fts MATCH ? AND k.type = ?
         ORDER BY score ASC
         LIMIT ?` : `SELECT k.id, bm25(knowledge_fts) AS score
         FROM knowledge_fts
         JOIN knowledge_entries k ON k.id = knowledge_fts.id
         WHERE knowledge_fts MATCH ?
         ORDER BY score ASC
         LIMIT ?`;
    const stmt = db.prepare(sql);
    const rows = type ? stmt.all(ftsQuery, type, limit) : stmt.all(ftsQuery, limit);
    return rows;
  } catch {
    return runFallbackKeywordSearch(db, query, type, limit);
  }
}
function runFallbackKeywordSearch(db, query, type, limit) {
  const tokens = query.trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return [];
  const conditions = tokens.map(() => "(title LIKE ? OR keywords LIKE ?)").join(" OR ");
  const params = [];
  for (const t of tokens) {
    params.push(`%${t}%`, `%${t}%`);
  }
  let sql = `SELECT id, title, keywords FROM knowledge_entries`;
  const whereClauses = [];
  if (tokens.length > 0) {
    whereClauses.push(`(${conditions})`);
  }
  if (type) {
    whereClauses.push("type = ?");
    params.push(type);
  }
  if (whereClauses.length > 0) {
    sql += ` WHERE ${whereClauses.join(" AND ")}`;
  }
  try {
    const rows = db.prepare(sql).all(...params);
    const scored = rows.map((row) => {
      let hits = 0;
      const titleLower = row.title.toLowerCase();
      for (const t of tokens) {
        const tLower = t.toLowerCase();
        if (titleLower.includes(tLower)) hits += 2;
        if (row.keywords && row.keywords.includes(t)) hits += 1;
      }
      return { id: row.id, score: -hits };
    });
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, limit);
  } catch {
    return [];
  }
}
function runVecSearch(db, queryEmbedding, type, limit) {
  if (!db.isVectorEnabled()) return [];
  const queryVecJson = JSON.stringify(Array.from(queryEmbedding));
  const sql = type ? `SELECT id, vec_distance_cosine(embedding, ?) AS distance
       FROM knowledge_entries
       WHERE embedding IS NOT NULL AND type = ?
       ORDER BY distance ASC
       LIMIT ?` : `SELECT id, vec_distance_cosine(embedding, ?) AS distance
       FROM knowledge_entries
       WHERE embedding IS NOT NULL
       ORDER BY distance ASC
       LIMIT ?`;
  try {
    const stmt = db.prepare(sql);
    const rows = type ? stmt.all(queryVecJson, type, limit) : stmt.all(queryVecJson, limit);
    return rows;
  } catch {
    return [];
  }
}

// src/main/services/tutorial/tutorial-repo.ts
var FIELD_SOURCE_URL = "__tutorial_source_url";
var FIELD_SOURCE_LICENSE_URL = "__tutorial_source_license_url";
var FIELD_SOURCE_KIND = "__tutorial_source_kind";
var FIELD_CONTENT = "__tutorial_content";
var FIELD_READING_TIME = "__tutorial_reading_time";
var FIELD_CATEGORY = "__tutorial_category";
var FIELD_DIFFICULTY = "__tutorial_difficulty";
var TutorialRepository = class {
  constructor(db) {
    this.db = db;
  }
  db;
  /**
   * 将 TutorialEntry 序列化为 KnowledgeEntry
   *
   * Phase 1-c 强化：完整保存 source 标注（name / url / license / licenseUrl / kind / crawledAt）
   * - licenseUrl：CC BY-SA 4.0 详情页 URL（用于 UI 显示"查看协议原文"）
   * - kind：offline-dump / github-clone / online-crawl（用于 UI 标识）
   */
  toKnowledgeEntry(t) {
    const tags = [
      TUTORIAL_CATEGORY_LABELS[t.category] ?? t.category,
      TUTORIAL_DIFFICULTY_LABELS[t.difficulty] ?? t.difficulty,
      ...t.distros
    ];
    return {
      id: t.id,
      type: "tutorial",
      title: t.title,
      problem: t.summary,
      rootCause: JSON.stringify({
        [FIELD_SOURCE_URL]: t.source.url,
        [FIELD_SOURCE_LICENSE_URL]: t.source.licenseUrl,
        [FIELD_SOURCE_KIND]: t.source.kind,
        [FIELD_CONTENT]: t.content,
        [FIELD_READING_TIME]: t.readingTime,
        [FIELD_CATEGORY]: t.category,
        [FIELD_DIFFICULTY]: t.difficulty,
        sourceName: t.source.name,
        sourceLicense: t.source.license,
        crawledAt: t.source.crawledAt
      }),
      commands: t.commands,
      keywords: t.keywords,
      tags,
      successRate: t.readingTime / 60,
      // 0-1 范围内（小时）
      useCount: 0,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt
    };
  }
  /**
   * 从 KnowledgeEntry 反序列化为 TutorialEntry
   */
  fromKnowledgeEntry(k) {
    if (k.type !== "tutorial") return null;
    let extra = {};
    try {
      extra = k.rootCause ? JSON.parse(k.rootCause) : {};
    } catch {
      return null;
    }
    const category = extra[FIELD_CATEGORY] ?? "linux-basics";
    const difficulty = extra[FIELD_DIFFICULTY] ?? "beginner";
    const distros = (k.tags ?? []).filter(
      (t) => ["rhel", "centos", "rocky", "fedora", "ubuntu", "debian", "arch", "opensuse"].includes(t)
    );
    return {
      id: k.id,
      title: k.title,
      summary: k.problem,
      source: {
        name: String(extra.sourceName ?? "Unknown"),
        url: String(extra[FIELD_SOURCE_URL] ?? ""),
        crawledAt: Number(extra.crawledAt ?? 0),
        license: String(extra.sourceLicense ?? "Unknown"),
        licenseUrl: extra[FIELD_SOURCE_LICENSE_URL] ? String(extra[FIELD_SOURCE_LICENSE_URL]) : void 0,
        kind: extra[FIELD_SOURCE_KIND]
      },
      category,
      tags: (k.tags ?? []).filter(
        (t) => !Object.values(TUTORIAL_CATEGORY_LABELS).includes(t) && !Object.values(TUTORIAL_DIFFICULTY_LABELS).includes(t) && !["rhel", "centos", "rocky", "fedora", "ubuntu", "debian", "arch", "opensuse"].includes(t)
      ),
      difficulty,
      readingTime: Number(extra[FIELD_READING_TIME] ?? 5),
      content: String(extra[FIELD_CONTENT] ?? ""),
      commands: k.commands ?? [],
      keywords: k.keywords ?? [],
      distros,
      createdAt: k.createdAt,
      updatedAt: k.updatedAt
    };
  }
  /**
   * 列出所有教程（按更新时间倒序）
   */
  listAll() {
    const rows = this.db.prepare('SELECT * FROM knowledge_entries WHERE type = ? ORDER BY "updatedAt" DESC').all("tutorial");
    return rows.map((r) => this.rowToEntry(r)).filter((t) => t !== null);
  }
  /**
   * 按分类列出教程
   */
  listByCategory(category) {
    const all = this.listAll();
    return all.filter((t) => t.category === category);
  }
  /**
   * 按 ID 获取单篇教程
   */
  getById(id) {
    const row = this.db.prepare("SELECT * FROM knowledge_entries WHERE id = ? AND type = ?").get(id, "tutorial");
    if (!row) return null;
    return this.rowToEntry(row);
  }
  /**
   * 统计每个分类的教程数量
   */
  categorySummary() {
    const all = this.listAll();
    const counts = /* @__PURE__ */ new Map();
    for (const t of all) {
      counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
    }
    return Object.keys(TUTORIAL_CATEGORY_LABELS).map((cat) => ({
      category: cat,
      count: counts.get(cat) ?? 0,
      label: TUTORIAL_CATEGORY_LABELS[cat]
    }));
  }
  /**
   * 关键词搜索（Jaccard 相似度，复用 knowledge-repo 逻辑简化版）
   */
  search(query, limit = 10) {
    const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length === 0) return [];
    const querySet = new Set(tokens);
    const candidates = this.listAll();
    const scored = candidates.map((t) => {
      const text = `${t.title} ${t.summary} ${t.keywords.join(" ")} ${t.tags.join(" ")}`.toLowerCase();
      const tokens_in_text = new Set(text.split(/\s+/));
      const intersection = new Set([...querySet].filter((x) => tokens_in_text.has(x)));
      const union = /* @__PURE__ */ new Set([...querySet, ...tokens_in_text]);
      const score = union.size === 0 ? 0 : intersection.size / union.size;
      return { t, score };
    }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
    return scored.map((s) => s.t);
  }
  /**
   * 批量 upsert（爬虫用）
   * - 已存在 ID：更新 content / crawledAt
   * - 不存在：插入
   *
   * @returns 统计 { inserted, updated, skipped }
   */
  upsertMany(entries) {
    if (entries.length === 0) {
      return { inserted: 0, updated: 0, skipped: 0 };
    }
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const raw = this.db.getRawConnection();
    if (!raw) {
      return { inserted: 0, updated: 0, skipped: entries.length };
    }
    const tx = raw.transaction((batch) => {
      for (const t of batch) {
        const knowledgeEntry = this.toKnowledgeEntry(t);
        const existing = this.db.prepare("SELECT id FROM knowledge_entries WHERE id = ? AND type = ?").get(knowledgeEntry.id, "tutorial");
        if (existing) {
          this.db.prepare(
            `UPDATE knowledge_entries SET
                title = @title,
                problem = @problem,
                "rootCause" = @rootCause,
                commands = @commands,
                keywords = @keywords,
                tags = @tags,
                "successRate" = @successRate,
                "updatedAt" = @updatedAt
              WHERE id = @id AND type = @type`
          ).run({
            ...knowledgeEntry,
            commands: JSON.stringify(knowledgeEntry.commands),
            keywords: JSON.stringify(knowledgeEntry.keywords),
            tags: JSON.stringify(knowledgeEntry.tags)
          });
          updated++;
        } else {
          this.db.prepare(
            `INSERT INTO knowledge_entries
                (id, type, title, problem, "rootCause", commands, keywords, tags,
                 "successRate", "useCount", "createdAt", "updatedAt")
              VALUES
                (@id, @type, @title, @problem, @rootCause, @commands, @keywords, @tags,
                 @successRate, @useCount, @createdAt, @updatedAt)`
          ).run({
            ...knowledgeEntry,
            commands: JSON.stringify(knowledgeEntry.commands),
            keywords: JSON.stringify(knowledgeEntry.keywords),
            tags: JSON.stringify(knowledgeEntry.tags)
          });
          inserted++;
        }
      }
    });
    try {
      tx(entries);
    } catch (err) {
      console.error("[TutorialRepository.upsertMany] \u4E8B\u52A1\u5931\u8D25:", err.message);
      skipped = entries.length;
      return { inserted, updated, skipped };
    }
    return { inserted, updated, skipped };
  }
  /**
   * 批量 upsert 异步版本（带 embedding 生成）
   *
   * 与同步版 `upsertMany()` 的区别：
   *   - 入库前为每条 entry 生成 BGE-small-zh-v1.5 向量（512 维）
   *   - 向量以 JSON 字符串形式写入 knowledge_entries.embedding 字段
   *   - 触发器会调用 `json_to_vec_f32(new.embedding)` 自动同步到 knowledge_vec 虚拟表
   *   - 同时 FTS5 触发器会自动同步 title/problem/keywords 到 knowledge_fts
   *
   * 降级策略：
   *   - `skipEmbedding=true`：跳过向量生成，等价于同步版（embedding=NULL）
   *   - EmbeddingService 不可用（模型下载失败）：跳过向量生成，记录警告，**仍写入主表**
   *     （后续可用 `backfillEmbeddings()` 补齐）
   *
   * 进度回调：
   *   - 2578 条教程首次入库会触发模型下载（约 24MB，10-30 秒）
   *   - 向量生成按 batchSize=8 分批，每批完成后回调 onProgress
   *   - 调用方可在 UI 显示"已处理 100/2578"
   *
   * @param entries 教程数组
   * @param options.skipEmbedding 是否跳过向量生成（默认 false）
   * @param options.onProgress 进度回调 (current, total)
   * @returns 统计 { inserted, updated, skipped }
   */
  async upsertManyAsync(entries, options) {
    if (entries.length === 0) {
      return { inserted: 0, updated: 0, skipped: 0 };
    }
    const embeddingMap = /* @__PURE__ */ new Map();
    if (!options?.skipEmbedding) {
      try {
        const floatMap = await generateEmbeddings(
          entries.map((e) => ({ id: e.id, title: e.title, content: e.content })),
          (pct) => {
            if (options?.onProgress) {
              options.onProgress(Math.floor(pct * entries.length), entries.length);
            }
          }
        );
        for (const [id, vec] of floatMap) {
          embeddingMap.set(id, Array.from(vec));
        }
      } catch (err) {
        if (err instanceof EmbeddingServiceUnavailableError) {
          console.warn(
            "[TutorialRepository.upsertManyAsync] Embedding \u670D\u52A1\u4E0D\u53EF\u7528\uFF0C\u8DF3\u8FC7\u5411\u91CF\u751F\u6210\uFF1A",
            err.message
          );
        } else {
          console.warn(
            "[TutorialRepository.upsertManyAsync] \u751F\u6210 embedding \u5931\u8D25\uFF0C\u8DF3\u8FC7\u5411\u91CF\u751F\u6210\uFF1A",
            err.message
          );
        }
      }
    }
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const raw = this.db.getRawConnection();
    if (!raw) {
      return { inserted: 0, updated: 0, skipped: entries.length };
    }
    const tx = raw.transaction((batch) => {
      for (const t of batch) {
        const knowledgeEntry = this.toKnowledgeEntry(t);
        const embeddingJson = embeddingMap.has(t.id) ? JSON.stringify(embeddingMap.get(t.id)) : null;
        const existing = this.db.prepare("SELECT id FROM knowledge_entries WHERE id = ? AND type = ?").get(knowledgeEntry.id, "tutorial");
        if (existing) {
          this.db.prepare(
            `UPDATE knowledge_entries SET
                title = @title,
                problem = @problem,
                "rootCause" = @rootCause,
                commands = @commands,
                keywords = @keywords,
                tags = @tags,
                "successRate" = @successRate,
                embedding = @embedding,
                "updatedAt" = @updatedAt
              WHERE id = @id AND type = @type`
          ).run({
            id: knowledgeEntry.id,
            type: knowledgeEntry.type,
            title: knowledgeEntry.title,
            problem: knowledgeEntry.problem,
            rootCause: knowledgeEntry.rootCause,
            commands: JSON.stringify(knowledgeEntry.commands),
            keywords: JSON.stringify(knowledgeEntry.keywords),
            tags: JSON.stringify(knowledgeEntry.tags),
            successRate: knowledgeEntry.successRate,
            embedding: embeddingJson,
            updatedAt: knowledgeEntry.updatedAt
          });
          updated++;
        } else {
          this.db.prepare(
            `INSERT INTO knowledge_entries
                (id, type, title, problem, "rootCause", commands, keywords, tags,
                 "successRate", "useCount", embedding, "createdAt", "updatedAt")
              VALUES
                (@id, @type, @title, @problem, @rootCause, @commands, @keywords, @tags,
                 @successRate, @useCount, @embedding, @createdAt, @updatedAt)`
          ).run({
            id: knowledgeEntry.id,
            type: knowledgeEntry.type,
            title: knowledgeEntry.title,
            problem: knowledgeEntry.problem,
            rootCause: knowledgeEntry.rootCause,
            commands: JSON.stringify(knowledgeEntry.commands),
            keywords: JSON.stringify(knowledgeEntry.keywords),
            tags: JSON.stringify(knowledgeEntry.tags),
            successRate: knowledgeEntry.successRate,
            useCount: knowledgeEntry.useCount,
            embedding: embeddingJson,
            createdAt: knowledgeEntry.createdAt,
            updatedAt: knowledgeEntry.updatedAt
          });
          inserted++;
        }
      }
    });
    try {
      tx(entries);
    } catch (err) {
      console.error("[TutorialRepository.upsertManyAsync] \u4E8B\u52A1\u5931\u8D25:", err.message);
      skipped = entries.length;
      return { inserted, updated, skipped };
    }
    if (options?.onProgress) {
      options.onProgress(entries.length, entries.length);
    }
    return { inserted, updated, skipped };
  }
  /**
   * 混合检索（FTS5 BM25 + vec0 KNN + RRF 融合）
   *
   * 调用任务 B 的 `hybridSearch()` 完成双路检索 + 倒数排名融合：
   *   - FTS5 路径：关键词精确匹配（如 "nginx 502" 直接命中相关条目）
   *   - 向量路径：语义相似（如 "如何排查网关错误" 也能命中 nginx 502 案例）
   *   - RRF 融合：取长补短，召回率 + 精确率兼顾
   *
   * 降级策略：
   *   - `useVector=false`：仅走 FTS5 路径
   *   - EmbeddingService 不可用（模型下载失败）：自动降级到仅 FTS5
   *   - 向量扩展未加载（db.isVectorEnabled()=false）：自动降级到仅 FTS5
   *   - FTS5 虚拟表不存在：hybridSearch 内部降级到 LIKE 关键词匹配
   *
   * @param query 用户查询字符串
   * @param options.type 知识类型过滤（默认 'tutorial'）
   * @param options.limit 返回数量上限（默认 10）
   * @param options.useVector 是否启用向量检索（默认 true）
   * @returns 混合检索结果数组（按 rrfScore 降序）
   */
  async searchHybrid(query, options) {
    const type = options?.type ?? "tutorial";
    const limit = options?.limit ?? 10;
    const wantVector = options?.useVector ?? true;
    let queryEmbedding;
    if (wantVector) {
      try {
        const prefixed = prefixQuery(query);
        const vec = await EmbeddingService.getInstance().embed(prefixed);
        if (vec.length === EMBEDDING_DIM && vec.some((v) => v !== 0)) {
          queryEmbedding = vec;
        }
      } catch (err) {
        console.warn(
          "[TutorialRepository.searchHybrid] \u751F\u6210\u67E5\u8BE2\u5411\u91CF\u5931\u8D25\uFF0C\u964D\u7EA7\u5230\u4EC5 FTS5 \u68C0\u7D22\uFF1A",
          err.message
        );
      }
    }
    return hybridSearch(this.db, {
      query,
      queryEmbedding,
      type,
      limit
    });
  }
  /**
   * 回填缺失的 embedding 字段（迁移工具）
   *
   * 应用场景：
   *   - 老版本数据未生成 embedding（同步版 upsertMany 入库的 2578 条历史数据）
   *   - EmbeddingService 当时不可用，后续模型下载成功后补齐
   *   - 数据库迁移后需要重建向量索引
   *
   * 流程：
   *   1. SELECT 找出 type='tutorial' AND embedding IS NULL 的所有条目
   *   2. 按 batchSize=8 分批调 generateEmbeddings()
   *   3. UPDATE 回填到主表（触发器会自动同步 knowledge_vec 虚拟表）
   *   4. 每批完成后回调 onProgress
   *
   * @param options.batchSize 每批大小（默认 8，与 generateEmbeddings 内部一致）
   * @param options.onProgress 进度回调 (current, total)
   * @returns 统计 { total, success, failed }
   */
  async backfillEmbeddings(options) {
    const batchSize = options?.batchSize ?? 8;
    const rows = this.db.prepare(
      `SELECT id, title, problem FROM knowledge_entries
         WHERE type = ? AND embedding IS NULL
         ORDER BY "updatedAt" ASC`
    ).all("tutorial");
    const total = rows.length;
    if (total === 0) {
      options?.onProgress?.(0, 0);
      return { total: 0, success: 0, failed: 0 };
    }
    let success = 0;
    let failed = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      try {
        const floatMap = await generateEmbeddings(
          batch.map((r) => ({ id: r.id, title: r.title, content: r.problem }))
        );
        const updateStmt = this.db.prepare(
          `UPDATE knowledge_entries SET embedding = ? WHERE id = ? AND type = ?`
        );
        const updateTx = this.db.getRawConnection()?.transaction((items2) => {
          for (const item of items2) {
            updateStmt.run(JSON.stringify(item.vec), item.id, "tutorial");
          }
        });
        const items = [];
        for (const row of batch) {
          const vec = floatMap.get(row.id);
          if (vec && vec.length === EMBEDDING_DIM) {
            items.push({ id: row.id, vec: Array.from(vec) });
          }
        }
        if (items.length > 0 && updateTx) {
          updateTx(items);
          success += items.length;
          failed += batch.length - items.length;
        } else {
          failed += batch.length;
        }
      } catch (err) {
        console.warn(
          `[TutorialRepository.backfillEmbeddings] \u6279\u6B21 ${i}-${i + batch.length} \u5931\u8D25\uFF1A`,
          err.message
        );
        failed += batch.length;
      }
      if (options?.onProgress) {
        options.onProgress(Math.min(i + batchSize, total), total);
      }
    }
    return { total, success, failed };
  }
  /**
   * 统计 tutorial 类型条目总数
   *
   * 用于 IPC `tutorial:search-status` 通道返回当前知识库规模，
   * 让 UI 能展示"已索引 N 条教程"。
   *
   * 实现：SELECT COUNT(*) FROM knowledge_entries WHERE type='tutorial'
   * 性能：SQLite COUNT(*) 走索引，O(log n)，无需全表扫描
   *
   * @returns tutorial 类型条目总数
   */
  count() {
    const row = this.db.prepare("SELECT COUNT(*) AS cnt FROM knowledge_entries WHERE type = ?").get("tutorial");
    return row?.cnt ?? 0;
  }
  /**
   * 统计指定 sourceName 的教程数
   */
  countBySourceName(sourceName) {
    const all = this.listAll();
    return all.filter((t) => t.source.name === sourceName).length;
  }
  /**
   * 单行 → TutorialEntry
   */
  rowToEntry(row) {
    try {
      const extra = row.rootCause ? JSON.parse(String(row.rootCause)) : {};
      const category = extra[FIELD_CATEGORY] ?? "linux-basics";
      const difficulty = extra[FIELD_DIFFICULTY] ?? "beginner";
      const tagsArr = row.tags ? JSON.parse(String(row.tags)) : [];
      const distros = tagsArr.filter(
        (t) => ["rhel", "centos", "rocky", "fedora", "ubuntu", "debian", "arch", "opensuse"].includes(t)
      );
      const keywords = row.keywords ? JSON.parse(String(row.keywords)) : [];
      const commands = row.commands ? JSON.parse(String(row.commands)) : [];
      return {
        id: String(row.id),
        title: String(row.title),
        summary: String(row.problem),
        source: {
          name: String(extra.sourceName ?? "Unknown"),
          url: String(extra[FIELD_SOURCE_URL] ?? ""),
          crawledAt: Number(extra.crawledAt ?? 0),
          license: String(extra.sourceLicense ?? "Unknown"),
          licenseUrl: extra[FIELD_SOURCE_LICENSE_URL] ? String(extra[FIELD_SOURCE_LICENSE_URL]) : void 0,
          kind: extra[FIELD_SOURCE_KIND]
        },
        category,
        tags: tagsArr.filter(
          (t) => !Object.values(TUTORIAL_CATEGORY_LABELS).includes(t) && !Object.values(TUTORIAL_DIFFICULTY_LABELS).includes(t) && !["rhel", "centos", "rocky", "fedora", "ubuntu", "debian", "arch", "opensuse"].includes(t)
        ),
        difficulty,
        readingTime: Number(extra[FIELD_READING_TIME] ?? 5),
        content: String(extra[FIELD_CONTENT] ?? ""),
        commands,
        keywords,
        distros,
        createdAt: Number(row.createdAt ?? Date.now()),
        updatedAt: Number(row.updatedAt ?? Date.now())
      };
    } catch (e) {
      console.warn("[TutorialRepository] \u89E3\u6790\u5931\u8D25:", e.message);
      return null;
    }
  }
};

// scripts/verify-rag-e2e.ts
import * as os from "node:os";
import * as path from "node:path";
var require2 = createRequire(import.meta.url);
var Module = require2("module");
var originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "electron") {
    return {
      app: {
        getPath: (name) => {
          if (name === "userData") return require2("node:path").join(require2("node:os").tmpdir(), `tdsf-test-${Date.now()}`);
          return "";
        }
      },
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: (s) => Buffer.from(s),
        decryptString: (b) => b.toString("utf-8")
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
var tmpDbPath = path.join(os.tmpdir(), `tdsf-rag-e2e-${Date.now()}.db`);
console.log(`[E2E] \u4E34\u65F6\u6570\u636E\u5E93: ${tmpDbPath}`);
var testEntries = [
  {
    id: "test:ssh-config",
    title: "\u5982\u4F55\u914D\u7F6E SSH \u514D\u5BC6\u767B\u5F55",
    summary: "\u4F7F\u7528 ssh-keygen \u751F\u6210\u5BC6\u94A5\u5BF9\uFF0C\u5E76\u901A\u8FC7 ssh-copy-id \u90E8\u7F72\u5230\u8FDC\u7A0B\u670D\u52A1\u5668",
    source: { name: "test", url: "http://test/ssh", crawledAt: Date.now(), license: "MIT", licenseUrl: "", kind: "online-crawl" },
    category: "security",
    tags: ["ssh", "security", "\u5BC6\u94A5"],
    difficulty: "intermediate",
    readingTime: 5,
    content: "## SSH \u514D\u5BC6\u767B\u5F55\u914D\u7F6E\n\n```bash\nssh-keygen -t ed25519\nssh-copy-id user@host\n```\n\n\u9A8C\u8BC1\uFF1A`ssh user@host` \u65E0\u9700\u5BC6\u7801",
    commands: ["ssh-keygen -t ed25519", "ssh-copy-id user@host"],
    keywords: ["ssh", "\u5BC6\u94A5", "\u514D\u5BC6", "keygen", "ed25519"],
    distros: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: "test:nginx-502",
    title: "Nginx 502 Bad Gateway \u6392\u67E5\u6307\u5357",
    summary: "502 \u9519\u8BEF\u901A\u5E38\u662F\u540E\u7AEF\u670D\u52A1\u6302\u6389\u6216\u8D85\u65F6\uFF0C\u7528 curl \u548C telnet \u5B9A\u4F4D",
    source: { name: "test", url: "http://test/nginx", crawledAt: Date.now(), license: "MIT", licenseUrl: "", kind: "online-crawl" },
    category: "troubleshooting",
    tags: ["nginx", "502", "troubleshoot"],
    difficulty: "advanced",
    readingTime: 8,
    content: "## Nginx 502 \u6392\u67E5\n\n```bash\ncurl -v http://localhost:8080\ntelnet 127.0.0.1 8080\n```\n\n\u5E38\u89C1\u539F\u56E0\uFF1A\u540E\u7AEF\u8FDB\u7A0B\u672A\u542F\u52A8 / \u7AEF\u53E3\u9519\u8BEF / \u9632\u706B\u5899\u62E6\u622A",
    commands: ["curl -v http://localhost:8080", "telnet 127.0.0.1 8080"],
    keywords: ["nginx", "502", "bad gateway", "\u6392\u67E5", "\u540E\u7AEF"],
    distros: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: "test:chmod",
    title: "chmod \u547D\u4EE4\u8BE6\u89E3",
    summary: "chmod \u7528\u4E8E\u4FEE\u6539\u6587\u4EF6\u6743\u9650\uFF0C\u652F\u6301\u6570\u5B57\u6A21\u5F0F\u548C\u7B26\u53F7\u6A21\u5F0F",
    source: { name: "test", url: "http://test/chmod", crawledAt: Date.now(), license: "MIT", licenseUrl: "", kind: "online-crawl" },
    category: "security",
    tags: ["chmod", "permission"],
    difficulty: "beginner",
    readingTime: 3,
    content: "## chmod \u547D\u4EE4\n\n```bash\nchmod 755 file.txt\nchmod u+x script.sh\n```\n\n\u6570\u5B57\u6A21\u5F0F\uFF1A7=rwx, 5=rx, 4=r",
    commands: ["chmod 755 file.txt", "chmod u+x script.sh"],
    keywords: ["chmod", "\u6743\u9650", "permission", "rwx"],
    distros: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: "test:systemd-failed",
    title: "systemd \u670D\u52A1\u542F\u52A8\u5931\u8D25\u6392\u67E5",
    summary: "\u7528 systemctl status \u548C journalctl \u67E5\u770B\u670D\u52A1\u5931\u8D25\u539F\u56E0",
    source: { name: "test", url: "http://test/systemd", crawledAt: Date.now(), license: "MIT", licenseUrl: "", kind: "online-crawl" },
    category: "services",
    tags: ["systemd", "service", "fail"],
    difficulty: "intermediate",
    readingTime: 6,
    content: "## systemd \u670D\u52A1\u5931\u8D25\n\n```bash\nsystemctl status nginx\njournalctl -u nginx -n 50\n```\n\n\u5E38\u89C1\u9519\u8BEF\uFF1A\u914D\u7F6E\u8BED\u6CD5 / \u4F9D\u8D56\u672A\u542F\u52A8 / \u7AEF\u53E3\u5360\u7528",
    commands: ["systemctl status nginx", "journalctl -u nginx -n 50"],
    keywords: ["systemd", "service", "fail", "status", "journalctl"],
    distros: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: "test:iptables-block",
    title: "iptables \u9632\u706B\u5899\u89C4\u5219\u914D\u7F6E",
    summary: "iptables \u662F Linux \u5185\u6838\u9632\u706B\u5899\u5DE5\u5177\uFF0C\u53EF\u914D\u7F6E\u5165\u7AD9\u51FA\u7AD9\u89C4\u5219",
    source: { name: "test", url: "http://test/iptables", crawledAt: Date.now(), license: "MIT", licenseUrl: "", kind: "online-crawl" },
    category: "networking",
    tags: ["iptables", "firewall", "network"],
    difficulty: "advanced",
    readingTime: 10,
    content: "## iptables \u914D\u7F6E\n\n```bash\niptables -A INPUT -p tcp --dport 22 -j ACCEPT\niptables -L -n -v\n```\n\n\u9ED8\u8BA4\u7B56\u7565\uFF1AINPUT/OUTPUT/FORWARD",
    commands: ["iptables -A INPUT -p tcp --dport 22 -j ACCEPT", "iptables -L -n -v"],
    keywords: ["iptables", "\u9632\u706B\u5899", "firewall", "\u89C4\u5219", "rule"],
    distros: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
];
async function main() {
  const db = DatabaseManager.getInstance(tmpDbPath);
  console.log(`[E2E] DB \u53EF\u7528=${db.isAvailable()} \u5411\u91CF\u6269\u5C55=${db.isVectorEnabled()}`);
  const repo = new TutorialRepository(db);
  console.log("\n========== 1. \u5165\u5E93 ==========");
  console.log("[E2E] \u5165\u5E93 5 \u6761\u6D4B\u8BD5\u6570\u636E\uFF08\u542B embedding \u751F\u6210\uFF09...");
  const insertResult = await repo.upsertManyAsync(testEntries, {
    onProgress: (cur, total) => console.log(`  [embedding] ${cur}/${total}`)
  });
  console.log(`[E2E] \u5165\u5E93\u5B8C\u6210: inserted=${insertResult.inserted} updated=${insertResult.updated} skipped=${insertResult.skipped}`);
  console.log("\n========== 2. \u68C0\u7D22\u72B6\u6001 ==========");
  const status = {
    vectorEnabled: db.isVectorEnabled(),
    embeddingModelLoaded: EmbeddingService.getInstance().isLoaded(),
    embeddingDim: EMBEDDING_DIM,
    totalEntries: repo.count()
  };
  console.log("[E2E]", status);
  const queries = [
    { q: "ssh \u514D\u5BC6", desc: "\u5173\u952E\u8BCD\u547D\u4E2D\uFF08FTS5 \u5E94\u8BE5\u8FD4\u56DE ssh \u6761\u76EE\uFF09" },
    { q: "\u914D\u7F6E SSH \u514D\u5BC6\u767B\u5F55", desc: "\u8BED\u4E49\u68C0\u7D22\uFF08vec0 \u5E94\u8BE5\u8FD4\u56DE ssh \u6761\u76EE\uFF09" },
    { q: "\u670D\u52A1\u8D77\u4E0D\u6765", desc: "\u8BED\u4E49\u6CDB\u5316\uFF08\u5E94\u547D\u4E2D systemd-failed\uFF09" },
    { q: "\u9632\u706B\u5899", desc: "\u4E2D\u6587\u5173\u952E\u8BCD\uFF08\u5E94\u547D\u4E2D iptables\uFF09" }
  ];
  console.log("\n========== 3. \u6DF7\u5408\u68C0\u7D22\u6D4B\u8BD5 ==========");
  for (const { q, desc } of queries) {
    console.log(`
--- \u67E5\u8BE2: "${q}" (${desc}) ---`);
    const queryVec = await EmbeddingService.getInstance().embed(prefixQuery(q)).catch(() => void 0);
    const results = hybridSearch(db, {
      query: q,
      queryEmbedding: queryVec,
      type: "tutorial",
      limit: 3
    });
    console.log(`  \u8FD4\u56DE ${results.length} \u6761:`);
    for (const r of results) {
      console.log(`    - [${r.source}] ${(r.rrfScore * 100).toFixed(2)}% | ${r.title}`);
      console.log(`      fts=${r.ftsScore.toFixed(2)} vec=${r.vecDistance.toFixed(4)}`);
    }
  }
  console.log("\n========== 4. \u6A21\u5F0F\u5BF9\u6BD4 ==========");
  const cmpQuery = "ssh \u914D\u7F6E";
  console.log(`\u67E5\u8BE2: "${cmpQuery}"`);
  const cmpVec = await EmbeddingService.getInstance().embed(prefixQuery(cmpQuery)).catch(() => void 0);
  console.log("\n\u4EC5 FTS\uFF08\u65E0\u5411\u91CF\uFF09:");
  const ftsOnly = hybridSearch(db, { query: cmpQuery, queryEmbedding: void 0, type: "tutorial", limit: 3 });
  ftsOnly.forEach((r, i) => console.log(`  ${i + 1}. [${r.source}] ${r.title} (rrf=${(r.rrfScore * 100).toFixed(2)}%)`));
  console.log("\n\u4EC5\u5411\u91CF\uFF08\u65E0 FTS\uFF0C\u4F20\u7A7A query\uFF09:");
  if (cmpVec) {
    const vecOnly = hybridSearch(db, { query: "", queryEmbedding: cmpVec, type: "tutorial", limit: 3 });
    vecOnly.forEach((r, i) => console.log(`  ${i + 1}. [${r.source}] ${r.title} (rrf=${(r.rrfScore * 100).toFixed(2)}%)`));
  }
  console.log("\n\u6DF7\u5408\uFF08FTS + vec\uFF09:");
  const both = hybridSearch(db, { query: cmpQuery, queryEmbedding: cmpVec, type: "tutorial", limit: 3 });
  both.forEach((r, i) => console.log(`  ${i + 1}. [${r.source}] ${r.title} (rrf=${(r.rrfScore * 100).toFixed(2)}%)`));
  console.log(`
\u2705 E2E \u9A8C\u8BC1\u5B8C\u6210\u3002\u4E34\u65F6 DB: ${tmpDbPath}`);
}
main().catch((err) => {
  console.error("[E2E] \u274C \u5931\u8D25:", err);
  process.exit(1);
});
