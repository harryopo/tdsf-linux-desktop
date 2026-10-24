/**
 * 知识条目删除：三种结果必须说三种话（#203）
 *
 * 界面以前没有任何删除入口（`kbDelete` 全仓零调用），而仓储里那一版 `delete()` 把
 * "删掉了" / "这条本来就不在" / "数据库出错了" 三件事一律压成 `false`：
 * `catch { return false }`。把它接到界面上，第一件事就是拿假话糊用户——
 * 库被锁住时屏幕上会说"这条已经不在了"。
 *
 * 所以这一刀先切在返回形状上：`deleted / not-found / error`，然后才接界面。
 *
 * 关于"真删三份"：`knowledge_fts` 与 `knowledge_vec` 都是 content/影子表，
 * 靠 knowledge_entries 上的 AFTER DELETE 触发器同步。
 * 这里能测到的是 FTS 那一半（真查一遍，删完查不到）；
 * vec 那一半要 sqlite-vec 原生扩展在测试库里装载，本机 :memory: 环境不保证有，
 * 所以改成钉触发器 SQL 本身（`DELETE FROM knowledge_vec WHERE id = old.id`），
 * **不把它当成"实测过向量真的没了"**。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseManager } from '../../src/main/services/db/database'
import { KnowledgeRepository } from '../../src/main/services/db/knowledge-repo'
import type { KnowledgeEntry } from '../../src/shared/models'

let dbm: DatabaseManager
let repo: KnowledgeRepository

function makeEntry(over: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  const now = Date.now()
  const base = {
    id: 'kb-del-1',
    type: 'incident_case' as const,
    title: '磁盘满了怎么办',
    problem: '根分区被打满，服务写日志失败',
    commands: ['df -h'],
    keywords: ['磁盘'],
    tags: ['storage'],
    successRate: 0,
    useCount: 0,
    createdAt: now,
    updatedAt: now,
  }
  // contentSeg 不在这里拼：serialize() 会按 #181 的口径自己生成，
  // 测试自己写一份就等于绕过了真正要守的那条写入路径。
  return { ...base, ...over }
}

/** 全文索引里还能不能查到这一行（按 #181 的 contentSeg 查） */
function ftsHitCount(query: string): number {
  const row = dbm
    .prepare('SELECT COUNT(*) AS n FROM knowledge_fts WHERE knowledge_fts MATCH ?')
    .get(query) as { n: number }
  return row.n
}

function triggerSql(name: string): string {
  const row = dbm
    .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?")
    .get(name) as { sql: string } | undefined
  return row?.sql ?? ''
}

beforeEach(() => {
  DatabaseManager.resetInstance()
  dbm = DatabaseManager.getInstance(':memory:')
  repo = new KnowledgeRepository(dbm)
})

afterEach(() => {
  DatabaseManager.resetInstance()
})

describe('[knowledge-delete] 三种结果说三种话', () => {
  it('删掉真存在的条目 ⇒ deleted，且主表与全文索引都查不到', () => {
    expect(repo.add(makeEntry())).toBe(true)
    expect(ftsHitCount('"磁盘"')).toBe(1)

    const result = repo.delete('kb-del-1')

    expect(result).toEqual({ kind: 'deleted' })
    expect(repo.getById('kb-del-1')).toBeNull()
    expect(ftsHitCount('"磁盘"'), 'AFTER DELETE 触发器要把 FTS 那一行也带走').toBe(0)
  })

  it('删一个不存在的 id ⇒ not-found，不许说成 deleted', () => {
    const result = repo.delete('never-existed')
    expect(result).toEqual({ kind: 'not-found' })
  })

  it('底层报错时 ⇒ error，不许回落成 not-found，更不许说成 deleted', () => {
    const entry = makeEntry({ title: 'nginx 502 排查', problem: '上游没活', keywords: ['nginx'] })
    expect(repo.add(entry)).toBe(true)

    // 真造一个数据库错误：删掉 FTS 表，AFTER DELETE 触发器就会在删除语句里炸
    dbm.exec('DROP TABLE knowledge_fts')

    const result = repo.delete('kb-del-1')

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' ? result.message : '', '错误要带原始原因，不能压成布尔').toMatch(
      /knowledge_fts/,
    )
  })

  it('向量那一半：靠触发器同步，SQL 必须写着按 id 删（本机测试库不一定装载 sqlite-vec，这里只钉机制本身）', () => {
    expect(triggerSql('knowledge_vec_ad')).toContain('DELETE FROM knowledge_vec WHERE id = old.id')
    expect(triggerSql('knowledge_ad')).toContain("'delete'")
  })
})
