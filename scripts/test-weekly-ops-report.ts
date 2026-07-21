/**
 * Weekly Ops Report 单元测试（Phase 6 Task 6.4）
 *
 * 测试目标（spec SubTask 6.4.3 ≥ 30 个用例，7 大场景）：
 *   1. 无数据场景（上周无决策 + 无知识沉淀）
 *   2. 有数据场景（多条决策 + 知识沉淀）
 *   3. 文件写入失败场景（mock fs.writeFile 抛错）
 *   4. 目录自动创建场景（mock fs.mkdir）
 *   5. 工厂函数场景（createWeeklyOpsReportTask 返回正确 SchedulerTask）
 *   6. ISO 周数计算场景（跨年边界 12 月末 → 1 月初）
 *   7. 改进建议生成场景（高危拦截率 > 20% 触发建议）
 *
 * 测试模式：mock DecisionWeeklyRepository / KnowledgeWeeklyRepository / ReportFileSystem。
 *
 * 运行方式（必须加 --tsconfig 才能解析 @shared/* 路径别名）：
 *   npx tsx --tsconfig tsconfig.node.json scripts/test-weekly-ops-report.ts
 *
 * 参考：
 *   - scripts/test-daily-decision-archive.ts（🚀 + section + ✅/❌ + 📊 输出格式）
 *   - src/main/services/scheduler/weekly-ops-report.ts（被测模块）
 */

import {
  executeWeeklyOpsReport,
  getISOWeekNumber,
  getLastWeekRange,
  generateImprovementSuggestions,
  generateWeeklyReportMarkdown,
  createWeeklyOpsReportTask,
  createWeeklyOpsReportTaskWithRepos,
  type DecisionWeeklyStats,
  type KnowledgeWeeklyStats,
  type DecisionWeeklyRepository,
  type KnowledgeWeeklyRepository,
  type ReportFileSystem,
  type WeeklyReportData,
} from '../src/main/services/scheduler/weekly-ops-report'
import type { SchedulerTask } from '@shared/scheduler-types'

// ============================================================
// 测试工具函数
// ============================================================

