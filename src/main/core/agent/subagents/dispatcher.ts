/**
 * Subagent 调度器（精简版 8 步协议）（v0.9.4 批次 4 - 任务 1）
 *
 * 借鉴 Kilo Code 的 task 工具 14 步 subagent 调度协议 + MetaGPT SOP 范式：
 *   d:\ai\linux教学一体\idea-to-dev-output\29-源码分析-KiloCode-多模式Subagent.md §4.3 / §5
 *
 * 与 task-protocol.ts 的关系：
 * - task-protocol.ts 实现 Kilo Code 完整 14 步协议（步骤级精细控制，每步独立可测试）
 * - dispatcher.ts 是 8 步简化版（粗粒度阶段，便于 Supervisor 编排）
 * - 两者互补：粗粒度调度用 dispatcher，细粒度单 Subagent 执行用 task-protocol
 *
 * 8 步流程：
 *   1. ANALYZE   — 解析用户请求，确定任务类型（关键词匹配）
 *   2. PLAN      — 生成任务分解（哪些 Subagent 接活）
 *   3. DISPATCH  — 派发任务给对应 Subagent
 *   4. EXECUTE   — Subagent 执行（带超时 + 取消信号）
 *   5. APPROVE   — 人工审批闸门（HIGH/CRITICAL 阻塞等待，LOW/MEDIUM 自动放行，5min 超时自动拒绝）
 *   6. COLLECT   — 收集所有 Subagent 结果
 *   7. REFLECT   — 执行后反思（LLM 评估目标达成度，不可用时降级为启发式）
 *   8. SUMMARIZE — 汇总输出给用户
 *
 * 当前实现：
 * - 8 步全部可用
 * - approve：Promise 暂停 + 超时自动拒绝（借鉴 agent-workflow.ts confirm 模式）
 * - reflect：LLM 评估 + 启发式降级（检查错误指示词 + 成功率）
 * - 完整 PAOR 循环 + LLM 驱动的任务分解在 v0.9.5 plan-and-act 双模式中落地
 *
 * 方案书依据：v0.9.4 §11 第 4 类（Subagent 调度 3 项）+ v0.9.3 §3.2（PAOR 循环）
 */
import type {
  SubagentRegistry,
  Subagent,
  SubagentTask,
  SubagentResult,
} from './base'
import { createSubagentTask } from './base'
import type {
  AgentMode,
  ThinkingStrength,
} from '@shared/agent-types'
import { logger } from '../../../services/log/logger'

/**
 * Subagent 调度步骤（借鉴 Kilo Code task 工具 14 步协议，精简为 8 步）
 *
 * 1. analyze   — 解析用户请求，确定任务类型
 * 2. plan      — 生成任务分解（哪些 Subagent 接活）
 * 3. dispatch  — 派发任务给对应 Subagent
 * 4. execute   — Subagent 执行（带超时 + 取消信号）
 * 5. approve   — 人工审批闸门（高危任务）
 * 6. collect   — 收集所有 Subagent 结果
 * 7. reflect   — 反思（评估结果质量，决定是否再循环）
 * 8. summarize — 汇总输出给用户
 */
export type DispatchStep =
  | 'analyze'
  | 'plan'
  | 'dispatch'
  | 'execute'
  | 'approve'
  | 'collect'
  | 'reflect'
  | 'summarize'

/**
 * 调度上下文（贯穿整个 8 步流程）
 */
export interface DispatchContext {
  /** 用户原始请求 */
  userRequest: string
  /** 会话 ID */
  sessionId: string
  /** 模式（chat/ask/plan/code/debug，影响工具白名单） */
  mode: AgentMode
  /** 思考强度 */
  strength: ThinkingStrength
  /** 当前步骤 */
  currentStep: DispatchStep
  /** 已完成的步骤记录（用于审计） */
  stepHistory: Array<{ step: DispatchStep; timestamp: number; success: boolean }>
}

