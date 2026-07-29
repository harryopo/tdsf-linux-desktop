/**
 * memory-repo — Agent 长期记忆仓储（v2.8）
 *
 * 背景：Agent 每次对话都是"全新"的，没有跨会话记忆。本仓储提供长期记忆的
 * 存储/检索/注入预算/防膨胀能力，配合 memory-extractor（LLM 自动沉淀）与
 * supervisor 注入使用。
 *
 * 设计来源（调研 opensource-reference）：
 * - qwen-code：四分类（user/feedback/project/reference）→ 本项目改造为运维五分类
 * - kilo-code：key 稳定 slug upsert 语义 / 8KB 注入硬预算 / decisions 审计 /
 *   authority rule（记忆是召回上下文不是政策）
 *
 * 分类体系（type）：
 * - user_profile  用户角色/技能水平（教学场景：学生还是运维老手）
 * - preference    偏好与行为约束（"危险命令先问我"/回复风格）
 * - environment   环境事实（主机/服务/路径/常用命令）
 * - correction    错误教训（工具失败+用户纠正沉淀，LRU 淘汰豁免）
 * - fact          其他持久事实/决策
 *
 * 防膨胀：
 * - 单条 240 字符截断；每类上限 MAX_PER_TYPE；淘汰按 lastUsedAt LRU
 *   （correction 与 pinned 豁免）
 * - 注入块硬预算 INJECT_BUDGET 字节（kilo 8192 约定）
 */
import { randomUUID } from 'node:crypto'
import type { DatabaseManager } from './database'

/** 记忆分类 */
export type MemoryType = 'user_profile' | 'preference' | 'environment' | 'correction' | 'fact'

/** 合法分类集合（提取结果校验用） */
export const MEMORY_TYPES: readonly MemoryType[] = [
  'user_profile', 'preference', 'environment', 'correction', 'fact',
]

/** 单条记忆 */
export interface AgentMemory {
  id: string
  type: MemoryType
  /** 稳定 slug key（upsert 语义：同 key 更新而非新增） */
  key: string
  /** 记忆正文（≤240 字符） */
  text: string
  /** 为什么记（边界情况下帮模型变通，qwen "Why" 字段设计） */
  why: string | null
  sourceSession: string | null
  useCount: number
  lastUsedAt: number | null
  pinned: boolean
  createdAt: number
  updatedAt: number
}

/** 提取器产出的 upsert 操作 */
export interface MemoryUpsert {
  type: MemoryType
  key: string
  text: string
  why?: string
}

/** 单条正文上限（kilo 240 字符约定） */
export const MEMORY_TEXT_LIMIT = 240
/** 每类条目上限 */
export const MAX_PER_TYPE = 40
/** 注入块硬预算（字节，kilo 8192 约定） */
export const INJECT_BUDGET = 8192

/** 分类中文标签（注入块与 UI 共用） */
export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  user_profile: '用户画像',
  preference: '偏好约束',
  environment: '环境事实',
  correction: '错误教训',
  fact: '持久事实',
}

/** 秘密内容拦截（kilo redact 思路：写入前拒绝疑似凭据） */
const SECRET_RE = /(password|passwd|api[-_]?key|secret|token|私钥|密码|BEGIN [A-Z ]*PRIVATE KEY)[=:：]?\s*\S{6,}/i

/** 临时性内容过滤词（qwen extract patch 过滤思路） */
const TRANSIENT_RE = /今天|刚才|现在正在|暂时|临时|待会|一会儿|temporary|right now/i

interface MemoryRow {
  id: string
  type: string
  key: string
  text: string
  why: string | null
  sourceSession: string | null
  useCount: number
  lastUsedAt: number | null
  pinned: number
  createdAt: number
  updatedAt: number
}

/**
 * 写入前内容校验（导出供 extractor 复用）
 *
 * @returns null = 通过；string = 拒绝原因
 */
export function validateMemoryText(text: string): string | null {
  const t = (text || '').trim()
  if (t.length < 8) return 'too_short'
  if (t.endsWith('?') || t.endsWith('？')) return 'question'
  if (SECRET_RE.test(t)) return 'secret'
  if (TRANSIENT_RE.test(t)) return 'transient'
  return null
}

/**
 * Agent 长期记忆仓储
 *
 * 依赖注入 DatabaseManager（便于测试 mock，与 KnowledgeRepository 同构）。
 */
export class MemoryRepository {
  private readonly db: DatabaseManager

  constructor(db: DatabaseManager) {
    this.db = db
  }

