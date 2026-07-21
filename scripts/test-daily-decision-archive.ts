/**
 * Daily Decision Archive 单元测试
 *
 * 测试目标（spec SubTask 6.3.3 ≥ 10 个用例）：
 *   1. 无决策记录 → success: true, summary "无决策需要归档"
 *   2. 1 条决策记录 → success: true, archivedCount: 1
 *   3. 多条决策记录 → success: true, archivedCount: N
 *   4. 重复触发幂等性 → 第二次 archivedCount: 0
 *   5. 数据库异常 → success: false, error 非空
 *
 * 测试模式：使用 mock DecisionRepository / KnowledgeRepository（不真实连接数据库）。
 *
 * 运行方式（必须加 --tsconfig 才能解析 @shared/* 路径别名）：
 *   npx tsx --tsconfig tsconfig.node.json scripts/test-daily-decision-archive.ts
 *
 * 参考：
 *   - scripts/test-cron-parser.ts（测试脚本模式：🚀 + section + ✅/❌ + 📊）
 *   - src/main/services/scheduler/daily-decision-archive.ts（被测模块）
 */

import {
  runDailyDecisionArchive,
  createDailyDecisionArchiveTask,
  createDailyDecisionArchiveTaskWithRepos,
} from '../src/main/services/scheduler/daily-decision-archive'
import type {
  ArchivedDecision,
  ArchivedKnowledgeEntry,
  ArchiveDecisionRepository,
  ArchiveKnowledgeRepository,
} from '../src/main/services/scheduler/daily-decision-archive'
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

/** 创建测试决策数据 */
function makeDecision(
  overrides: Partial<ArchivedDecision> = {}
): ArchivedDecision {
  return {
    id: overrides.id ?? 'dec-001',
    title: overrides.title ?? '磁盘空间不足',
    summary: overrides.summary ?? '根分区使用率 95%，需清理日志',
    hypothesis: overrides.hypothesis ?? '/var/log 占用过大',
    fixCommand: overrides.fixCommand ?? 'find /var/log -name "*.log" -mtime +7 -delete',
    fixDescription: overrides.fixDescription ?? '清理 7 天前的日志文件',
    rollbackCommand: overrides.rollbackCommand,
    riskLevel: overrides.riskLevel ?? 'LOW',
    status: overrides.status ?? 'verified',
    timestamp: overrides.timestamp ?? Date.now(),
    verification: overrides.verification ?? 'df -h 显示使用率降至 60%',
  }
}

// ============================================================
// Mock 实现
// ============================================================

/**
 * Mock 决策仓储
 *
 * 内存存储测试决策，支持注入异常。
 */
class MockDecisionRepo implements ArchiveDecisionRepository {
  private readonly decisions: ArchivedDecision[] = []
  private queryError: Error | null = null
  queryCallCount = 0

  /** 设置返回的决策列表 */
  setDecisions(decisions: ArchivedDecision[]): void {
    this.decisions.length = 0
    this.decisions.push(...decisions)
  }

  /** 注入 querySuccessfulDecisions 异常 */
  setQueryError(err: Error | null): void {
    this.queryError = err
  }

  async querySuccessfulDecisions(dateRange: {
    start: number
    end: number
  }): Promise<ArchivedDecision[]> {
    this.queryCallCount++
    if (this.queryError) throw this.queryError
    return this.decisions.filter(
      (d) => d.timestamp >= dateRange.start && d.timestamp <= dateRange.end
    )
  }

  async existsById(id: string): Promise<boolean> {
    return this.decisions.some((d) => d.id === id)
  }
}

/**
 * Mock 知识仓储
 *
 * 内存 Map 模拟存储，支持注入异常。
 */
class MockKnowledgeRepo implements ArchiveKnowledgeRepository {
  private readonly entries = new Map<string, ArchivedKnowledgeEntry>()
  private readonly byRelatedId = new Map<string, ArchivedKnowledgeEntry>()
  private aiContribution = 0
  private saveError: Error | null = null
  private countError: Error | null = null
  private findByRelatedError: Error | null = null

  saveCallCount = 0
  findByRelatedCallCount = 0
  transactionCallCount = 0
  incrementCallCount = 0

