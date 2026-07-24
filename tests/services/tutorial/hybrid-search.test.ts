/**
 * hybrid-search 单元测试（v2.5 Phase D1）
 *
 * 来源：src/main/services/tutorial/hybrid-search.ts 609-660 行注释中的教学测试用例
 * 迁移目的：将注释形式的测试逻辑转为可执行的 vitest 用例，保证 CI 覆盖
 *
 * 覆盖：
 *   - reciprocalRankFusion：RRF 融合算法（纯函数，6 用例）
 *   - escapeFtsQuery：FTS5 查询转义（纯函数，7 用例）
 *   - hybridSearch：混合检索主函数（mock DB，3 核心场景 + 边界）
 *
 * 教学要点（对应原注释）：
 *   - 测试 1：纯 FTS 检索（无向量）→ source='fts', vecDistance=-1
 *   - 测试 2：纯向量检索（无 FTS）→ source='vec', ftsScore=0
 *   - 测试 3：混合检索（FTS + 向量）→ 存在 source='both'，rrfScore 双路加分
 */

import { describe, it, expect } from 'vitest'
import {
  reciprocalRankFusion,
  escapeFtsQuery,
  hybridSearch,
} from '@main/services/tutorial/hybrid-search'
import type { DatabaseManager } from '@main/services/db/database'

// ============================================================================
// Mock DatabaseManager 工厂
// ============================================================================

/**
 * 创建 mock DatabaseManager
 *
 * 根据 SQL 内容匹配不同的查询路径：
 *   - MATCH ... knowledge_fts → FTS5 检索结果
 *   - vec_distance_cosine → 向量检索结果
 *   - SELECT id, type, title, problem, tags ... WHERE id IN → 回填查询
 *   - LIKE → FTS 降级路径（关键词匹配）
 */
function createMockDb(options: {
  ftsRows?: Array<{ id: string; score: number; title: string; problem: string; tags: string | null }>
  vecRows?: Array<{ id: string; distance: number }>
  backfillRows?: Array<{ id: string; type: string; title: string; problem: string; tags: string | null }>
  vectorEnabled?: boolean
}): DatabaseManager {
  const { ftsRows = [], vecRows = [], backfillRows = [], vectorEnabled = false } = options

  const mockStatement = {
    get: vi.fn(() => ({ c: 0 })),
    all: vi.fn((..._params: unknown[]) => {
      // 根据调用顺序返回不同结果（hybridSearch 内部按序调用 FTS → vec → 回填）
      // 但更可靠的方式是根据 SQL 内容匹配
      return []
    }),
    run: vi.fn(() => ({ changes: 1, lastInsertRowid: 0n })),
    bind: vi.fn().mockReturnThis(),
    finalize: vi.fn(),
  }

  // 用一个计数器跟踪 all() 的调用次数，模拟分阶段查询
  let allCallIndex = 0
  const allResults: unknown[][] = []

  // 预先准备好 FTS、vec、回填三路的结果
  // 注意：hybridSearch 内部调用顺序是 FTS → vec → 回填（如果两路都有结果）
  // 但如果某路跳过，则只有回填或只有一路 + 回填

  // 为了更精确，我们用 SQL 匹配而非调用顺序
  const prepareMock = vi.fn((sql: string) => {
    const sqlLower = sql.toLowerCase()

    if (sqlLower.includes('match') && sqlLower.includes('knowledge_fts')) {
      // FTS5 检索
      return {
        ...mockStatement,
        all: vi.fn(() => ftsRows.map((r) => ({ id: r.id, score: r.score }))),
      }
    }

    if (sqlLower.includes('vec_distance_cosine')) {
      // 向量检索
      return {
        ...mockStatement,
        all: vi.fn(() => vecRows.map((r) => ({ id: r.id, distance: r.distance }))),
      }
    }

    if (sqlLower.includes('like')) {
      // FTS 降级路径（LIKE 关键词匹配）
      return {
        ...mockStatement,
        all: vi.fn(() => ftsRows.map((r) => ({ id: r.id, score: r.score }))),
      }
    }

    if (sqlLower.includes('where id in')) {
      // 回填查询
      return {
        ...mockStatement,
        all: vi.fn(() => backfillRows),
      }
    }

    // 默认返回空
    return mockStatement
  })

  // 忽略 allCallIndex 和 allResults，保留以备未来扩展
  void allCallIndex
  void allResults

  return {
    isAvailable: vi.fn(() => true),
    isVectorEnabled: vi.fn(() => vectorEnabled),
    prepare: prepareMock,
    exec: vi.fn(),
    close: vi.fn(),
    getRawConnection: vi.fn(() => null),
  } as unknown as DatabaseManager
}

