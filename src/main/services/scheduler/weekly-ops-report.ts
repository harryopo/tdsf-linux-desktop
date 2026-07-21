/**
 * 运维周报任务（Weekly Ops Report）— Phase 6 Task 6.4
 *
 * 定时生成上周运维周报，含决策统计、趋势分析、知识沉淀、改进建议。
 * 触发时机（DEC-7 时区决策）：cron `0 9 * * 1` → 每周一 09:00 北京时间
 *
 * 设计原则：
 *   - 依赖注入：核心执行函数接受 repository / fs 参数，便于测试 mock
 *   - 错误隔离：数据库查询失败不中断整个任务，记录到 details.queryErrors
 *   - 幂等性：覆盖写入同名文件，不检查文件是否存在
 *   - 纯函数：Markdown 生成 / 改进建议 / ISO 周数 / 时间范围 都是纯函数
 *
 * @phase Phase 6 Task 6.4
 */

import type { SchedulerTask, TaskResult } from '@shared/scheduler-types'

// ============================================================================
// 周报领域类型
// ============================================================================

/** 单日决策趋势 */
export interface DailyDecisionTrend {
  date: string
  total: number
  successCount: number
  blockedCount: number
}

/** 决策周统计 */
export interface DecisionWeeklyStats {
  total: number
  successCount: number
  blockedCount: number
  avgResponseMs: number
  dailyTrend: DailyDecisionTrend[]
}

/** 知识周统计 */
export interface KnowledgeWeeklyStats {
  newEntries: number
  aiContributionRate: number
}

/** 周报数据（Markdown 生成的输入） */
export interface WeeklyReportData {
  isoYear: number
  isoWeek: number
  startDate: Date
  endDate: Date
  generatedAt: string
  decision: DecisionWeeklyStats
  knowledge: KnowledgeWeeklyStats
  suggestions: string[]
}

// ============================================================================
// 仓储接口（依赖注入）
// ============================================================================

export interface DecisionWeeklyRepository {
  getWeeklyStats(startDate: Date, endDate: Date): Promise<DecisionWeeklyStats>
}

export interface KnowledgeWeeklyRepository {
  getWeeklyStats(startDate: Date, endDate: Date): Promise<KnowledgeWeeklyStats>
}

/** 文件系统接口（便于测试 mock） */
export interface ReportFileSystem {
  mkdirRecursive(path: string): Promise<void>
  writeFile(path: string, content: string): Promise<void>
}

/** 周报执行参数 */
export interface WeeklyReportParams {
  decisionRepo: DecisionWeeklyRepository
  knowledgeRepo: KnowledgeWeeklyRepository
  fs: ReportFileSystem
  reportsDir: string
  timezone?: string
  now?: Date
}

// ============================================================================
// 常量
// ============================================================================

const WEEKLY_OPS_REPORT_CRON = '0 9 * * 1'
const DEFAULT_TIMEZONE = 'Asia/Shanghai'
const MS_PER_DAY = 24 * 60 * 60 * 1000
const MS_PER_WEEK = 7 * MS_PER_DAY
const HIGH_RISK_BLOCK_RATE_THRESHOLD = 0.2
const LOW_AI_CONTRIBUTION_THRESHOLD = 0.1
const LOW_SUCCESS_RATE_THRESHOLD = 0.8
const SLOW_RESPONSE_MS_THRESHOLD = 5000

// ============================================================================
// 纯函数：ISO 8601 周数计算
// ============================================================================

/**
 * 计算 ISO 8601 周号（基于 date 的 UTC 字段）
 * 算法：取该日期的"本周四"（ISO 周年标志），ISO 年 = 本周四年份，
 *       ISO 周 = ceil(((本周四 - 该年1月1日) / 7天) + 1)
 * 调用方需确保 date 的 UTC 字段对齐"目标时区本地日期"。
 */
export function getISOWeekNumber(date: Date): { year: number; week: number } {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  )
  const dayNum = d.getUTCDay() || 7 // 周日 0 → ISO 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum) // 调整到本周四
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const diffDays = (d.getTime() - yearStart.getTime()) / MS_PER_DAY
  return { year: d.getUTCFullYear(), week: Math.ceil((diffDays + 1) / 7) }
}

// ============================================================================
// 纯函数：上周时间范围 + 本地日期提取
// ============================================================================

/** 用 Intl 提取目标时区下的指定字段（year/month/day[/hour/minute/second]） */
function extractTimezoneFields(
  date: Date,
  timezone: string,
  withTime: boolean
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: withTime ? '2-digit' : undefined,
    minute: withTime ? '2-digit' : undefined,
    second: withTime ? '2-digit' : undefined,
  })
  const map: Record<string, string> = {}
  for (const p of fmt.formatToParts(date)) map[p.type] = p.value
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour ?? '0', 10) % 24,
    minute: parseInt(map.minute ?? '0', 10),
    second: parseInt(map.second ?? '0', 10),
  }
}