/**
 * 调度结果（dispatchSubagents 返回值）
 */
export interface DispatchResult {
  /** 最终输出文本 */
  output: string
  /** 是否成功 */
  success: boolean
  /** 调度路径（哪些 Subagent 接活） */
  subagentsUsed: string[]
  /** 总耗时（ms） */
  totalDurationMs: number
  /** 总 token 消耗 */
  totalTokens: number
  /** 总成本（USD） */
  totalCost: number
  /** 步骤历史 */
  stepHistory: DispatchContext['stepHistory']
  /** 审批结果（approve 步骤产出） */
  approval?: ApprovalResult
  /** 反思结果（reflect 步骤产出） */
  reflection?: ReflectResult
  /** 错误信息（失败时填充） */
  error?: string
}

/**
 * 子日志器（自动注入调度前缀）
 */
const log = logger.child('AGENT.SUBAGENT.DISPATCHER')

/**
 * 单个 Subagent 执行超时阈值（ms，默认 30 秒）
 *
 * 借鉴 Kilo Code：subagent 不应长时间阻塞父 session。
 * 超时后该 Subagent 视为失败，但不影响其他 Subagent。
 */
const SINGLE_SUBAGENT_TIMEOUT_MS = 30_000

/**
 * 任务类型关键词映射表（analyze 步骤用）
 *
 * 简单关键词匹配：包含关键词 → 推荐对应的 Subagent。
 * v0.9.5 将替换为 LLM 驱动的意图分类。
 */
const TASK_KEYWORD_MAP: Array<{ keywords: string[]; subagent: string }> = [
  { keywords: ['部署', 'deploy', 'install', '安装'], subagent: 'running' },
  { keywords: ['代码', 'code', '编程', '实现', '修改'], subagent: 'coding' },
  { keywords: ['搜索', 'search', '查询', '检索', '查'], subagent: 'search' },
  { keywords: ['思考', 'think', '分析', '推理'], subagent: 'thinking' },
  { keywords: ['技能', 'skill', '教程', '教学'], subagent: 'skill' },
  { keywords: ['方法论', 'methodology', '流程', 'sop'], subagent: 'methodology' },
  { keywords: ['历史', 'history', '之前', '上次'], subagent: 'history' },
  { keywords: ['知识库', 'knowledge', 'kb', '案例'], subagent: 'knowledge' },
  { keywords: ['探查', 'explore', '探索', '代码库'], subagent: 'explore' },
]

/**
 * 步骤历史记录辅助函数
 *
 * @param step 当前步骤
 * @param success 是否成功
 * @returns 历史记录条目
 */
function makeStepRecord(
  step: DispatchStep,
  success: boolean
): { step: DispatchStep; timestamp: number; success: boolean } {
  return { step, timestamp: Date.now(), success }
}

/**
 * ANALYZE 步骤：解析用户请求，确定任务类型
 *
 * 当前版本：基于关键词匹配，找到所有匹配的 Subagent。
 * v0.9.5 增强：LLM 驱动的意图分类 + 多意图融合。
 *
 * @param userRequest 用户原始请求
 * @returns 匹配到的 Subagent 名称列表（去重）
 */
function analyzeRequest(userRequest: string): string[] {
  const matched = new Set<string>()
  const lowerRequest = userRequest.toLowerCase()
  for (const { keywords, subagent } of TASK_KEYWORD_MAP) {
    for (const kw of keywords) {
      if (lowerRequest.includes(kw.toLowerCase())) {
        matched.add(subagent)
        break
      }
    }
  }
  // 默认 fallback：无匹配时使用 thinking（通用分析）
  if (matched.size === 0) {
    matched.add('thinking')
  }
  return Array.from(matched)
}

/**
 * PLAN 步骤：根据 analyze 结果生成 SubagentTask 列表
 *
 * 当前版本：每个匹配的 Subagent 生成一个 task，input 为用户请求原文。
 * v0.9.5 增强：LLM 分解多步骤任务 + 任务依赖图。
 *
 * @param userRequest 用户请求
 * @param subagentNames 匹配到的 Subagent 名称
 * @param ctx 调度上下文
 * @returns SubagentTask 列表
 */