let passCount = 0
let failCount = 0

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`)
    passCount++
  } else {
    console.log(`  ❌ FAIL: ${message}`)
    failCount++
  }
}

function section(name: string): void {
  console.log('\n' + '='.repeat(60))
  console.log(`🔍 ${name}`)
  console.log('='.repeat(60))
}

// ============================================================
// Mock 实现
// ============================================================

/**
 * Mock 决策仓储
 *
 * 支持注入返回值 / 异常，记录调用次数与参数。
 */
class MockDecisionRepo implements DecisionWeeklyRepository {
  private stats: DecisionWeeklyStats | null = null
  private error: Error | null = null
  callCount = 0
  lastArgs: { start: Date; end: Date } | null = null

  setStats(stats: DecisionWeeklyStats | null): void {
    this.stats = stats
  }
  setError(err: Error | null): void {
    this.error = err
  }

  async getWeeklyStats(startDate: Date, endDate: Date): Promise<DecisionWeeklyStats> {
    this.callCount++
    this.lastArgs = { start: startDate, end: endDate }
    if (this.error) throw this.error
    return (
      this.stats ?? {
        total: 0,
        successCount: 0,
        blockedCount: 0,
        avgResponseMs: 0,
        dailyTrend: [],
      }
    )
  }
}

/** Mock 知识仓储 */
class MockKnowledgeRepo implements KnowledgeWeeklyRepository {
  private stats: KnowledgeWeeklyStats | null = null
  private error: Error | null = null
  callCount = 0

  setStats(stats: KnowledgeWeeklyStats | null): void {
    this.stats = stats
  }
  setError(err: Error | null): void {
    this.error = err
  }

  async getWeeklyStats(): Promise<KnowledgeWeeklyStats> {
    this.callCount++
    if (this.error) throw this.error
    return this.stats ?? { newEntries: 0, aiContributionRate: 0 }
  }
}

/**
 * Mock 文件系统
 *
 * 记录 mkdir / writeFile 调用，支持注入异常。
 * 不真实写入磁盘，避免污染测试环境。
 */
class MockFileSystem implements ReportFileSystem {
  mkdirCallCount = 0
  writeFileCallCount = 0
  lastMkdirPath: string | null = null
  lastWritePath: string | null = null
  lastWriteContent: string | null = null
  private mkdirError: Error | null = null
  private writeError: Error | null = null

  setMkdirError(err: Error | null): void {
    this.mkdirError = err
  }
  setWriteError(err: Error | null): void {
    this.writeError = err
  }

  async mkdirRecursive(path: string): Promise<void> {
    this.mkdirCallCount++
    this.lastMkdirPath = path
    if (this.mkdirError) throw this.mkdirError
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.writeFileCallCount++
    this.lastWritePath = path
    this.lastWriteContent = content
    if (this.writeError) throw this.writeError
  }
}

/** 构建测试参数 */
function buildParams(
  decisionRepo: MockDecisionRepo,
  knowledgeRepo: MockKnowledgeRepo,
  fs: MockFileSystem,
  overrides: { reportsDir?: string; timezone?: string; now?: Date } = {}
): Parameters<typeof executeWeeklyOpsReport>[0] {
  return {
    decisionRepo,
    knowledgeRepo,
    fs,
    reportsDir: overrides.reportsDir ?? '/tmp/test-reports',
    timezone: overrides.timezone ?? 'Asia/Shanghai',
    now: overrides.now ?? new Date('2026-07-20T10:00:00+08:00'), // 周一 10:00 北京时间
  }
}

/** 构建决策统计测试数据 */
function makeDecisionStats(overrides: Partial<DecisionWeeklyStats> = {}): DecisionWeeklyStats {
  return {
    total: overrides.total ?? 0,
    successCount: overrides.successCount ?? 0,
    blockedCount: overrides.blockedCount ?? 0,
    avgResponseMs: overrides.avgResponseMs ?? 0,
    dailyTrend: overrides.dailyTrend ?? [],
  }
}

/** 构建知识统计测试数据 */
function makeKnowledgeStats(overrides: Partial<KnowledgeWeeklyStats> = {}): KnowledgeWeeklyStats {
  return {
    newEntries: overrides.newEntries ?? 0,
    aiContributionRate: overrides.aiContributionRate ?? 0,
  }
}

// ============================================================
// 主测试函数
// ============================================================

async function main(): Promise<void> {
  console.log('🚀 Phase 6 Task 6.4 Weekly Ops Report 单元测试')
  console.log('   测试场景：无数据 / 有数据 / 文件写入失败 / 目录创建 / 工厂 / ISO 周数 / 改进建议')

  // ────────── 场景 1：无数据场景 ──────────

  section('场景 1：无数据场景（上周无决策 + 无知识沉淀）')

  {
    const decisionRepo = new MockDecisionRepo()
    const knowledgeRepo = new MockKnowledgeRepo()
    const fs = new MockFileSystem()
    decisionRepo.setStats(makeDecisionStats())
    knowledgeRepo.setStats(makeKnowledgeStats())

    const result = await executeWeeklyOpsReport(buildParams(decisionRepo, knowledgeRepo, fs))

    // 1. 应返回 success: true
    assert(result.success === true, '无数据时应返回 success=true')
    // 2. summary 应包含"0 决策/0 知识"
    assert(
      result.summary.includes('0 决策/0 知识'),
      `summary 应包含 "0 决策/0 知识"，实际 "${result.summary}"`
    )
    // 3. queryErrors 应为空数组
    assert(
      Array.isArray(result.details?.queryErrors) &&
        (result.details?.queryErrors as unknown[]).length === 0,
      'queryErrors 应为空数组'
    )
    // 4. 文件应被写入（即使无数据也生成周报）
    assert(fs.writeFileCallCount === 1, '无数据时也应写入周报文件')
    // 5. 改进建议应包含"无数据"提示
    const suggestions = result.details?.suggestions as string[]
    assert(
      suggestions.length === 1 && suggestions[0].includes('无决策与知识沉淀数据'),
      `改进建议应提示"无数据"，实际 ${JSON.stringify(suggestions)}`
    )
  }

  // ────────── 场景 2：有数据场景 ──────────

  section('场景 2：有数据场景（多条决策 + 知识沉淀）')

  {
    const decisionRepo = new MockDecisionRepo()
    const knowledgeRepo = new MockKnowledgeRepo()
    const fs = new MockFileSystem()
    decisionRepo.setStats(
      makeDecisionStats({
        total: 20,
        successCount: 18,
        blockedCount: 2,
        avgResponseMs: 1500,
        dailyTrend: [
          { date: '2026-07-13', total: 3, successCount: 3, blockedCount: 0 },
          { date: '2026-07-14', total: 4, successCount: 4, blockedCount: 0 },
          { date: '2026-07-15', total: 3, successCount: 2, blockedCount: 1 },
          { date: '2026-07-16', total: 3, successCount: 3, blockedCount: 0 },
          { date: '2026-07-17', total: 3, successCount: 3, blockedCount: 0 },
          { date: '2026-07-18', total: 2, successCount: 2, blockedCount: 1 },
          { date: '2026-07-19', total: 2, successCount: 1, blockedCount: 0 },
        ],
      })
    )
    knowledgeRepo.setStats(makeKnowledgeStats({ newEntries: 8, aiContributionRate: 0.625 }))

    const result = await executeWeeklyOpsReport(buildParams(decisionRepo, knowledgeRepo, fs))

    // 6. 应返回 success: true
    assert(result.success === true, '有数据时应返回 success=true')
    // 7. summary 应包含"20 决策/8 知识"
    assert(
      result.summary.includes('20 决策/8 知识'),
      `summary 应包含 "20 决策/8 知识"，实际 "${result.summary}"`
    )
    // 8. weekLabel 应为 "2026-W29"（2026-07-13 至 2026-07-19 是 ISO W29）
    assert(
      (result.details?.weekLabel as string) === '2026-W29',
      `weekLabel 应为 "2026-W29"，实际 "${result.details?.weekLabel}"`
    )
    // 9. filePath 应包含 "week-2026-W29.md"
    assert(
      (result.details?.filePath as string).includes('week-2026-W29.md'),
      `filePath 应包含 "week-2026-W29.md"，实际 "${result.details?.filePath}"`
    )
    // 10. 写入的 Markdown 应包含趋势表格 7 行
    const content = fs.lastWriteContent ?? ''
    const trendRows = content
      .split('\n')
      .filter((l) => l.startsWith('| 2026-07-')).length
    assert(trendRows === 7, `趋势表应有 7 行数据，实际 ${trendRows} 行`)
    // 11. 写入的 Markdown 应包含 "AI 贡献率：62.5%"
    assert(
      content.includes('AI 贡献率：62.5%'),
      `Markdown 应包含 "AI 贡献率：62.5%"`
    )
  }

  // ────────── 场景 3：文件写入失败 ──────────

  section('场景 3：文件写入失败场景（mock fs.writeFile 抛错）')

  {
    const decisionRepo = new MockDecisionRepo()
    const knowledgeRepo = new MockKnowledgeRepo()
    const fs = new MockFileSystem()
    decisionRepo.setStats(makeDecisionStats({ total: 5, successCount: 5 }))
    fs.setWriteError(new Error('磁盘空间不足'))

    const result = await executeWeeklyOpsReport(buildParams(decisionRepo, knowledgeRepo, fs))

    // 12. 应返回 success: false
    assert(result.success === false, 'writeFile 抛错时应返回 success=false')
    // 13. error 应包含"磁盘空间不足"
    assert(
      result.error?.includes('磁盘空间不足') === true,
      `error 应包含 "磁盘空间不足"，实际 "${result.error}"`
    )
    // 14. summary 应包含"周报文件写入失败"
    assert(
      result.summary.includes('周报文件写入失败'),
      `summary 应包含 "周报文件写入失败"，实际 "${result.summary}"`
    )
  }

  // ────────── 场景 3.1：mkdir 失败 ──────────

  {
    const decisionRepo = new MockDecisionRepo()
    const knowledgeRepo = new MockKnowledgeRepo()
    const fs = new MockFileSystem()
    fs.setMkdirError(new Error('权限不足'))

    const result = await executeWeeklyOpsReport(buildParams(decisionRepo, knowledgeRepo, fs))

    // 15. mkdir 抛错也应返回 success: false
    assert(result.success === false, 'mkdir 抛错时应返回 success=false')
    // 16. writeFile 不应被调用（mkdir 已失败）
    assert(fs.writeFileCallCount === 0, 'mkdir 失败时不应调用 writeFile')
  }

  // ────────── 场景 4：目录自动创建 ──────────

  section('场景 4：目录自动创建场景（mock fs.mkdir）')

  {
    const decisionRepo = new MockDecisionRepo()
    const knowledgeRepo = new MockKnowledgeRepo()
    const fs = new MockFileSystem()
    const params = buildParams(decisionRepo, knowledgeRepo, fs, {
      reportsDir: '/custom/path/reports',
    })

    await executeWeeklyOpsReport(params)

    // 17. mkdirRecursive 应被调用 1 次
    assert(fs.mkdirCallCount === 1, 'mkdirRecursive 应被调用 1 次')
    // 18. mkdirRecursive 收到的路径应为 '/custom/path/reports'
    assert(
      fs.lastMkdirPath === '/custom/path/reports',
      `mkdir 路径应为 "/custom/path/reports"，实际 "${fs.lastMkdirPath}"`
    )
    // 19. writeFile 应被调用 1 次（mkdir 成功后）
    assert(fs.writeFileCallCount === 1, 'mkdir 成功后 writeFile 应被调用 1 次')
  }

  // ────────── 场景 5：工厂函数 ──────────

  section('场景 5：工厂函数 createWeeklyOpsReportTask')

  {
    // 20. 占位工厂返回正确元数据
    const task: SchedulerTask = createWeeklyOpsReportTask()
    assert(task.id === 'weekly-ops-report', 'id 应为 weekly-ops-report')
    assert(task.cron === '0 9 * * 1', `cron 应为 "0 9 * * 1"，实际 "${task.cron}"`)
    assert(task.timezone === 'Asia/Shanghai', 'timezone 应为 Asia/Shanghai')
    assert(task.enabled === true, 'enabled 应为 true')
    assert(task.name === '运维周报', 'name 应为 "运维周报"')
  }

  // 21. 占位 handler 应能正常执行（不抛错，使用占位仓储 + 降级到 os.tmpdir）
  {
    const task = createWeeklyOpsReportTask()
    const result = await task.handler()
    assert(result.success === true, '占位 handler 应返回 success=true（用占位仓储）')
    assert(
      result.summary.includes('0 决策/0 知识'),
      `占位 handler summary 应包含 "0 决策/0 知识"，实际 "${result.summary}"`
    )
  }

  // 22. 带注入工厂：handler 可正常执行
  {
    const decisionRepo = new MockDecisionRepo()
    const knowledgeRepo = new MockKnowledgeRepo()
    const fs = new MockFileSystem()
    decisionRepo.setStats(makeDecisionStats({ total: 10, successCount: 9, blockedCount: 1 }))

    const taskWithRepos = createWeeklyOpsReportTaskWithRepos(
      decisionRepo,
      knowledgeRepo,
      fs,
      '/test/injected/reports'
    )
    assert(taskWithRepos.id === 'weekly-ops-report', '带注入工厂 id 正确')

    const result = await taskWithRepos.handler()
    assert(result.success === true, '带注入工厂 handler 应返回 success=true')
    assert(
      (result.details?.filePath as string).startsWith('/test/injected/reports/week-'),
      `filePath 应以 "/test/injected/reports/week-" 开头，实际 "${result.details?.filePath}"`
    )
    assert(
      result.summary.includes('10 决策'),
      `summary 应包含 "10 决策"，实际 "${result.summary}"`
    )
  }

  // ────────── 场景 6：ISO 周数计算（跨年边界）──────────

  section('场景 6：ISO 周数计算（跨年边界 12 月末 → 1 月初）')

  {
    // 23. 2026-01-01（周四）→ ISO 2026-W01
    const r1 = getISOWeekNumber(new Date(Date.UTC(2026, 0, 1)))
    assert(
      r1.year === 2026 && r1.week === 1,
      `2026-01-01 应为 2026-W01，实际 ${r1.year}-W${r1.week}`
    )

    // 24. 2025-12-31（周三）→ ISO 2025-W01（因为该周属于 2026 年第一周，但 ISO 周年看周四）
    //     2025-12-31 的本周四是 2026-01-01，所以 ISO 周年为 2026
    const r2 = getISOWeekNumber(new Date(Date.UTC(2025, 11, 31)))
    assert(
      r2.year === 2026 && r2.week === 1,
      `2025-12-31 应为 2026-W01（跨年），实际 ${r2.year}-W${r2.week}`
    )

    // 25. 2027-01-01（周五）→ ISO 2026-W53（因为本周四是 2026-12-31，2026 年有 53 周）
    const r3 = getISOWeekNumber(new Date(Date.UTC(2027, 0, 1)))
    assert(
      r3.year === 2026 && r3.week === 53,
      `2027-01-01 应为 2026-W53（跨年，2026 有 53 周），实际 ${r3.year}-W${r3.week}`
    )

    // 26. 2026-07-15（周三）→ ISO 2026-W29
    const r4 = getISOWeekNumber(new Date(Date.UTC(2026, 6, 15)))
    assert(
      r4.year === 2026 && r4.week === 29,
      `2026-07-15 应为 2026-W29，实际 ${r4.year}-W${r4.week}`
    )

    // 27. 2026-12-31（周四）→ ISO 2026-W53（2026 年有 53 周）
    const r5 = getISOWeekNumber(new Date(Date.UTC(2026, 11, 31)))
    assert(
      r5.year === 2026 && r5.week === 53,
      `2026-12-31 应为 2026-W53（2026 有 53 周），实际 ${r5.year}-W${r5.week}`
    )

    // 28. 2024-12-30（周一）→ ISO 2025-W01
    const r6 = getISOWeekNumber(new Date(Date.UTC(2024, 11, 30)))
    assert(
      r6.year === 2025 && r6.week === 1,
      `2024-12-30 应为 2025-W01（跨年），实际 ${r6.year}-W${r6.week}`
    )
  }

  // ────────── 场景 6.1：getLastWeekRange 时区正确性 ──────────

  section('场景 6.1：getLastWeekRange 时区正确性')

  {
    // 周一 10:00 北京时间 → 上周一应为 2026-07-13 00:00 北京时间
    const now = new Date('2026-07-20T10:00:00+08:00')
    const range = getLastWeekRange('Asia/Shanghai', now)

    // 上周一 00:00 北京时间 = 2026-07-12T16:00:00Z（-8h）
    const expectedStart = new Date('2026-07-12T16:00:00.000Z').getTime()
    assert(
      range.start.getTime() === expectedStart,
      `start 应为 2026-07-12T16:00:00Z（上周一 00:00 北京），实际 ${range.start.toISOString()}`
    )

    // 上周日 23:59:59.999 北京时间 = 2026-07-19T15:59:59.999Z
    const expectedEnd = new Date('2026-07-19T15:59:59.999Z').getTime()
    assert(
      range.end.getTime() === expectedEnd,
      `end 应为 2026-07-19T15:59:59.999Z（上周日 23:59:59.999 北京），实际 ${range.end.toISOString()}`
    )

    // end - start 应为 7 天 - 1ms
    assert(
      range.end.getTime() - range.start.getTime() === 7 * 86400000 - 1,
      '时间范围应为 7 天 - 1ms'
    )
  }

  // ────────── 场景 7：改进建议生成 ──────────

  section('场景 7：改进建议生成（高危拦截率 > 20% 触发建议）')

  {
    // 29. 高危拦截率 25%（>20%）应触发命令白名单建议
    const s1 = generateImprovementSuggestions(
      makeDecisionStats({ total: 20, successCount: 15, blockedCount: 5 }),
      makeKnowledgeStats({ newEntries: 5, aiContributionRate: 0.5 })
    )
    assert(
      s1.some((s) => s.includes('高危拦截率达 25.0%') && s.includes('命令白名单')),
      `高危拦截率 25% 应触发命令白名单建议，实际 ${JSON.stringify(s1)}`
    )

    // 30. 高危拦截率 10%（≤20%）不应触发
    const s2 = generateImprovementSuggestions(
      makeDecisionStats({ total: 20, successCount: 18, blockedCount: 2 }),
      makeKnowledgeStats({ newEntries: 5, aiContributionRate: 0.5 })
    )
    assert(
      !s2.some((s) => s.includes('高危拦截率')),
      '高危拦截率 10% 不应触发该建议'
    )

    // 31. 成功率 60%（<80%）应触发
    const s3 = generateImprovementSuggestions(
      makeDecisionStats({ total: 10, successCount: 6, blockedCount: 0 }),
      makeKnowledgeStats({ newEntries: 5, aiContributionRate: 0.5 })
    )
    assert(
      s3.some((s) => s.includes('决策成功率仅 60.0%') && s.includes('失败决策')),
      `成功率 60% 应触发失败决策建议`
    )

    // 32. AI 贡献率 5%（<10%）应触发
    const s4 = generateImprovementSuggestions(
      makeDecisionStats({ total: 10, successCount: 10 }),
      makeKnowledgeStats({ newEntries: 10, aiContributionRate: 0.05 })
    )
    assert(
      s4.some((s) => s.includes('AI 贡献率仅 5.0%') && s.includes('自动归档')),
      `AI 贡献率 5% 应触发自动归档建议`
    )

    // 33. 平均响应时间 8000ms（>5000）应触发
    const s5 = generateImprovementSuggestions(
      makeDecisionStats({ total: 10, successCount: 10, avgResponseMs: 8000 }),
      makeKnowledgeStats({ newEntries: 5, aiContributionRate: 0.5 })
    )
    assert(
      s5.some((s) => s.includes('平均响应时间 8000ms') && s.includes('SSH')),
      `平均响应时间 8000ms 应触发 SSH 优化建议`
    )

    // 34. 全部正常时应返回"各项指标正常"
    const s6 = generateImprovementSuggestions(
      makeDecisionStats({ total: 10, successCount: 9, blockedCount: 1, avgResponseMs: 1000 }),
      makeKnowledgeStats({ newEntries: 5, aiContributionRate: 0.5 })
    )
    assert(
      s6.length === 1 && s6[0].includes('各项指标正常'),
      `全部正常应返回"各项指标正常"，实际 ${JSON.stringify(s6)}`
    )
  }

  // ────────── 场景 7.1：Markdown 生成（直接测试纯函数）──────────

  section('场景 7.1：Markdown 周报生成（纯函数）')

  {
    const data: WeeklyReportData = {
      isoYear: 2026,
      isoWeek: 29,
      startDate: new Date(Date.UTC(2026, 6, 13)),
      endDate: new Date(Date.UTC(2026, 6, 19)),
      generatedAt: '2026-07-20T02:00:00.000Z',
      decision: {
        total: 10,
        successCount: 8,
        blockedCount: 2,
        avgResponseMs: 1234.5,
        dailyTrend: [{ date: '2026-07-13', total: 10, successCount: 8, blockedCount: 2 }],
      },
      knowledge: { newEntries: 4, aiContributionRate: 0.5 },
      suggestions: ['建议 1', '建议 2'],
    }
    const md = generateWeeklyReportMarkdown(data)

    // 35. 标题应包含 "2026-W29"
    assert(md.includes('# TDSF Linux 运维周报 · 2026-W29'), 'Markdown 标题应包含 2026-W29')
    // 36. 决策统计表应包含 "80.0%"（成功率）
    assert(md.includes('| 成功率 | 80.0% |'), 'Markdown 应包含成功率 80.0%')
    // 37. 趋势表应包含 "2026-07-13"
    assert(md.includes('| 2026-07-13 | 10 | 8 | 2 |'), 'Markdown 应包含趋势行 2026-07-13')
    // 38. 改进建议应包含 "建议 1" 和 "建议 2"
    assert(md.includes('- 建议 1') && md.includes('- 建议 2'), 'Markdown 应包含两条建议')
  }

  // ────────── 场景 8：数据库查询失败不中断 ──────────

  section('场景 8：数据库查询失败不中断任务')

  {
    const decisionRepo = new MockDecisionRepo()
    const knowledgeRepo = new MockKnowledgeRepo()
    const fs = new MockFileSystem()
    decisionRepo.setError(new Error('决策数据库连接失败'))
    knowledgeRepo.setError(new Error('知识数据库连接失败'))

    const result = await executeWeeklyOpsReport(buildParams(decisionRepo, knowledgeRepo, fs))

    // 39. 查询失败不应中断任务（仍 success: true）
    assert(result.success === true, '数据库查询失败时任务应 success=true（不中断）')
    // 40. queryErrors 应包含 2 条记录
    const errors = result.details?.queryErrors as Array<{ repo: string; error: string }>
    assert(
      Array.isArray(errors) && errors.length === 2,
      `queryErrors 应有 2 条记录，实际 ${errors?.length}`
    )
    // 41. summary 应提示查询错误
    assert(
      result.summary.includes('2 个查询错误'),
      `summary 应包含 "2 个查询错误"，实际 "${result.summary}"`
    )
    // 42. 文件仍应被写入（用空数据兜底）
    assert(fs.writeFileCallCount === 1, '数据库失败时仍应写入周报文件')
  }

  // ────────── 场景 9：durationMs 与 details 结构 ──────────

  section('场景 9：durationMs 与 details 结构')

  {
    const decisionRepo = new MockDecisionRepo()
    const knowledgeRepo = new MockKnowledgeRepo()
    const fs = new MockFileSystem()

    const result = await executeWeeklyOpsReport(buildParams(decisionRepo, knowledgeRepo, fs))

    // 43. durationMs 为非负数
    assert(
      typeof result.durationMs === 'number' && result.durationMs >= 0,
      `durationMs 应为非负数，实际 ${result.durationMs}`
    )
    // 44. details 包含 dateRange
    assert(
      result.details?.dateRange !== undefined &&
        typeof (result.details?.dateRange as { start: number }).start === 'number',
      'details 应包含 dateRange.start'
    )
    // 45. details 包含 isoYear / isoWeek
    assert(
      typeof result.details?.isoYear === 'number' &&
        typeof result.details?.isoWeek === 'number',
      'details 应包含 isoYear / isoWeek'
    )
  }

  // ────────── 汇总 ──────────

  console.log('\n' + '='.repeat(60))
  console.log('📊 测试汇总')
  console.log('='.repeat(60))
  console.log(`  ✅ 通过: ${passCount}`)
  console.log(`  ❌ 失败: ${failCount}`)
  console.log('='.repeat(60))

  if (failCount > 0) {
    console.log('\n❌ 测试失败，请检查 weekly-ops-report.ts')
    process.exit(1)
  } else {
    console.log('\n✅ 全部测试通过！运维周报任务就绪')
    process.exit(0)
  }
}

main().catch((err) => {
  console.error('\n💥 测试执行异常:', err)
  process.exit(2)
})