/**
 * 计算上周时间范围（目标时区下）
 *   - start：上周一 00:00:00.000（目标时区）对应的 UTC Date
 *   - end：上周日 23:59:59.999（目标时区）对应的 UTC Date
 * 算法参考 daily-decision-archive.getTodayRange 的时区偏移推导。
 */
export function getLastWeekRange(
  timezone: string = DEFAULT_TIMEZONE,
  now: Date = new Date()
): { start: Date; end: Date } {
  const { year, month, day, hour, minute, second } = extractTimezoneFields(now, timezone, true)
  const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0)
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  const offsetMs = asUtc - now.getTime()
  const todayStart = utcMidnight - offsetMs

  // 目标时区下今天是星期几（ISO: 1=Monday, 7=Sunday）
  const todayDate = new Date(Date.UTC(year, month - 1, day))
  const isoDay = todayDate.getUTCDay() === 0 ? 7 : todayDate.getUTCDay()

  const weekStartMs = todayStart - (isoDay - 1 + 7) * MS_PER_DAY
  const weekEndMs = weekStartMs + MS_PER_WEEK - 1
  return { start: new Date(weekStartMs), end: new Date(weekEndMs) }
}

/** 提取目标时区下本地日期，构造为 UTC Date（用于 ISO 周数计算） */
function extractLocalDateAsUtc(date: Date, timezone: string): Date {
  const { year, month, day } = extractTimezoneFields(date, timezone, false)
  return new Date(Date.UTC(year, month - 1, day))
}

// ============================================================================
// 纯函数：改进建议生成
// ============================================================================

/**
 * 基于统计数据生成改进建议（规则匹配）：
 *   1. 无数据 → 建议检查采集链路
 *   2. 高危拦截率 > 20% → 建议加强命令白名单审核
 *   3. 成功率 < 80% → 建议排查失败决策根因
 *   4. AI 贡献率 < 10% → 建议启用自动归档
 *   5. 平均响应时间 > 5000ms → 建议优化决策流程
 *   6. 全部正常 → 正向保持建议
 */
export function generateImprovementSuggestions(
  decision: DecisionWeeklyStats,
  knowledge: KnowledgeWeeklyStats
): string[] {
  const suggestions: string[] = []

  if (decision.total === 0 && knowledge.newEntries === 0) {
    suggestions.push('上周无决策与知识沉淀数据，建议检查数据采集链路是否正常工作')
    return suggestions
  }

  if (decision.total > 0) {
    const blockRate = decision.blockedCount / decision.total
    if (blockRate > HIGH_RISK_BLOCK_RATE_THRESHOLD) {
      suggestions.push(
        `高危拦截率达 ${(blockRate * 100).toFixed(1)}%（>20%），建议加强命令白名单审核，梳理高频被拦截命令是否需要规范化授权`
      )
    }
    const successRate = decision.successCount / decision.total
    if (successRate < LOW_SUCCESS_RATE_THRESHOLD) {
      suggestions.push(
        `决策成功率仅 ${(successRate * 100).toFixed(1)}%（<80%），建议排查失败决策的共同根因，优化决策引擎的假设生成逻辑`
      )
    }
  }

  if (knowledge.newEntries > 0 && knowledge.aiContributionRate < LOW_AI_CONTRIBUTION_THRESHOLD) {
    suggestions.push(
      `AI 贡献率仅 ${(knowledge.aiContributionRate * 100).toFixed(1)}%（<10%），建议启用每日决策自动归档任务以提升知识沉淀效率`
    )
  }

  if (decision.avgResponseMs > SLOW_RESPONSE_MS_THRESHOLD) {
    suggestions.push(
      `平均响应时间 ${Math.round(decision.avgResponseMs)}ms（>5000ms），建议优化 SSH 命令采集与 LLM 调用链路`
    )
  }

  if (suggestions.length === 0) {
    suggestions.push('各项指标正常，继续保持当前的运维策略与告警阈值配置')
  }
  return suggestions
}

// ============================================================================
// 纯函数：Markdown 周报生成
// ============================================================================

