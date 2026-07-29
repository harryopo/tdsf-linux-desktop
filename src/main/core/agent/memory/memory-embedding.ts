/**
 * memory-embedding — 长期记忆语义检索的 embedding 桥接（v2.9）
 *
 * 职责：把重量级的本地 BGE embedding 服务与 MemoryRepository 解耦。
 * - repo（memory-repo.ts）保持纯 DB 操作、可单测（不依赖 ONNX 模型）
 * - extractor（memory-extractor.ts）保持纯逻辑、可单测
 * - 本模块承担唯一的 EmbeddingService 依赖，全部 fire-and-forget / 降级安全
 *
 * 复用现成设施（与知识库/教程同一套）：
 * - EmbeddingService（BGE-small-zh-v1.5，本地 ONNX，512 维）
 * - prefixQuery（查询侧加 BGE 前缀，文档侧不加——BGE 模型硬性要求）
 * - repo.searchByVector（vec_distance_cosine 直查）/ setEmbedding / listMissingEmbedding
 */
import type { MemoryRepository, AgentMemory } from '../../../services/db/memory-repo'
import { logger } from '../../../services/log/logger'

/**
 * 生成查询向量（查询侧加 BGE 前缀）
 *
 * @returns 512 维 number[]；模型不可用/失败时返回 null（调用方降级到关键词）
 */
export async function embedMemoryQuery(query: string): Promise<number[] | null> {
  if (!query || !query.trim()) return null
  try {
    const { EmbeddingService, prefixQuery, EMBEDDING_DIM } = await import(
      '../../../services/tutorial/embedding-service'
    )
    const vec = await EmbeddingService.getInstance().embed(prefixQuery(query))
    // 维度校验 + 非全零（空向量不参与检索）
    if (vec.length === EMBEDDING_DIM && vec.some((v) => v !== 0)) {
      return Array.from(vec)
    }
    return null
  } catch (err) {
    logger.warn('MemoryEmbedding', `查询向量生成失败（降级关键词）：${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/**
 * 混合检索：优先向量语义召回，命中不足时用关键词兜底并去重合并
 *
 * @param repo 记忆仓储
 * @param query 用户查询
 * @param limit 返回上限
 */
export async function recallMemories(
  repo: MemoryRepository,
  query: string,
  limit = 5,
): Promise<{ results: AgentMemory[]; mode: 'vector' | 'keyword' | 'hybrid' }> {
  const queryVec = await embedMemoryQuery(query)
  const vectorHits = queryVec ? repo.searchByVector(queryVec, limit) : []

  // 向量已够量 → 纯语义
  if (vectorHits.length >= limit) {
    return { results: vectorHits, mode: 'vector' }
  }

  // 关键词兜底（补齐到 limit，按 key 去重）
  const keywordHits = repo.search(query, limit)
  if (vectorHits.length === 0) {
    return { results: keywordHits, mode: 'keyword' }
  }
  const seen = new Set(vectorHits.map((m) => m.key))
  const merged = [...vectorHits]
  for (const m of keywordHits) {
    if (merged.length >= limit) break
    if (!seen.has(m.key)) {
      merged.push(m)
      seen.add(m.key)
    }
  }
  return { results: merged, mode: 'hybrid' }
}

/**
 * 后台回填缺失 embedding（fire-and-forget，对话结束后异步补齐）
 *
 * 记忆写入时不阻塞生成 embedding（extractor 保持轻量）；由本函数在空闲时
 * 扫描 embedding IS NULL 的记忆分批补齐，触发器/直查即可语义命中。
 *
 * @param repo 记忆仓储
 * @param maxBatch 单次最多回填条数（默认 20，避免长时间占用）
 */
export async function backfillMemoryEmbeddings(repo: MemoryRepository, maxBatch = 20): Promise<number> {
  const missing = repo.listMissingEmbedding(maxBatch)
  if (missing.length === 0) return 0
  try {
    const { EmbeddingService } = await import('../../../services/tutorial/embedding-service')
    const service = EmbeddingService.getInstance()
    let filled = 0
    for (const m of missing) {
      // 文档侧不加前缀；text + why 作为语义载体
      const text = `${m.text}${m.why ? ` ${m.why}` : ''}`.trim()
      try {
        const vec = await service.embed(text)
        if (repo.setEmbedding(m.key, Array.from(vec))) filled++
      } catch {
        // 单条失败跳过，不中断整批
      }
    }
    if (filled > 0) logger.info('MemoryEmbedding', `回填 embedding ${filled}/${missing.length} 条`)
    return filled
  } catch (err) {
    logger.warn('MemoryEmbedding', `embedding 服务不可用，跳过回填：${err instanceof Error ? err.message : String(err)}`)
    return 0
  }
}
