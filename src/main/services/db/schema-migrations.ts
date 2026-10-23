/**
 * SQLite schema 迁移（A4：以 PRAGMA user_version 为版本指针）
 *
 * 为什么需要这一层：
 *   建表语句一直是 `CREATE TABLE IF NOT EXISTS` + 两个手写的 `migrateXxxTable()`
 *   私方法。前者对已存在的表完全不生效，后者每次启动无条件跑一遍 PRAGMA 检查，
 *   于是"这个库升到哪一版了"没有任何地方记录 —— 迁移失败也无人知晓。
 *
 * 规则：
 *   1. 需要改结构时，往 MIGRATIONS 末尾追加一项，version 取上一项 +1，**不要改历史项**。
 *   2. 每项 up() 必须幂等：老库可能已经带着这一列，CREATE TABLE 也会给新库带上，
 *      所以新增列一律走 hasColumn() 守卫。
 *   3. 迁移失败不抛异常（应用要能继续启动），但错误会记进 DbStatus.migrationError，
 *      且 user_version 不越过失败点 —— 由全局横幅显示给用户。
 */

import type { Database } from 'better-sqlite3'
import { backfillKnowledgeContentSeg } from './knowledge-seg-backfill'

/** 单项迁移定义 */
export interface Migration {
  /** 目标版本号，写入 PRAGMA user_version */
  version: number
  /** 人类可读描述，用于日志与失败提示 */
  description: string
  /** 变更动作，必须幂等 */
  up: (db: Database) => void
}

/** 读取 PRAGMA user_version（空库返回 0） */
export function readSchemaVersion(db: Database): number {
  const row = db.prepare('PRAGMA user_version').get() as Record<string, number>
  return Number(row?.user_version ?? 0)
}

/** 写入 PRAGMA user_version（该语句不接受占位符，只能拼接数字字面量） */
export function writeSchemaVersion(db: Database, version: number): void {
  const safe = Math.trunc(Number(version))
  if (!Number.isFinite(safe) || safe < 0) {
    throw new Error(`非法 schema 版本号: ${version}`)
  }
  db.exec(`PRAGMA user_version = ${safe}`)
}

/** 判断表是否已含某列（SQLite 不支持 ALTER TABLE ADD COLUMN IF NOT EXISTS） */
export function hasColumn(db: Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.some((r) => r.name === column)
}