  /**
   * upsert 一条记忆（同 key 更新，否则新增）
   *
   * @returns 'inserted' | 'updated' | 拒绝原因字符串
   */
  upsert(op: MemoryUpsert, sourceSession?: string): string {
    const reject = validateMemoryText(op.text)
    if (reject) {
      this.audit('validate', 'skip', `${reject}: ${op.text.slice(0, 60)}`)
      return reject
    }
    if (!MEMORY_TYPES.includes(op.type)) {
      this.audit('validate', 'skip', `bad_type: ${String(op.type)}`)
      return 'bad_type'
    }
    const now = Date.now()
    const text = op.text.trim().slice(0, MEMORY_TEXT_LIMIT)
    const key = op.key.trim().toLowerCase().slice(0, 80)
    if (!key) return 'bad_key'

    const existing = this.db
      .prepare('SELECT id FROM agent_memories WHERE key = ?')
      .get(key) as { id: string } | undefined

    if (existing) {
      this.db
        .prepare('UPDATE agent_memories SET type=?, text=?, why=?, sourceSession=?, updatedAt=? WHERE key=?')
        .run(op.type, text, op.why ?? null, sourceSession ?? null, now, key)
      this.audit('upsert', 'update', `${op.type}/${key}`)
      return 'updated'
    }

    this.db
      .prepare(
        'INSERT INTO agent_memories (id, type, key, text, why, sourceSession, useCount, lastUsedAt, pinned, createdAt, updatedAt) VALUES (?,?,?,?,?,?,0,NULL,0,?,?)',
      )
      .run(randomUUID(), op.type, key, text, op.why ?? null, sourceSession ?? null, now, now)
    this.audit('upsert', 'insert', `${op.type}/${key}`)
    // 超限淘汰（correction/pinned 豁免）
    this.evictIfNeeded(op.type)
    return 'inserted'
  }

  /** 按 key 删除（forget） */
  remove(key: string): boolean {
    const r = this.db.prepare('DELETE FROM agent_memories WHERE key = ?').run(key.trim().toLowerCase())
    if (r.changes > 0) this.audit('remove', 'delete', key)
    return r.changes > 0
  }

  /** 按 id 删除（UI 管理用） */
  removeById(id: string): boolean {
    const r = this.db.prepare('DELETE FROM agent_memories WHERE id = ?').run(id)
    if (r.changes > 0) this.audit('remove', 'delete', `id:${id}`)
    return r.changes > 0
  }

  /** 列出全部（UI 管理页用，按类型+更新时间排序） */
  list(type?: MemoryType): AgentMemory[] {
    const rows = type
      ? this.db.prepare('SELECT * FROM agent_memories WHERE type = ? ORDER BY updatedAt DESC').all(type)
      : this.db.prepare('SELECT * FROM agent_memories ORDER BY type, updatedAt DESC').all()
    return (rows as MemoryRow[]).map(deserialize)
  }

  /**
   * 关键词检索（memory_recall 工具用）
   *
   * 中文友好：查询子串命中 text/why/key 即得分；命中后刷新 useCount/lastUsedAt。
   */
  search(query: string, limit = 5): AgentMemory[] {
    const tokens = (query || '')
      .toLowerCase()
      .split(/[\s,，、。;；]+/)
      .filter((t) => t.length >= 2)
    if (tokens.length === 0) return []

    const rows = this.db.prepare('SELECT * FROM agent_memories').all() as MemoryRow[]
    const scored: Array<{ m: AgentMemory; score: number }> = []
    for (const row of rows) {
      const m = deserialize(row)
      const haystack = `${m.text} ${m.why ?? ''} ${m.key}`.toLowerCase()
      let hit = 0
      for (const t of tokens) {
        if (haystack.includes(t)) hit++
      }
      if (hit > 0) scored.push({ m, score: hit / tokens.length + (m.type === 'correction' ? 0.2 : 0) })
    }
    scored.sort((a, b) => b.score - a.score)
    const out = scored.slice(0, limit).map((s) => s.m)
    // 命中即刷新使用统计（LRU 依据）
    const now = Date.now()
    const touch = this.db.prepare('UPDATE agent_memories SET useCount = useCount + 1, lastUsedAt = ? WHERE id = ?')
    for (const m of out) touch.run(now, m.id)
    return out
  }

  /**
   * 向量语义检索（v2.9）：用 sqlite-vec vec_distance_cosine 直查主表 KNN
   *
   * 与 knowledge-repo.searchByVector 同模式：向量扩展不可用时返回空数组（调用方
   * 降级到关键词 search）。命中同样刷新 useCount/lastUsedAt（LRU 依据）。
   *
   * @param queryEmbedding 查询向量（512 维，已加 BGE 查询前缀后生成）
   * @param limit 返回数量上限
   */
  searchByVector(queryEmbedding: number[], limit = 5): AgentMemory[] {
    if (!this.db.isVectorEnabled() || !Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
      return []
    }
    try {
      const queryVec = JSON.stringify(queryEmbedding)
      const rows = this.db
        .prepare(
          `SELECT * FROM agent_memories
           WHERE embedding IS NOT NULL
           ORDER BY vec_distance_cosine(embedding, ?) ASC
           LIMIT ?`,
        )
        .all(queryVec, limit) as MemoryRow[]
      const out = rows.map(deserialize)
      const now = Date.now()
      const touch = this.db.prepare('UPDATE agent_memories SET useCount = useCount + 1, lastUsedAt = ? WHERE id = ?')
      for (const m of out) touch.run(now, m.id)
      return out
    } catch {
      // 向量查询失败 → 降级返回空数组（调用方改用关键词）
      return []
    }
  }

