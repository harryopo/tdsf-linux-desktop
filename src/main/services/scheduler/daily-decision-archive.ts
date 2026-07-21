/**
 * 每日决策归档任务（Daily Decision Archive）
 *
 * 定时归档当天成功的决策记录到知识库，实现"决策 → 知识"的自动沉淀闭环。
 *
 * 触发时机（DEC-7 时区决策）：
 *   cron `0 18 * * *` → 每日 18:00 北京时间
 *
 * 归档流程：
 *   1. 查询时间范围内已成功的决策（由 repository 实现方定义"成功"语义）
 *   2. 对每条决策幂等检查（relatedDecisionId 是否已存在）
 *   3. 转换为知识条目并写入知识库（事务包裹，保证原子性）
 *   4. 返回 TaskResult 摘要（归档数 / 知识库总数 / AI 贡献率）
 *
 * 设计原则：
 *   - 依赖注入：核心执行函数接受 repository 参数，便于测试 mock
 *   - 幂等性：同一决策不被重复归档（检查 relatedDecisionId）
 *   - 事务包裹：使用 repository 提供的事务接口保证原子性
 *   - 接口抽象：定义独立的归档领域接口，不依赖具体 repository 实现
 *
 * 模型适配说明（Phase 7 待补齐）：
 *   现有 DecisionCard 无 title/riskLevel/summary/verification 字段，
 *   现有 KnowledgeEntry 无 source/relatedDecisionId 字段。
 *   本模块定义独立的 ArchivedDecision / ArchivedKnowledgeEntry 领域模型，
 *   由 Phase 7 的适配器负责 DecisionCard ↔ ArchivedDecision、
 *   KnowledgeEntry ↔ ArchivedKnowledgeEntry 的映射。
 *
 * @phase Phase 6 Task 6.3
 */

import type { RiskLevel } from '@shared/models'
import type { SchedulerTask, TaskResult } from '@shared/scheduler-types'

// ============================================================================
// 归档领域类型
// ============================================================================

/**
 * 已归档的决策（领域模型）
 *
 * 从 DecisionCard 抽象而来，只暴露归档需要的字段。
 * - `title` 通常映射自 `DecisionCard.problem`
 * - `riskLevel` 映射自 `DecisionCard.risk.level`
 * - `verification` 由适配器从 `fixDescription` 或 `status='verified'` 推断
 */
export interface ArchivedDecision {
  /** 决策 ID（唯一） */
  id: string
  /** 决策标题（通常对应 DecisionCard.problem） */
  title: string
  /** 决策摘要（问题 + 假设概述） */
  summary: string
  /** 根因假设 */
  hypothesis: string
  /** 修复命令 */
  fixCommand: string
  /** 修复说明 */
  fixDescription: string
  /** 回滚命令（可选） */
  rollbackCommand?: string
  /** 风险等级 */
  riskLevel: RiskLevel
  /** 决策状态（由适配器填充，如 'executed' / 'verified'） */
  status: string
  /** 时间戳（epoch ms） */
  timestamp: number
  /** 验证结论（可选，由适配器推断） */
  verification?: string
}

/**
 * 已归档的知识条目（领域模型）
 *
 * 从 KnowledgeEntry 抽象而来，增加 `source` / `relatedDecisionId` 归档元数据。
 * 现有 KnowledgeEntry 无此二字段，适配器需将其编码到 tags / keywords 中
 * （如 `source:auto-archive`、`decision:{id}`）以保持向后兼容。
 */
export interface ArchivedKnowledgeEntry {
  /** 知识条目 ID（唯一） */
  id: string
  /** 标题（归档格式：`[自动归档] ${decision.title}`） */
  title: string
  /** 内容（决策摘要 + 假设 + 执行命令 + 验证结论） */
  content: string
  /** 来源标识（auto-archive = 自动归档） */
  source: 'auto-archive' | 'manual' | 'imported'
  /** 标签 */
  tags: string[]
  /** 关联的决策 ID（用于幂等性检查） */
  relatedDecisionId: string
  /** 创建时间（epoch ms） */
  createdAt: number
}

// ============================================================================
// 仓储接口（依赖注入）
// ============================================================================

