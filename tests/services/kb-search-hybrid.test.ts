/**
 * 聊天主链路的知识检索（#180，真库）
 *
 * 之前 supervisor 的 kb_search 只走 KnowledgeRepository.search（关键词子串 + Jaccard），
 * FTS5/向量/融合那套只在两个 subagent 里用，而那两个 subagent 不在聊天主链路上——
 * 等于"混合检索"从来没给 AI 用过。
 *
 * 现在换成：
 *   1. FTS5 BM25 + 向量 KNN + RRF 融合（复用 tutor 已有实现，不另写一套）
 *   2. 双路都没命中时退回关键词匹配
 *   3. 两种路径都要记一次「知识库检索」，不能因为换了实现就让设置页那栏归零或翻倍
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseManager } from '../../src/main/services/db/database'
import { KnowledgeRepository } from '../../src/main/services/db/knowledge-repo'
import { writeEmbedding } from '../../src/main/services/knowledge/kb-embedding'
import { searchKnowledge } from '../../src/main/services/knowledge/kb-search'
import type { KnowledgeEntry } from '../../src/shared/models'

let dbm: DatabaseManager
let repo: KnowledgeRepository

function makeEntry(over: Partial<KnowledgeEntry>): KnowledgeEntry {
  const now = Date.now()
  return {
    id: 'kb-search-1',
    type: 'incident_case',
    title: '占位标题',
    problem: '占位问题',
    commands: [],
    keywords: [],
    tags: [],
    successRate: 0,
    useCount: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

/** 与条目向量完全一致的查询向量（余弦距离 0） */
function vecAt(index: number): Float32Array {
  const vec = new Float32Array(512)
  vec[index] = 1
  return vec
}

/** 设置页「知识库检索」这一栏的读数来源 */
function retrievalCount(): number {
  const row = dbm
    .prepare(`SELECT COUNT(*) AS n FROM tool_call_log WHERE toolName = '知识库检索'`)
    .get() as { n: number }
  return row.n
}

beforeEach(() => {
  DatabaseManager.resetInstance()
  dbm = DatabaseManager.getInstance(':memory:')
  repo = new KnowledgeRepository(dbm)
})

afterEach(() => {
  DatabaseManager.resetInstance()
})

describe('混合检索', () => {
  it('字面完全不重合也能命中：向量那条腿真在用', async () => {
    const entry = makeEntry({
      id: 'kb-vec-1',
      title: '网关异常',
      problem: '上游连接被拒绝',
      commands: ['curl -I 127.0.0.1'],
      keywords: ['upstream'],
      tags: ['network'],
    })
    repo.add(entry)
    writeEmbedding(dbm, entry.id, Array.from(vecAt(0)))

    const result = await searchKnowledge({
      db: dbm,
      repo,
      query: '服务起不来怎么办',
      // 注入查询向量：这是"模型可用时"的形状；真模型不在单测里加载
      embedQuery: async () => vecAt(0),
    })

    // 负向对照：旧实现（只走关键词子串/Jaccard）对这句话一条都查不到。
    // 没有这一行，上面那条"命中了"也可能是关键词碰巧中的，判据就白写了。
    expect(repo.search('服务起不来怎么办', undefined, 5)).toEqual([])

    expect(result.mode).toBe('hybrid')
    expect(result.vectorUsed).toBe(true)
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0].entry.id).toBe('kb-vec-1')
    // 命中后要能拿到完整条目，模型摘要才有 commands 可读
    expect(result.hits[0].entry.commands).toEqual(['curl -I 127.0.0.1'])
  })

  it('向量不可用、全文也切不中中文时，退回关键词匹配（还能查到）', async () => {
    repo.add(
      makeEntry({
        id: 'kb-kw-1',
        title: 'nginx 日志位置',
        problem: '默认在 /var/log/nginx/error.log',
        keywords: ['日志'],
      })
    )

    const result = await searchKnowledge({
      db: dbm,
      repo,
      query: '看日志',
      embedQuery: async () => null,
    })

    expect(result.mode).toBe('keyword')
    expect(result.vectorUsed).toBe(false)
    expect(result.hits.map((h) => h.entry.id)).toContain('kb-kw-1')
  })

  it('两种路径各记一次「知识库检索」，不归零也不翻倍', async () => {
    repo.add(makeEntry({ id: 'kb-cnt-1', title: '磁盘满了怎么办', keywords: ['磁盘'], commands: ['df -h'] }))

    const before = retrievalCount()
    await searchKnowledge({ db: dbm, repo, query: '磁盘满了怎么办', embedQuery: async () => null })
    expect(retrievalCount()).toBe(before + 1)

    await searchKnowledge({ db: dbm, repo, query: '看日志', embedQuery: async () => null })
    expect(retrievalCount()).toBe(before + 2)
  })

  it('查不到就返回空，不抛错也不塞不相干条目', async () => {
    repo.add(makeEntry({ id: 'kb-none-1', title: 'nginx', keywords: ['nginx'] }))
    const result = await searchKnowledge({
      db: dbm,
      repo,
      query: '完全不沾边的内容',
      embedQuery: async () => null,
    })
    expect(result.hits).toEqual([])
  })
})
