/**
 * Phase 6.7 综合集成测试：定时任务调度引擎全链路覆盖（36 用例）
 * 覆盖：cron-parser + Scheduler + 健康检查 + 决策归档 + 周报 + IPC 语义
 * 运行：npx tsx --tsconfig tsconfig.node.json scripts/test-scheduler.ts
 */
import { getNextRun, parseCron, CronParseError } from '../src/main/services/scheduler/cron-parser'
import { Scheduler, resetScheduler } from '../src/main/services/scheduler/scheduler'
import { runDailyHealthCheck, DefaultRuleAnalyzer, type SshExecutor, type HealthCheckDetails } from '../src/main/services/scheduler/daily-health-check'
import { runDailyDecisionArchive, type ArchivedDecision, type ArchiveDecisionRepository, type ArchiveKnowledgeRepository, type ArchivedKnowledgeEntry } from '../src/main/services/scheduler/daily-decision-archive'
import { executeWeeklyOpsReport, getISOWeekNumber, type DecisionWeeklyRepository, type DecisionWeeklyStats, type KnowledgeWeeklyRepository, type KnowledgeWeeklyStats, type ReportFileSystem } from '../src/main/services/scheduler/weekly-ops-report'
import type { SshConfig } from '../src/shared/models'
import type { TaskResult } from '../src/shared/scheduler-types'

const tests: Array<{ name: string; fn: () => Promise<void> | void }> = []
function test(name: string, fn: () => Promise<void> | void): void { tests.push({ name, fn }) }
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(`Assertion failed: ${msg}`) }
function expectThrows(fn: () => unknown, msg: string): void {
  try { fn() } catch (e) { assert(e instanceof Error, `应抛 Error：${msg}`); return }
  throw new Error(`未抛错：${msg}`)
}

function getShanghaiFields(date: Date): { minute: number; hour: number; day: number; month: number; year: number; weekday: string } {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })
  const map: Record<string, string> = {}
  for (const p of fmt.formatToParts(date)) map[p.type] = p.value
  return { minute: parseInt(map.minute, 10), hour: parseInt(map.hour, 10) % 24,
    day: parseInt(map.day, 10), month: parseInt(map.month, 10), year: parseInt(map.year, 10), weekday: map.weekday }
}

type MockSshConfig = { connectError?: string; execError?: string; execResults?: Map<string, { stdout: string; stderr: string; exitCode: number }> }
type ExecResult = { stdout: string; stderr: string; exitCode: number }

class MockSshExecutor implements SshExecutor {
  private readonly mocks: Map<string, MockSshConfig>
  private readonly sessionToServer = new Map<string, string>()
  connectCalls = 0; execCalls = 0; disconnectCalls = 0; private counter = 0
  constructor(mocks: Map<string, MockSshConfig>) { this.mocks = mocks }
  async connect(config: SshConfig): Promise<string> {
    this.connectCalls++
    const m = this.mocks.get(config.id)
    if (m?.connectError) throw new Error(m.connectError)
    const sid = `s${++this.counter}`; this.sessionToServer.set(sid, config.id); return sid
  }
  async exec(sessionId: string, command: string): Promise<ExecResult> {
    this.execCalls++
    const m = this.mocks.get(this.sessionToServer.get(sessionId) ?? '')
    if (m?.execError) throw new Error(m.execError)
    return m?.execResults?.get(command) ?? { stdout: '', stderr: '', exitCode: 0 }
  }
  async disconnect(_sessionId: string): Promise<boolean> { this.disconnectCalls++; return true }
}

const DEFAULT_METRICS_OUTPUT = new Map<string, ExecResult>([
  [`top -bn1 | grep "Cpu(s)" | awk '{print $2}'`, { stdout: '12.5', stderr: '', exitCode: 0 }],
  [`free -m | awk '/Mem/{print $3"/"$2}'`, { stdout: '2048/8192', stderr: '', exitCode: 0 }],
  [`df -h / | awk 'NR==2{print $5}'`, { stdout: '45%', stderr: '', exitCode: 0 }],
  [`cat /proc/net/dev | grep eth0`, { stdout: '  eth0: 100 200 0 0 0 0 0 0 300 400 0 0 0 0 0 0', stderr: '', exitCode: 0 }],
])
const makeServer = (id: string): SshConfig => ({
  id, name: id, host: `${id}.example.com`, port: 22, username: 'root', authType: 'password', password: 'secret',
})