/**
 * 决策仓储接口（归档场景）
 *
 * 只暴露归档需要的查询方法，由 `DecisionRepository` 适配实现。
 * 真实适配器在 Phase 7 补齐。
 */
export interface ArchiveDecisionRepository {
  /**
   * 查询指定时间范围内已成功的决策
   *
   * "成功"由实现方定义（推荐 status IN ('executed', 'verified')）。
   * 返回结果按时间升序排列。
   *
   * @param dateRange 时间范围 [start, end]（epoch ms）
   * @returns 决策数组
   */
  querySuccessfulDecisions(dateRange: {
    start: number
    end: number
  }): Promise<ArchivedDecision[]>

  /**
   * 检查指定 ID 的决策是否存在
   * @param id 决策 ID
   */
  existsById(id: string): Promise<boolean>
}

/**
 * 知识仓储接口（归档场景）
 *
 * 只暴露归档需要的方法，由 `KnowledgeRepository` 适配实现。
 * 真实适配器在 Phase 7 补齐。
 */
export interface ArchiveKnowledgeRepository {
  /**
   * 根据关联决策 ID 查找已归档的知识条目（幂等性检查）
   * @param relatedDecisionId 关联决策 ID
   * @returns 已存在的知识条目，无则返回 null
   */
  findByRelatedDecisionId(
    relatedDecisionId: string
  ): Promise<ArchivedKnowledgeEntry | null>

  /**
   * 保存知识条目
   * @param entry 知识条目
   */
  save(entry: ArchivedKnowledgeEntry): Promise<void>

  /**
   * 统计知识库总条目数
   */
  count(): Promise<number>

  /**
   * 按来源统计条目数
   * @param source 来源标识（如 'auto-archive'）
   */
  countBySource(source: string): Promise<number>

  /**
   * AI 贡献率计数器 +1
   *
   * 用于统计 AI 自动归档贡献的知识条目数（可写入 settings 表或内存计数）。
   */
  incrementAiContribution(): Promise<void>

  /**
   * 在事务中执行操作（保证原子性）
   *
   * 真实实现使用 better-sqlite3 transaction；
   * mock 实现可直接执行 fn（无事务语义，但保证接口一致）。
   *
   * @param fn 事务内操作
   * @returns 操作返回值
   */
  runInTransaction<T>(fn: () => Promise<T>): Promise<T>
}

/**
 * 归档任务执行参数
 */
export interface ArchiveParams {
  /** 决策仓储 */
  decisionRepo: ArchiveDecisionRepository
  /** 知识仓储 */
  knowledgeRepo: ArchiveKnowledgeRepository
  /** 归档时间范围 [start, end]（epoch ms） */
  dateRange: { start: number; end: number }
}

// ============================================================================
// 常量
// ============================================================================

/** cron 表达式：每日 18:00 北京时间 */
const DAILY_DECISION_ARCHIVE_CRON = '0 18 * * *'

/** 默认时区（DEC-7：Asia/Shanghai） */
const DEFAULT_TIMEZONE = 'Asia/Shanghai'

/** 归档来源标识 */
const ARCHIVE_SOURCE = 'auto-archive' as const

/** 归档标签 */
const ARCHIVE_TAG = 'auto-archived'
const DECISION_TAG = 'decision'

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 将决策转换为知识条目
 *
 * 字段映射：
 *   - `title`: `[自动归档] ${decision.title}`
 *   - `content`: 决策摘要 + 假设 + 执行命令 + 验证结论
 *   - `source`: 'auto-archive'
 *   - `tags`: ['auto-archived', 'decision', riskLevel]
 *   - `relatedDecisionId`: decision.id
 *
 * @param decision 决策
 * @param now 当前时间戳（用于生成唯一 ID）
 * @returns 知识条目
 */
function decisionToKnowledge(
  decision: ArchivedDecision,
  now: number
): ArchivedKnowledgeEntry {
  return {
    id: `archive-${decision.id}-${now}`,
    title: `[自动归档] ${decision.title}`,
    content: buildKnowledgeContent(decision),
    source: ARCHIVE_SOURCE,
    tags: [ARCHIVE_TAG, DECISION_TAG, decision.riskLevel],
    relatedDecisionId: decision.id,
    createdAt: now,
  }
}