  async findByRelatedDecisionId(
    relatedDecisionId: string
  ): Promise<ArchivedKnowledgeEntry | null> {
    this.findByRelatedCallCount++
    if (this.findByRelatedError) throw this.findByRelatedError
    return this.byRelatedId.get(relatedDecisionId) ?? null
  }

  async save(entry: ArchivedKnowledgeEntry): Promise<void> {
    if (this.saveError) throw this.saveError
    this.entries.set(entry.id, entry)
    this.byRelatedId.set(entry.relatedDecisionId, entry)
    this.saveCallCount++
  }

  async count(): Promise<number> {
    if (this.countError) throw this.countError
    return this.entries.size
  }

  async countBySource(source: string): Promise<number> {
    let c = 0
    for (const e of this.entries.values()) {
      if (e.source === source) c++
    }
    return c
  }

  async incrementAiContribution(): Promise<void> {
    this.aiContribution++
    this.incrementCallCount++
  }

  async runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
    this.transactionCallCount++
    return fn()
  }

  // ── 测试辅助方法 ──

  getAiContribution(): number {
    return this.aiContribution
  }

  getSavedEntries(): ArchivedKnowledgeEntry[] {
    return Array.from(this.entries.values())
  }

  setSaveError(err: Error | null): void {
    this.saveError = err
  }

  setCountError(err: Error | null): void {
    this.countError = err
  }

  setFindByRelatedError(err: Error | null): void {
    this.findByRelatedError = err
  }
}

/** 构建归档参数（默认时间范围覆盖所有测试决策） */
function buildParams(
  decisionRepo: MockDecisionRepo,
  knowledgeRepo: MockKnowledgeRepo,
  dateRange: { start: number; end: number } = { start: 0, end: Date.now() + 1000 }
): {
  decisionRepo: ArchiveDecisionRepository
  knowledgeRepo: ArchiveKnowledgeRepository
  dateRange: { start: number; end: number }
} {
  return { decisionRepo, knowledgeRepo, dateRange }
}

// ============================================================
// 主测试函数
// ============================================================