class MockArchiveDecisionRepo implements ArchiveDecisionRepository {
  private decisions: ArchivedDecision[] = []; error: Error | null = null; queryCallCount = 0
  setDecisions(list: ArchivedDecision[]): void { this.decisions = list }
  async querySuccessfulDecisions(range: { start: number; end: number }): Promise<ArchivedDecision[]> {
    this.queryCallCount++; if (this.error) throw this.error
    return this.decisions.filter((d) => d.timestamp >= range.start && d.timestamp <= range.end)
  }
  async existsById(id: string): Promise<boolean> { return this.decisions.some((d) => d.id === id) }
}

class MockArchiveKnowledgeRepo implements ArchiveKnowledgeRepository {
  private entries = new Map<string, ArchivedKnowledgeEntry>()
  private byRelated = new Map<string, ArchivedKnowledgeEntry>()
  aiContribution = 0; saveError: Error | null = null; countError: Error | null = null; findByRelatedError: Error | null = null
  saveCallCount = 0; findByRelatedCallCount = 0; transactionCallCount = 0; incrementCallCount = 0
  async findByRelatedDecisionId(id: string): Promise<ArchivedKnowledgeEntry | null> {
    this.findByRelatedCallCount++; if (this.findByRelatedError) throw this.findByRelatedError
    return this.byRelated.get(id) ?? null
  }
  async save(entry: ArchivedKnowledgeEntry): Promise<void> {
    if (this.saveError) throw this.saveError
    this.entries.set(entry.id, entry); this.byRelated.set(entry.relatedDecisionId, entry); this.saveCallCount++
  }
  async count(): Promise<number> { if (this.countError) throw this.countError; return this.entries.size }
  async countBySource(source: string): Promise<number> { let c = 0; for (const e of this.entries.values()) if (e.source === source) c++; return c }
  async incrementAiContribution(): Promise<void> { this.aiContribution++; this.incrementCallCount++ }
  async runInTransaction<T>(fn: () => Promise<T>): Promise<T> { this.transactionCallCount++; return fn() }
  getSavedEntries(): ArchivedKnowledgeEntry[] { return Array.from(this.entries.values()) }
}

const makeDecision = (o: Partial<ArchivedDecision> = {}): ArchivedDecision => ({
  id: o.id ?? 'dec-001', title: o.title ?? '磁盘空间不足',
  summary: o.summary ?? '根分区使用率 95%', hypothesis: o.hypothesis ?? '/var/log 占用过大',
  fixCommand: o.fixCommand ?? 'find /var/log -mtime +7 -delete',
  fixDescription: o.fixDescription ?? '清理 7 天前的日志', rollbackCommand: o.rollbackCommand,
  riskLevel: o.riskLevel ?? 'LOW', status: o.status ?? 'verified',
  timestamp: o.timestamp ?? Date.now(), verification: o.verification ?? 'df -h 显示使用率降至 60%',
})

class MockWeeklyDecisionRepo implements DecisionWeeklyRepository {
  stats: DecisionWeeklyStats | null = null; error: Error | null = null; callCount = 0
  async getWeeklyStats(_start: Date, _end: Date): Promise<DecisionWeeklyStats> {
    this.callCount++; if (this.error) throw this.error
    return this.stats ?? { total: 0, successCount: 0, blockedCount: 0, avgResponseMs: 0, dailyTrend: [] }
  }
}

class MockWeeklyKnowledgeRepo implements KnowledgeWeeklyRepository {
  stats: KnowledgeWeeklyStats | null = null; error: Error | null = null; callCount = 0
  async getWeeklyStats(): Promise<KnowledgeWeeklyStats> {
    this.callCount++; if (this.error) throw this.error
    return this.stats ?? { newEntries: 0, aiContributionRate: 0 }
  }
}

