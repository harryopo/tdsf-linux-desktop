/**
 * schema 迁移单元测试（A4：PRAGMA user_version + 迁移数组）
 *
 * 判据来源：计划 §A4 "v0→v1 迁移幂等测试"。
 * 这里用真实 better-sqlite3 内存库（vitest 已把 better-sqlite3 列为 external，
 * 测试环境能加载原生模块），而不是 mock —— 迁移正确性恰恰体现在真实 DDL 行为上。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import type { Database as Db } from 'better-sqlite3'
import {
  MIGRATIONS,
  TARGET_SCHEMA_VERSION,
  applyMigrations,
  hasColumn,
  readSchemaVersion,
  writeSchemaVersion,
} from '../../src/main/services/db/schema-migrations'

/** 造一个"迁移前"的老库：故意缺 serverId / durationMs / embedding 三列 */
function createV0Database(db: Db): void {
  db.exec(`
    CREATE TABLE decision_cards (
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
    CREATE TABLE agent_memories (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      key TEXT NOT NULL UNIQUE,
      text TEXT NOT NULL,
      why TEXT,
      sourceSession TEXT,
      useCount INTEGER NOT NULL DEFAULT 0,
      lastUsedAt INTEGER,
      pinned INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    -- knowledge_entries 是最老的那张表，v0 库里必然存在；这里故意不带 feedback 列
    CREATE TABLE knowledge_entries (
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
  `)
  writeSchemaVersion(db, 0)
}

let db: Db

beforeEach(() => {
  db = new Database(':memory:')
})

afterEach(() => {
  db.close()
})

describe('user_version 读写', () => {
  it('空库读出 0', () => {
    expect(readSchemaVersion(db)).toBe(0)
  })

  it('写入后能读回', () => {
    writeSchemaVersion(db, 7)
    expect(readSchemaVersion(db)).toBe(7)
  })

  it('负数或非数字版本号直接拒绝（不接受拼进口令的输入）', () => {
    expect(() => writeSchemaVersion(db, -1)).toThrow(/非法 schema 版本号/)
    expect(() => writeSchemaVersion(db, Number.NaN)).toThrow(/非法 schema 版本号/)
    expect(() => writeSchemaVersion(db, '1; DROP TABLE x' as unknown as number)).toThrow(
      /非法 schema 版本号/
    )
  })
})

describe('applyMigrations — v0 老库补齐', () => {
  it('v0 库跑完后带齐三列，版本到达目标值', () => {
    createV0Database(db)
    expect(readSchemaVersion(db)).toBe(0)

    const result = applyMigrations(db)

    expect(result.error).toBeNull()
    expect(result.from).toBe(0)
    expect(result.to).toBe(TARGET_SCHEMA_VERSION)
    expect(result.applied).toEqual(MIGRATIONS.map((m) => m.version))
    expect(hasColumn(db, 'decision_cards', 'serverId')).toBe(true)
    expect(hasColumn(db, 'decision_cards', 'durationMs')).toBe(true)
    expect(hasColumn(db, 'agent_memories', 'embedding')).toBe(true)
    expect(hasColumn(db, 'knowledge_entries', 'feedback')).toBe(true)
    expect(readSchemaVersion(db)).toBe(TARGET_SCHEMA_VERSION)
  })

  it('补列之后老库里的答复能读写（反馈这条功能要靠这列活着）', () => {
    createV0Database(db)
    db.prepare(
      `INSERT INTO knowledge_entries (id, type, title, problem, commands, keywords, tags, successRate, useCount, createdAt, updatedAt)
       VALUES ('kb-1', 'incident_case', '磁盘满', 'df 打满', '[]', '[]', '[]', 0, 0, 1, 1)`
    ).run()

    applyMigrations(db)

    db.prepare(`UPDATE knowledge_entries SET feedback = 'helpful' WHERE id = 'kb-1'`).run()
    const row = db.prepare(`SELECT feedback, successRate FROM knowledge_entries WHERE id = 'kb-1'`)
      .get() as { feedback: string | null; successRate: number }
    expect(row.feedback).toBe('helpful')
  })

  it('补列不丢已有数据', () => {
    createV0Database(db)
    db.prepare(
      'INSERT INTO decision_cards (id, problem, hypothesis, evidences, confidence, risk, fixCommand, status, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('dc-1', '磁盘满', '日志占位', '[]', 0.8, 'high', 'df -h', 'open', 1)

    applyMigrations(db)

    const row = db.prepare('SELECT id, serverId, durationMs FROM decision_cards').get() as {
      id: string
      serverId: string | null
      durationMs: number | null
    }
    expect(row.id).toBe('dc-1')
    expect(row.serverId).toBeNull()
    expect(row.durationMs).toBeNull()
  })
})

describe('applyMigrations — 幂等', () => {
  it('同一库连跑两次，第二次不执行任何迁移', () => {
    createV0Database(db)
    const first = applyMigrations(db)
    expect(first.applied.length).toBeGreaterThan(0)

    const second = applyMigrations(db)
    expect(second.applied).toEqual([])
    expect(second.error).toBeNull()
    expect(second.from).toBe(TARGET_SCHEMA_VERSION)
    expect(second.to).toBe(TARGET_SCHEMA_VERSION)
  })

  it('新库（建表语句已带全部列）跑迁移也是 no-op', () => {
    db.exec(`
      CREATE TABLE decision_cards (id TEXT PRIMARY KEY, serverId TEXT, durationMs INTEGER);
      CREATE TABLE agent_memories (id TEXT PRIMARY KEY, embedding TEXT);
      CREATE TABLE knowledge_entries (id TEXT PRIMARY KEY, feedback TEXT);
    `)

    const result = applyMigrations(db)

    expect(result.error).toBeNull()
    expect(readSchemaVersion(db)).toBe(TARGET_SCHEMA_VERSION)
  })

  it('已在目标版本之后的库不会被回退', () => {
    db.exec(`
      CREATE TABLE decision_cards (id TEXT PRIMARY KEY, serverId TEXT, durationMs INTEGER);
      CREATE TABLE agent_memories (id TEXT PRIMARY KEY, embedding TEXT);
      CREATE TABLE knowledge_entries (id TEXT PRIMARY KEY, feedback TEXT);
    `)
    applyMigrations(db)
    writeSchemaVersion(db, TARGET_SCHEMA_VERSION + 10)

    const result = applyMigrations(db)

    expect(result.applied).toEqual([])
    expect(readSchemaVersion(db)).toBe(TARGET_SCHEMA_VERSION + 10)
  })
})

describe('applyMigrations — 失败可见且不越版本', () => {
  it('表不存在时迁移报错，user_version 停在失败点', () => {
    // 空库里两张表都没有，PRAGMA table_info 返回空数组 → ALTER 找不到表而抛错
    const result = applyMigrations(db)

    expect(result.error).toMatch(/迁移失败/)
    expect(result.to).toBe(0)
    expect(result.applied).toEqual([])
    expect(readSchemaVersion(db)).toBe(0)
  })

  it('迁移版本必须唯一且递增（防止漏排号导致跳过迁移）', () => {
    const versions = MIGRATIONS.map((m) => m.version)
    expect(new Set(versions).size).toBe(versions.length)
    expect([...versions].sort((a, b) => a - b)).toEqual(versions)
    expect(TARGET_SCHEMA_VERSION).toBe(Math.max(...versions))
  })
})
