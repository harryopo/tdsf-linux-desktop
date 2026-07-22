/**
 * 任务记忆沉淀服务（P2-I）
 *
 * 在 Task Protocol step 14 完成后自动沉淀任务关键信息到知识库 + Markdown，
 * 实现"任务完成 → 知识"的即时沉淀闭环（v0.9.3 §3.5 v1.2 方向提前实施）。
 *
 * 沉淀字段：
 * - 标识：sedimentId (LRN-YYYYMMDD-NNN) / taskId / subagentName / parentSessionId
 * - 时间：timestamp / totalDurationMs / startTime
 * - 输入：userQuery (ctx.input 前 200 字符)
 * - 输出：output (截断 2000 字符)
 * - 资源：providerId / model / usage (tokens + cost)
 * - 状态：allSuccess / failedSteps / mode
 * - 经验：lessons[] (启发式提取，无 LLM 依赖；LLM 反思留给 v1.6 集成)
 * - 上下文：attention (AttentionTracker.getCurrent() 快照)
 * - 检索：keywords[] / tags[] (从 output + attention 自动提取)
 *
 * 双轨写入：
 *   1. 知识库（KnowledgeRepository.add，type='incident_case'，source tag 标 'auto-sediment'）
 *   2. Markdown（userData/task-sediment/learnings.md，LRN-YYYYMMDD-NNN 格式追加）
 *
 * 幂等性：
 *   - 知识库 id = `sediment-{taskId}`（同一 taskId 重复沉淀直接 skip）
 *   - Markdown 不做幂等（追加模式，靠 LRN 编号时序区分）
 *
 * 错误降级链：
 *   知识库写入失败 → 仅写 Markdown；Markdown 失败 → 仅日志；日志失败 → 静默吞错
 *   沉淀失败绝不影响主任务返回（executeTaskProtocol finally 中调用，try-catch 包裹）
 *
 * AttentionTracker 钩子：
 *   沉淀成功后调用 reset() 归档当前 attention（补上一直空挂的 reset 调用点）
 *
 * 方案书依据：v0.9.3 §3.5 记忆与进化层（v1.2 postmortem 方向 v2.x 提前实施）
 * 复用清单（A8 避免重复造轮子）：
 *   - KnowledgeRepository（src/main/services/db/knowledge-repo.ts）：知识库 CRUD
 *   - AttentionTracker（src/main/core/agent/attention-tracker.ts）：单例 + reset()
 *   - DatabaseManager（src/main/services/db/database.ts）：单例获取 db
 *   - logger（src/main/services/log/logger.ts）：子日志器
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { app } from 'electron'
import type { KnowledgeEntry } from '@shared/models'
import type { TaskProtocolContext, StepResult } from '../agent/subagents/task-protocol-types'
import { KnowledgeRepository } from '../../services/db/knowledge-repo'
import { DatabaseManager } from '../../services/db/database'
import { AttentionTracker } from '../agent/attention-tracker'
import { logger } from '../../services/log/logger'

// ============================================================================
// 常量
// ============================================================================

/** Markdown 沉淀目录名（位于 userData 下） */
const SEDIMENT_DIRNAME = 'task-sediment'

/** Markdown 沉淀文件名 */
const SEDIMENT_FILENAME = 'learnings.md'

/** output 字段截断长度（避免知识库条目过大） */
const OUTPUT_TRUNCATE_LENGTH = 2000

/** userQuery 字段截断长度 */
const QUERY_TRUNCATE_LENGTH = 200

/** 启发式错误指示词（用于 lessons 提取，与 dispatcher.ts 保持一致） */
const ERROR_INDICATORS = /error|fail|exception|timeout|refused|denied|错误|失败|超时|拒绝/i

/** 子日志器（自动注入模块前缀） */
const log = logger.child('MEMORY.SEDIMENT')

// ============================================================================
// 类型
// ============================================================================

/**
 * 沉淀结果
 */
export interface TaskSedimentOutput {
  /** 沉淀 ID（LRN-YYYYMMDD-NNN 格式） */
  sedimentId: string
  /** 写入位置 */
  writtenTo: 'knowledge_repo' | 'markdown_only' | 'skipped'
  /** 跳过原因（writtenTo='skipped' 时填充） */
  reason?: string
  /** 提取的经验教训 */
  lessons: string[]
  /** attention 是否被归档（reset 调用成功） */
  attentionArchived: boolean
}