/**
 * 构建知识条目内容（Markdown 结构）
 *
 * 结构：
 *   ## 决策摘要
 *   ## 根因假设
 *   ## 执行命令（代码块）
 *   ## 修复说明（可选）
 *   ## 回滚命令（可选，代码块）
 *   ## 验证结论（可选）
 */
function buildKnowledgeContent(decision: ArchivedDecision): string {
  const sections: string[] = []

  sections.push('## 决策摘要', decision.summary)
  sections.push('## 根因假设', decision.hypothesis)
  sections.push('## 执行命令', '```', decision.fixCommand, '```')

  if (decision.fixDescription) {
    sections.push('## 修复说明', decision.fixDescription)
  }
  if (decision.rollbackCommand) {
    sections.push('## 回滚命令', '```', decision.rollbackCommand, '```')
  }
  if (decision.verification) {
    sections.push('## 验证结论', decision.verification)
  }

  return sections.join('\n\n')
}

/**
 * 计算指定时区下当天 00:00 到当前时间的时间范围
 *
 * 算法：
 *   1. 用 Intl.DateTimeFormat 提取目标时区的年月日 + 时分秒
 *   2. `utcMidnight` = 把"目标时区 00:00"当作 UTC 解释的时间戳
 *   3. `asUtc` = 把"目标时区当前时间"当作 UTC 解释的时间戳
 *   4. `offsetMs = asUtc - now.getTime()`（东八区为 +28800000）
 *   5. `start = utcMidnight - offsetMs`（目标时区当天 00:00 的真实 UTC 时间戳）
 *
 * @param now 当前 UTC 时间
 * @param timezone IANA 时区（如 Asia/Shanghai）
 * @returns { start, end } epoch ms
 */
function getTodayRange(
  now: Date,
  timezone: string
): { start: number; end: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = fmt.formatToParts(now)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value

  const year = parseInt(map.year, 10)
  const month = parseInt(map.month, 10)
  const day = parseInt(map.day, 10)
  const hour = parseInt(map.hour, 10) % 24
  const minute = parseInt(map.minute, 10)
  const second = parseInt(map.second, 10)

  const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0)
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  const offsetMs = asUtc - now.getTime()
  const start = utcMidnight - offsetMs

  return { start, end: now.getTime() }
}

// ============================================================================
// 核心执行函数
// ============================================================================

/**
 * 执行每日决策归档
 *
 * 流程：
 *   1. 查询时间范围内已成功的决策
 *   2. 无决策时返回 success + "无决策需要归档"
 *   3. 事务包裹：对每条决策幂等检查 + 转换 + 保存
 *   4. 统计归档数、知识库总数、AI 贡献率
 *   5. 返回 TaskResult
 *
 * 幂等性：归档前检查 `relatedDecisionId` 是否已存在，已存在则跳过。
 * 异常处理：任何异常都转换为 `success: false` 的 TaskResult，不抛出。
 *
 * @param params 归档参数（含 repository + dateRange）
 * @returns 任务执行结果
 */
