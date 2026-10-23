/**
 * contentSeg 的回填（#181，迁移 v5 用）
 *
 * 加列那一刻，库里已有的条目的 contentSeg 是 NULL——不补的话这些条目
 * 在中文全文检索里等于不存在（FTS 只索引这一列）。
 *
 * 放在这里而不是写进迁移体的 SQL：分词是 JS 逻辑，SQLite 表达不了。
 * 直接吃 better-sqlite3 的 Database，这样迁移层与单测都能用同一份实现。
 */

import type { Database } from 'better-sqlite3'
import { buildContentSeg } from './knowledge-tokenize'

/** 安全解析 JSON 字符串数组（脏数据按空数组处理，不让一条坏行卡住整次回填） */
function parseArray(json: unknown): string[] {
  if (typeof json !== 'string' || json.length === 0) return []
  try {
    const parsed = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/**
 * 给 contentSeg 为空的条目补上分词文本
 *
 * @returns 实际补了多少条
 */
export function backfillKnowledgeContentSeg(db: Database, batchSize = 200): number {
  // 迁移要能对任何历史形状的库跑完（有单测用只有几列的极简表模拟老库）。
  // 缺列时直接跳过：那种表里也没有可索引的正文，回填个空串没有意义，
  // 但为此让整次迁移失败、把应用卡在启动横幅上才是真问题。
  const columns = new Set(
    (db.prepare('PRAGMA table_info(knowledge_entries)').all() as Array<{ name: string }>).map(
      (c) => c.name
    )
  )
  const required = ['id', 'title', 'problem', 'keywords', 'tags', 'commands', 'contentSeg']
  if (!required.every((name) => columns.has(name))) return 0

  const select = db.prepare(
    `SELECT id, title, problem, keywords, tags, commands
     FROM knowledge_entries
     WHERE contentSeg IS NULL
     LIMIT ?`
  )
  const update = db.prepare('UPDATE knowledge_entries SET contentSeg = ? WHERE id = ?')

  let total = 0
  for (;;) {
    const rows = select.all(batchSize) as Array<{
      id: string
      title: string | null
      problem: string | null
      keywords: string | null
      tags: string | null
      commands: string | null
    }>
    if (rows.length === 0) break
    const runAll = db.transaction((batch: typeof rows) => {
      for (const row of batch) {
        update.run(
          buildContentSeg({
            title: row.title,
            problem: row.problem,
            keywords: parseArray(row.keywords),
            tags: parseArray(row.tags),
            commands: parseArray(row.commands),
          }),
          row.id
        )
      }
    })
    runAll(rows)
    total += rows.length
    // 每批都更新了 contentSeg，下一轮 SELECT 自然只会拿到剩下的
    if (rows.length < batchSize) break
  }
  return total
}