class MockReportFileSystem implements ReportFileSystem {
  mkdirCallCount = 0; writeFileCallCount = 0
  lastMkdirPath: string | null = null; lastWritePath: string | null = null; lastWriteContent: string | null = null
  mkdirError: Error | null = null; writeError: Error | null = null
  async mkdirRecursive(path: string): Promise<void> { this.mkdirCallCount++; this.lastMkdirPath = path; if (this.mkdirError) throw this.mkdirError }
  async writeFile(path: string, content: string): Promise<void> {
    this.writeFileCallCount++; this.lastWritePath = path; this.lastWriteContent = content
    if (this.writeError) throw this.writeError
  }
}

type TaskId = 'daily-health-check' | 'daily-decision-archive' | 'weekly-ops-report'
const registerSimpleTask = (sched: Scheduler, id: TaskId = 'daily-health-check',
  handler: () => Promise<TaskResult> = async () => ({ success: true, summary: 'ok', durationMs: 1 })): void =>
  sched.register({ id, name: 'T', cron: '0 9 * * *', timezone: 'Asia/Shanghai', enabled: true, handler })
const buildArchiveParams = (dr: MockArchiveDecisionRepo, kr: MockArchiveKnowledgeRepo,
  dateRange: { start: number; end: number } = { start: 0, end: Date.now() + 1000 }) =>
  ({ decisionRepo: dr, knowledgeRepo: kr, dateRange })
const buildWeeklyParams = (dr: MockWeeklyDecisionRepo, kr: MockWeeklyKnowledgeRepo, fs: MockReportFileSystem,
  overrides: { reportsDir?: string; now?: Date } = {}) => ({
  decisionRepo: dr, knowledgeRepo: kr, fs,
  reportsDir: overrides.reportsDir ?? '/tmp/test-reports',
  timezone: 'Asia/Shanghai' as const, now: overrides.now ?? new Date('2026-07-20T10:00:00+08:00'),
})

test('cron-parser: * * * * * 返回下一整分钟', () => {
  const from = new Date('2026-07-21T10:00:00+08:00')
  assert(getNextRun('* * * * *', from).getTime() - from.getTime() === 60_000, '应 +1 分钟')
})
test('cron-parser: 0 9 * * * 返回 09:00 整', () => {
  const f = getShanghaiFields(getNextRun('0 9 * * *', new Date('2026-07-21T08:00:00+08:00')))
  assert(f.hour === 9 && f.minute === 0, `应为 09:00，实际 ${f.hour}:${f.minute}`)
})
test('cron-parser: */5 步进返回 5 的倍数分钟', () => {
  const f = getShanghaiFields(getNextRun('*/5 * * * *', new Date('2026-07-21T10:03:00+08:00')))
  assert(f.minute % 5 === 0, `分钟应为 5 倍数，实际 ${f.minute}`)
})
test('cron-parser: 0 9-18 * * * 范围内整点', () => {
  const f = getShanghaiFields(getNextRun('0 9-18 * * *', new Date('2026-07-21T09:30:00+08:00')))
  assert(f.hour >= 9 && f.hour <= 18 && f.minute === 0, `应在 9-18 整点，实际 ${f.hour}:${f.minute}`)
})
test('cron-parser: 0,30 * * * * 列表返回 0 或 30', () => {
  const f = getShanghaiFields(getNextRun('0,30 * * * *', new Date('2026-07-21T10:10:00+08:00')))
  assert(f.minute === 0 || f.minute === 30, `分钟应为 0/30，实际 ${f.minute}`)
})
test('cron-parser: 0 9 * * MON 命名星期', () => {
  const f = getShanghaiFields(getNextRun('0 9 * * MON', new Date('2026-07-21T10:00:00+08:00')))
  assert(f.weekday === 'Mon' && f.hour === 9, `应为周一 09:00，实际 ${f.weekday} ${f.hour}`)
})
test('cron-parser: 时区 Asia/Shanghai 正确', () => {
  const next = getNextRun('0 9 * * *', new Date('2026-07-21T00:00:00Z'), 'Asia/Shanghai')
  assert(next.getTime() === new Date('2026-07-21T01:00:00Z').getTime(), `UTC 应为 01:00，实际 ${next.toISOString()}`)
})
test('cron-parser: 闰年 2 月 29 日边界', () => {
  const f = getShanghaiFields(getNextRun('0 0 29 2 *', new Date('2024-01-01T00:00:00Z')))
  assert(f.month === 2 && f.day === 29 && f.year === 2024, `应为 2024-02-29，实际 ${f.year}-${f.month}-${f.day}`)
})
test('cron-parser: parseCron 结构正确', () => {
  const p = parseCron('0 9 * * 1')
  assert(p.minute.has(0) && p.hour.has(9) && p.dayOfWeek.has(1), '字段集合应包含 0/9/1')
  assert(p.dayOfMonthRestricted === false && p.dayOfWeekRestricted === true, 'restricted 标记应正确')
})
test('cron-parser: 无效表达式抛 CronParseError', () => {
  expectThrows(() => getNextRun('60 9 * * *', new Date()), 'minute 超范围应抛错')
  expectThrows(() => getNextRun('0 9 *', new Date()), '字段数不足应抛错')
  expectThrows(() => getNextRun('abc', new Date()), '非法字符应抛错')
  try { getNextRun('invalid', new Date()); throw new Error('应抛错但未抛') }
  catch (e) {
    assert(e instanceof CronParseError, '应抛 CronParseError 类型')
    assert(e instanceof Error, 'CronParseError 应继承 Error')
  }
})

