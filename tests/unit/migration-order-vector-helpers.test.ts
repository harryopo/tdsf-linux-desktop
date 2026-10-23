/**
 * 迁移顺序：向量辅助函数必须比迁移先注册（#181 实测踩到）
 *
 * 老库里已经装着 knowledge_vec_au 触发器，它调用 json_to_vec_f32。
 * v5 迁移要给存量行回填 contentSeg，那条 UPDATE 会触发它；
 * 若函数还没注册，整次迁移失败，用户开机会看到「数据库降级」横幅。
 *
 * 这条判据用一个真文件库复刻那个顺序：先建一张带同名触发器的表，
 * 把 user_version 压到 4，再让 DatabaseManager 正常初始化，看迁移有没有过。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { DatabaseManager } from '../../src/main/services/db/database'
import { applyMigrations } from '../../src/main/services/db/schema-migrations'

let dir = ''
let dbPath = ''

/** 造一个"升过级的老库"：v4 schema + 向量触发器 + 一条待回填的行 */
function seedLegacyDb(path: string): void {
  const raw = new Database(path)
  raw.exec(`
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
      feedback TEXT,
      useCount INTEGER NOT NULL DEFAULT 0,
      embedding TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE vec_probe (v BLOB);
    -- 与 initVec0Tables 里的 knowledge_vec_au 同形：任何 UPDATE 都会调这个函数
    CREATE TRIGGER knowledge_vec_au AFTER UPDATE ON knowledge_entries
    BEGIN
      DELETE FROM vec_probe;
      INSERT INTO vec_probe(v)
      SELECT json_to_vec_f32(new.embedding) WHERE new.embedding IS NOT NULL;
    END;
  `)
  raw.prepare(
    `INSERT INTO knowledge_entries
     (id, type, title, problem, commands, keywords, tags, successRate, useCount, createdAt, updatedAt)
     VALUES ('kb-legacy-1','incident_case','磁盘占满','根分区满了','[]','["磁盘"]','[]',0,0,1,1)`
  ).run()
  raw.pragma('user_version = 4')
  raw.close()
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tdsf-migrate-order-'))
  dbPath = join(dir, 'app.db')
})

afterEach(() => {
  DatabaseManager.resetInstance()
  rmSync(dir, { recursive: true, force: true })
})

describe('迁移顺序', () => {
  it('老库带着向量触发器时，v5 回填也能跑完（函数先注册）', () => {
    seedLegacyDb(dbPath)

    const dbm = DatabaseManager.getInstance(dbPath)
    const status = dbm.getStatus()

    expect(status.migrationError, `迁移失败：${status.migrationError}`).toBeNull()
    const row = dbm
      .prepare('SELECT contentSeg FROM knowledge_entries WHERE id = ?')
      .get('kb-legacy-1') as { contentSeg: string | null }
    expect(row.contentSeg, '回填没生效，这条老知识在中文检索里查不到').toContain('磁盘')
  })

  it('对照：不走 DatabaseManager（函数没注册）时同一个库会迁移失败', () => {
    seedLegacyDb(dbPath)
    // 直接对裸连接跑迁移 = 没有 registerVectorHelpers 的顺序
    const raw = new Database(dbPath)
    const result = applyMigrations(raw)
    raw.close()

    expect(result.error, '这条对照说明顺序确实是必需条件，不是巧合').toContain('json_to_vec_f32')
  })
})
