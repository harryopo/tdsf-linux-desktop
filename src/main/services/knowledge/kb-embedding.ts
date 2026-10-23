/**
 * 知识库向量的唯一写入点（#180）
 *
 * 为什么单独一层：
 * - 仓储（knowledge-repo.ts）保持纯 DB、可单测，不认识 ONNX；
 * - 导入器（kb-import.ts）只关心"哪些条目需要向量"，不认识模型；
 * - 本模块承担唯一的 EmbeddingService 依赖，全部降级安全。
 *
 * 与记忆那条链（memory-embedding.ts）同一套设施：
 * - EmbeddingService（BGE-small-zh-v1.5，本地 ONNX，512 维）
 * - prefixQuery：**查询侧**加 BGE 前缀，**文档侧不加**（模型硬性要求）
 * - embedding 列存 JSON 文本，database.ts 的触发器同步进 vec0
 *
 * 文本口径也是单源：导入、补齐、检索三处都调 knowledgeEmbeddingText，
 * 免得"入库时截 1500、检索时截 2000"这种漂移让同一句话的两个向量对不上。
 */

import type { DatabaseManager } from '../db/database'
import { logger } from '../log/logger'

/** 文档侧最多取多少字符（与教程回填同一档：约 500-700 token，不超 BGE 的 512 token） */
export const KNOWLEDGE_EMBED_MAX_CHARS = 1500

/** 一次推理多少条（与 EmbeddingService.embedBatch 默认值一致） */
export const EMBED_BATCH_SIZE = 8

/** 一次"补齐语义索引"最多处理多少条（避免一次点按把界面卡几分钟） */
export const REINDEX_LIMIT_DEFAULT = 200

/**
 * 向量器接口（可注入，便于单测）
 *
 * ensureReady 返回 null 表示可用；返回字符串则是给人看的原因（直接进界面文案）。
 */
export interface KbEmbedder {
  ensureReady(): Promise<string | null>
  embed(texts: string[]): Promise<Float32Array[]>
}

/** 文档侧嵌入文本：标题在上、正文在下，超长如实截断 */
export function knowledgeEmbeddingText(title: string, problem: string): string {
  const head = (title ?? '').trim()
  const body = (problem ?? '').slice(0, KNOWLEDGE_EMBED_MAX_CHARS)
  return `${head}\n\n${body}`.trim()
}

/**
 * 写/清一条条目的向量
 *
 * 走独立 UPDATE 而不是仓储的 update()：那条路会整行合并，
 * 一不小心就把本机的 useCount / feedback 带进写语句里。
 */