test('Scheduler: getInstance() 单例', () => {
  resetScheduler()
  const s1 = Scheduler.getInstance()
  assert(s1 === Scheduler.getInstance(), 'getInstance 两次应返回同一实例')
  resetScheduler()
})
test('Scheduler: register 注册任务后 list 返回', () => {
  resetScheduler()
  const sched = Scheduler.getInstance()
  registerSimpleTask(sched)
  const list = sched.list()
  assert(list.length === 1 && list[0].id === 'daily-health-check' && list[0].nextRunAt !== null,
    '应有 1 个 daily-health-check 任务且 nextRunAt 非空')
  resetScheduler()
})
test('Scheduler: toggle(false) 禁用任务', () => {
  resetScheduler()
  const sched = Scheduler.getInstance()
  registerSimpleTask(sched); sched.toggle('daily-health-check', false)
  const item = sched.list()[0]
  assert(item.enabled === false && item.nextRunAt === null, '禁用后 enabled=false / nextRunAt=null')
  resetScheduler()
})
test('Scheduler: toggle(true) 启用任务', () => {
  resetScheduler()
  const sched = Scheduler.getInstance()
  sched.register({ id: 'daily-health-check', name: 'T', cron: '0 9 * * *',
    timezone: 'Asia/Shanghai', enabled: false,
    handler: async () => ({ success: true, summary: 'ok', durationMs: 1 }) })
  sched.toggle('daily-health-check', true)
  const item = sched.list()[0]
  assert(item.enabled === true && item.nextRunAt !== null, '启用后 enabled=true / nextRunAt!=null')
  resetScheduler()
})
test('Scheduler: trigger 立即触发返回 TaskResult', async () => {
  resetScheduler()
  const sched = Scheduler.getInstance()
  registerSimpleTask(sched, 'daily-health-check',
    async () => ({ success: true, summary: 'trigger ok', durationMs: 0 }))
  const r = await sched.trigger('daily-health-check')
  assert(r.success === true && r.summary === 'trigger ok', 'trigger 应返回正确 TaskResult')
  resetScheduler()
})
test('Scheduler: trigger 后 lastResult / lastRunAt 更新', async () => {
  resetScheduler()
  const sched = Scheduler.getInstance()
  registerSimpleTask(sched)
  await sched.trigger('daily-health-check')
  const item = sched.list()[0]
  assert(item.lastResult !== null && item.lastRunAt !== null, 'lastResult/lastRunAt 应已更新')
  resetScheduler()
})
test('Scheduler: 任务异常不中断调度引擎', async () => {
  resetScheduler()
  const sched = Scheduler.getInstance()
  registerSimpleTask(sched, 'daily-health-check')
  sched.register({ id: 'daily-decision-archive', name: '失败', cron: '0 18 * * *',
    timezone: 'Asia/Shanghai', enabled: true,
    handler: async () => { throw new Error('模拟失败') } })
  const fr = await sched.trigger('daily-decision-archive')
  assert(fr.success === false && fr.error !== undefined, '失败任务应返回 success=false')
  const ok = await sched.trigger('daily-health-check')
  assert(ok.success === true, '正常任务不应受失败任务影响（错误隔离）')
  resetScheduler()
})
test('Scheduler: task-start / task-done 事件触发', async () => {
  resetScheduler()
  const sched = Scheduler.getInstance()
  let sc = 0, dc = 0
  sched.on('task-start', () => { sc++ })
  sched.on('task-done', () => { dc++ })
  registerSimpleTask(sched)
  await sched.trigger('daily-health-check')
  assert(sc === 1 && dc === 1, `应触发 start/done 各 1 次，实际 ${sc}/${dc}`)
  resetScheduler()
})
test('Scheduler: task-error 事件触发', async () => {
  resetScheduler()
  const sched = Scheduler.getInstance()
  let ec = 0
  sched.on('task-error', () => { ec++ })
  sched.register({ id: 'daily-decision-archive', name: '失败', cron: '0 18 * * *',
    timezone: 'Asia/Shanghai', enabled: true,
    handler: async () => { throw new Error('测试错误') } })
  await sched.trigger('daily-decision-archive')
  assert(ec === 1, `应触发 1 次 task-error，实际 ${ec}`)
  resetScheduler()
})
test('Scheduler: toggle/trigger 不存在任务应抛错', async () => {
  resetScheduler()
  const sched = Scheduler.getInstance()
  expectThrows(() => sched.toggle('nonexistent' as never, true), 'toggle 不存在任务应抛错')
  try { await sched.trigger('nonexistent' as never); throw new Error('应抛错但未抛') }
  catch (e) { assert(e instanceof Error, 'trigger 不存在任务应抛 Error') }
  resetScheduler()
})