// ============================================================================
// 1. reciprocalRankFusion 测试（纯算法）
// ============================================================================

describe('reciprocalRankFusion — RRF 倒数排名融合', () => {
  it('空输入应返回空 Map', () => {
    const result = reciprocalRankFusion([], [])
    expect(result.size).toBe(0)
  })

  it('纯 FTS 结果：所有条目 source 应为 fts', () => {
    const ftsResults = [
      { id: 'a', score: -1.5 },
      { id: 'b', score: -2.0 },
    ]
    const result = reciprocalRankFusion(ftsResults, [])
    expect(result.size).toBe(2)
    expect(result.get('a')?.source).toBe('fts')
    expect(result.get('b')?.source).toBe('fts')
    expect(result.get('a')?.ftsRank).toBe(1)
    expect(result.get('b')?.ftsRank).toBe(2)
    expect(result.get('a')?.vecRank).toBeUndefined()
  })

  it('纯 vec 结果：所有条目 source 应为 vec', () => {
    const vecResults = [
      { id: 'x', distance: 0.1 },
      { id: 'y', distance: 0.3 },
    ]
    const result = reciprocalRankFusion([], vecResults)
    expect(result.size).toBe(2)
    expect(result.get('x')?.source).toBe('vec')
    expect(result.get('y')?.source).toBe('vec')
    expect(result.get('x')?.vecRank).toBe(1)
    expect(result.get('y')?.vecRank).toBe(2)
    expect(result.get('x')?.ftsRank).toBeUndefined()
  })

  it('双路同时命中：source 应为 both，rrfScore 应为两路之和', () => {
    const ftsResults = [{ id: 'shared', score: -1.0 }]
    const vecResults = [{ id: 'shared', distance: 0.2 }]
    const result = reciprocalRankFusion(ftsResults, vecResults, 60, 1.0, 1.0)

    const entry = result.get('shared')
    expect(entry?.source).toBe('both')
    expect(entry?.ftsRank).toBe(1)
    expect(entry?.vecRank).toBe(1)
    // rank=1 时贡献 = 1/(60+1) = 1/61，两路合计 = 2/61
    expect(entry?.rrfScore).toBeCloseTo(2 / 61, 10)
  })

  it('rank=1 的贡献应大于 rank=2（排名越靠前贡献越大）', () => {
    const ftsResults = [
      { id: 'first', score: -1.0 },
      { id: 'second', score: -2.0 },
    ]
    const result = reciprocalRankFusion(ftsResults, [])
    const firstScore = result.get('first')?.rrfScore ?? 0
    const secondScore = result.get('second')?.rrfScore ?? 0
    expect(firstScore).toBeGreaterThan(secondScore)
  })

  it('权重调整：ftsWeight=2 时 FTS 路径贡献翻倍', () => {
    const ftsResults = [{ id: 'a', score: -1.0 }]
    const resultDefault = reciprocalRankFusion(ftsResults, [], 60, 1.0, 1.0)
    const resultWeighted = reciprocalRankFusion(ftsResults, [], 60, 2.0, 1.0)

    const defaultScore = resultDefault.get('a')?.rrfScore ?? 0
    const weightedScore = resultWeighted.get('a')?.rrfScore ?? 0
    expect(weightedScore).toBeCloseTo(defaultScore * 2, 10)
  })
})

// ============================================================================
// 2. escapeFtsQuery 测试（纯字符串处理）
// ============================================================================