function planTasks(
  userRequest: string,
  subagentNames: string[],
  ctx: Omit<DispatchContext, 'currentStep' | 'stepHistory'>
): SubagentTask[] {
  return subagentNames.map((name) =>
    createSubagentTask(name, `处理用户请求：${userRequest.slice(0, 100)}`, userRequest, {
      sessionId: ctx.sessionId,
      strength: ctx.strength,
    })
  )
}

/**
 * EXECUTE 步骤：执行单个 Subagent 任务（带超时保护）
 *
 * 借鉴 Kilo Code：subagent 执行有超时保护，超时视为失败但不影响其他 Subagent。
 *
 * @param subagent 目标 Subagent 实例
 * @param task 任务对象
 * @returns SubagentResult（超时或异常时返回 success=false）
 */
async function executeWithTimeout(
  subagent: Subagent,
  task: SubagentTask
): Promise<SubagentResult> {
  return new Promise<SubagentResult>((resolve) => {
    const timer = setTimeout(() => {
      resolve({
        taskId: task.id,
        success: false,
        output: null,
        error: `Subagent 执行超时（${SINGLE_SUBAGENT_TIMEOUT_MS}ms）`,
        durationMs: SINGLE_SUBAGENT_TIMEOUT_MS,
      })
    }, SINGLE_SUBAGENT_TIMEOUT_MS)

    subagent
      .execute(task)
      .then((result) => {
        clearTimeout(timer)
        resolve(result)
      })
      .catch((err) => {
        clearTimeout(timer)
        resolve({
          taskId: task.id,
          success: false,
          output: null,
          error: err instanceof Error ? err.message : String(err),
          durationMs: 0,
        })
      })
  })
}

/**
 * COLLECT 步骤：收集所有 Subagent 结果，合并输出
 *
 * @param results SubagentResult 列表
 * @returns 合并后的输出文本
 */
function collectOutput(results: SubagentResult[]): string {
  const parts: string[] = []
  for (const r of results) {
    if (r.success) {
      const output =
        typeof r.output === 'string'
          ? r.output
          : r.output === null || r.output === undefined
            ? ''
            : JSON.stringify(r.output)
      if (output) {
        parts.push(output)
      }
    } else if (r.error) {
      parts.push(`[失败] ${r.error}`)
    }
  }
  return parts.join('\n\n')
}


/**
 * REFLECT 步骤返回值
 */
export interface ReflectResult {
  goalMet: boolean
  /** 质量评分 [0, 1] */
  quality: number
  lessons: string[]
  shouldIterate: boolean
}

/** 输出中的错误指示词（启发式降级用） */
const ERROR_INDICATORS = /error|fail|exception|timeout|refused|denied|错误|失败|超时|拒绝/i

/**
 * REFLECT 步骤：执行后反思 — 目标是否达成？
 *
 * 优先调用 LLM 做简短评估；LLM 不可用时降级为启发式（检查错误指示词 + 成功率）。
 *
 * @param results SubagentResult 列表
 * @param userRequest 用户原始请求（作为"目标"参照）
 * @param llmChat 可选 LLM 对话函数（由调用方注入，解耦 LLM 依赖）
 * @returns 反思结果（goalMet / quality / lessons / shouldIterate）
 */