async function main(): Promise<void> {
  console.log('🚀 Phase 6 Task 6.3 Daily Decision Archive 单元测试')
  console.log('   测试场景：无决策 / 单条 / 多条 / 幂等性 / 异常 / 工厂函数')

  // ────────── 场景 1：无决策记录 ──────────

  section('场景 1：无决策记录')

  {
    const decisionRepo = new MockDecisionRepo()
    const knowledgeRepo = new MockKnowledgeRepo()
    decisionRepo.setDecisions([])

    const result = await runDailyDecisionArchive(
      buildParams(decisionRepo, knowledgeRepo)
    )

    // 1. 应返回 success: true
    assert(result.success === true, '无决策时应返回 success=true')
    // 2. summary 应包含"无决策需要归档"
    assert(
      result.summary === '无决策需要归档',
      `summary 应为"无决策需要归档"，实际 "${result.summary}"`
    )
    // 3. archivedCount 应为 0
    assert(
      (result.details?.archivedCount as number) === 0,
      'archivedCount 应为 0'
    )
    // 4. totalDecisions 应为 0
    assert(
      (result.details?.totalDecisions as number) === 0,
      'totalDecisions 应为 0'
    )
    // 5. 不应调用 save
    assert(knowledgeRepo.saveCallCount === 0, '无决策时不应调用 save')
    // 6. 不应启动事务
    assert(
      knowledgeRepo.transactionCallCount === 0,
      '无决策时不应启动事务'
    )
  }

  // ────────── 场景 2：1 条决策记录 ──────────

  section('场景 2：1 条决策记录')

  {
    const decisionRepo = new MockDecisionRepo()
    const knowledgeRepo = new MockKnowledgeRepo()
    decisionRepo.setDecisions([makeDecision()])

    const result = await runDailyDecisionArchive(
      buildParams(decisionRepo, knowledgeRepo)
    )

    // 7. 应返回 success: true
    assert(result.success === true, '1 条决策时应返回 success=true')
    // 8. archivedCount 应为 1
    assert(
      (result.details?.archivedCount as number) === 1,
      'archivedCount 应为 1'
    )
    // 9. AI 贡献计数 +1
    assert(
      knowledgeRepo.getAiContribution() === 1,
      'AI 贡献计数应为 1'
    )
    // 10. save 调用 1 次
    assert(knowledgeRepo.saveCallCount === 1, 'save 应被调用 1 次')
    // 11. title 格式 `[自动归档] xxx`
    const saved = knowledgeRepo.getSavedEntries()[0]
    assert(
      saved.title === '[自动归档] 磁盘空间不足',
      `title 应为"[自动归档] 磁盘空间不足"，实际 "${saved.title}"`
    )
    // 12. tags 包含 ['auto-archived', 'decision', 'LOW']
    assert(
      saved.tags.includes('auto-archived') &&
        saved.tags.includes('decision') &&
        saved.tags.includes('LOW'),
      `tags 应包含 auto-archived/decision/LOW，实际 ${JSON.stringify(saved.tags)}`
    )
    // 13. content 包含摘要、假设、命令
    assert(
      saved.content.includes('根分区使用率') && // summary
        saved.content.includes('/var/log') && // hypothesis
        saved.content.includes('find /var/log'), // fixCommand
      'content 应包含摘要、假设、命令'
    )
    // 14. relatedDecisionId 等于决策 ID
    assert(
      saved.relatedDecisionId === 'dec-001',
      'relatedDecisionId 应等于决策 ID'
    )
  }

  // ────────── 场景 3：多条决策记录 ──────────

  section('场景 3：多条决策记录')

  {
    const decisionRepo = new MockDecisionRepo()
    const knowledgeRepo = new MockKnowledgeRepo()
    const decisions = [
      makeDecision({ id: 'dec-001', riskLevel: 'LOW' }),
      makeDecision({ id: 'dec-002', riskLevel: 'MEDIUM', title: 'CPU 使用率过高' }),
      makeDecision({ id: 'dec-003', riskLevel: 'HIGH', title: '内存泄漏' }),
    ]
    decisionRepo.setDecisions(decisions)

    const result = await runDailyDecisionArchive(
      buildParams(decisionRepo, knowledgeRepo)
    )

    // 15. 应返回 success: true
    assert(result.success === true, '3 条决策时应返回 success=true')
    // 16. archivedCount 应为 3
    assert(
      (result.details?.archivedCount as number) === 3,
      'archivedCount 应为 3'
    )
    // 17. totalDecisions 应为 3
    assert(
      (result.details?.totalDecisions as number) === 3,
      'totalDecisions 应为 3'
    )
    // 18. runInTransaction 调用 1 次（整批一次事务）
    assert(
      knowledgeRepo.transactionCallCount === 1,
      'runInTransaction 应调用 1 次'
    )
    // 19. save 调用 3 次
    assert(knowledgeRepo.saveCallCount === 3, 'save 应被调用 3 次')
    // 20. AI 贡献计数为 3
    assert(
      knowledgeRepo.getAiContribution() === 3,
      'AI 贡献计数应为 3'
    )
  }

  // ────────── 场景 4：幂等性（重复触发）──────────

  section('场景 4：重复触发幂等性')

  {
    const decisionRepo = new MockDecisionRepo()
    const knowledgeRepo = new MockKnowledgeRepo()
    const decisions = [
      makeDecision({ id: 'dec-001' }),
      makeDecision({ id: 'dec-002' }),
      makeDecision({ id: 'dec-003' }),
    ]
    decisionRepo.setDecisions(decisions)

    // 第一次调用：应归档 3 条
    const result1 = await runDailyDecisionArchive(
      buildParams(decisionRepo, knowledgeRepo)
    )
    assert(
      (result1.details?.archivedCount as number) === 3,
      '第一次调用 archivedCount 应为 3'
    )

    // 第二次调用：应全部跳过
    const result2 = await runDailyDecisionArchive(
      buildParams(decisionRepo, knowledgeRepo)
    )

    // 21. 第二次 archivedCount 应为 0
    assert(
      (result2.details?.archivedCount as number) === 0,
      '第二次调用 archivedCount 应为 0（幂等）'
    )
    // 22. 第二次 skippedCount 应为 3
    assert(
      (result2.details?.skippedCount as number) === 3,
      '第二次调用 skippedCount 应为 3'
    )
    // 23. save 调用次数不变（仍为 3，未新增）
    assert(
      knowledgeRepo.saveCallCount === 3,
      '第二次调用后 save 总次数应仍为 3'
    )
    // 24. findByRelatedDecisionId 被调用 6 次（3 + 3）
    assert(
      knowledgeRepo.findByRelatedCallCount === 6,
      `findByRelatedDecisionId 应调用 6 次（3+3），实际 ${knowledgeRepo.findByRelatedCallCount}`
    )
  }

  // ────────── 场景 5：数据库异常 ──────────

  section('场景 5：数据库异常')

  // 25. querySuccessfulDecisions 抛错
  {
    const decisionRepo = new MockDecisionRepo()
    const knowledgeRepo = new MockKnowledgeRepo()
    decisionRepo.setQueryError(new Error('数据库连接失败'))

    const result = await runDailyDecisionArchive(
      buildParams(decisionRepo, knowledgeRepo)
    )

    assert(result.success === false, 'query 抛错时应返回 success=false')
    assert(
      result.error !== undefined && result.error.length > 0,
      'error 应非空'
    )
    assert(
      result.error?.includes('数据库连接失败'),
      `error 应包含"数据库连接失败"，实际 "${result.error}"`
    )
  }

  // 26. save 抛错
  {
    const decisionRepo = new MockDecisionRepo()
    const knowledgeRepo = new MockKnowledgeRepo()
    decisionRepo.setDecisions([makeDecision()])
    knowledgeRepo.setSaveError(new Error('写入失败'))

    const result = await runDailyDecisionArchive(
      buildParams(decisionRepo, knowledgeRepo)
    )

    assert(result.success === false, 'save 抛错时应返回 success=false')
    assert(
      result.error?.includes('写入失败'),
      `error 应包含"写入失败"，实际 "${result.error}"`
    )
  }

  // 27. count 抛错（事务后统计阶段）
  {
    const decisionRepo = new MockDecisionRepo()
    const knowledgeRepo = new MockKnowledgeRepo()
    decisionRepo.setDecisions([makeDecision()])
    knowledgeRepo.setCountError(new Error('统计失败'))

    const result = await runDailyDecisionArchive(
      buildParams(decisionRepo, knowledgeRepo)
    )

    assert(result.success === false, 'count 抛错时应返回 success=false')
    assert(
      result.error?.includes('统计失败'),
      `error 应包含"统计失败"，实际 "${result.error}"`
    )
  }

  // 28. findByRelatedDecisionId 抛错
  {
    const decisionRepo = new MockDecisionRepo()
    const knowledgeRepo = new MockKnowledgeRepo()
    decisionRepo.setDecisions([makeDecision()])
    knowledgeRepo.setFindByRelatedError(new Error('查询已归档失败'))

    const result = await runDailyDecisionArchive(
      buildParams(decisionRepo, knowledgeRepo)
    )

    assert(result.success === false, 'findByRelated 抛错时应返回 success=false')
    assert(
      result.error?.includes('查询已归档失败'),
      `error 应包含"查询已归档失败"，实际 "${result.error}"`
    )
  }

  // ────────── 场景 6：AI 贡献率统计 ──────────

  section('场景 6：AI 贡献率统计')

  {
    const decisionRepo = new MockDecisionRepo()
    const knowledgeRepo = new MockKnowledgeRepo()
    decisionRepo.setDecisions([
      makeDecision({ id: 'dec-001' }),
      makeDecision({ id: 'dec-002' }),
    ])

    // 预置一条手动知识条目（非 auto-archive）
    const manualEntry: ArchivedKnowledgeEntry = {
      id: 'manual-001',
      title: '手动知识',
      content: '手动添加',
      source: 'manual',
      tags: ['manual'],
      relatedDecisionId: 'manual-dec',
      createdAt: Date.now(),
    }
    await knowledgeRepo.save(manualEntry)

    const result = await runDailyDecisionArchive(
      buildParams(decisionRepo, knowledgeRepo)
    )

    // 29. totalKnowledge 应为 3（1 手动 + 2 归档）
    assert(
      (result.details?.totalKnowledge as number) === 3,
      `totalKnowledge 应为 3，实际 ${result.details?.totalKnowledge}`
    )
    // 30. aiArchivedCount 应为 2
    assert(
      (result.details?.aiArchivedCount as number) === 2,
      `aiArchivedCount 应为 2，实际 ${result.details?.aiArchivedCount}`
    )
    // 31. aiContributionRate 应为 2/3 ≈ 0.6667
    assert(
      (result.details?.aiContributionRate as number) === 0.6667,
      `aiContributionRate 应为 0.6667，实际 ${result.details?.aiContributionRate}`
    )
  }

  // ────────── 场景 7：工厂函数 ──────────

  section('场景 7：工厂函数 createDailyDecisionArchiveTask')

  {
    // 32. 占位工厂返回正确元数据
    const task: SchedulerTask = createDailyDecisionArchiveTask()
    assert(task.id === 'daily-decision-archive', 'id 应为 daily-decision-archive')
    assert(task.cron === '0 18 * * *', `cron 应为 "0 18 * * *"，实际 "${task.cron}"`)
    assert(task.timezone === 'Asia/Shanghai', 'timezone 应为 Asia/Shanghai')
    assert(task.enabled === true, 'enabled 应为 true')
    assert(task.name === '每日决策归档', 'name 应为"每日决策归档"')

    // 33. 占位 handler 返回 success=false
    const placeholderResult = await task.handler()
    assert(
      placeholderResult.success === false,
      '占位 handler 应返回 success=false'
    )
    assert(
      placeholderResult.error !== undefined,
      '占位 handler 应有 error 提示'
    )
  }

  // 34. 带注入工厂：handler 可正常执行
  {
    const decisionRepo = new MockDecisionRepo()
    const knowledgeRepo = new MockKnowledgeRepo()
    decisionRepo.setDecisions([makeDecision()])

    const taskWithRepos = createDailyDecisionArchiveTaskWithRepos(
      decisionRepo,
      knowledgeRepo
    )
    assert(taskWithRepos.id === 'daily-decision-archive', '带注入工厂 id 正确')

    const result = await taskWithRepos.handler()
    assert(
      result.success === true,
      '带注入工厂 handler 应返回 success=true'
    )
    assert(
      (result.details?.archivedCount as number) === 1,
      '带注入工厂应归档 1 条'
    )
  }

  // ────────── 场景 8：边界 - durationMs 与 details 结构 ──────────

  section('场景 8：边界 - durationMs 与 details 结构')

  {
    const decisionRepo = new MockDecisionRepo()
    const knowledgeRepo = new MockKnowledgeRepo()
    decisionRepo.setDecisions([makeDecision()])

    const result = await runDailyDecisionArchive(
      buildParams(decisionRepo, knowledgeRepo)
    )

    // 35. durationMs 为非负数
    assert(
      typeof result.durationMs === 'number' && result.durationMs >= 0,
      `durationMs 应为非负数，实际 ${result.durationMs}`
    )
    // 36. details 包含 dateRange
    assert(
      result.details?.dateRange !== undefined,
      'details 应包含 dateRange'
    )
    // 37. details 包含 skippedCount
    assert(
      result.details?.skippedCount === 0,
      '无跳过时 skippedCount 应为 0'
    )
    // 38. details.archivedDecisionIds 包含已归档决策 ID
    const ids = result.details?.archivedDecisionIds as string[]
    assert(
      Array.isArray(ids) && ids.includes('dec-001'),
      'archivedDecisionIds 应包含 dec-001'
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
    console.log('\n❌ 测试失败，请检查 daily-decision-archive.ts')
    process.exit(1)
  } else {
    console.log('\n✅ 全部测试通过！每日决策归档任务就绪')
    process.exit(0)
  }
}

main().catch((err) => {
  console.error('\n💥 测试执行异常:', err)
  process.exit(2)
})