/**
 * 迁移清单（按 version 升序）
 *
 * v1 收编了原先散在 DatabaseManager 里的两个手写迁移：
 *   - decision_cards 的 serverId / durationMs
 *   - agent_memories 的 embedding
 * 这两列在新库的 CREATE TABLE 里已经有了，所以对全新库是 no-op。
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'decision_cards 补 serverId/durationMs，agent_memories 补 embedding',
    up: (db) => {
      if (!hasColumn(db, 'decision_cards', 'serverId')) {
        db.exec('ALTER TABLE decision_cards ADD COLUMN serverId TEXT')
      }
      if (!hasColumn(db, 'decision_cards', 'durationMs')) {
        db.exec('ALTER TABLE decision_cards ADD COLUMN durationMs INTEGER')
      }
      if (!hasColumn(db, 'agent_memories', 'embedding')) {
        db.exec('ALTER TABLE agent_memories ADD COLUMN embedding TEXT')
      }
    },
  },
  {
    version: 2,
    description: 'knowledge_entries 补 feedback（用户"有没有帮助"的答复要落盘）',
    up: (db) => {
      // 界面上的反馈按钮自 v2.6 就在按，但库里没有这一列：kbUpdate 返回 true、
      // 字段被 serialize 丢掉，重开页面就回到"没反馈过"，成功率也没有因此动过。
      if (!hasColumn(db, 'knowledge_entries', 'feedback')) {
        db.exec('ALTER TABLE knowledge_entries ADD COLUMN feedback TEXT')
      }
    },
  },
  {
    version: 3,
    description: '建 decision_audit（决策审计链：事件当场落库、哈希写入时算好）',
    up: (db) => {
      // 详情页那句"逐行可验证篡改"以前是渲染层看时重建的，证明不了任何事（#174）。
      // 审计要成立，事件必须在发生那一刻进来，且只进不改——所以这张表没有主键之外的
      // 业务身份列，也不给任何 UPDATE/DELETE 的口子（仓储层不暴露，判据盯着）。
      db.exec(`
        CREATE TABLE IF NOT EXISTS decision_audit (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          decisionId TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          actor TEXT NOT NULL,
          action TEXT NOT NULL,
          result TEXT NOT NULL,
          prevHash TEXT NOT NULL,
          hash TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_decision_audit_card ON decision_audit(decisionId, seq);
      `)
    },
  },
  {
    version: 4,
    description: '建 chat_messages（对话历史落盘：重启不再全丢，切服务器不再串话）',
    up: (db) => {
      // 这两件事此前都做不到：库里没有任何一张对话表（`agent-store` 是纯内存，
      // 重启即空），而显示侧读的是全量 messages，于是上一台服务器的回答会混进这一台。
      // 表设计跟着"回看要能看到什么"走：思考链、工具卡、用量与 estimated 口径、
      // 取消与失败两档都得有地方放，否则回看到的比当场看到的少。
      // 主键用渲染层的消息 id（不是 AUTOINCREMENT）：同一条消息收尾那一笔要能覆盖，
      // 不然流式期的半截会永远留在列表里。
      // sshSessionId 可空是刻意的：没连服务器时的对话也是一等公民，
      // 但取数按 `IS` 比较，NULL 只和 NULL 相等，不会被别的会话捞走。
      db.exec(`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id TEXT PRIMARY KEY,
          correlationId TEXT,
          sshSessionId TEXT,
          role TEXT NOT NULL CHECK (role IN ('user','assistant')),
          content TEXT NOT NULL,
          reasoning TEXT,
          toolEvents TEXT,
          providerId TEXT,
          model TEXT,
          usage TEXT,
          cancelled INTEGER NOT NULL DEFAULT 0,
          isError INTEGER NOT NULL DEFAULT 0,
          errorCode TEXT,
          errorMessage TEXT,
          contextTokens INTEGER,
          contextNote TEXT,
          cotEntropyTrajectory TEXT,
          createdAt INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(sshSessionId, createdAt);
      `)
    },
  },
  {
    version: 5,
    description: '知识库全文检索支持中文：补 contentSeg 并重建 FTS',
    up: (db) => {
      /*
       * 病根：FTS5 的 unicode61 把整段连续中文当一个 token——「磁盘满了怎么办」
       * 在索引里是一个词，拿「磁盘」MATCH 永远命中不了。SQLite 的 trigram 分词
       * 也救不了两字词（它只切连续三字符）。
       *
       * 做法：入库前用二元组切好写进 contentSeg，FTS 只索引这一列（按空格切）；
       * 查询侧同一套规则切词并按 OR 连。分词是 JS 逻辑，SQLite 表达不了，
       * 所以存量数据在这一步用 JS 回填。
       *
       * 重建 FTS 必须连触发器一起 DROP：initFts5Tables 用的是 CREATE ... IF NOT EXISTS，
       * 旧表/旧触发器留着就永远不会换成新结构。
       */
      if (!hasColumn(db, 'knowledge_entries', 'contentSeg')) {
        db.exec('ALTER TABLE knowledge_entries ADD COLUMN contentSeg TEXT')
      }
      backfillKnowledgeContentSeg(db)
      db.exec(`
        DROP TRIGGER IF EXISTS knowledge_ai;
        DROP TRIGGER IF EXISTS knowledge_ad;
        DROP TRIGGER IF EXISTS knowledge_au;
        DROP TABLE IF EXISTS knowledge_fts;
      `)
    },
  },
]

/** 迁移清单的最高版本；建库后 user_version 应当等于它 */
export const TARGET_SCHEMA_VERSION: number = MIGRATIONS.reduce(
  (max, m) => Math.max(max, m.version),
  0
)

/** applyMigrations 的结果，供 DatabaseManager 组装 DbStatus */
export interface MigrationResult {
  /** 进入时的 user_version */
  from: number
  /** 离开时的 user_version（失败时停在最后一个成功的版本） */
  to: number
  /** 本次实际执行的版本号 */
  applied: number[]
  /** 失败原因；成功时为 null */
  error: string | null
}

/**
 * 按版本号顺序补齐迁移
 *
 * 每项迁移单独事务：失败时该项回滚，已完成的项保留，user_version 停在失败点。
 * 重复调用安全 —— 已到目标版本时直接返回 applied: []。
 */
export function applyMigrations(db: Database): MigrationResult {
  const from = readSchemaVersion(db)
  const applied: number[] = []
  let version = from

  const pending = [...MIGRATIONS]
    .filter((m) => m.version > from)
    .sort((a, b) => a.version - b.version)

  for (const migration of pending) {
    try {
      db.transaction(() => {
        migration.up(db)
        writeSchemaVersion(db, migration.version)
      })()
      version = migration.version
      applied.push(migration.version)
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err)
      return { from, to: version, applied, error: `v${migration.version} 迁移失败：${msg}` }
    }
  }

  return { from, to: version, applied, error: null }
}