test('daily-health-check: 无服务器配置返回 success=true', async () => {
  const executor = new MockSshExecutor(new Map())
  const r = await runDailyHealthCheck({ sshExecutor: executor, servers: [], ruleAnalyzer: new DefaultRuleAnalyzer() })
  const d = r.details as HealthCheckDetails
  assert(r.success && d.serversChecked === 0 && d.alerts.length === 0 && executor.connectCalls === 0, '无服务器应 success=true 且无连接')
})
test('daily-health-check: mock SSH 采集成功', async () => {
  const mocks = new Map<string, MockSshConfig>([
    ['s1', { execResults: DEFAULT_METRICS_OUTPUT }], ['s2', { execResults: DEFAULT_METRICS_OUTPUT }],
  ])
  const executor = new MockSshExecutor(mocks)
  const r = await runDailyHealthCheck({
    sshExecutor: executor, servers: [makeServer('s1'), makeServer('s2')],
    ruleAnalyzer: new DefaultRuleAnalyzer(),
  })
  const d = r.details as HealthCheckDetails
  assert(r.success && d.successes.length === 2, `应有 2 台成功，实际 ${d.successes.length}`)
  assert(executor.connectCalls === 2 && executor.disconnectCalls === 2, '应调用 2 次 connect/disconnect')
  assert(r.summary.includes('成功 2 台'), `summary 应含"成功 2 台"，实际 "${r.summary}"`)
})
test('daily-health-check: 部分失败不中断整体任务', async () => {
  const mocks = new Map<string, MockSshConfig>([
    ['ok', { execResults: DEFAULT_METRICS_OUTPUT }], ['fail', { connectError: 'ECONNREFUSED' }],
  ])
  const executor = new MockSshExecutor(mocks)
  const r = await runDailyHealthCheck({
    sshExecutor: executor, servers: [makeServer('ok'), makeServer('fail')],
    ruleAnalyzer: new DefaultRuleAnalyzer(),
  })
  const d = r.details as HealthCheckDetails
  assert(r.success && d.successes.length === 1 && d.failures.length === 1, '应 1 成功 1 失败')
  assert(d.failures[0].serverId === 'fail' && d.failures[0].error === 'ECONNREFUSED', 'failure 信息应正确')
})

