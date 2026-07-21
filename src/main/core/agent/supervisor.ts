/**
 * Supervisor Agent（监督者 Agent）骨架
 *
 * 职责：
 * - 作为 Agent 系统的统一入口，封装 streamText 调用
 * - 实现 Plan-Act-Observe-Reflect（PAOR）循环占位（Week 2 实现完整编排）
 * - 集成 Provider 抽象层（provider-factory）
 * - 集成敏感信息脱敏（redactSecrets，Hard Constraint 6）
 * - 集成 Token 统计（token-stats）
 * - 集成上下文管理（compactIfNeeded，5 层 compaction）
 * - 注册 8 个 Subagent（Week 1 仅创建实例，Week 2 实现 Plan 阶段调度）
 * - 预留人工审批闸门接口（Hard Constraint 4）
 * - 支持请求取消（AbortController）
 *
 * Week 1 实现：
 * - chat() 方法：streamText 包装 + redact + token 统计 + compaction
 * - PAOR 四阶段占位方法（plan/act/observe/reflect，仅返回 stub）
 * - createAllSubagents() 注册（暂不调度）
 * - cancelRequest() 取消进行中的请求
 *
 * Week 2 待实现：
 * - PAOR 循环完整编排
 * - Subagent 调度（按 task type 分发）
 * - 人工审批闸门 UI 联动（IPC 推送审批请求）
 * - 可信度融合（多 Subagent 结果加权）
 *
 * 方案书依据：v0.9 §3.2（PAOR 循环）+ §3.1（8 个 Subagent）+ §10（Hard Constraints）
 */
import { streamText, generateText, tool, isStepCount, type ModelMessage } from 'ai'
import { z } from 'zod'
import { createLanguageModel, getDefaultParams } from './providers/provider-factory'
import { getProviderWithApiKey, getDefaultProviderId, ensureProvidersInitialized } from './providers/provider-registry'
import { redactSecrets } from './providers/redact'
import { recordTokenUsage } from './providers/token-stats'
import { compactIfNeeded } from './context'
import { createAllSubagents } from './subagents'
import type { Subagent, SubagentName, SubagentTask, SubagentResult } from './subagents/base'
import type { ThinkingStrength } from './providers/types'
import type { ChatResult } from '@shared/agent-types'
import { logger } from '../../services/log/logger'
import { SshConnectionManager } from '../../services/ssh/connection-manager'
import { createCotTraceCollector } from './credibility/mass-functions/cot-trace-collector'
import { assessRisk } from '../risk-engine'

/**
 * 流式 chat 调用参数
 */
export interface ChatParams {
  /** 对话消息列表（用户输入会先经 redactSecrets 脱敏） */
  messages: ModelMessage[]
  /** Provider ID（不传时使用默认 Provider） */
  providerId?: string
  /** 思考强度（影响 maxTokens 与后续是否调度 Subagent） */
  strength?: ThinkingStrength
  /** token 流式回调（每个 chunk 调用一次） */
  onToken?: (delta: string) => void
  /** 完成回调（含完整文本和 token 使用） */
  onDone?: (result: ChatResult) => void
  /** 错误回调 */
  onError?: (error: Error) => void
  /** 关联 ID（用于日志追踪 + 取消请求） */
  correlationId?: string
  /**
   * 活跃 SSH 会话 ID（可选）。
   * 传入后启用只读 ssh_readonly 工具，供运维诊断查询。
   * 注意：agent-runtime 的 session-registry id 与 SSH session 不同；
   * 此处必须是 SshConnectionManager 的 sessionId。
   */
  sshSessionId?: string
}

// ChatResult 类型从 @shared/agent-types 导入（供 preload/renderer 共享）
// 重新导出便于 main 内部从 supervisor 导入
export type { ChatResult } from '@shared/agent-types'

/**
 * PAOR 循环阶段
 */
export type PaorPhase = 'plan' | 'act' | 'observe' | 'reflect'

/**
 * PAOR 单次循环结果（Week 2 实现完整逻辑）
 */
export interface PaorStepResult {
  /** 当前阶段 */
  phase: PaorPhase
  /** 阶段输出（plan=任务清单，act=Subagent 结果，observe=观察记录，reflect=反思） */
  output: unknown
  /** 是否需要进入下一阶段 */
  next: boolean
  /** 是否需要人工审批 */
  requiresApproval: boolean
}

/**
 * PAOR Plan 阶段输出的结构化执行计划
 */
export interface PlanObject {
  /** 任务目标 */
  goal: string
  /** 有序步骤列表（每条建议为可执行命令或操作描述） */
  steps: string[]
  /** 风险点列表 */
  risks: string[]
  /** 验证方法（如何确认任务成功） */
  verification: string
}

/**
 * PAOR Act 阶段单步执行结果
 */