function formatDate(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 生成 Markdown 周报（格式遵循 spec Section 4） */
export function generateWeeklyReportMarkdown(data: WeeklyReportData): string {
  const weekLabel = `${data.isoYear}-W${String(data.isoWeek).padStart(2, '0')}`
  const lines: string[] = []

  lines.push(`# TDSF Linux 运维周报 · ${weekLabel}`, '')
  lines.push(`> 生成时间：${data.generatedAt}`)
  lines.push(`> 覆盖范围：${formatDate(data.startDate)} 至 ${formatDate(data.endDate)}`, '')

  // 1. 决策统计
  lines.push('## 1. 决策统计', '| 指标 | 数值 |', '|------|------|')
  const successRate =
    data.decision.total > 0
      ? ((data.decision.successCount / data.decision.total) * 100).toFixed(1) + '%'
      : 'N/A'
  lines.push(`| 总决策数 | ${data.decision.total} |`)
  lines.push(`| 成功率 | ${successRate} |`)
  lines.push(`| 高危拦截数 | ${data.decision.blockedCount} |`)
  lines.push(`| 平均响应时间 | ${Math.round(data.decision.avgResponseMs)}ms |`, '')

  // 2. 趋势分析
  lines.push('## 2. 趋势分析', '| 日期 | 决策数 | 成功数 | 高危拦截 |', '|------|--------|--------|----------|')
  if (data.decision.dailyTrend.length === 0) {
    lines.push('| (无数据) | - | - | - |')
  } else {
    for (const t of data.decision.dailyTrend) {
      lines.push(`| ${t.date} | ${t.total} | ${t.successCount} | ${t.blockedCount} |`)
    }
  }
  lines.push('')

  // 3. 知识沉淀
  lines.push('## 3. 知识沉淀')
  lines.push(`- 新增知识条目：${data.knowledge.newEntries}`)
  lines.push(`- AI 贡献率：${(data.knowledge.aiContributionRate * 100).toFixed(1)}%`, '')

  // 4. 改进建议
  lines.push('## 4. 改进建议')
  if (data.suggestions.length === 0) {
    lines.push('- (无改进建议)')
  } else {
    for (const s of data.suggestions) lines.push(`- ${s}`)
  }
  return lines.join('\n')
}

// ============================================================================
// 核心执行函数
// ============================================================================

/**
 * 执行运维周报生成（依赖注入，便于测试 mock）
 * 错误处理：数据库查询失败不中断（记录到 queryErrors）；文件写入失败返回 success=false
 */
export async function executeWeeklyOpsReport(
  params: WeeklyReportParams
): Promise<TaskResult> {
  const startedAt = Date.now()
  const {
    decisionRepo, knowledgeRepo, fs, reportsDir,
    timezone = DEFAULT_TIMEZONE, now = new Date(),
  } = params

  // 1. 计算上周时间范围 + ISO 周号
  const { start, end } = getLastWeekRange(timezone, now)
  const localDateForWeek = extractLocalDateAsUtc(start, timezone)
  const { year: isoYear, week: isoWeek } = getISOWeekNumber(localDateForWeek)

  // 2. 并行查询统计（错误隔离，使用 Promise.allSettled 并行执行避免串行阻塞）
  const [decisionRes, knowledgeRes] = await Promise.allSettled([
    decisionRepo.getWeeklyStats(start, end),
    knowledgeRepo.getWeeklyStats(start, end),
  ])

  const queryErrors: Array<{ repo: string; error: string }> = []
  if (decisionRes.status === 'rejected') {
    queryErrors.push({
      repo: 'decision',
      error: decisionRes.reason instanceof Error ? decisionRes.reason.message : String(decisionRes.reason),
    })
  }
  if (knowledgeRes.status === 'rejected') {
    queryErrors.push({
      repo: 'knowledge',
      error: knowledgeRes.reason instanceof Error ? knowledgeRes.reason.message : String(knowledgeRes.reason),
    })
  }

  const decisionStats: DecisionWeeklyStats | null =
    decisionRes.status === 'fulfilled' ? decisionRes.value : null
  const knowledgeStats: KnowledgeWeeklyStats | null =
    knowledgeRes.status === 'fulfilled' ? knowledgeRes.value : null

  // 3. 查询失败时用空数据兜底（不影响周报生成）
  const decision: DecisionWeeklyStats = decisionStats ?? {
    total: 0, successCount: 0, blockedCount: 0, avgResponseMs: 0, dailyTrend: [],
  }
  const knowledge: KnowledgeWeeklyStats = knowledgeStats ?? {
    newEntries: 0, aiContributionRate: 0,
  }

  // 4. 生成改进建议 + 周报数据
  const suggestions = generateImprovementSuggestions(decision, knowledge)
  const reportData: WeeklyReportData = {
    isoYear, isoWeek, startDate: start, endDate: end,
    generatedAt: now.toISOString(), decision, knowledge, suggestions,
  }

  // 5. 生成 Markdown + 写入文件
  const markdown = generateWeeklyReportMarkdown(reportData)
  const weekLabel = `${isoYear}-W${String(isoWeek).padStart(2, '0')}`
  const filePath = `${reportsDir}/week-${weekLabel}.md`

  try {
    await fs.mkdirRecursive(reportsDir)
    await fs.writeFile(filePath, markdown)
  } catch (e) {
    const err = e as Error
    return {
      success: false,
      summary: `周报文件写入失败: ${err.message}`,
      error: err.message,
      details: { weekLabel, filePath, queryErrors, decisionStats: decision, knowledgeStats: knowledge },
      durationMs: Date.now() - startedAt,
    }
  }

  // 6. 返回成功 TaskResult
  const queryErrorCount = queryErrors.length
  const summary =
    queryErrorCount > 0
      ? `生成 ${weekLabel} 周报（${decision.total} 决策/${knowledge.newEntries} 知识，${queryErrorCount} 个查询错误）`
      : `生成 ${weekLabel} 周报（${decision.total} 决策/${knowledge.newEntries} 知识）`

  return {
    success: true,
    summary,
    details: {
      weekLabel, filePath, isoYear, isoWeek,
      dateRange: { start: start.getTime(), end: end.getTime() },
      decisionStats: decision, knowledgeStats: knowledge, suggestions, queryErrors,
    },
    durationMs: Date.now() - startedAt,
  }
}

// ============================================================================
// 默认 ReportFileSystem 实现（Node.js fs/promises）
// ============================================================================

class NodeReportFileSystem implements ReportFileSystem {
  async mkdirRecursive(path: string): Promise<void> {
    const fs = await import('node:fs/promises')
    await fs.mkdir(path, { recursive: true })
  }
  async writeFile(path: string, content: string): Promise<void> {
    const fs = await import('node:fs/promises')
    await fs.writeFile(path, content, 'utf8')
  }
}

// ============================================================================
// 占位仓储（运行时未注入真实仓储时使用）+ 报告目录解析
// ============================================================================

class PlaceholderDecisionRepo implements DecisionWeeklyRepository {
  async getWeeklyStats(): Promise<DecisionWeeklyStats> {
    console.warn(
      '[weekly-ops-report] 决策仓储未注入，返回空统计。请使用 createWeeklyOpsReportTaskWithRepos 注入真实实现'
    )
    return { total: 0, successCount: 0, blockedCount: 0, avgResponseMs: 0, dailyTrend: [] }
  }
}

class PlaceholderKnowledgeRepo implements KnowledgeWeeklyRepository {
  async getWeeklyStats(): Promise<KnowledgeWeeklyStats> {
    console.warn(
      '[weekly-ops-report] 知识仓储未注入，返回空统计。请使用 createWeeklyOpsReportTaskWithRepos 注入真实实现'
    )
    return { newEntries: 0, aiContributionRate: 0 }
  }
}

/** 解析报告目录：electron 可用时用 app.getPath('userData') + '/reports'，否则降级到 os.tmpdir/tdsf-reports */
async function resolveReportsDir(): Promise<string> {
  try {
    const electron = await import('electron')
    return `${electron.app.getPath('userData')}/reports`
  } catch {
    const os = await import('node:os')
    const path = await import('node:path')
    return path.join(os.tmpdir(), 'tdsf-reports')
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建运维周报任务（占位版）
 * handler 使用占位仓储（返回空数据 + console.warn）+ 默认 NodeReportFileSystem。
 * 真实运行时请使用 createWeeklyOpsReportTaskWithRepos 注入真实仓储。
 */
export function createWeeklyOpsReportTask(): SchedulerTask {
  return {
    id: 'weekly-ops-report',
    name: '运维周报',
    cron: WEEKLY_OPS_REPORT_CRON,
    timezone: DEFAULT_TIMEZONE,
    enabled: true,
    handler: async () => {
      const reportsDir = await resolveReportsDir()
      return executeWeeklyOpsReport({
        decisionRepo: new PlaceholderDecisionRepo(),
        knowledgeRepo: new PlaceholderKnowledgeRepo(),
        fs: new NodeReportFileSystem(),
        reportsDir,
        timezone: DEFAULT_TIMEZONE,
      })
    },
  }
}

/** 创建带仓储注入的运维周报任务（用于测试 / Phase 7 真实适配器） */
export function createWeeklyOpsReportTaskWithRepos(
  decisionRepo: DecisionWeeklyRepository,
  knowledgeRepo: KnowledgeWeeklyRepository,
  fs?: ReportFileSystem,
  reportsDir?: string
): SchedulerTask {
  return {
    id: 'weekly-ops-report',
    name: '运维周报',
    cron: WEEKLY_OPS_REPORT_CRON,
    timezone: DEFAULT_TIMEZONE,
    enabled: true,
    handler: async () => {
      const dir = reportsDir ?? (await resolveReportsDir())
      return executeWeeklyOpsReport({
        decisionRepo,
        knowledgeRepo,
        fs: fs ?? new NodeReportFileSystem(),
        reportsDir: dir,
        timezone: DEFAULT_TIMEZONE,
      })
    },
  }
}