test('daily-decision-archive: 无决策返回 success=true + "无决策需要归档"', async () => {
  const dr = new MockArchiveDecisionRepo(); const kr = new MockArchiveKnowledgeRepo()
  dr.setDecisions([])
  const r = await runDailyDecisionArchive(buildArchiveParams(dr, kr))
  assert(r.success && r.summary === '无决策需要归档', `summary 应为"无决策需要归档"，实际 "${r.summary}"`)
  assert((r.details?.archivedCount as number) === 0 && kr.saveCallCount === 0, 'archivedCount=0 且不调用 save')
})
test('daily-decision-archive: 有决策归档到知识库', async () => {
  const dr = new MockArchiveDecisionRepo(); const kr = new MockArchiveKnowledgeRepo()
  dr.setDecisions([makeDecision(), makeDecision({ id: 'dec-002', title: 'CPU 高' })])
  const r = await runDailyDecisionArchive(buildArchiveParams(dr, kr))
  assert(r.success && (r.details?.archivedCount as number) === 2, `archivedCount 应为 2，实际 ${r.details?.archivedCount}`)
  assert(kr.saveCallCount === 2 && kr.aiContribution === 2, 'save 2 次 / AI 贡献 2')
  const saved = kr.getSavedEntries()[0]
  assert(saved.title === '[自动归档] 磁盘空间不足', `title 应为"[自动归档] 磁盘空间不足"，实际 "${saved.title}"`)
  assert(saved.tags.includes('auto-archived') && saved.relatedDecisionId === 'dec-001', 'tags/relatedDecisionId 应正确')
})
test('daily-decision-archive: 重复触发幂等性', async () => {
  const dr = new MockArchiveDecisionRepo(); const kr = new MockArchiveKnowledgeRepo()
  dr.setDecisions([makeDecision(), makeDecision({ id: 'dec-002' })])
  const r1 = await runDailyDecisionArchive(buildArchiveParams(dr, kr))
  assert((r1.details?.archivedCount as number) === 2, '首次应归档 2 条')
  const r2 = await runDailyDecisionArchive(buildArchiveParams(dr, kr))
  assert((r2.details?.archivedCount as number) === 0 && (r2.details?.skippedCount as number) === 2, '第二次 archivedCount=0/skippedCount=2（幂等）')
  assert(kr.saveCallCount === 2, `save 总次数应仍为 2，实际 ${kr.saveCallCount}`)
})