export interface ActResult {
  /** 执行的步骤索引（对应 PlanObject.steps） */
  stepIndex: number
  /** 实际执行的命令 */
  command: string
  /** 命令输出（stdout/stderr 合并） */
  output: string
  /** 是否执行成功（exitCode === 0） */
  success: boolean
}

/**
 * PAOR Observe 阶段观察结果
 */
export interface ObserveResult {
  /** 观察状态 */
  status: 'success' | 'partial' | 'failed'
  /** 观察要点列表 */
  observations: string[]
  /** 是否建议重试当前步骤 */
  needsRetry: boolean
}

/**
 * PAOR Reflect 阶段反思决策
 */
export interface ReflectResult {
  /** 循环决策：继续下一步 / 重试 / 中止 / 计划完成 */
  decision: 'continue' | 'retry' | 'abort' | 'done'
  /** 决策理由 */
  reasoning: string
  /** 可选的更新后计划（如需要调整步骤） */
  updatedPlan?: PlanObject
}

/**
 * PAOR 单次迭代记录（Plan→Act→Observe→Reflect 一轮的完整轨迹）
 */
export interface PaorIteration {
  /** 迭代序号（从 1 开始） */
  iteration: number
  /** 执行的步骤索引 */
  stepIndex: number
  /** Act 阶段结果 */
  act: ActResult
  /** Observe 阶段结果 */
  observe: ObserveResult
  /** Reflect 阶段决策 */
  reflect: ReflectResult
  /** 是否因风险拦截而跳过执行（人工审批门） */
  riskBlocked?: boolean
}

/**
 * PAOR 自动循环最终结果
 */
export interface PaorLoopResult {
  /** 最终状态：done=计划完成，abort=中止，max_iterations=达到迭代上限 */
  status: 'done' | 'abort' | 'max_iterations'
  /** 结构化计划 */
  plan: PlanObject
  /** 计划置信度 */
  planConfidence: number
  /** 完整迭代轨迹（可审计） */
  iterations: PaorIteration[]
  /** 最终结论摘要 */
  summary: string
  /** 总耗时（毫秒） */
  durationMs: number
}

/**
 * PAOR 循环选项
 */
export interface PaorLoopOptions {
  /** 最大迭代次数（默认 5，防止无限循环） */
  maxIterations?: number
  /** 每步最大重试次数（默认 1） */
  maxRetriesPerStep?: number
  /**
   * 风险审批回调（Hard Constraint 4）
   *
   * 当 assessRisk 判定命令为 HIGH/CRITICAL 时调用。
   * 返回 true 表示人工批准执行，false 表示拒绝（该步骤标记为 riskBlocked）。
   * 不传时 HIGH/CRITICAL 命令自动跳过（安全默认）。
   */
  approveRisk?: (command: string, level: string, description: string) => Promise<boolean>
  /** 每轮迭代回调（供 UI 实时展示进度） */
  onIteration?: (iteration: PaorIteration) => void
}

/**
 * Supervisor Agent 单例类
 *
 * 通过 getSupervisor() 获取全局唯一实例。
 * 在 app.whenReady 后由 IPC handler 首次调用时自动初始化。
 */
class SupervisorAgent {
  /** 已注册的 Subagent 表（Week 1 仅创建实例，Week 2 实现 Plan 阶段调度） */
  private readonly subagents: Record<SubagentName, Subagent>

  /** 进行中的请求表：correlationId → AbortController（用于取消请求） */
  private readonly activeRequests = new Map<string, AbortController>()

  /** 是否已初始化（避免重复初始化 Subagent） */
  private initialized = false

  constructor() {
    // 创建所有 Subagent 实例（Week 1 仅占位）
    this.subagents = createAllSubagents()
    this.log.info('Supervisor Agent 已创建', {
      subagentCount: Object.keys(this.subagents).length,
    })
  }

  /** 受保护日志器 */
  private readonly log = logger.child('AGENT.SUPERVISOR')

  /**
   * 初始化（懒加载，首次调用 chat 时触发）
   *
   * 确保 Provider 列表已从持久化存储加载到内存。
   */
  private ensureInitialized(): void {
    if (this.initialized) return
    ensureProvidersInitialized()
    this.initialized = true
    this.log.info('Supervisor Agent 已初始化（Provider 列表已加载）')
  }

