/**
 * 知识检索（聊天主链路用的那一个入口，#180）
 *
 * 组装顺序（照着 RAGFlow/LlamaIndex 的常规做法，不另发明）：
 *   1. 查询向量（BGE 查询侧前缀）→ FTS5 BM25 + 向量 KNN + RRF 融合
 *   2. 融合后一条都没命中 → 退回仓储的关键词/子串匹配
 *   3. 两条路径都只记一次「知识库检索」
 *
 * 为什么不用 hybridSearch 的返回直接喂模型：它只回 id/title/problem，
 * 而模型摘要要 commands、界面要 successRate/useCount —— 这里按 id 回填完整条目。
 */

import type { DatabaseManager } from '../db/database'
import type { KnowledgeRepository } from '../db/knowledge-repo'
import type { KnowledgeEntry } from '@shared/models'
import { hybridSearch } from '../tutorial/hybrid-search'
import { embedKnowledgeQuery } from './kb-embedding'

/** 一条命中：完整条目 + 它是怎么被找到的 */
export interface KnowledgeSearchHit {
  entry: KnowledgeEntry
  /** fts=全文 / vec=向量 / both=两路都中 / keyword=关键词兜底 */
  source: 'fts' | 'vec' | 'both' | 'keyword'
  /** RRF 融合分（keyword 兜底时为 0，没有可比性） */
  rrfScore: number
}

export interface KnowledgeSearchResult {
  hits: KnowledgeSearchHit[]
  /** 这次实际走的是哪条路 */
  mode: 'hybrid' | 'keyword'
  /** 向量腿有没有真的参与（模型没就绪 / 库里还没有向量时为 false） */
  vectorUsed: boolean
}

export interface KnowledgeSearchOptions {
  db: DatabaseManager
  repo: KnowledgeRepository
  query: string
  limit?: number
  /** 测试注入；生产走本地 BGE 模型 */
  embedQuery?: (query: string) => Promise<Float32Array | null>
}

/**
 * 检索知识库
 *
 * 注意：返回的是"按相关度排好的条目"，
 * 不做阈值过滤——RRF 分数与余弦距离量纲不同，硬定阈值会把中文短查询全滤掉。
 */
export async function searchKnowledge(opts: KnowledgeSearchOptions): Promise<KnowledgeSearchResult> {
  const limit = opts.limit ?? 5
  const embedQuery = opts.embedQuery ?? embedKnowledgeQuery

  const queryVector = await embedQuery(opts.query)
  const fused = hybridSearch(opts.db, {
    query: opts.query,
    queryEmbedding: queryVector ?? undefined,
    limit,
  })

  if (fused.length > 0) {
    // 混合路径自己记账：它绕开了仓储的 search()，不记这里就没人记。
    // 记数行为仍归仓储所有（同一个常量、同一个方法），这里只是借它记一笔。
    opts.repo.recordRetrieval()
    const hits: KnowledgeSearchHit[] = []
    for (const row of fused) {
      const entry = opts.repo.getById(row.id)
      // 取不到说明刚被删掉，跳过而不是塞一条残缺对象给模型
      if (entry) hits.push({ entry, source: row.source, rrfScore: row.rrfScore })
    }
    return {
      hits,
      mode: 'hybrid',
      vectorUsed: fused.some((row) => row.source === 'vec' || row.source === 'both'),
    }
  }

  // 兜底：仓储的关键词/子串匹配（它内部会记一次「知识库检索」）
  const entries = opts.repo.search(opts.query, undefined, limit)
  return {
    hits: entries.map((entry) => ({ entry, source: 'keyword', rrfScore: 0 })),
    mode: 'keyword',
    vectorUsed: false,
  }
}