test('weekly-ops-report: 无数据返回 success=true + summary 含"0 决策/0 知识"', async () => {
  const fs = new MockReportFileSystem()
  const r = await executeWeeklyOpsReport(buildWeeklyParams(new MockWeeklyDecisionRepo(), new MockWeeklyKnowledgeRepo(), fs))
  assert(r.success && r.summary.includes('0 决策/0 知识') && fs.writeFileCallCount === 1, '无数据应 success=true / 写入 1 次')
})
test('weekly-ops-report: 有数据生成 Markdown 文件', async () => {
  const dr = new MockWeeklyDecisionRepo(); const kr = new MockWeeklyKnowledgeRepo(); const fs = new MockReportFileSystem()
  dr.stats = { total: 10, successCount: 8, blockedCount: 2, avgResponseMs: 1500,
    dailyTrend: [{ date: '2026-07-13', total: 10, successCount: 8, blockedCount: 2 }] }
  kr.stats = { newEntries: 5, aiContributionRate: 0.6 }
  const r = await executeWeeklyOpsReport(buildWeeklyParams(dr, kr, fs))
  assert(r.success && r.summary.includes('10 决策'), `summary 应含"10 决策"，实际 "${r.summary}"`)
  assert((r.details?.weekLabel as string) === '2026-W29', `weekLabel 应为 2026-W29，实际 "${r.details?.weekLabel}"`)
  const c = fs.lastWriteContent ?? ''
  assert(c.includes('# TDSF Linux 运维周报 · 2026-W29') && c.includes('| 2026-07-13 | 10 | 8 | 2 |'), 'Markdown 应含标题和趋势行')
  assert(c.includes('AI 贡献率：60.0%'), 'Markdown 应含 AI 贡献率')
})
test('weekly-ops-report: 目录不存在时自动创建', async () => {
  const fs = new MockReportFileSystem()
  await executeWeeklyOpsReport(buildWeeklyParams(new MockWeeklyDecisionRepo(), new MockWeeklyKnowledgeRepo(), fs,
    { reportsDir: '/custom/path/reports' }))
  assert(fs.mkdirCallCount === 1 && fs.lastMkdirPath === '/custom/path/reports' && fs.writeFileCallCount === 1, 'mkdir 1 次且路径正确')
})
test('weekly-ops-report: ISO 周数计算（跨年边界）', () => {
  const r1 = getISOWeekNumber(new Date(Date.UTC(2026, 0, 1)))
  assert(r1.year === 2026 && r1.week === 1, `2026-01-01 应为 2026-W01，实际 ${r1.year}-W${r1.week}`)
  const r2 = getISOWeekNumber(new Date(Date.UTC(2025, 11, 31)))
  assert(r2.year === 2026 && r2.week === 1, `2025-12-31 应为 2026-W01（跨年），实际 ${r2.year}-W${r2.week}`)
  const r3 = getISOWeekNumber(new Date(Date.UTC(2026, 6, 15)))
  assert(r3.year === 2026 && r3.week === 29, `2026-07-15 应为 2026-W29，实际 ${r3.year}-W${r3.week}`)
})