describe('escapeFtsQuery — FTS5 查询转义', () => {
  it('空字符串应返回空', () => {
    expect(escapeFtsQuery('')).toBe('')
  })

  it('null/undefined 应返回空', () => {
    expect(escapeFtsQuery(null as unknown as string)).toBe('')
    expect(escapeFtsQuery(undefined as unknown as string)).toBe('')
  })

  it('单词查询应用双引号包裹', () => {
    expect(escapeFtsQuery('ssh')).toBe('"ssh"')
  })

  it('多词查询应用空格连接（AND 语义）', () => {
    expect(escapeFtsQuery('ssh 配置')).toBe('"ssh" "配置"')
  })

  it('含双引号的词应转义为两个连续双引号', () => {
    // 输入 ssh"config → 内部转义为 ssh""config → 包裹为 "ssh""config"
    expect(escapeFtsQuery('ssh"config')).toBe('"ssh""config"')
  })

  it('纯标点符号应被过滤，返回空字符串', () => {
    expect(escapeFtsQuery('，。！？')).toBe('')
    expect(escapeFtsQuery('   ，   ')).toBe('')
  })

  it('FTS5 语法关键字（OR/AND/NOT）应被双引号包裹后失效', () => {
    // OR 被双引号包裹后变为短语 "OR"，不再解释为语法关键字
    expect(escapeFtsQuery('ssh OR x')).toBe('"ssh" "OR" "x"')
  })
})

// ============================================================================
// 3. hybridSearch 测试（mock DB）— 对应原注释中的 3 个教学场景
// ============================================================================

