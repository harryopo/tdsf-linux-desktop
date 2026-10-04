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