test('IPC scheduler:list 语义：注册 3 个任务后 list 返回 3 个状态', () => {
  resetScheduler()
  const sched = Scheduler.getInstance()
  sched.register({ id: 'daily-health-check', name: '每日健康检查', cron: '0 9 * * *',
    timezone: 'Asia/Shanghai', enabled: true, handler: async () => ({ success: true, summary: 'ok', durationMs: 1 }) })
  sched.register({ id: 'daily-decision-archive', name: '每日决策归档', cron: '0 18 * * *',
    timezone: 'Asia/Shanghai', enabled: true, handler: async () => ({ success: true, summary: 'ok', durationMs: 1 }) })
  sched.register({ id: 'weekly-ops-report', name: '运维周报', cron: '0 9 * * 1',
    timezone: 'Asia/Shanghai', enabled: true, handler: async () => ({ success: true, summary: 'ok', durationMs: 1 }) })
  const list = sched.list()
  assert(list.length === 3, `list 应返回 3 个任务，实际 ${list.length}`)
  const ids = list.map((s) => s.id).sort()
  assert(ids[0] === 'daily-decision-archive' && ids[1] === 'daily-health-check' && ids[2] === 'weekly-ops-report',
    '应包含 3 个受控任务 ID')
  resetScheduler()
})
test('IPC scheduler:toggle 语义：启用/禁用任务反映到 list', () => {
  resetScheduler()
  const sched = Scheduler.getInstance()
  registerSimpleTask(sched)
  sched.toggle('daily-health-check', false)
  let item = sched.list().find((s) => s.id === 'daily-health-check')!
  assert(item.enabled === false && item.nextRunAt === null, 'toggle(false) 后 enabled=false / nextRunAt=null')
  sched.toggle('daily-health-check', true)
  item = sched.list().find((s) => s.id === 'daily-health-check')!
  assert(item.enabled === true && item.nextRunAt !== null, 'toggle(true) 后 enabled=true / nextRunAt!=null')
  resetScheduler()
})
test('IPC scheduler:trigger 语义：立即触发返回 TaskResult', async () => {
  resetScheduler()
  const sched = Scheduler.getInstance()
  registerSimpleTask(sched, 'daily-health-check',
    async () => ({ success: true, summary: 'trigger via ipc', durationMs: 5 }))
  const r = await sched.trigger('daily-health-check')
  assert(r.success && r.summary === 'trigger via ipc', 'trigger 应返回正确结果')
  const item = sched.list().find((s) => s.id === 'daily-health-check')!
  assert(item.lastResult !== null && item.lastRunAt !== null, 'trigger 后 lastResult/lastRunAt 应已更新')
  resetScheduler()
})
test('IPC scheduler:status 语义：task-start/done/error 事件转发', async () => {
  resetScheduler()
  const sched = Scheduler.getInstance()
  const pushed: string[] = []
  let cur = ''
  const forward = (p: { id: string }) => {
    const s = sched.list().find((x) => x.id === p.id)
    if (s) pushed.push(`${cur}:${s.id}`)
  }
  sched.on('task-start', (p: { id: string }) => { cur = 'task-start'; forward(p) })
  sched.on('task-done', (p: { id: string }) => { cur = 'task-done'; forward(p) })
  sched.on('task-error', (p: { id: string }) => { cur = 'task-error'; forward(p) })
  registerSimpleTask(sched)
  await sched.trigger('daily-health-check')
  assert(pushed.length === 2 && pushed[0].startsWith('task-start:daily-health-check') && pushed[1].startsWith('task-done:daily-health-check'),
    `应推送 2 次（start+done），实际 ${pushed.length}`)
  pushed.length = 0
  sched.register({ id: 'daily-decision-archive', name: 'T', cron: '0 18 * * *',
    timezone: 'Asia/Shanghai', enabled: true, handler: async () => { throw new Error('模拟失败') } })
  await sched.trigger('daily-decision-archive')
  assert(pushed.length === 2 && pushed.some((s) => s.startsWith('task-error:daily-decision-archive')),
    `失败应推送 2 次（start+error），实际 ${pushed.length}`)
  resetScheduler()
})
test('IPC scheduler:trigger 不存在 taskId 返回结构化错误（不抛异常）', async () => {
  resetScheduler()
  const sched = Scheduler.getInstance()
  const ipcTrigger = async (taskId: string): Promise<TaskResult> => {
    try { return await sched.trigger(taskId as never) }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, summary: `触发任务失败: ${msg}`, error: msg, durationMs: 0 }
    }
  }
  const r = await ipcTrigger('nonexistent')
  assert(r.success === false && r.error !== undefined && r.error?.includes('任务不存在'),
    `不存在 taskId 应返回 success=false 含"任务不存在"，实际 "${r.error}"`)
  resetScheduler()
})
test('IPC scheduler:toggle 不存在 taskId 返回 null（IPC 兜底语义）', () => {
  resetScheduler()
  const sched = Scheduler.getInstance()
  const ipcToggle = (taskId: string, enabled: boolean): unknown => {
    try {
      sched.toggle(taskId as never, enabled)
      return sched.list().find((s) => s.id === taskId) ?? null
    } catch { return null }
  }
  assert(ipcToggle('nonexistent', true) === null, '不存在 taskId 应返回 null')
  resetScheduler()
})

async function main(): Promise<void> {
  console.log('🚀 Phase 6.7 综合集成测试：定时任务调度引擎全链路')
  console.log(`   测试用例总数：${tests.length}\n`)
  let passed = 0, failed = 0
  const failures: string[] = []
  for (const t of tests) {
    try { await t.fn(); passed++; console.log(`  ✅ PASS: ${t.name}`) }
    catch (e) { failed++; const msg = (e as Error).message; failures.push(`${t.name}: ${msg}`); console.log(`  ❌ FAIL: ${t.name}: ${msg}`) }
  }
  const sep = '='.repeat(60)
  console.log(`\n${sep}\n📊 测试汇总\n${sep}\n  ✅ 通过: ${passed}\n  ❌ 失败: ${failed}\n  📋 总数: ${tests.length}\n${sep}`)
  if (failed > 0) {
    console.log('\n❌ 失败用例详情：')
    for (const f of failures) console.log(`   - ${f}`)
    process.exit(1)
  }
  console.log('\n✅ 全部测试通过！Phase 6 综合集成测试覆盖完成')
  process.exit(0)
}

main().catch((err) => {
  console.error('\n💥 测试执行异常:', err)
  process.exit(2)
})