describe('hybridSearch — 混合检索主函数', () => {
  // ─── 测试 1：纯 FTS 检索（无向量）──────────────────────────────
  // 场景：用户输入关键词，但未提供 queryEmbedding
  // 期望：返回包含关键词的教程，source 全部为 'fts'，vecDistance 全部为 -1
  it('测试 1：纯 FTS 检索（无 queryEmbedding）→ source=fts, vecDistance=-1', () => {
    const db = createMockDb({
      ftsRows: [
        { id: 't1', score: -1.2, title: 'SSH 免密配置', problem: '配置 ssh key', tags: '["Linux 基础"]' },
        { id: 't2', score: -2.5, title: 'SSH 端口转发', problem: 'ssh -L 端口映射', tags: '["网络"]' },
      ],
      backfillRows: [
        { id: 't1', type: 'tutorial', title: 'SSH 免密配置', problem: '配置 ssh key', tags: '["Linux 基础"]' },
        { id: 't2', type: 'tutorial', title: 'SSH 端口转发', problem: 'ssh -L 端口映射', tags: '["网络"]' },
      ],
      vectorEnabled: false,
    })

    const results = hybridSearch(db, { query: 'ssh 配置', limit: 5 })

    expect(results.length).toBe(2)
    // 所有 source 应为 'fts'（未提供 queryEmbedding，向量路径跳过）
    expect(results.every((r) => r.source === 'fts')).toBe(true)
    // 所有 vecDistance 应为 -1（未参与向量检索）
    expect(results.every((r) => r.vecDistance === -1)).toBe(true)
    // 按 rrfScore 降序排列（rank=1 的 t1 分数更高）
    expect(results[0].id).toBe('t1')
    expect(results[0].rrfScore).toBeGreaterThan(results[1].rrfScore)
  })

  // ─── 测试 2：纯向量检索（无 FTS）──────────────────────────────
  // 场景：用户输入空 query，但提供了 queryEmbedding
  // 期望：返回最近邻的条目，source 全部为 'vec'，ftsScore 全部为 0
  it('测试 2：纯向量检索（空 query + queryEmbedding）→ source=vec, ftsScore=0', () => {
    const fakeVec = new Float32Array(384) // 模拟 embedding 模型输出 384 维
    const db = createMockDb({
      vecRows: [
        { id: 't3', distance: 0.15 },
        { id: 't4', distance: 0.35 },
      ],
      backfillRows: [
        { id: 't3', type: 'tutorial', title: 'Nginx 502 排查', problem: '502 Bad Gateway', tags: '["运维"]' },
        { id: 't4', type: 'tutorial', title: 'Nginx 负载均衡', problem: 'upstream 配置', tags: '["运维"]' },
      ],
      vectorEnabled: true,
    })

    const results = hybridSearch(db, { query: '', queryEmbedding: fakeVec, limit: 5 })

    expect(results.length).toBe(2)
    // 所有 source 应为 'vec'（query 为空，FTS 路径跳过）
    expect(results.every((r) => r.source === 'vec')).toBe(true)
    // 所有 ftsScore 应为 0（未参与 FTS 检索）
    expect(results.every((r) => r.ftsScore === 0)).toBe(true)
    // vecDistance 应为非负值（0-2 范围）
    expect(results.every((r) => r.vecDistance >= 0 && r.vecDistance <= 2)).toBe(true)
    // 按 vecDistance 升序（即 rrfScore 降序）
    expect(results[0].id).toBe('t3') // distance=0.15 < 0.35
  })

  // ─── 测试 3：混合检索（FTS + 向量）─────────────────────────────
  // 场景：用户同时提供 query 和 queryEmbedding，模拟真实生产用法
  // 期望：存在 source='both' 的条目（双路命中），rrfScore 较高
  it('测试 3：混合检索（query + queryEmbedding）→ 存在 source=both，双路加分', () => {
    const realVec = new Float32Array(384)
    const db = createMockDb({
      ftsRows: [
        { id: 't5', score: -1.0, title: 'Nginx 502 错误排查', problem: '502 Bad Gateway', tags: '["运维"]' },
        { id: 't6', score: -2.0, title: 'SSH 配置', problem: 'ssh key', tags: '["Linux 基础"]' },
      ],
      vecRows: [
        { id: 't5', distance: 0.12 }, // t5 同时被 FTS 和 vec 命中 → both
        { id: 't7', distance: 0.25 },
      ],
      backfillRows: [
        { id: 't5', type: 'tutorial', title: 'Nginx 502 错误排查', problem: '502 Bad Gateway', tags: '["运维"]' },
        { id: 't6', type: 'tutorial', title: 'SSH 配置', problem: 'ssh key', tags: '["Linux 基础"]' },
        { id: 't7', type: 'tutorial', title: '网关错误处理', problem: 'gateway error', tags: '["网络"]' },
      ],
      vectorEnabled: true,
    })

    const results = hybridSearch(db, {
      query: 'nginx 502',
      queryEmbedding: realVec,
      limit: 10,
    })

    expect(results.length).toBe(3)
    // 应存在 source='both' 的条目（t5 同时被 FTS 和 vec 命中）
    const bothEntries = results.filter((r) => r.source === 'both')
    expect(bothEntries.length).toBeGreaterThanOrEqual(1)
    expect(bothEntries[0].id).toBe('t5')

    // 'both' 条目的 rrfScore 应大于单路条目（双路加分）
    const ftsOnly = results.find((r) => r.source === 'fts')
    const vecOnly = results.find((r) => r.source === 'vec')
    if (ftsOnly && vecOnly) {
      expect(bothEntries[0].rrfScore).toBeGreaterThan(ftsOnly.rrfScore)
      expect(bothEntries[0].rrfScore).toBeGreaterThan(vecOnly.rrfScore)
    }

    // rrfScore 降序排列（both 应排第一）
    expect(results[0].source).toBe('both')
  })

  // ─── 边界场景：两路都为空 → 返回空数组 ──────────────────────────
  it('两路都跳过（空 query + 无 queryEmbedding）→ 返回空数组', () => {
    const db = createMockDb({ vectorEnabled: false })
    const results = hybridSearch(db, { query: '', limit: 5 })
    expect(results).toEqual([])
  })

  // ─── 边界场景：向量扩展未启用 → 降级为纯 FTS ────────────────────
  it('向量扩展未启用时降级为纯 FTS', () => {
    const db = createMockDb({
      ftsRows: [
        { id: 't8', score: -1.0, title: '测试', problem: '内容', tags: null },
      ],
      backfillRows: [
        { id: 't8', type: 'tutorial', title: '测试', problem: '内容', tags: null },
      ],
      vectorEnabled: false, // 向量扩展未启用
    })

    const fakeVec = new Float32Array(384)
    const results = hybridSearch(db, {
      query: '测试',
      queryEmbedding: fakeVec, // 即使传了向量，但因 vectorEnabled=false 会跳过
      limit: 5,
    })

    expect(results.length).toBe(1)
    expect(results[0].source).toBe('fts') // 降级为纯 FTS
    expect(results[0].vecDistance).toBe(-1) // 未参与向量检索
  })
})