  /**
   * 流式 chat 调用（核心入口）
   *
   * 流程：
   * 1. 获取 Provider 配置（含 apiKey，从 SecureStore 解密）
   * 2. 对消息内容进行 redactSecrets 脱敏（Hard Constraint 6）
   * 3. 调用 compactIfNeeded 执行 5 层 compaction（Hard Constraint 7）
   * 4. 创建 LanguageModel 实例（provider-factory 分发）
   * 5. 调用 streamText 流式输出
   * 6. 累积 token 使用并记录到 token-stats
   * 7. 完成时调用 onDone，错误时调用 onError
   *
   * @param params chat 调用参数
   */
  async chat(params: ChatParams): Promise<void> {
    const {
      messages,
      providerId,
      strength = 'standard',
      onToken,
      onDone,
      onError,
      correlationId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sshSessionId,
    } = params

    this.ensureInitialized()
    const startTime = Date.now()

    // 1. 获取 Provider 配置
    const resolvedProviderId = providerId ?? getDefaultProviderId()
    const config = getProviderWithApiKey(resolvedProviderId)
    if (!config) {
      const err = new Error(`Provider "${resolvedProviderId}" 不存在，请在设置中配置`)
      this.log.error('chat 调用失败：Provider 不存在', { providerId: resolvedProviderId, correlationId })
      onError?.(err)
      return
    }

    // 2. redact 敏感信息（对每条 user 消息内容脱敏）
    const redactedMessages = messages.map((m) => {
      if (typeof m.content === 'string') {
        return { ...m, content: redactSecrets(m.content) } as ModelMessage
      }
      // 多模态内容暂不脱敏（v0.9 Week 1 仅支持纯文本消息）
      return m
    })

    // 3. compaction（5 层阈值）
    const compaction = compactIfNeeded(redactedMessages)
    if (compaction.level !== 'none') {
      this.log.info('chat 触发 compaction', {
        correlationId,
        level: compaction.level,
        beforeTokens: compaction.beforeTokens,
        afterTokens: compaction.afterTokens,
        truncatedCount: compaction.truncatedCount,
      })
    }

    // 4. 创建 LanguageModel
    let modelInstance
    try {
      modelInstance = createLanguageModel(config)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.log.error('chat 调用失败：创建 LanguageModel 失败', {
        providerId: resolvedProviderId,
        correlationId,
        error: error.message,
      })
      onError?.(error)
      return
    }

    // 5. 获取参数（temperature / maxTokens）
    const { temperature, maxTokens } = getDefaultParams(modelInstance.config)

    // 6. 创建 AbortController 并注册（用于 cancelRequest）
    const abortController = new AbortController()
    this.activeRequests.set(correlationId, abortController)

    // 思考强度影响 maxTokens：deep 模式翻倍（Week 2 还会启用 Subagent 编排）
    const effectiveMaxTokens =
      strength === 'deep' ? maxTokens * 2 : strength === 'fast' ? Math.floor(maxTokens / 2) : maxTokens

    // v0.9.6 P2 M5+：CoT 熵轨迹收集器
    // Vercel AI SDK v7 路径：streamText 不暴露 per-step content block，
    // 采用 text-fallback 模式（按句子切分 + text-feature entropy）
    const traceCollector = createCotTraceCollector()

    this.log.info('chat 调用开始', {
      correlationId,
      providerId: resolvedProviderId,
      model: modelInstance.resolvedModel,
      strength,
      temperature,
      maxTokens: effectiveMaxTokens,
      messageCount: compaction.messages.length,
      compactionLevel: compaction.level,
    })

    try {
      // 7. 只读 SSH 工具（有活跃 SSH 会话时挂载）
      const tools =
        sshSessionId && SshConnectionManager.getInstance().getConnectionState(sshSessionId) === 'connected'
          ? {
              ssh_readonly: tool({
                description:
                  '在已连接的 Linux 主机上执行【只读】诊断命令（如 df/free/ps/journalctl/nginx -t）。禁止写操作。',
                inputSchema: z.object({
                  command: z
                    .string()
                    .min(1)
                    .describe('只读 shell 命令，例如: df -h; free -m; systemctl status nginx --no-pager'),
                }),
                execute: async ({ command }: { command: string }) => {
                  const risk = assessRisk(command)
                  if (risk.blocked || risk.level === 'CRITICAL' || risk.level === 'HIGH') {
                    return {
                      ok: false,
                      error: `命令被风险引擎拦截（${risk.level}）：${risk.description}`,
                      stdout: '',
                      stderr: '',
                      exitCode: -1,
                    }
                  }
                  // 额外只读启发式：拒绝明显写操作
                  if (/\b(rm|mv|cp|dd|mkfs|chmod|chown|userdel|shutdown|reboot|systemctl\s+(start|stop|restart|enable|disable)|apt\s+install|yum\s+install)\b/i.test(command)) {
                    return {
                      ok: false,
                      error: 'ssh_readonly 仅允许只读查询，请使用演示模式 HITL 执行写操作',
                      stdout: '',
                      stderr: '',
                      exitCode: -1,
                    }
                  }
                  try {
                    const r = await SshConnectionManager.getInstance().exec(
                      sshSessionId,
                      command,
                    )
                    return {
                      ok: r.exitCode === 0,
                      exitCode: r.exitCode,
                      stdout: (r.stdout || '').slice(0, 12000),
                      stderr: (r.stderr || '').slice(0, 4000),
                      risk: risk.level,
                    }
                  } catch (e) {
                    return {
                      ok: false,
                      error: e instanceof Error ? e.message : String(e),
                      stdout: '',
                      stderr: '',
                      exitCode: -1,
                    }
                  }
                },
              }),
            }
          : undefined

      // 8. 调用 streamText（Vercel AI SDK v7；可选 tools + stopWhen）
      const result = streamText({
        model: modelInstance.model,
        messages: compaction.messages,
        temperature,
        maxOutputTokens: effectiveMaxTokens,
        abortSignal: abortController.signal,
        ...(tools
          ? {
              tools,
              stopWhen: isStepCount(4),
            }
          : {}),
      })

      // 累积完整文本
      let fullText = ''
      for await (const chunk of result.textStream) {
        if (chunk) {
          fullText += chunk
          onToken?.(chunk)
          // v0.9.6 P2 M5+：累积到 trace collector（fallback 切分在 finalize 进行）
          traceCollector.accumulateFinalText(chunk)
        }
      }

      // 8. 获取 token 使用（v7：result.usage 是 Promise）
      const usage = await result.usage
      const finishReason = await result.finishReason
      const inputTokens = usage?.inputTokens ?? 0
      const outputTokens = usage?.outputTokens ?? 0
      const totalTokens = inputTokens + outputTokens

      // 9. 记录 token 使用到统计服务
      recordTokenUsage({
        providerId: resolvedProviderId,
        model: modelInstance.resolvedModel,
        inputTokens,
        outputTokens,
        totalTokens,
        subagent: 'supervisor',
        strength,
        timestamp: Date.now(),
      })

      // v0.9.6 P2 M5+：finalize trace collector，附加熵轨迹到 ChatResult
      const traceResult = traceCollector.finalize()
      const cotEntropyTrajectory = traceResult.collected ? traceResult.trajectory : undefined

      const durationMs = Date.now() - startTime
      const chatResult: ChatResult = {
        text: fullText,
        usage: { inputTokens, outputTokens, totalTokens },
        finishReason: finishReason ?? 'unknown',
        providerId: resolvedProviderId,
        model: modelInstance.resolvedModel,
        strength,
        durationMs,
        compactionLevel: compaction.level === 'L5' ? 'L4' : compaction.level,
        cotEntropyTrajectory,
      }

      this.log.info('chat 调用完成', {
        correlationId,
        durationMs,
        inputTokens,
        outputTokens,
        totalTokens,
        finishReason: chatResult.finishReason,
        textLength: fullText.length,
        // v0.9.6 P2 M5+：CoT trace 元数据
        cotTrace: {
          totalSteps: traceResult.totalSteps,
          usedFallback: traceResult.usedFallback,
          sourceBreakdown: traceResult.sourceBreakdown,
        },
      })

      onDone?.(chatResult)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))

