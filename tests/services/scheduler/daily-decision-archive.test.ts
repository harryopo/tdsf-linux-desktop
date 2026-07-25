/**
 * 每日决策归档任务单元测试
 *
 * 覆盖：
 *   - runDailyDecisionArchive 空决策场景
 *   - runDailyDecisionArchive 单条决策归档成功
 *   - runDailyDecisionArchive 幂等跳过已归档决策
 *   - runDailyDecisionArchive 异常转换为 TaskResult
 *   - decisionToKnowledge / buildKnowledgeContent 字段映射
 *   - getTodayRange 时区范围计算
 *
 * Mock 策略：
 *   - ArchiveDecisionRepository / ArchiveKnowledgeRepository 使用内存 mock
 *   - redactSensitiveInfo 直接透传（无需复杂脱敏）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  ArchiveDecisionRepository,
  ArchiveKnowledgeRepository,
  ArchivedDecision,
  ArchivedKnowledgeEntry,
} from '../../../src/main/services/scheduler/daily-decision-archive'
import {
  runDailyDecisionArchive,
  getTodayRange,
} from '../../../src/main/services/scheduler/daily-decision-archive'

// Mock 脱敏模块（避免引入真实 redact 实现）
vi.mock('../../../src/main/services/security/redact', () => ({
  redactSensitiveInfo: (msg: string) => msg,
}))

// ────────── Mock Repository 工厂 ──────────

function createMockDecisionRepo(
  decisions: ArchivedDecision[] = []
): ArchiveDecisionRepository {
  return {
    querySuccessfulDecisions: vi.fn(async () => [...decisions]),
    existsById: vi.fn(async (id) => decisions.some((d) => d.id === id)),
  }
}

function createMockKnowledgeRepo(): ArchiveKnowledgeRepository & {
  entries: ArchivedKnowledgeEntry[]
} {
  const entries: ArchivedKnowledgeEntry[] = []
  return {
    entries,
    findByRelatedDecisionId: vi.fn(async (id) =>
      entries.find((e) => e.relatedDecisionId === id) ?? null
    ),
    save: vi.fn(async (entry) => {
      entries.push(entry)
    }),
    count: vi.fn(async () => entries.length),
    countBySource: vi.fn(async (source) =>
      entries.filter((e) => e.source === source).length
    ),
    incrementAiContribution: vi.fn(async () => {}),
    runInTransaction: vi.fn(async (fn) => fn()),
  }
}

function makeDecision(overrides: Partial<ArchivedDecision> = {}): ArchivedDecision {
  return {
    id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: '测试决策',
    summary: '测试摘要',
    hypothesis: '根因假设',
    fixCommand: 'systemctl restart nginx',
    fixDescription: '重启 Nginx 服务',
    rollbackCommand: 'systemctl stop nginx',
    riskLevel: 'MEDIUM',
    status: 'verified',
    timestamp: Date.now(),
    verification: '已验证执行成功',
    ...overrides,
  }
}

// ────────── 测试用例 ──────────

describe('runDailyDecisionArchive', () => {
  let decisionRepo: ArchiveDecisionRepository
  let knowledgeRepo: ReturnType<typeof createMockKnowledgeRepo>
  const dateRange = { start: 0, end: Number.MAX_SAFE_INTEGER }

  beforeEach(() => {
    decisionRepo = createMockDecisionRepo()
    knowledgeRepo = createMockKnowledgeRepo()
  })

  it('无成功决策时返回 success 并提示无决策需要归档', async () => {
    const result = await runDailyDecisionArchive({
      decisionRepo,
      knowledgeRepo,
      dateRange,
    })

    expect(result.success).toBe(true)
    expect(result.summary).toBe('无决策需要归档')
    expect(result.details?.archivedCount).toBe(0)
    expect(result.details?.totalDecisions).toBe(0)
  })

  it('单条决策归档成功并更新统计', async () => {
    const decision = makeDecision({ id: 'dec-1', title: '归档测试' })
    decisionRepo = createMockDecisionRepo([decision])

    const result = await runDailyDecisionArchive({
      decisionRepo,
      knowledgeRepo,
      dateRange,
    })

    expect(result.success).toBe(true)
    expect(result.details?.archivedCount).toBe(1)
    expect(result.details?.skippedCount).toBe(0)
    expect(result.details?.totalKnowledge).toBe(1)
    expect(knowledgeRepo.entries.length).toBe(1)
    expect(knowledgeRepo.entries[0].relatedDecisionId).toBe('dec-1')
    expect(knowledgeRepo.entries[0].title).toContain('归档测试')
    expect(knowledgeRepo.entries[0].source).toBe('auto-archive')
  })

  it('已归档决策幂等跳过', async () => {
    const decision = makeDecision({ id: 'dec-2' })
    decisionRepo = createMockDecisionRepo([decision])
    // 预置一条已归档条目
    knowledgeRepo.entries.push({
      id: 'existing',
      title: '[自动归档] 已有',
      content: 'content',
      source: 'auto-archive',
      tags: ['auto-archived', 'decision', 'dec-2'],
      relatedDecisionId: 'dec-2',
      createdAt: Date.now(),
    })

    const result = await runDailyDecisionArchive({
      decisionRepo,
      knowledgeRepo,
      dateRange,
    })

    expect(result.success).toBe(true)
    expect(result.details?.archivedCount).toBe(0)
    expect(result.details?.skippedCount).toBe(1)
    expect(knowledgeRepo.entries.length).toBe(1)
  })

  it('querySuccessfulDecisions 异常时转换为失败 TaskResult', async () => {
    decisionRepo = {
      querySuccessfulDecisions: vi.fn(async () => {
        throw new Error('数据库连接失败')
      }),
      existsById: vi.fn(),
    }

    const result = await runDailyDecisionArchive({
      decisionRepo,
      knowledgeRepo,
      dateRange,
    })

    expect(result.success).toBe(false)
    expect(result.summary).toContain('数据库连接失败')
    expect(result.error).toContain('数据库连接失败')
  })

  it('生成知识条目内容包含决策关键信息', async () => {
    const decision = makeDecision({
      id: 'dec-3',
      title: 'Nginx 重启',
      summary: 'Nginx 无法访问',
      hypothesis: 'Nginx 进程异常',
      fixCommand: 'systemctl restart nginx',
      verification: '已验证执行成功',
    })
    decisionRepo = createMockDecisionRepo([decision])

    await runDailyDecisionArchive({
      decisionRepo,
      knowledgeRepo,
      dateRange,
    })

    const entry = knowledgeRepo.entries[0]
    expect(entry.content).toContain('Nginx 无法访问')
    expect(entry.content).toContain('Nginx 进程异常')
    expect(entry.content).toContain('systemctl restart nginx')
    expect(entry.content).toContain('已验证执行成功')
  })
})

describe('getTodayRange', () => {
  it('返回 start <= end 且 start 对应当天 00:00（北京时间）', () => {
    // 固定一个已知北京时间：2026-07-25 18:30:00 CST = 2026-07-25 10:30:00 UTC
    const now = new Date('2026-07-25T10:30:00.000Z')
    const { start, end } = getTodayRange(now, 'Asia/Shanghai')

    expect(end).toBe(now.getTime())
    expect(start).toBeLessThan(end)

    // start 应为当天 00:00 CST 对应的 UTC 时间戳
    const startDate = new Date(start)
    expect(startDate.toISOString()).toBe('2026-07-24T16:00:00.000Z')
  })
})