export function writeEmbedding(db: DatabaseManager, id: string, vec: number[] | null): boolean {
  try {
    db.prepare('UPDATE knowledge_entries SET embedding = ? WHERE id = ?').run(
      vec && vec.length > 0 ? JSON.stringify(vec) : null,
      id
    )
    return true
  } catch (err) {
    logger.warn('KB.EMBEDDING', '写向量失败', {
      id,
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

/** 读一条条目当前的向量（判据与去重用） */
export function readEmbedding(db: DatabaseManager, id: string): string | null {
  const row = db.prepare('SELECT embedding FROM knowledge_entries WHERE id = ?').get(id) as
    | { embedding: string | null }
    | undefined
  return row?.embedding ?? null
}

function isUsableVector(vec: Float32Array | undefined): vec is Float32Array {
  if (!vec || vec.length === 0) return false
  for (const v of vec) {
    if (!Number.isFinite(v)) return false
  }
  return true
}

/**
 * 为一组条目生成并写入向量
 *
 * 只处理"当前 embedding 为空"的条目：内容没变的条目不会白跑一次推理
 * （这是 LlamaIndex 用内容哈希跳过重处理的同一条思路）。
 */
export async function embedKnowledgeEntries(
  db: DatabaseManager,
  ids: string[],
  embedder: KbEmbedder
): Promise<{ embedded: number; failed: number; note?: string }> {
  if (ids.length === 0) return { embedded: 0, failed: 0 }

  const pending = ids.filter((id) => readEmbedding(db, id) === null)
  if (pending.length === 0) return { embedded: 0, failed: 0 }

  const notReady = await embedder.ensureReady()
  if (notReady) {
    return { embedded: 0, failed: 0, note: notReady }
  }

  let embedded = 0
  let failed = 0
  for (let offset = 0; offset < pending.length; offset += EMBED_BATCH_SIZE) {
    const batchIds = pending.slice(offset, offset + EMBED_BATCH_SIZE)
    const rows = db
      .prepare(
        `SELECT id, title, problem FROM knowledge_entries WHERE id IN (${batchIds.map(() => '?').join(',')})`
      )
      .all(...batchIds) as Array<{ id: string; title: string; problem: string }>
    const byId = new Map(rows.map((r) => [r.id, r]))
    const texts: string[] = []
    const orderedIds: string[] = []
    for (const id of batchIds) {
      const row = byId.get(id)
      if (!row) {
        failed++
        continue
      }
      texts.push(knowledgeEmbeddingText(row.title, row.problem))
      orderedIds.push(id)
    }
    if (texts.length === 0) continue

    try {
      const vectors = await embedder.embed(texts)
      for (let i = 0; i < orderedIds.length; i++) {
        const vec = vectors[i]
        if (!isUsableVector(vec)) {
          failed++
          continue
        }
        if (writeEmbedding(db, orderedIds[i], Array.from(vec))) embedded++
        else failed++
      }
    } catch (err) {
      failed += orderedIds.length
      logger.warn('KB.EMBEDDING', '一批向量生成失败，跳过继续', {
        size: orderedIds.length,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { embedded, failed }
}

/**
 * 补齐语义索引：按"还没有向量"批量生成
 *
 * 这是界面上的"补齐语义索引"按钮，也是内置 22 条种子与用户手填条目
 * 拿到向量的唯一途径（启动时自动下载模型不在产品口径里）。
 */
export async function reindexKnowledgeEmbeddings(
  db: DatabaseManager,
  embedder: KbEmbedder,
  limit: number = REINDEX_LIMIT_DEFAULT
): Promise<{ embedded: number; failed: number; remaining: number; note?: string }> {
  const remainingRow = db
    .prepare(`SELECT COUNT(*) AS n FROM knowledge_entries WHERE embedding IS NULL OR embedding = ''`)
    .get() as { n: number } | undefined
  const remainingBefore = remainingRow?.n ?? 0
  if (remainingBefore === 0) return { embedded: 0, failed: 0, remaining: 0 }

  const rows = db
    .prepare(
      `SELECT id FROM knowledge_entries
       WHERE embedding IS NULL OR embedding = ''
       ORDER BY updatedAt DESC LIMIT ?`
    )
    .all(limit) as Array<{ id: string }>
  const ids = rows.map((r) => r.id)

  const outcome = await embedKnowledgeEntries(db, ids, embedder)
  const remainingRowAfter = db
    .prepare(`SELECT COUNT(*) AS n FROM knowledge_entries WHERE embedding IS NULL OR embedding = ''`)
    .get() as { n: number } | undefined
  return {
    embedded: outcome.embedded,
    failed: outcome.failed,
    remaining: remainingRowAfter?.n ?? Math.max(0, remainingBefore - outcome.embedded),
    note: outcome.note,
  }
}

/**
 * 真正的 ONNX 向量器
 *
 * 采用动态 import：模块加载时不碰 transformers.js，只有真的要用模型才把
 * 几百 MB 的推理栈拉起来（与 memory-embedding.ts 同一做法）。
 *
 * @param opts.allowDownload 缺模型时允不允许联网取（默认允许）。
 *        导入笔记、重建语义索引这类**用户显式动作**允许；
 *        聊天里的检索一律传 false（`embedKnowledgeQuery` 内部就是这么调的）。
 */
export function createOnnxKbEmbedder(opts: { allowDownload?: boolean } = {}): KbEmbedder {
  const allowDownload = opts.allowDownload !== false
  return {
    async ensureReady(): Promise<string | null> {
      try {
        const { EmbeddingService } = await import('../tutorial/embedding-service')
        await EmbeddingService.getInstance().ensureLoaded({ allowDownload })
        return null
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        logger.warn('KB.EMBEDDING', '本地向量模型不可用', { reason, allowDownload })
        return `本地向量模型没就绪：${reason}。文字内容已正常保存，语义检索要等模型可用后点「重建语义索引」才会生效。`
      }
    },
    async embed(texts: string[]): Promise<Float32Array[]> {
      const { EmbeddingService, EMBEDDING_DIM } = await import('../tutorial/embedding-service')
      const vectors = await EmbeddingService.getInstance().embedBatch(texts, EMBED_BATCH_SIZE)
      // 维度不对的向量一律作废：宁可这一条没有向量，也不能把 0 向量写进库
      return vectors.map((v) => (v.length === EMBEDDING_DIM ? v : new Float32Array(0)))
    },
  }
}

/**
 * 查询侧向量（检索用）
 *
 * 与文档侧唯一的差别是 BGE 前缀：官方要求查询加、文档不加。
 * 失败返回 null，调用方退回关键词/全文那条腿。
 */
export async function embedKnowledgeQuery(query: string): Promise<Float32Array | null> {
  if (!query.trim()) return null
  try {
    const { EmbeddingService, prefixQuery, EMBEDDING_DIM } = await import(
      '../tutorial/embedding-service'
    )
    const service = EmbeddingService.getInstance()
    // 聊天里的检索不许替用户下载模型：缓存里有就加载（约 1 秒），缺就直接走全文/关键词。
    // 下载只发生在用户显式动作里（导入笔记、重建语义索引、教程回填）。
    await service.ensureLoaded({ allowDownload: false })
    const vec = await service.embed(prefixQuery(query))
    if (vec.length !== EMBEDDING_DIM) return null
    if (!vec.some((v) => v !== 0)) return null
    return vec
  } catch (err) {
    logger.warn('KB.EMBEDDING', '查询向量生成失败（降级到全文检索）', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
