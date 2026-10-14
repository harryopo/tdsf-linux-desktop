/**
 * 标签查询的 SQL 语义判据（#94「归档每次决策都整表扫」）
 *
 * 归档的幂等检查（这条决策归档过没有）原来是 `exportAll().find(tags.includes(tag))`：
 * N 条决策 = N 次整表读 + N 次逐行反序列化。改成 findByTag / countByTag 后，
 * 正确性完全押在"tags 列是 JSON 数组文本，用 LIKE 匹配带引号的完整值"这一手上，
 * 所以必须拿真 SQL 量三件事：
 *   1. 前缀不误伤：查 decision:a_1 不许命中 decision:a_12；
 *   2. 下划线不当通配符：查 decision:a_1 不许命中 decision:ax1（不转义 LIKE 就会中）；
 *   3. countByTag 与 findByTag 同口径（两处 SQL 分叉是最常见的静默不一致）。
 *
 * 用 Node 自带的 node:sqlite 跑真 SQL，不用手写 SQL 模拟器：
 * 仓库里那份 MockDatabase 不认 LIKE/ESCAPE/COUNT，拿它测等于测自己写的假引擎。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import { KnowledgeRepository, tagLikeNeedle } from '../../src/main/services/db/knowledge-repo'
import type { DatabaseManager } from '../../src/main/services/db/database'

// vite 会把 `import 'node:sqlite'` 当外部包去解析（报 Failed to load url sqlite），
// 走 createRequire 拿 Node 自带的 sqlite，语义与命令行下 `node -e require('node:sqlite')` 一致。
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as unknown as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void
    prepare(sql: string): {
      run(...args: unknown[]): void
      get(...args: unknown[]): unknown
      all(...args: unknown[]): unknown[]
    }
  }
}

// DatabaseSync 是从 node:sqlite 现取的值（构造函数），不是类型；
// 要声明实例就用 InstanceType<typeof ...>（写成 DatabaseSync 是拿值当类型用）。
let sqlite: InstanceType<typeof DatabaseSync>
let repo: KnowledgeRepository

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE knowledge_entries (
      id TEXT PRIMARY KEY,
      tags TEXT NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)
  // 只转发 prepare：被测的三个查询都是单语句，不需要 better-sqlite3 的其余面
  const db = {
    prepare: (sql: string) => ({
      all: (...args: unknown[]) => sqlite.prepare(sql).all(...(args as never[])),
      get: (...args: unknown[]) => sqlite.prepare(sql).get(...(args as never[])),
      run: (...args: unknown[]) => sqlite.prepare(sql).run(...(args as never[])),
    }),
  } as unknown as DatabaseManager
  repo = new KnowledgeRepository(db)
})

function insert(id: string, tags: string[], updatedAt: number): void {
  sqlite.prepare('INSERT INTO knowledge_entries (id, tags, updatedAt) VALUES (?, ?, ?)').run(
    id,
    JSON.stringify(tags),
    updatedAt
  )
}

describe('findByTag / countByTag：真 SQL 下的标签匹配', () => {
  it('命中带该标签的行，且前缀不误伤（decision:a_1 不中 decision:a_12）', () => {
    insert('hit', ['source:auto-archive', 'decision:a_1'], 100)
    insert('prefix', ['decision:a_12'], 200)

    const found = repo.findByTag('decision:a_1')
    expect(found.map((e) => e.id)).toEqual(['hit'])
    expect(repo.countByTag('decision:a_1')).toBe(1)
  })

  it('标签里的下划线按字面量匹配（不转义就会被当成 LIKE 通配符多命中）', () => {
    insert('exact', ['decision:a_1'], 100)
    insert('wild', ['decision:ax1'], 200)

    expect(repo.findByTag('decision:a_1').map((e) => e.id)).toEqual(['exact'])
    expect(repo.countByTag('decision:a_1')).toBe(1)
    // 反向对照：转义逻辑本身没写反——查 ax1 也只命中它自己
    expect(repo.findByTag('decision:ax1').map((e) => e.id)).toEqual(['wild'])
  })

  it('两条 SQL 同口径：countByTag 恒等于 findByTag(limit 放宽) 的条数', () => {
    insert('k1', ['source:auto-archive'], 1)
    insert('k2', ['source:auto-archive', 'decision:z'], 2)
    insert('k3', ['decision:z'], 3)

    for (const tag of ['source:auto-archive', 'decision:z', 'decision:none']) {
      expect(repo.countByTag(tag), `标签 ${tag} 两处口径不一致`).toBe(
        repo.findByTag(tag, 500).length
      )
    }
  })

  it('多条命中时按 updatedAt 倒序取第一条（幂等检查要的是最新那条）', () => {
    insert('old', ['decision:d1'], 100)
    insert('new', ['decision:d1'], 900)
    expect(repo.findByTag('decision:d1')[0].id).toBe('new')
  })

  it('countAll 数的是行数，不再把整表读进内存', () => {
    insert('k1', ['a'], 1)
    insert('k2', ['b'], 2)
    expect(repo.countAll()).toBe(2)
  })

  it('needle 构造：引号包住整个标签，% 与 _ 都转义', () => {
    expect(tagLikeNeedle('decision:a_1')).toBe('"decision:a\\_1"')
    expect(tagLikeNeedle('100%')).toBe('"100\\%"')
  })
})