async function reflectOnResults(
  results: SubagentResult[],
  userRequest: string,
  llmChat?: (prompt: string) => Promise<string>
): Promise<ReflectResult> {
  const successCount = results.filter((r) => r.success).length
  const successRate = results.length > 0 ? successCount / results.length : 0
  const outputText = results.map((r) => (typeof r.output === 'string' ? r.output : '')).join('\n')

  // 尝试 LLM 评估
  if (llmChat) {
    try {
      const prompt = [
        '你是一个执行后反思评估器。请判断执行结果是否达成用户目标。',
        `用户目标：${userRequest.slice(0, 200)}`,
        `执行结果摘要：${outputText.slice(0, 500)}`,
        `成功率：${(successRate * 100).toFixed(0)}%`,
        '请严格回复 JSON：{"goalMet":bool,"quality":0到1的小数,"lessons":["经验"],"shouldIterate":bool}',
      ].join('\n')
      const raw = await llmChat(prompt)
      const parsed = JSON.parse(raw.replace(/```json?|```/g, '').trim()) as ReflectResult
      return {
        goalMet: Boolean(parsed.goalMet),
        quality: Math.max(0, Math.min(1, Number(parsed.quality) || 0.5)),
        lessons: Array.isArray(parsed.lessons) ? parsed.lessons.slice(0, 5) : [],
        shouldIterate: Boolean(parsed.shouldIterate),
      }
    } catch (err) {
      log.warn('reflect: LLM 评估失败，降级到启发式', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // 启发式降级：检查错误指示词 + 成功率
  const hasErrors = ERROR_INDICATORS.test(outputText) || successRate < 0.5
  const quality = successRate * (hasErrors ? 0.6 : 1.0)
  const lessons: string[] = []
  if (successRate < 1) lessons.push(`部分任务失败（成功率 ${(successRate * 100).toFixed(0)}%）`)
  if (ERROR_INDICATORS.test(outputText)) lessons.push('输出中包含错误指示词，建议排查')
  return { goalMet: successRate >= 0.5 && !hasErrors, quality, lessons, shouldIterate: successRate < 0.5 }
}

/**
 * APPROVE 步骤返回值
 */
export interface ApprovalResult {
  approved: boolean
  approver: 'auto' | 'human'
  reason: string
}

/** 模块级审批解析器（外部 IPC/UI 调用 resolveApproval 恢复流程） */
let approvalResolve: ((approved: boolean) => void) | null = null

/**
 * 外部调用此方法完成人工审批（IPC 层转发 UI 按钮点击）
 *
 * @param approved true=批准，false=拒绝
 */
export function resolveApproval(approved: boolean): void {
  if (approvalResolve) {
    approvalResolve(approved)
    approvalResolve = null
  }
}

/** 审批超时阈值（5 分钟，安全兜底自动拒绝） */
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

/**
 * APPROVE 步骤：人工审批闸门（HIGH/CRITICAL 阻塞，LOW/MEDIUM 自动放行）
 *
 * 借鉴 agent-workflow.ts confirm 步骤的 Promise 暂停 + 超时自动拒绝模式。
 * 当 Subagent 标记 requiresApproval=true（高危操作）时，暂停等待人工确认；
 * 否则自动批准，不阻塞流程。
 *
 * @param results SubagentResult 列表
 * @returns 审批结果（approved / approver / reason）
 */
async function approveActions(results: SubagentResult[]): Promise<ApprovalResult> {
  const pending = results.filter((r) => r.requiresApproval === true)
  if (pending.length === 0) {
    log.debug('approve: 无高危操作，自动批准')
    return { approved: true, approver: 'auto', reason: '无高危操作，自动批准' }
  }
  log.info('approve: 检测到高危操作，等待人工审批', {
    count: pending.length,
    taskIds: pending.map((r) => r.taskId),
  })
  const approved = await new Promise<boolean>((resolve) => {
    approvalResolve = resolve
    setTimeout(() => {
      if (approvalResolve) {
        log.warn('approve: 审批超时（5分钟），自动拒绝')
        approvalResolve = null
        resolve(false)
      }
    }, APPROVAL_TIMEOUT_MS)
  })
  return {
    approved,
    approver: 'human',
    reason: approved ? '人工审批通过' : '人工审批拒绝或超时',
  }
}

/**
 * Subagent 调度器（精简版 8 步）
 *
 * 借鉴 Kilo Code task 工具 14 步协议 + MetaGPT SOP 范式。
 *
 * 执行流程：
 * 1. ANALYZE   — 关键词匹配确定任务类型
 * 2. PLAN      — 生成 SubagentTask 列表
 * 3. DISPATCH  — 从 registry 查找 Subagent 实例
 * 4. EXECUTE   — 并行执行所有 Subagent（带超时保护）
 * 5. APPROVE   — 人工审批闸门（HIGH/CRITICAL 阻塞等待，LOW/MEDIUM 自动放行）
 * 6. COLLECT   — 合并所有 Subagent 输出
 * 7. REFLECT   — 执行后反思（LLM 评估目标达成度，降级为启发式）
 * 8. SUMMARIZE — 拼接最终输出文本
 *
 * 异常处理：
 * - 单个 Subagent 失败不影响其他 Subagent
 * - 整体 success = 至少一个 Subagent 成功
 * - 超时（30s）视为失败
 * - 审批超时（5min）自动拒绝
 *
 * @param ctx 调度上下文（不含 currentStep / stepHistory，由内部维护）
 * @param registry Subagent 注册表（按 name 查找）
 * @param llmChat 可选 LLM 对话函数（注入后 reflect 步骤使用 LLM 评估，否则启发式降级）
 * @returns 调度结果
 *
 * @example
 * ```ts
 * const registry = createAllSubagents() // 实现 SubagentRegistry 接口
 * const result = await dispatchSubagents({
 *   userRequest: '帮我搜索 nginx 部署教程',
 *   sessionId: 'sess_abc123',
 *   mode: 'chat',
 *   strength: 'standard',
 * }, registry)
 * ```
 */
export async function dispatchSubagents(
  ctx: Omit<DispatchContext, 'currentStep' | 'stepHistory'>,
  registry: SubagentRegistry,
  llmChat?: (prompt: string) => Promise<string>
): Promise<DispatchResult> {
  const startTime = Date.now()
  const stepHistory: DispatchContext['stepHistory'] = []
  const subagentsUsed: string[] = []
  let totalTokens = 0
  let totalCost = 0

  log.info('开始执行 8 步 subagent 调度', {
    userRequestLength: ctx.userRequest.length,
    sessionId: ctx.sessionId,
    mode: ctx.mode,
    strength: ctx.strength,
  })

  // === 步骤 1：ANALYZE ===
  let matchedSubagents: string[]
  try {
    matchedSubagents = analyzeRequest(ctx.userRequest)
    stepHistory.push(makeStepRecord('analyze', true))
    log.debug('analyze 完成', { matchedSubagents })
  } catch (err) {
    stepHistory.push(makeStepRecord('analyze', false))
    return {
      output: '',
      success: false,
      subagentsUsed: [],
      totalDurationMs: Date.now() - startTime,
      totalTokens: 0,
      totalCost: 0,
      stepHistory,
      error: `analyze 失败：${err instanceof Error ? err.message : String(err)}`,
    }
  }

  // === 步骤 2：PLAN ===
  let tasks: SubagentTask[]
  try {
    tasks = planTasks(ctx.userRequest, matchedSubagents, ctx)
    stepHistory.push(makeStepRecord('plan', true))
    log.debug('plan 完成', { taskCount: tasks.length })
  } catch (err) {
    stepHistory.push(makeStepRecord('plan', false))
    return {
      output: '',
      success: false,
      subagentsUsed: [],
      totalDurationMs: Date.now() - startTime,
      totalTokens: 0,
      totalCost: 0,
      stepHistory,
      error: `plan 失败：${err instanceof Error ? err.message : String(err)}`,
    }
  }

  // === 步骤 3：DISPATCH（查找 Subagent 实例） ===
  const subagentInstances: Array<{ task: SubagentTask; subagent: Subagent }> = []
  for (const task of tasks) {
    // SubagentRegistry.get 接受 SubagentName，但 explore 等新增 Subagent 不在联合类型中
    // 使用类型断言绕过（与现有 explore-subagent.ts 风格一致）
    const subagent = registry.get(task.type as never)
    if (subagent) {
      subagentInstances.push({ task, subagent })
      subagentsUsed.push(task.type)
    } else {
      log.warn('dispatch 步骤：未找到 Subagent，跳过', { subagentName: task.type })
    }
  }
  stepHistory.push(makeStepRecord('dispatch', subagentInstances.length > 0))

  // 如果没有匹配到任何 Subagent，直接返回
  if (subagentInstances.length === 0) {
    stepHistory.push(makeStepRecord('execute', true))
    stepHistory.push(makeStepRecord('approve', true))
    stepHistory.push(makeStepRecord('collect', true))
    stepHistory.push(makeStepRecord('reflect', true))
    stepHistory.push(makeStepRecord('summarize', true))
    return {
      output: '无匹配的 Subagent 可调度（analyze 未识别任务类型）',
      success: true,
      subagentsUsed: [],
      totalDurationMs: Date.now() - startTime,
      totalTokens: 0,
      totalCost: 0,
      stepHistory,
    }
  }

  // === 步骤 4：EXECUTE（并行执行，带超时） ===
  const results: SubagentResult[] = await Promise.all(
    subagentInstances.map(({ task, subagent }) =>
      executeWithTimeout(subagent, task).then((result) => {
        // 累计 token + cost
        if (result.usage) {
          totalTokens += result.usage.totalTokens || 0
        }
        if (result.success) {
          totalCost += 0 // SubagentResult 未携带 cost 字段，由 token-stats 统一计算
        }
        return result
      })
    )
  )
  const executeSuccess = results.some((r) => r.success)
  stepHistory.push(makeStepRecord('execute', executeSuccess))

  // === 步骤 5：APPROVE（人工审批闸门，HIGH/CRITICAL 阻塞） ===
  const approval = await approveActions(results)
  stepHistory.push(makeStepRecord('approve', approval.approved))
  if (!approval.approved) {
    log.warn('approve 步骤：审批未通过，终止调度', { reason: approval.reason })
    return {
      output: `[审批拒绝] ${approval.reason}`,
      success: false,
      subagentsUsed,
      totalDurationMs: Date.now() - startTime,
      totalTokens,
      totalCost,
      stepHistory,
      approval,
      error: `审批未通过：${approval.reason}`,
    }
  }

  // === 步骤 6：COLLECT（合并输出） ===
  const collectedOutput = collectOutput(results)
  stepHistory.push(makeStepRecord('collect', true))

  // === 步骤 7：REFLECT（执行后反思） ===
  const reflection = await reflectOnResults(results, ctx.userRequest, llmChat)
  stepHistory.push(makeStepRecord('reflect', true))
  if (reflection.shouldIterate) {
    log.warn('reflect 步骤：建议再循环', { quality: reflection.quality, lessons: reflection.lessons })
  }

  // === 步骤 8：SUMMARIZE（汇总输出） ===
  const summaryHeader = `[调度完成] 调用 ${subagentsUsed.length} 个 Subagent：${subagentsUsed.join(', ')}`
  const summaryFooter = `[统计] 质量 ${(reflection.quality * 100).toFixed(0)}%，token ${totalTokens}，耗时 ${Date.now() - startTime}ms`
  const finalOutput = [summaryHeader, collectedOutput, summaryFooter]
    .filter((s) => s)
    .join('\n\n')
  stepHistory.push(makeStepRecord('summarize', true))

  log.info('8 步 subagent 调度完成', {
    subagentsUsed,
    goalMet: reflection.goalMet,
    quality: reflection.quality,
    totalTokens,
    totalDurationMs: Date.now() - startTime,
  })

  return {
    output: finalOutput,
    success: executeSuccess,
    subagentsUsed,
    totalDurationMs: Date.now() - startTime,
    totalTokens,
    totalCost,
    stepHistory,
    approval,
    reflection,
  }
}