      // 区分取消和真实错误
      if (abortController.signal.aborted) {
        this.log.info('chat 调用已取消', { correlationId, durationMs: Date.now() - startTime })
        onDone?.({
          text: '',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          finishReason: 'cancelled',
          providerId: resolvedProviderId,
          model: modelInstance.resolvedModel,
          strength,
          durationMs: Date.now() - startTime,
          compactionLevel: compaction.level === 'L5' ? 'L4' : compaction.level,
        })
      } else {
        this.log.error('chat 调用失败', {
          correlationId,
          error: error.message,
          durationMs: Date.now() - startTime,
        })
        onError?.(error)
      }
    } finally {
      this.activeRequests.delete(correlationId)
    }
  }

  /**
   * 取消进行中的 chat 请求
   *
   * @param correlationId 关联 ID（chat 调用时传入）
   * @returns 是否成功取消（false 表示请求已结束或不存在）
   */
  cancelRequest(correlationId: string): boolean {
    const controller = this.activeRequests.get(correlationId)
    if (!controller) {
      this.log.warn('取消请求失败：correlationId 不存在或请求已结束', { correlationId })
      return false
    }
    controller.abort()
    this.log.info('已发出取消信号', { correlationId })
    return true
  }

  /**
   * 获取已注册的 Subagent（Week 2 由 Plan 阶段调度使用）
   *
   * @param name Subagent 名称
   * @returns Subagent 实例或 null（未注册时）
   */
  getSubagent(name: SubagentName): Subagent | null {
    return this.subagents[name] ?? null
  }

  /**
   * 列出所有已注册的 Subagent
   */
  listSubagents(): Subagent[] {
    return Object.values(this.subagents)
  }

  // ========================================================================
  // PAOR 循环（Plan-Act-Observe-Reflect）
  //
  // 与 agent-workflow.ts 的 7 步 HITL 互补：
  //   - 7 步 HITL 面向"单次诊断→修复→验证"的固定流程
  //   - PAOR 面向"多步运维任务"的迭代编排（可循环、可重试、可中止）
  // ========================================================================

  /**
   * 内部非流式 LLM 调用（PAOR 各阶段复用）
   *
   * 复用 chat() 的 Provider 解析 + createLanguageModel + token 统计模式，
   * 但使用 generateText 一次性返回完整文本（PAOR 不需要流式输出）。
   * 任何失败都返回空字符串，由调用方决定降级逻辑。
   *
   * @param systemPrompt 系统提示词
   * @param userPrompt 用户提示词
   * @param maxTokens 最大输出 token 数
   */
  private async callLlm(systemPrompt: string, userPrompt: string, maxTokens = 1024): Promise<string> {
    this.ensureInitialized()
    const config = getProviderWithApiKey(getDefaultProviderId())
    if (!config) {
      this.log.warn('[PAOR] callLlm 跳过：无可用 Provider')
      return ''
    }
    try {
      const modelInstance = createLanguageModel(config)
      const { temperature } = getDefaultParams(modelInstance.config)
      const result = await generateText({
        model: modelInstance.model,
        messages: [
          { role: 'system', content: systemPrompt } as ModelMessage,
          { role: 'user', content: userPrompt } as ModelMessage,
        ],
        temperature,
        maxOutputTokens: maxTokens,
      })
      const usage = result.usage
      recordTokenUsage({
        providerId: config.id,
        model: modelInstance.resolvedModel,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        totalTokens: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
        subagent: 'supervisor',
        strength: 'standard',
        timestamp: Date.now(),
      })
      return result.text ?? ''
    } catch (err) {
      this.log.warn('[PAOR] callLlm 调用失败', { error: err instanceof Error ? err.message : String(err) })
      return ''
    }
  }

  /**
   * Plan 阶段：分析运维任务，生成结构化执行计划
   *
   * 调用 LLM 输出 { goal, steps, risks, verification }；LLM 失败或解析失败时
   * 降级为单步计划（直接把任务作为唯一步骤），保证流程可继续。
   *
   * @param task 用户运维任务描述
   * @returns 结构化计划 + 置信度（LLM 成功 0.8，降级 0.3）
   */
  protected async plan(task: string): Promise<{ plan: PlanObject; confidence: number }> {
    this.log.info('[PAOR] Plan 阶段开始', { taskLength: task.length })
    const fallback: PlanObject = {
      goal: task,
      steps: [task],
      risks: ['未进行 LLM 风险评估'],
      verification: '人工确认执行结果',
    }
    const systemPrompt =
      '你是一位资深 Linux 运维工程师。分析以下运维任务，输出结构化执行计划：' +
      '1.目标 2.步骤列表 3.风险点 4.验证方法。' +
      '只返回 JSON，格式：{"goal":"...","steps":["..."],"risks":["..."],"verification":"..."}'
    const text = await this.callLlm(systemPrompt, task, 1024)
    const parsed = this.parsePlanJson(text)
    if (!parsed) {
      this.log.warn('[PAOR] Plan 降级为单步计划')
      return { plan: fallback, confidence: 0.3 }
    }
    this.log.info('[PAOR] Plan 阶段完成', { steps: parsed.steps.length, risks: parsed.risks.length })
    return { plan: parsed, confidence: 0.8 }
  }

  /**
   * Act 阶段：通过 SSH 执行计划中指定步骤
   *
   * 选取指定索引的步骤，经 SshConnectionManager 执行，记录 token 统计。
   * 无可用 SSH 会话或执行异常时优雅返回 success=false。
   *
   * @param plan 计划对象（steps 中对应索引作为待执行命令）
   * @param sessionId SSH 会话 ID
   * @param stepIndex 待执行步骤索引（默认 0，PAOR 循环中递增）
   * @returns 单步执行结果
   */
  protected async act(plan: PlanObject, sessionId: string, stepIndex = 0): Promise<ActResult> {
    const command = plan.steps[stepIndex] ?? ''
    this.log.info('[PAOR] Act 阶段开始', { sessionId, stepIndex, command })
    if (!command) {
      return { stepIndex, command, output: '计划中没有可执行步骤', success: false }
    }
    const ssh = SshConnectionManager.getInstance()
    if (ssh.getConnectionState(sessionId) !== 'connected') {
      this.log.warn('[PAOR] Act 中止：SSH 会话未连接', { sessionId })
      return { stepIndex, command, output: `SSH 会话 ${sessionId} 未连接`, success: false }
    }
    try {
      const result = await ssh.exec(sessionId, command)
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
      recordTokenUsage({
        providerId: 'ssh-exec',
        model: 'ssh',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        subagent: 'supervisor',
        strength: 'standard',
        timestamp: Date.now(),
      })
      const success = result.exitCode === 0
      this.log.info('[PAOR] Act 阶段完成', { stepIndex, exitCode: result.exitCode, success })
      return { stepIndex, command, output, success }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log.error('[PAOR] Act 执行异常', { stepIndex, error: message })
      return { stepIndex, command, output: message, success: false }
    }
  }

  /**
   * Observe 阶段：分析 Act 结果，判断成功/部分成功/失败
   *
   * 先用关键词启发式快速判断；当输出复杂（较长）或失败时调用 LLM 简要解读。
   *
   * @param actionResult Act 阶段执行结果
   * @returns 观察状态 + 观察要点 + 是否建议重试
   */
  protected async observe(actionResult: ActResult): Promise<ObserveResult> {
    this.log.info('[PAOR] Observe 阶段开始', { stepIndex: actionResult.stepIndex, success: actionResult.success })
    const output = actionResult.output
    const errorKeywords = ['error', 'failed', 'denied', 'not found', 'permission', '错误', '失败', '拒绝']
    const lower = output.toLowerCase()
    const hasError = errorKeywords.some((k) => lower.includes(k))
    let status: ObserveResult['status'] = actionResult.success ? (hasError ? 'partial' : 'success') : 'failed'
    const observations: string[] = []
    const needsRetry = !actionResult.success
    // 输出复杂或失败时调用 LLM 简要解读
    if (output.length > 200 || !actionResult.success) {
      const text = await this.callLlm(
        '你是 Linux 运维专家。简要分析以下命令执行结果，判断是否成功、有无异常。' +
          '只返回 JSON：{"status":"success|partial|failed","observations":["..."]}',
        `命令：${actionResult.command}\n退出成功：${actionResult.success}\n输出：\n${output.slice(0, 2000)}`,
        512
      )
      const parsed = this.parseObserveJson(text)
      if (parsed) {
        status = parsed.status
        observations.push(...parsed.observations)
      }
    }
    if (observations.length === 0) {
      observations.push(actionResult.success ? '命令执行成功，未见明显异常' : '命令执行失败，需要排查')
    }
    this.log.info('[PAOR] Observe 阶段完成', { status, needsRetry, observationCount: observations.length })
    return { status, observations, needsRetry }
  }

  /**
   * Reflect 阶段：对比观察结果与计划预期，决定下一步
   *
   * 决策规则：
   *   - 观察失败且需重试 → retry
   *   - 观察失败且不建议重试 → abort
   *   - 还有剩余步骤 → continue
   *   - 所有步骤完成 → done
   *
   * @param observation Observe 阶段结果
   * @param originalPlan 原始计划
   * @param currentStepIndex 当前已执行的步骤索引（PAOR 循环传入）
   * @returns 决策 + 理由（可选附带更新后的计划）
   */
  protected async reflect(observation: ObserveResult, originalPlan: PlanObject, currentStepIndex = 0): Promise<ReflectResult> {
    this.log.info('[PAOR] Reflect 阶段开始', { status: observation.status, needsRetry: observation.needsRetry })
    const totalSteps = originalPlan.steps.length
    if (observation.status === 'failed') {
      const decision = observation.needsRetry ? 'retry' : 'abort'
      const reasoning = observation.needsRetry
        ? '当前步骤执行失败，建议重试或调整命令后再次执行'
        : '当前步骤执行失败且不适合重试，中止任务以避免风险'
      this.log.info('[PAOR] Reflect 决策', { decision })
      return { decision, reasoning }
    }
    // 成功或部分成功：判断是否还有剩余步骤
    const hasNext = currentStepIndex < totalSteps - 1
    const decision: ReflectResult['decision'] = hasNext ? 'continue' : 'done'
    const reasoning = hasNext
      ? `当前步骤观察为 ${observation.status}，继续执行后续步骤（共 ${totalSteps} 步）`
      : `所有步骤已完成（观察状态 ${observation.status}），按验证方法「${originalPlan.verification}」确认结果`
    this.log.info('[PAOR] Reflect 决策', { decision })
    return { decision, reasoning }
  }

  // ========================================================================
  // PAOR 自动循环编排（方案书 v0.9 §3.2）
  // ========================================================================

  /**
   * PAOR 自动循环：Plan → (Act → Observe → Reflect)* → 结论
   *
   * 完整编排多步运维任务的自主执行循环：
   *   1. Plan：LLM 生成结构化执行计划（降级为单步计划）
   *   2. 循环（最多 maxIterations 轮）：
   *      - 风险闸门：HIGH/CRITICAL 命令需人工审批（Hard Constraint 4）
   *      - Act：SSH 执行当前步骤
   *      - Observe：分析执行结果
   *      - Reflect：决策 continue/retry/abort/done
   *   3. 输出完整迭代轨迹（可审计）+ 结论摘要
   *
   * 安全保证：
   *   - maxIterations 防止无限循环（默认 5）
   *   - 每步最多重试 maxRetriesPerStep 次（默认 1）
   *   - 高危命令未经审批自动跳过（安全默认策略）
   *
   * @param task 运维任务描述
   * @param sessionId SSH 会话 ID
   * @param options 循环选项（迭代上限/重试/审批回调/进度回调）
   * @returns 完整循环结果（含可审计的迭代轨迹）
   */
  async runPaorLoop(task: string, sessionId: string, options: PaorLoopOptions = {}): Promise<PaorLoopResult> {
    const startTime = Date.now()
    const maxIterations = options.maxIterations ?? 5
    const maxRetries = options.maxRetriesPerStep ?? 1

    // ── Phase 1: Plan ──
    const { plan, confidence } = await this.plan(task)
    let currentPlan = plan
    this.log.info('[PAOR-Loop] 计划已生成', { goal: currentPlan.goal, steps: currentPlan.steps.length, confidence })

    const iterations: PaorIteration[] = []
    let stepIndex = 0
    let retryCount = 0
    let iterationNum = 0
    let status: PaorLoopResult['status'] = 'max_iterations'
    let aborted = false

    // ── Phase 2: 循环 Act → Observe → Reflect ──
    while (iterationNum < maxIterations && stepIndex < currentPlan.steps.length && !aborted) {
      iterationNum++
      const command = currentPlan.steps[stepIndex] ?? ''

      // 风险闸门（Hard Constraint 4）：HIGH/CRITICAL 需人工审批
      const risk = assessRisk(command)
      if (risk.level === 'HIGH' || risk.level === 'CRITICAL') {
        let approved = false
        if (options.approveRisk) {
          try {
            approved = await options.approveRisk(command, risk.level, risk.description)
          } catch {
            approved = false
          }
        }
        if (!approved) {
          const iteration: PaorIteration = {
            iteration: iterationNum,
            stepIndex,
            act: { stepIndex, command, output: `命令被风控拦截（${risk.level}）：${risk.description}`, success: false },
            observe: { status: 'failed', observations: [`风险等级 ${risk.level}，未获人工批准，跳过此步骤`], needsRetry: false },
            reflect: { decision: 'continue', reasoning: '高危命令未获批准，跳过继续后续步骤' },
            riskBlocked: true
          }
          iterations.push(iteration)
          options.onIteration?.(iteration)
          this.log.warn('[PAOR-Loop] 高危命令被拦截', { stepIndex, level: risk.level })
          stepIndex++
          retryCount = 0
          continue
        }
      }

      // Act
      const actResult = await this.act(currentPlan, sessionId, stepIndex)

      // Observe
      const observeResult = await this.observe(actResult)

      // Reflect
      const reflectResult = await this.reflect(observeResult, currentPlan, stepIndex)
      if (reflectResult.updatedPlan) {
        currentPlan = reflectResult.updatedPlan
      }

      const iteration: PaorIteration = {
        iteration: iterationNum,
        stepIndex,
        act: actResult,
        observe: observeResult,
        reflect: reflectResult
      }
      iterations.push(iteration)
      options.onIteration?.(iteration)

      // 循环控制
      switch (reflectResult.decision) {
        case 'done':
          status = 'done'
          stepIndex = currentPlan.steps.length // 退出循环
          break
        case 'abort':
          status = 'abort'
          aborted = true
          break
        case 'retry':
          if (retryCount < maxRetries) {
            retryCount++
            this.log.info('[PAOR-Loop] 重试当前步骤', { stepIndex, retryCount })
          } else {
            // 重试耗尽，跳到下一步避免死循环
            this.log.warn('[PAOR-Loop] 重试次数耗尽，跳到下一步', { stepIndex })
            stepIndex++
            retryCount = 0
          }
          break
        case 'continue':
        default:
          stepIndex++
          retryCount = 0
          break
      }
    }

    // 所有步骤正常走完（最后一步 continue 导致 stepIndex 越界）也视为完成
    if (!aborted && status === 'max_iterations' && stepIndex >= currentPlan.steps.length) {
      status = 'done'
    }

    const summary = this.buildPaorSummary(status, currentPlan, iterations)
    const result: PaorLoopResult = {
      status,
      plan: currentPlan,
      planConfidence: confidence,
      iterations,
      summary,
      durationMs: Date.now() - startTime
    }
    this.log.info('[PAOR-Loop] 循环结束', { status, iterations: iterations.length, durationMs: result.durationMs })
    return result
  }

  /**
   * 生成 PAOR 循环结论摘要
   */
  private buildPaorSummary(status: PaorLoopResult['status'], plan: PlanObject, iterations: PaorIteration[]): string {
    const successCount = iterations.filter((i) => i.observe.status === 'success').length
    const blockedCount = iterations.filter((i) => i.riskBlocked).length
    const parts: string[] = []

    switch (status) {
      case 'done':
        parts.push(`任务「${plan.goal}」已完成`)
        break
      case 'abort':
        parts.push(`任务「${plan.goal}」执行中止`)
        break
      case 'max_iterations':
        parts.push(`任务「${plan.goal}」达到迭代上限，部分步骤未执行`)
        break
    }

    parts.push(`${successCount}/${iterations.length} 轮观察成功`)
    if (blockedCount > 0) parts.push(`${blockedCount} 条高危命令被风控拦截`)
    if (plan.verification) parts.push(`验证方法：${plan.verification}`)

    const lastReflect = iterations[iterations.length - 1]?.reflect
    if (lastReflect) parts.push(`最终决策：${lastReflect.reasoning}`)

    return parts.join('。')
  }

  /**
   * 解析 Plan 阶段 LLM 输出的 JSON（容错：支持 markdown 代码块包裹）
   */
  private parsePlanJson(text: string): PlanObject | null {
    const obj = this.extractJson(text)
    if (!obj) return null
    const goal = typeof obj.goal === 'string' ? obj.goal : ''
    const steps = Array.isArray(obj.steps) ? obj.steps.filter((s): s is string => typeof s === 'string') : []
    if (!goal || steps.length === 0) return null
    return {
      goal,
      steps,
      risks: Array.isArray(obj.risks) ? obj.risks.filter((r): r is string => typeof r === 'string') : [],
      verification: typeof obj.verification === 'string' ? obj.verification : '人工确认执行结果',
    }
  }

  /**
   * 解析 Observe 阶段 LLM 输出的 JSON（容错）
   */
  private parseObserveJson(text: string): { status: ObserveResult['status']; observations: string[] } | null {
    const obj = this.extractJson(text)
    if (!obj) return null
    const status = obj.status
    if (status !== 'success' && status !== 'partial' && status !== 'failed') return null
    const observations = Array.isArray(obj.observations)
      ? obj.observations.filter((o): o is string => typeof o === 'string')
      : []
    return { status, observations }
  }

  /**
   * 从 LLM 文本中提取 JSON 对象（支持纯 JSON 或 ```json 代码块）
   */
  private extractJson(text: string): Record<string, unknown> | null {
    if (!text || text.trim().length === 0) return null
    const candidates: string[] = [text.trim()]
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlock) candidates.push(codeBlock[1].trim())
    const braceMatch = text.match(/\{[\s\S]*\}/)
    if (braceMatch) candidates.push(braceMatch[0])
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>
        }
      } catch {
        // 尝试下一个候选
      }
    }
    return null
  }

  // ========================================================================
  // 人工审批闸门接口（Hard Constraint 4，Week 2 实现 UI 联动）
  // ========================================================================

  /**
   * 判断是否需要人工审批（Week 2 实现具体规则）
   *
   * 默认规则（Week 2 实现）：
   * - 思考强度为 deep 时，所有 Subagent 结果均需审批
   * - running-subagent 的所有任务均需审批（高危命令执行）
   * - 风险等级为 high/critical 的工具调用均需审批
   *
   * @param _task 待审批的任务
   */
  isApprovalRequired(_task: SubagentTask): boolean {
    return false
  }

  /**
   * 请求人工审批（Week 2 实现 IPC 推送）
   *
   * 当前版本仅记录日志，返回 pending 状态的结果。
   *
   * @param task 任务对象
   * @param preview 审批预览文本
   */
  async requestApproval(task: SubagentTask, preview: string): Promise<SubagentResult> {
    this.log.warn('请求人工审批（Week 2 实现 UI 联动）', {
      taskId: task.id,
      preview,
    })
    return {
      taskId: task.id,
      success: false,
      output: null,
      error: '等待人工审批（Week 2 实现 UI 联动）',
      durationMs: 0,
      requiresApproval: true,
      approvalPreview: preview,
    }
  }
}

/**
 * 全局 Supervisor 单例（懒加载）
 *
 * 首次访问时创建，避免在模块加载时初始化（依赖 electron-store，需 app.ready 后才能用）。
 */
let supervisorInstance: SupervisorAgent | null = null

/**
 * 获取 Supervisor Agent 单例
 *
 * @returns SupervisorAgent 实例
 */
export function getSupervisor(): SupervisorAgent {
  if (!supervisorInstance) {
    supervisorInstance = new SupervisorAgent()
  }
  return supervisorInstance
}

/**
 * 重置 Supervisor 单例（仅用于测试）
 *
 * 取消所有进行中的请求并清空实例。
 */
export function resetSupervisor(): void {
  if (supervisorInstance) {
    for (const correlationId of supervisorInstance['activeRequests'].keys()) {
      supervisorInstance.cancelRequest(correlationId)
    }
  }
  supervisorInstance = null
}