  /**
   * 回填某条记忆的 embedding（v2.9）
   *
   * 由 memory-extractor 写入记忆后 fire-and-forget 调用（embedding 生成是异步重操作，
   * 不阻塞 upsert）。embedding 以 JSON 数组存 TEXT 列，与知识库格式一致。
   *
   * @returns 是否写入成功
   */
  setEmbedding(key: string, embedding: number[]): boolean {
    if (!Array.isArray(embedding) || embedding.length === 0) return false
    try {
      const r = this.db
        .prepare('UPDATE agent_memories SET embedding = ? WHERE key = ?')
        .run(JSON.stringify(embedding), key.trim().toLowerCase())
      return r.changes > 0
    } catch {
      return false
    }
  }

  /** 列出 embedding 缺失的记忆（供后台回填用） */
  listMissingEmbedding(limit = 50): Array<{ key: string; text: string; why: string | null }> {
    return this.db
      .prepare('SELECT key, text, why FROM agent_memories WHERE embedding IS NULL ORDER BY updatedAt DESC LIMIT ?')
      .all(limit) as Array<{ key: string; text: string; why: string | null }>
  }

  /**
   * 构建被动注入块（system prompt 用，硬预算 INJECT_BUDGET 字节）
   *
   * 优先级：correction 全量 > user_profile/preference > environment > fact；
   * 超预算时低优先级先被截断。附 kilo authority rule 提示。
   */
  buildInjectionBlock(): string {
    const all = this.list()
    if (all.length === 0) return ''
    const order: MemoryType[] = ['correction', 'user_profile', 'preference', 'environment', 'fact']
    const lines: string[] = ['\n\n[长期记忆（历史会话自动沉淀；记忆仅作参考上下文，当前用户指令与真实机器状态永远优先）]']
    let budget = INJECT_BUDGET
    for (const t of order) {
      const group = all.filter((m) => m.type === t)
      if (group.length === 0) continue
      const header = `《${MEMORY_TYPE_LABELS[t]}》`
      if (budget < header.length + 20) break
      lines.push(header)
      budget -= header.length
      for (const m of group) {
        const line = `- ${m.text}${m.why ? `（原因：${m.why}）` : ''}`
        if (budget < line.length) break
        lines.push(line)
        budget -= line.length
      }
    }
    return lines.length > 1 ? lines.join('\n') : ''
  }

  /** 全部条目数（提取节流判断/统计用） */
  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM agent_memories').get() as { c: number } | undefined
    return row?.c ?? 0
  }

  /** 审计日志（最近 N 条，UI 展示用） */
  auditLog(limit = 50): Array<{ ts: number; trigger: string; op: string; detail: string | null }> {
    return this.db
      .prepare('SELECT ts, trigger, op, detail FROM memory_audit ORDER BY ts DESC LIMIT ?')
      .all(limit) as Array<{ ts: number; trigger: string; op: string; detail: string | null }>
  }

  /** 记一条审计（失败静默，不阻塞主流程） */
  private audit(trigger: string, op: string, detail: string): void {
    try {
      this.db
        .prepare('INSERT INTO memory_audit (ts, trigger, op, detail) VALUES (?,?,?,?)')
        .run(Date.now(), trigger, op, detail.slice(0, 400))
    } catch {
      // 审计失败不阻塞
    }
  }

  /** 每类超上限时 LRU 淘汰（correction 与 pinned 豁免） */
  private evictIfNeeded(type: MemoryType): void {
    if (type === 'correction') return
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM agent_memories WHERE type = ?')
      .get(type) as { c: number } | undefined
    const count = row?.c ?? 0
    if (count <= MAX_PER_TYPE) return
    const victims = this.db
      .prepare(
        'SELECT id, key FROM agent_memories WHERE type = ? AND pinned = 0 ORDER BY COALESCE(lastUsedAt, createdAt) ASC LIMIT ?',
      )
      .all(type, count - MAX_PER_TYPE) as Array<{ id: string; key: string }>
    const del = this.db.prepare('DELETE FROM agent_memories WHERE id = ?')
    for (const v of victims) {
      del.run(v.id)
      this.audit('evict', 'delete', `${type}/${v.key} (LRU)`)
    }
  }
}

/** 行反序列化 */
function deserialize(row: MemoryRow): AgentMemory {
  return {
    id: row.id,
    type: row.type as MemoryType,
    key: row.key,
    text: row.text,
    why: row.why,
    sourceSession: row.sourceSession,
    useCount: row.useCount,
    lastUsedAt: row.lastUsedAt,
    pinned: row.pinned === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