// ============================================================================
// LRN 编号生成
// ============================================================================

/**
 * 生成 LRN-YYYYMMDD-NNN 编号
 *
 * 同一进程内递增 NNN（不跨进程持久化，重启从 001 开始）。
 * 跨进程幂等性靠 KnowledgeRepository 的 id (`sediment-{taskId}`) 保证。
 *
 * @returns LRN 编号字符串
 */
function generateSedimentId(): string {
  const now = new Date()
  const yyyy = now.getFullYear().toString()
  const mm = (now.getMonth() + 1).toString().padStart(2, '0')
  const dd = now.getDate().toString().padStart(2, '0')
  const seq = (sedimentSeqCounter++).toString().padStart(3, '0')
  return `LRN-${yyyy}${mm}${dd}-${seq}`
}

/** 同进程内 LRN 编号计数器（重启从 0 开始） */
let sedimentSeqCounter = 0

// ============================================================================
// 启发式 lessons 提取
// ============================================================================

/**
 * 从 TaskProtocolContext 启发式提取经验教训
 *
 * 不依赖 LLM（LLM 反思留给 v1.6 集成 reflectOnResults），
 * 基于 completedSteps 成败 + output 错误指示词 + failedSteps 列表生成可读 lessons。
 *
 * @param ctx 任务协议上下文
 * @returns lessons 数组（最多 5 条）
 */
function extractLessonsHeuristic(ctx: TaskProtocolContext): string[] {
  const lessons: string[] = []
  const completedSteps = ctx.completedSteps ?? []
  const failedSteps = completedSteps.filter((s: StepResult) => !s.success)
  const successRate =
    completedSteps.length > 0
      ? (completedSteps.length - failedSteps.length) / completedSteps.length
      : 0

  // 1. 失败步骤
  if (failedSteps.length > 0) {
    const names = failedSteps.map((s) => s.step).join(', ')
    lessons.push(`失败步骤：${names}（成功率 ${(successRate * 100).toFixed(0)}%）`)
  }

  // 2. output 中的错误指示词
  const output = ctx.output ?? ''
  if (typeof output === 'string' && ERROR_INDICATORS.test(output)) {
    lessons.push('输出中包含错误指示词，建议排查')
  }

  // 3. 超时阈值
  const totalDurationMs =
    ctx.startTime !== undefined ? Date.now() - ctx.startTime : 0
  if (totalDurationMs > 60_000) {
    lessons.push(`任务耗时较长（${(totalDurationMs / 1000).toFixed(1)}s），考虑优化或拆分`)
  }

  // 4. token 消耗
  if (ctx.usage && ctx.usage.totalTokens > 10_000) {
    lessons.push(
      `Token 消耗较高（input=${ctx.usage.inputTokens}, output=${ctx.usage.outputTokens}）`
    )
  }

  // 5. attention 关联
  const attention = ctx.attention
  if (attention?.errors && attention.errors.length > 0) {
    lessons.push(`涉及错误：${attention.errors.slice(0, 3).join('; ')}`)
  }

  return lessons.slice(0, 5)
}

// ============================================================================
// 关键词/标签提取
// ============================================================================

/**
 * 从 ctx 提取 keywords（用于知识库 Jaccard 搜索）
 *
 * 来源：subagentName / mode / failedSteps / attention.files 基名 / output 高频词
 *
 * @param ctx 任务协议上下文
 * @returns 关键词数组
 */
function extractKeywords(ctx: TaskProtocolContext): string[] {
  const keywords = new Set<string>()

  // 1. subagentName + mode
  if (ctx.subagentName) keywords.add(ctx.subagentName)
  if (ctx.mode) keywords.add(ctx.mode)

  // 2. 失败步骤名
  for (const s of ctx.completedSteps) {
    if (!s.success) keywords.add(s.step)
  }

  // 3. attention.files 基名（不含路径）
  if (ctx.attention?.files) {
    for (const f of ctx.attention.files) {
      const base = path.basename(f).split('.')[0]
      if (base) keywords.add(base.toLowerCase())
    }
  }

  // 4. attention.commands 主命令（第一个 token）
  if (ctx.attention?.commands) {
    for (const c of ctx.attention.commands) {
      const firstToken = c.trim().split(/\s+/)[0]
      if (firstToken && firstToken.length > 1) keywords.add(firstToken.toLowerCase())
    }
  }

  // 5. output 前 200 字符中长度 >= 3 的英文词
  const output = typeof ctx.output === 'string' ? ctx.output.slice(0, 200) : ''
  const tokens = output.toLowerCase().split(/[^a-z0-9_]+/i).filter((t) => t.length >= 3)
  for (const t of tokens.slice(0, 10)) {
    keywords.add(t)
  }

  return Array.from(keywords).slice(0, 20)
}

