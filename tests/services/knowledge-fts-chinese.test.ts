/**
 * 中文全文检索真的能命中（#181，真 better-sqlite3 库）
 *
 * 这条判据的核心是一组 A/B：同一行数据
 *   - 老形态的 FTS（unicode61 直接索引原文）查「磁盘」→ 0 条
 *   - 新形态（索引入库前切好的二元组）查「磁盘」→ 命中
 * 只断言"能命中"是不够的：万一是别的字段碰巧中的，判据就白写了。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseManager } from '../../src/main/services/db/database'
import { KnowledgeRepository } from '../../src/main/services/db/knowledge-repo'
import { TARGET_SCHEMA_VERSION } from '../../src/main/services/db/schema-migrations'
import { backfillKnowledgeContentSeg } from '../../src/main/services/db/knowledge-seg-backfill'
import { hybridSearch } from '../../src/main/services/tutorial/hybrid-search'
import type { KnowledgeEntry } from '../../src/shared/models'

let dbm: DatabaseManager
let repo: KnowledgeRepository

function makeEntry(over: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  const now = Date.now()
  return {
    id: 'kb-cn-1',
    type: 'incident_case',
    title: '磁盘满了怎么办',
    problem: '根分区被打满，服务写日志失败',
    commands: ['df -h'],
    keywords: ['磁盘'],
    tags: ['storage'],
    successRate: 0,
    useCount: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

/** 老形态：unicode61 直接索引原文（改造前的样子） */
function legacyFtsHitCount(query: string): number {
  dbm.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS legacy_fts USING fts5(
      title, problem, tokenize='unicode61 remove_diacritics 2'
    );
  `)
  dbm.exec('DELETE FROM legacy_fts')
  dbm.exec('INSERT INTO legacy_fts(title, problem) SELECT title, problem FROM knowledge_entries')
  const row = dbm
    .prepare('SELECT COUNT(*) AS n FROM legacy_fts WHERE legacy_fts MATCH ?')
    .get(query) as { n: number }
  return row.n
}

function ftsHitIds(query: string): string[] {
  const rows = dbm
    .prepare(
      `SELECT k.id AS id FROM knowledge_fts
       JOIN knowledge_entries k ON k.rowid = knowledge_fts.rowid
       WHERE knowledge_fts MATCH ?`
    )
    .all(query) as Array<{ id: string }>
  return rows.map((r) => r.id)
}

beforeEach(() => {
  DatabaseManager.resetInstance()
  dbm = DatabaseManager.getInstance(':memory:')
  repo = new KnowledgeRepository(dbm)
})

afterEach(() => {
  DatabaseManager.resetInstance()
})

describe('中文命中（A/B 对照）', () => {
  it('老形态索引查不到，新形态能查到', () => {
    repo.add(makeEntry())
    // A：改造前 unicode61 直接把「磁盘满了怎么办」当一个词 → 查「磁盘」0 条
    expect(legacyFtsHitCount('"磁盘"')).toBe(0)
    // B：入库时切好词 → 查「磁盘」命中
    expect(ftsHitIds('"磁盘"')).toContain('kb-cn-1')
  })

  it('混合检索这条腿也真的用上了（不是只有表里能查）', () => {
    repo.add(makeEntry())
    const hits = hybridSearch(dbm, { query: '磁盘' })
    expect(hits.map((h) => h.id)).toContain('kb-cn-1')
    expect(hits.find((h) => h.id === 'kb-cn-1')?.source).toBe('fts')
  })

  it('长句查询也能召回短条目（OR 语义，不是 AND）', () => {
    repo.add(makeEntry())
    // 按 AND 连的话会要求「了怎/怎么/么办」同时出现，这条 10 字标题里根本没有
    const hits = hybridSearch(dbm, { query: '磁盘满了服务起不来' })
    expect(hits.map((h) => h.id)).toContain('kb-cn-1')
  })

  it('改标题后旧词查不到、新词查得到（触发器跟着 contentSeg 走）', () => {
    repo.add(makeEntry())
    repo.update('kb-cn-1', { title: '内存被占满了怎么办', problem: 'swap 被打满', keywords: ['内存'] })
    expect(ftsHitIds('"磁盘"')).not.toContain('kb-cn-1')
    expect(ftsHitIds('"内存"')).toContain('kb-cn-1')
  })

  it('建库即 v5：新库直接带 contentSeg 与新形态 FTS', () => {
    expect(TARGET_SCHEMA_VERSION).toBeGreaterThanOrEqual(5)
    const cols = dbm.prepare('PRAGMA table_info(knowledge_entries)').all() as Array<{ name: string }>
    expect(cols.map((c) => c.name)).toContain('contentSeg')
    const ftsCols = dbm.prepare('PRAGMA table_info(knowledge_fts)').all() as Array<{ name: string }>
    expect(ftsCols.map((c) => c.name)).toContain('contentSeg')
  })
})

describe('存量回填', () => {
  it('contentSeg 为空的老行回填后能查到（迁移 v5 走的同一段代码）', () => {
    // 模拟老库：直接写一行但不写 contentSeg
    dbm
      .prepare(
        `INSERT INTO knowledge_entries
         (id, type, title, problem, commands, keywords, tags, successRate, useCount, createdAt, updatedAt)
         VALUES (?, 'incident_case', ?, ?, '[]', ?, '[]', 0, 0, ?, ?)`
      )
      .run('kb-old-1', '网关报错一百次', '上游连接超时', '["网关"]', Date.now(), Date.now())
    // 查的必须是"标题里的半截词"：keywords 列本身是 JSON，unicode61 会把每个关键词
    // 切成独立 token，所以拿关键词查老行照样命中——那证明不了 contentSeg 的作用。
    expect(ftsHitIds('"报错"')).toEqual([])

    // 迁移层拿到的就是 better-sqlite3 的 Database（不是 DatabaseManager 包装），
    // 这里也走同一个原始连接，保证测的是迁移里跑的那份实现
    const raw = dbm.getRawConnection()
    expect(raw).not.toBeNull()
    const filled = backfillKnowledgeContentSeg(raw!)
    expect(filled).toBeGreaterThanOrEqual(1)
    expect(ftsHitIds('"报错"')).toContain('kb-old-1')
  })
})
