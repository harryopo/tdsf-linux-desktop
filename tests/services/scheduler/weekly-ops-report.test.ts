/**
 * 运维周报任务单元测试
 *
 * 覆盖：
 *   - getISOWeekNumber ISO 周数计算
 *   - getLastWeekRange 上周时间范围
 *   - generateImprovementSuggestions 改进建议规则
 *   - generateWeeklyReportMarkdown Markdown 格式
 *   - executeWeeklyOpsReport 成功生成周报
 *   - executeWeeklyOpsReport 查询失败隔离
 *   - executeWeeklyOpsReport 文件写入失败
 *
 * Mock 策略：
 *   - DecisionWeeklyRepository / KnowledgeWeeklyRepository 使用内存 mock
 *   - ReportFileSystem 使用内存 mock（捕获写入内容）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  DecisionWeeklyRepository,
  KnowledgeWeeklyRepository,
  ReportFileSystem,
} from '../../../src/main/services/scheduler/weekly-ops-report'
import {
  getISOWeekNumber,
  getLastWeekRange,
  generateImprovementSuggestions,
  generateWeeklyReportMarkdown,
  executeWeeklyOpsReport,
} from '../../../src/main/services/scheduler/weekly-ops-report'

// ────────── Mock Repository / FS 工厂 ──────────

function createMockDecisionRepo(stats?: ReturnType<typeof makeDecisionStats>): DecisionWeeklyRepository {
  return {
    getWeeklyStats: vi.fn(async () => stats ?? makeDecisionStats()),
  }
}

function createMockKnowledgeRepo(stats?: ReturnType<typeof makeKnowledgeStats>): KnowledgeWeeklyRepository {
  return {
    getWeeklyStats: vi.fn(async () => stats ?? makeKnowledgeStats()),
  }
}

function createMockFs(): ReportFileSystem & { files: Map<string, string> } {
  const files = new Map<string, string>()
  return {
    files,
    mkdirRecursive: vi.fn(async () => {}),
    writeFile: vi.fn(async (path, content) => {
      files.set(path, content)
    }),
  }
}

function makeDecisionStats(overrides = {}) {
  return {
    total: 10,
    successCount: 9,
    blockedCount: 1,
    avgResponseMs: 1200,
    dailyTrend: [
      { date: '2026-07-20', total: 2, successCount: 2, blockedCount: 0 },
      { date: '2026-07-21', total: 3, successCount: 2, blockedCount: 1 },
    ],
    ...overrides,
  }
}

function makeKnowledgeStats(overrides = {}) {
  return {
    newEntries: 5,
    aiContributionRate: 0.2,
    ...overrides,
  }
}

// ────────── 测试用例 ──────────

describe('getISOWeekNumber', () => {
  it('2026-01-05 是 ISO 2026-W02（周一）', () => {
    const { year, week } = getISOWeekNumber(new Date('2026-01-05T00:00:00Z'))
    expect(year).toBe(2026)
    expect(week).toBe(2)
  })

  it('2026-07-25 是 ISO 2026-W30', () => {
    const { year, week } = getISOWeekNumber(new Date('2026-07-25T00:00:00Z'))
    expect(year).toBe(2026)
    expect(week).toBe(30)
  })
})

describe('getLastWeekRange', () => {
  it('返回 7 天整的时间范围（北京时间 2026-07-25）', () => {
    const now = new Date('2026-07-25T10:30:00.000Z') // 周六
    const { start, end } = getLastWeekRange('Asia/Shanghai', now)

    const msPerDay = 24 * 60 * 60 * 1000
    expect(end.getTime() - start.getTime()).toBe(7 * msPerDay - 1)

    // start 应为上周一 00:00 CST（2026-07-13 00:00 CST = 2026-07-12 16:00 UTC）
    expect(start.toISOString()).toBe('2026-07-12T16:00:00.000Z')
  })
})

describe('generateImprovementSuggestions', () => {
  it('无数据时建议检查采集链路', () => {
    const suggestions = generateImprovementSuggestions(
      { total: 0, successCount: 0, blockedCount: 0, avgResponseMs: 0, dailyTrend: [] },
      { newEntries: 0, aiContributionRate: 0 }
    )
    expect(suggestions[0]).toContain('检查数据采集链路')
  })

  it('高危拦截率 >20% 时给出拦截建议', () => {
    const suggestions = generateImprovementSuggestions(
      { total: 10, successCount: 5, blockedCount: 3, avgResponseMs: 1000, dailyTrend: [] },
      { newEntries: 5, aiContributionRate: 0.2 }
    )
    expect(suggestions.some((s) => s.includes('高危拦截率'))).toBe(true)
  })

  it('成功率 <80% 时给出成功率建议', () => {
    const suggestions = generateImprovementSuggestions(
      { total: 10, successCount: 7, blockedCount: 0, avgResponseMs: 1000, dailyTrend: [] },
      { newEntries: 5, aiContributionRate: 0.2 }
    )
    expect(suggestions.some((s) => s.includes('成功率'))).toBe(true)
  })

  it('AI 贡献率 <10% 时给出自动归档建议', () => {
    const suggestions = generateImprovementSuggestions(
      { total: 10, successCount: 9, blockedCount: 0, avgResponseMs: 1000, dailyTrend: [] },
      { newEntries: 5, aiContributionRate: 0.05 }
    )
    expect(suggestions.some((s) => s.includes('AI 贡献率'))).toBe(true)
  })

  it('平均响应时间 >5000ms 时给出性能建议', () => {
    const suggestions = generateImprovementSuggestions(
      { total: 10, successCount: 10, blockedCount: 0, avgResponseMs: 6000, dailyTrend: [] },
      { newEntries: 5, aiContributionRate: 0.2 }
    )
    expect(suggestions.some((s) => s.includes('响应时间'))).toBe(true)
  })

  it('全部正常时给出正向保持建议', () => {
    const suggestions = generateImprovementSuggestions(
      { total: 10, successCount: 10, blockedCount: 0, avgResponseMs: 1000, dailyTrend: [] },
      { newEntries: 5, aiContributionRate: 0.2 }
    )
    expect(suggestions[0]).toContain('各项指标正常')
  })
})

describe('generateWeeklyReportMarkdown', () => {
  it('生成包含所有章节的 Markdown', () => {
    const markdown = generateWeeklyReportMarkdown({
      isoYear: 2026,
      isoWeek: 30,
      startDate: new Date('2026-07-20T00:00:00Z'),
      endDate: new Date('2026-07-26T23:59:59Z'),
      generatedAt: new Date('2026-07-27T09:00:00Z').toISOString(),
      decision: makeDecisionStats(),
      knowledge: makeKnowledgeStats(),
      suggestions: ['建议1', '建议2'],
    })

    expect(markdown).toContain('# TDSF Linux 运维周报 · 2026-W30')
    expect(markdown).toContain('## 1. 决策统计')
    expect(markdown).toContain('## 2. 趋势分析')
    expect(markdown).toContain('## 3. 知识沉淀')
    expect(markdown).toContain('## 4. 改进建议')
    expect(markdown).toContain('| 2026-07-20 | 2 | 2 | 0 |')
    expect(markdown).toContain('- 建议1')
    expect(markdown).toContain('- 建议2')
  })
})

describe('executeWeeklyOpsReport', () => {
  let decisionRepo: DecisionWeeklyRepository
  let knowledgeRepo: KnowledgeWeeklyRepository
  let fs: ReturnType<typeof createMockFs>
  const reportsDir = '/tmp/reports'
  const now = new Date('2026-07-27T09:00:00.000Z')

  beforeEach(() => {
    decisionRepo = createMockDecisionRepo()
    knowledgeRepo = createMockKnowledgeRepo()
    fs = createMockFs()
  })

  it('成功生成周报并写入文件', async () => {
    const result = await executeWeeklyOpsReport({
      decisionRepo,
      knowledgeRepo,
      fs,
      reportsDir,
      now,
    })

    expect(result.success).toBe(true)
    expect(result.summary).toContain('2026-W30')
    expect(result.details?.filePath).toContain('week-2026-W30.md')
    expect(fs.files.size).toBe(1)
    const content = Array.from(fs.files.values())[0]
    expect(content).toContain('# TDSF Linux 运维周报 · 2026-W30')
  })

  it('决策仓储查询失败时不中断周报生成', async () => {
    decisionRepo = {
      getWeeklyStats: vi.fn(async () => {
        throw new Error('决策表查询失败')
      }),
    }

    const result = await executeWeeklyOpsReport({
      decisionRepo,
      knowledgeRepo,
      fs,
      reportsDir,
      now,
    })

    expect(result.success).toBe(true)
    expect(result.details?.queryErrors).toHaveLength(1)
    expect(result.details?.queryErrors[0].repo).toBe('decision')
    expect(result.details?.decisionStats.total).toBe(0)
  })

  it('知识仓储查询失败时不中断周报生成', async () => {
    knowledgeRepo = {
      getWeeklyStats: vi.fn(async () => {
        throw new Error('知识表查询失败')
      }),
    }

    const result = await executeWeeklyOpsReport({
      decisionRepo,
      knowledgeRepo,
      fs,
      reportsDir,
      now,
    })

    expect(result.success).toBe(true)
    expect(result.details?.queryErrors).toHaveLength(1)
    expect(result.details?.queryErrors[0].repo).toBe('knowledge')
    expect(result.details?.knowledgeStats.newEntries).toBe(0)
  })

  it('文件写入失败返回 success=false', async () => {
    fs.writeFile = vi.fn(async () => {
      throw new Error('磁盘只读')
    })

    const result = await executeWeeklyOpsReport({
      decisionRepo,
      knowledgeRepo,
      fs,
      reportsDir,
      now,
    })

    expect(result.success).toBe(false)
    expect(result.summary).toContain('磁盘只读')
  })
})