/**
 * 从 ctx 提取 tags（用于知识库分类）
 *
 * @param ctx 任务协议上下文
 * @returns 标签数组
 */
function extractTags(ctx: TaskProtocolContext): string[] {
  const tags = ['auto-sediment']
  if (ctx.subagentName) tags.push(`subagent:${ctx.subagentName}`)
  if (ctx.mode) tags.push(`mode:${ctx.mode}`)
  if (ctx.parentSessionId) tags.push('inherited')
  const allSuccess = ctx.completedSteps.every((s) => s.success)
  tags.push(allSuccess ? 'success' : 'failure')
  return tags
}

// ============================================================================
// 知识库写入
// ============================================================================

/**
 * 构建知识库条目（incident_case 类型）
 *
 * @param ctx 任务协议上下文
 * @param sedimentId 沉淀 ID
 * @param lessons 启发式提取的 lessons
 * @returns KnowledgeEntry
 */
function buildKnowledgeEntry(
  ctx: TaskProtocolContext,
  sedimentId: string,
  lessons: string[]
): KnowledgeEntry {
  const now = Date.now()
  const allSuccess = ctx.completedSteps.every((s) => s.success)
  const failedSteps = ctx.completedSteps
    .filter((s) => !s.success)
    .map((s) => s.step)

  // problem 字段：subagent + 输入摘要
  const inputSummary =
    typeof ctx.input === 'string'
      ? ctx.input.slice(0, QUERY_TRUNCATE_LENGTH)
      : ctx.input !== undefined
        ? JSON.stringify(ctx.input).slice(0, QUERY_TRUNCATE_LENGTH)
        : '(无输入)'

  const problem = `[${ctx.subagentName}] ${inputSummary}`

  // rootCause 字段：失败步骤 + lessons
  const rootCauseParts: string[] = []
  if (failedSteps.length > 0) {
    rootCauseParts.push(`失败步骤：${failedSteps.join(', ')}`)
  }
  if (lessons.length > 0) {
    rootCauseParts.push(`经验：${lessons.join(' | ')}`)
  }

  // commands 字段：attention.commands
  const commands = ctx.attention?.commands ?? []

  // verification 字段：成功状态 + token 使用
  const verificationParts: string[] = [
    `状态：${allSuccess ? '成功' : '失败'}（${ctx.completedSteps.length} 步）`,
  ]
  if (ctx.usage) {
    verificationParts.push(
      `Token：input=${ctx.usage.inputTokens}, output=${ctx.usage.outputTokens}`
    )
    if (ctx.usage.cost !== undefined) {
      verificationParts.push(`成本：$${ctx.usage.cost.toFixed(4)}`)
    }
  }

  return {
    id: `sediment-${ctx.taskId}`,
    type: 'incident_case',
    title: `[自动沉淀] ${ctx.subagentName} - ${sedimentId}`,
    problem,
    rootCause: rootCauseParts.length > 0 ? rootCauseParts.join('\n') : undefined,
    commands,
    verification: verificationParts.join('\n'),
    keywords: extractKeywords(ctx),
    tags: extractTags(ctx),
    successRate: allSuccess ? 1.0 : 0.0,
    useCount: 1,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * 写入知识库（幂等：同一 taskId 重复沉淀直接 skip）
 *
 * @param entry 知识库条目
 * @returns true=写入成功，false=已存在或写入失败
 */
async function writeToKnowledgeRepo(entry: KnowledgeEntry): Promise<boolean> {
  try {
    const db = DatabaseManager.getInstance()
    const repo = new KnowledgeRepository(db)

    // 幂等检查：同一 taskId 已存在 → skip
    const existing = repo.getById(entry.id)
    if (existing) {
      log.debug('知识库条目已存在，跳过', { id: entry.id, taskId: entry.id })
      return false
    }

    const success = repo.add(entry)
    if (!success) {
      log.warn('KnowledgeRepository.add 返回 false', { id: entry.id })
      return false
    }

    log.info('知识库沉淀成功', { id: entry.id, title: entry.title })
    return true
  } catch (err) {
    log.warn('知识库沉淀失败（DatabaseManager 未就绪或写入异常）', {
      id: entry.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

// ============================================================================
// Markdown 写入
// ============================================================================

/**
 * 获取 Markdown 沉淀目录
 *
 * 优先级：
 * 1. app.getPath('userData')/task-sediment/（Electron 生产环境）
 * 2. ~/.tdsf-linux/task-sediment/（CLI / 测试环境）
 */
function getSedimentDir(): string {
  try {
    // Electron 环境：app.getPath('userData') 可用
    // 非 Electron 环境（如测试）：electron 模块被 vi.mock，app.getPath 返回 mock 路径
    // 真正的 非 Electron 环境下 app 为 undefined → 抛错 → 走 catch
    const userData = app.getPath('userData')
    return path.join(userData, SEDIMENT_DIRNAME)
  } catch {
    // 非 Electron 环境（CLI / 测试降级）
    return path.join(os.homedir(), '.tdsf-linux', SEDIMENT_DIRNAME)
  }
}

/**
 * 构建 Markdown 条目（LRN-YYYYMMDD-NNN 格式）
 *
 * @param ctx 任务协议上下文
 * @param sedimentId 沉淀 ID
 * @param lessons 启发式提取的 lessons
 * @returns Markdown 字符串
 */
function buildMarkdownEntry(
  ctx: TaskProtocolContext,
  sedimentId: string,
  lessons: string[]
): string {
  const now = new Date()
  const ts = now.toISOString()
  const allSuccess = ctx.completedSteps.every((s) => s.success)
  const failedSteps = ctx.completedSteps
    .filter((s) => !s.success)
    .map((s) => s.step)

  const totalDurationMs =
    ctx.startTime !== undefined ? Date.now() - ctx.startTime : 0

  const inputSummary =
    typeof ctx.input === 'string'
      ? ctx.input.slice(0, QUERY_TRUNCATE_LENGTH)
      : ctx.input !== undefined
        ? JSON.stringify(ctx.input).slice(0, QUERY_TRUNCATE_LENGTH)
        : '(无输入)'

  const output =
    typeof ctx.output === 'string'
      ? ctx.output.slice(0, OUTPUT_TRUNCATE_LENGTH)
      : '(无输出)'

  const usage = ctx.usage
    ? `input=${ctx.usage.inputTokens}, output=${ctx.usage.outputTokens}, cost=$${(ctx.usage.cost ?? 0).toFixed(4)}`
    : '(无 usage)'

  const attention = ctx.attention
    ? [
        ctx.attention.files?.length ? `files: ${ctx.attention.files.join(', ')}` : '',
        ctx.attention.commands?.length
          ? `commands: ${ctx.attention.commands.join(', ')}`
          : '',
        ctx.attention.errors?.length ? `errors: ${ctx.attention.errors.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '(无 attention)'

  const lessonsText = lessons.length > 0 ? lessons.map((l) => `- ${l}`).join('\n') : '- (无)'

  return `## ${sedimentId} · ${ctx.subagentName} - ${allSuccess ? '成功' : '失败'}

- **时间**：${ts}
- **任务 ID**：${ctx.taskId}
- **父会话**：${ctx.parentSessionId ?? '(无)'}
- **模式**：${ctx.mode ?? '(默认)'}
- **总耗时**：${(totalDurationMs / 1000).toFixed(2)}s
- **步骤数**：${ctx.completedSteps.length}（失败：${failedSteps.length || 0}）
${failedSteps.length > 0 ? `- **失败步骤**：${failedSteps.join(', ')}` : ''}
- **Provider/Model**：${ctx.providerConfig?.id ?? '(无)'} / ${ctx.modelInstance?.resolvedModel ?? ctx.providerConfig?.model ?? '(无)'}

### 输入
\`\`\`
${inputSummary}
\`\`\`

### 输出（截断 ${OUTPUT_TRUNCATE_LENGTH} 字符）
\`\`\`
${output}
\`\`\`

### 资源消耗
${usage}

### Attention 快照
\`\`\`
${attention}
\`\`\`

### 经验教训
${lessonsText}

---
`
}

/**
 * 追加写入 Markdown 沉淀文件
 *
 * 文件不存在时自动创建（含标题）。
 *
 * @param markdownEntry Markdown 条目
 * @returns true=写入成功
 */
async function appendToMarkdown(markdownEntry: string): Promise<boolean> {
  try {
    const dir = getSedimentDir()
    await fs.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, SEDIMENT_FILENAME)

    // 文件不存在时写入标题
    try {
      await fs.access(filePath)
    } catch {
      const header = `# 任务记忆沉淀（自动生成）

> 此文件由 Task Protocol step 14 之后的 sedimentTaskMemory 自动追加。
> 编号格式：LRN-YYYYMMDD-NNN（同进程递增，重启从 001 开始）。
> 主沉淀位置：知识库（type=incident_case, id=sediment-{taskId}）。
> 此文件为人类可读副本，不作为幂等性依据。

`
      await fs.writeFile(filePath, header, 'utf8')
    }

    await fs.appendFile(filePath, markdownEntry, 'utf8')
    log.info('Markdown 沉淀成功', { dir })
    return true
  } catch (err) {
    log.warn('Markdown 沉淀失败', {
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

// ============================================================================
// AttentionTracker 归档
// ============================================================================

/**
 * 归档当前 attention（调用 reset 将 current 存入 history）
 *
 * 补上 AttentionTracker 一直空挂的 reset 调用点。
 *
 * @returns true=调用成功
 */
function archiveAttention(): boolean {
  try {
    AttentionTracker.getInstance().reset()
    return true
  } catch (err) {
    log.warn('AttentionTracker.reset 失败', {
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

// ============================================================================
// 主入口：sedimentTaskMemory
// ============================================================================

/**
 * 任务记忆沉淀（P2-I 主入口）
 *
 * 在 Task Protocol step 14 完成后调用，自动沉淀任务关键信息。
 *
 * 双轨写入：知识库 + Markdown
 * 幂等性：知识库 id = `sediment-{taskId}`（重复沉淀 skip）
 * 错误降级链：知识库失败 → 仅 Markdown；Markdown 失败 → 仅日志；日志失败 → 静默吞错
 *
 * @param ctx 完成后的任务协议上下文
 * @returns 沉淀结果（包含 sedimentId / writtenTo / lessons / attentionArchived）
 */
export async function sedimentTaskMemory(
  ctx: TaskProtocolContext
): Promise<TaskSedimentOutput> {
  const sedimentId = generateSedimentId()
  const lessons = extractLessonsHeuristic(ctx)

  log.info('开始任务记忆沉淀', {
    sedimentId,
    taskId: ctx.taskId,
    subagentName: ctx.subagentName,
    completedSteps: ctx.completedSteps.length,
  })

  // 1. 构建知识库条目
  const entry = buildKnowledgeEntry(ctx, sedimentId, lessons)

  // 2. 写入知识库（幂等）
  const knowledgeSuccess = await writeToKnowledgeRepo(entry)

  // 3. 写入 Markdown（人类可读副本）
  const markdownEntry = buildMarkdownEntry(ctx, sedimentId, lessons)
  const markdownSuccess = await appendToMarkdown(markdownEntry)

  // 4. 归档 attention（无论写入是否成功都归档，避免 attention 累积）
  const attentionArchived = archiveAttention()

  // 5. 决定 writtenTo
  let writtenTo: TaskSedimentOutput['writtenTo']
  let reason: string | undefined

  if (knowledgeSuccess && markdownSuccess) {
    writtenTo = 'knowledge_repo'
  } else if (markdownSuccess) {
    writtenTo = 'markdown_only'
  } else if (!knowledgeSuccess && !markdownSuccess) {
    // 检查是否因为幂等跳过（KnowledgeRepository.getById 已存在）
    try {
      const db = DatabaseManager.getInstance()
      const repo = new KnowledgeRepository(db)
      const existing = repo.getById(entry.id)
      if (existing) {
        writtenTo = 'skipped'
        reason = `taskId=${ctx.taskId} 已沉淀过`
      } else {
        writtenTo = 'skipped'
        reason = '知识库和 Markdown 均写入失败'
      }
    } catch {
      writtenTo = 'skipped'
      reason = '知识库和 Markdown 均写入失败（且 DatabaseManager 不可用）'
    }
  } else {
    // knowledgeSuccess=true, markdownSuccess=false
    writtenTo = 'knowledge_repo'
  }

  log.info('任务记忆沉淀完成', {
    sedimentId,
    taskId: ctx.taskId,
    writtenTo,
    reason,
    lessonsCount: lessons.length,
    attentionArchived,
  })

  return {
    sedimentId,
    writtenTo,
    reason,
    lessons,
    attentionArchived,
  }
}