export async function runDailyDecisionArchive(
  params: ArchiveParams
): Promise<TaskResult> {
  const { decisionRepo, knowledgeRepo, dateRange } = params
  const startedAt = Date.now()

  try {
    // 1. 查询时间范围内已成功的决策
    const decisions = await decisionRepo.querySuccessfulDecisions(dateRange)

    if (decisions.length === 0) {
      return {
        success: true,
        summary: '无决策需要归档',
        details: {
          archivedCount: 0,
          totalDecisions: 0,
          skippedCount: 0,
          dateRange,
        },
        durationMs: Date.now() - startedAt,
      }
    }

    // 2. 事务包裹归档过程（保证原子性）
    const archiveResult = await knowledgeRepo.runInTransaction(async () => {
      let archivedCount = 0
      let skippedCount = 0
      const archivedIds: string[] = []

      for (const decision of decisions) {
        // 幂等性检查：relatedDecisionId 是否已存在
        const existing = await knowledgeRepo.findByRelatedDecisionId(
          decision.id
        )
        if (existing) {
          skippedCount++
          continue
        }

        // 转换 + 保存
        const knowledge = decisionToKnowledge(decision, startedAt)
        await knowledgeRepo.save(knowledge)
        await knowledgeRepo.incrementAiContribution()
        archivedCount++
        archivedIds.push(decision.id)
      }

      return { archivedCount, skippedCount, archivedIds }
    })

    // 3. 统计摘要
    const totalKnowledge = await knowledgeRepo.count()
    const aiArchivedCount = await knowledgeRepo.countBySource(ARCHIVE_SOURCE)
    const aiContributionRate =
      totalKnowledge > 0
        ? Number((aiArchivedCount / totalKnowledge).toFixed(4))
        : 0

    const summary =
      archiveResult.archivedCount > 0
        ? `归档 ${archiveResult.archivedCount} 条决策，跳过 ${archiveResult.skippedCount} 条已归档`
        : `当日 ${decisions.length} 条决策均已归档，无新增`

    return {
      success: true,
      summary,
      details: {
        archivedCount: archiveResult.archivedCount,
        skippedCount: archiveResult.skippedCount,
        totalDecisions: decisions.length,
        totalKnowledge,
        aiArchivedCount,
        aiContributionRate,
        archivedDecisionIds: archiveResult.archivedIds,
        dateRange,
      },
      durationMs: Date.now() - startedAt,
    }
  } catch (e) {
    const err = e as Error
    return {
      success: false,
      summary: `归档失败: ${err.message}`,
      error: err.message,
      details: {
        dateRange,
        errorName: err.name,
      },
      durationMs: Date.now() - startedAt,
    }
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建每日决策归档任务定义（占位版）
 *
 * 返回 SchedulerTask，但 handler 未注入 repository，调用时会抛错。
 *
 * 适用场景：
 *   - 仅需任务定义元数据（id / cron / name）时使用（如注册到调度引擎列表）
 *   - 真实运行时请使用 `createDailyDecisionArchiveTaskWithRepos`
 *
 * @returns SchedulerTask 定义（cron = `0 18 * * *`，timezone = Asia/Shanghai）
 */
export function createDailyDecisionArchiveTask(): SchedulerTask {
  return {
    id: 'daily-decision-archive',
    name: '每日决策归档',
    cron: DAILY_DECISION_ARCHIVE_CRON,
    timezone: DEFAULT_TIMEZONE,
    enabled: true,
    handler: async () => {
      // TODO Phase 7：注入真实 repository 实现
      // 当前为占位 handler，真实使用时通过 createDailyDecisionArchiveTaskWithRepos 注入
      return {
        success: false,
        summary: '归档任务未注入 repository',
        error:
          '[daily-decision-archive] 默认 handler 未注入 repository，请使用 createDailyDecisionArchiveTaskWithRepos(decisionRepo, knowledgeRepo) 创建任务',
        durationMs: 0,
      }
    },
  }
}

/**
 * 创建带 repository 注入的每日决策归档任务
 *
 * 在 Phase 7 repository 适配器就绪后，使用此工厂创建可运行的任务。
 * handler 内部自动计算当天 00:00 到当前时间的时间范围（北京时间）。
 *
 * @param decisionRepo 决策仓储
 * @param knowledgeRepo 知识仓储
 * @returns SchedulerTask（handler 已注入 repository）
 */
export function createDailyDecisionArchiveTaskWithRepos(
  decisionRepo: ArchiveDecisionRepository,
  knowledgeRepo: ArchiveKnowledgeRepository
): SchedulerTask {
  return {
    id: 'daily-decision-archive',
    name: '每日决策归档',
    cron: DAILY_DECISION_ARCHIVE_CRON,
    timezone: DEFAULT_TIMEZONE,
    enabled: true,
    handler: async () => {
      const now = new Date()
      const { start, end } = getTodayRange(now, DEFAULT_TIMEZONE)
      return runDailyDecisionArchive({
        decisionRepo,
        knowledgeRepo,
        dateRange: { start, end },
      })
    },
  }
}
