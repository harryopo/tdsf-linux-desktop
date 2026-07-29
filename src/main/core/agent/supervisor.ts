/**
 * Supervisor Agent（监督者 Agent）
 *
 * 职责：
 * - 作为 Agent 系统的统一入口，封装 streamText 调用
 * - 实现 Plan-Act-Observe-Reflect（PAOR）循环编排
 * - 集成 Provider 抽象层（provider-factory）
 * - 集成敏感信息脱敏（redactSecrets，Hard Constraint 6）
 * - 集成 Token 统计（token-stats）
 * - 集成上下文管理（compactIfNeeded，5 层 compaction）
 * - 注册 8 个 Subagent（通过 Plan 阶段调度）
 * - 人工审批闸门（Hard Constraint 4，已接入 BaseSubagent.execute 流程）
 * - 支持请求取消（AbortController）
 *
 * ============================================================================
 * v2.0 Phase E.3 边界声明（Mastra vs Supervisor，详见 docs/AGENT-BOUNDARY.md）
 * ============================================================================
 *
 * 【本文件：SupervisorAgent】— **多步场景专用**
 *
 * 适用条件（满足任意 1 项即走 Supervisor）：
 *   1. 需要多步推理：PAOR 4 阶段循环（plan/act/observe/reflect）
 *   2. 需要 HITL 审批：高危操作（写文件、执行命令、修改 sandbox）
 *   3. 需要 Subagent 调度：8 个 Subagent 之一（explore/coding/verify/...）
 *   4. 需要可信度评估：6 源证据融合 + 决策卡 + 审计报告
 *   5. 需要上下文 compaction：长对话压缩（5 层 L1-L4）
 *
 * 典型场景：
 *   - 复杂故障诊断（"服务为什么变慢了"）→ PAOR 多轮 + 多 Subagent
 *   - 高危命令执行（"重启 nginx"）→ 7 步 HITL 审批
 *   - 跨 Subagent 协作（explore + coding + verify）→ Plan 阶段调度
 *   - 决策卡生成 + EU AI Act 审计报告 → credibility 子系统
 *
 * 不适用场景（应走 Mastra OpsAgent）：
 *   - 单轮简单查询（如"查看 CPU 使用率"）→ Mastra 一次工具调用
 *   - 教程搜索（如"搜索 nginx 教程"）→ Mastra tutorial_search
 *   - MCP Server 无状态单次请求 → Mastra Agent.generate()
 *
 * 与 Mastra OpsAgent 的关系：
 *   - **不互相调用**：supervisor 不调用 ops-agent，ops-agent 也不调用 supervisor
 *   - **共享工具**：两者都通过 ToolRegistry 复用 5 个核心工具
 *   - **路由由 IPC 层决定**：上层 IPC handler 根据请求复杂度选择路径
 *   - **共享 Provider**：两者都通过 provider-registry 获取 LLM 实例
 *
 * 已实现：
 * - chat() 方法：streamText 包装 + redact + token 统计 + compaction
 * - PAOR 四阶段完整实现（plan/act/observe/reflect + runPaorLoop 自动循环）
 * - createAllSubagents() 注册 + 审批闸门（isApprovalRequired / requestApproval）
 * - cancelRequest() 取消进行中的请求
 *
 * 方案书依据：v0.9 §3.2（PAOR 循环）+ §3.1（8 个 Subagent）+ §10（Hard Constraints）
 *             + v2.0 Phase E.3 TD-3 边界澄清
 *
 * 详见决策树：docs/AGENT-BOUNDARY.md §决策树
 */
import { streamText, generateText, tool, isStepCount, type ModelMessage } from 'ai'
import { z } from 'zod'
import { routeChatTools, CHAT_TOOL_CATALOG } from './tools/chat-tool-router'
// v2.10 快慢思考自动路由：auto 档按复杂度解析为 standard/deep
import { resolveThinkingStrength } from './thinking-router'
// v2.11 PAOR 状态图编排：路由决策纯函数（可单测，默认行为与旧 switch 等价）
import {
  initPaorState,
  shouldContinueLoop,
  routePaorNext,
  routeRiskRejected,
  type PaorDecision,
  type PaorRouteLimits,
} from './paor-graph'
import { createLanguageModel, getDefaultParams } from './providers/provider-factory'
import { getProviderWithApiKey, getDefaultProviderId, ensureProvidersInitialized } from './providers/provider-registry'
import { getProviderCapabilities } from './providers/provider-capabilities'
import { redactSecrets } from './providers/redact'
import { recordTokenUsage } from './providers/token-stats'
import { compactIfNeeded } from './context'
import { createAllSubagents } from './subagents'
import type { Subagent, SubagentName, SubagentTask, SubagentResult } from './subagents/base'
import type { ThinkingStrength } from './providers/types'
import type { ChatResult, RequestedThinkingStrength } from '@shared/agent-types'
import { logger } from '../../services/log/logger'
import { SshConnectionManager } from '../../services/ssh/connection-manager'
import { preflightCheck } from '../../services/ssh/command-preflight'
// v2.9 sftp_read 工具：复用 SftpManager 读远程文件内容（与 claude-sdk-tools 同模式）
import { SftpManager } from '../../services/ssh/sftp'
import { createCotTraceCollector } from './credibility/mass-functions/cot-trace-collector'
import { assessRisk } from '../risk-engine'
import { withCallbackStreamTrace } from '../../services/observability/langfuse-trace'
import { DatabaseManager } from '../../services/db/database'
import { KnowledgeRepository } from '../../services/db/knowledge-repo'
// v2.8 长期记忆：仓储 + 自动提取（对话结束 fire-and-forget）+ 工具失败教训沉淀
import { MemoryRepository } from '../../services/db/memory-repo'
import { extractMemories, recordToolFailure } from './memory/memory-extractor'
// v2.9 语义检索：混合召回（向量+关键词）+ 后台 embedding 回填
import { recallMemories, backfillMemoryEmbeddings } from './memory/memory-embedding'
import { TutorialRepository } from '../../services/tutorial/tutorial-repo'
import { getSkillRouter } from '../../services/skills/skill-router-singleton'

/**
 * 流式 chat 调用参数
 */
export interface ChatParams {
  /** 对话消息列表（用户输入会先经 redactSecrets 脱敏） */
  messages: ModelMessage[]
  /** Provider ID（不传时使用默认 Provider） */
  providerId?: string
  /** 思考强度（影响 maxTokens 与后续是否调度 Subagent；v2.10 支持 'auto' 自动路由） */
  strength?: RequestedThinkingStrength
  /** token 流式回调（每个 chunk 调用一次） */
  onToken?: (delta: string) => void
  /**
   * 思考链增量回调（v2.5 深度思考可视化）
   *
   * DeepSeek 思考模式（strength='deep'）下 fullStream 产生 reasoning-delta 分片；
   * 此回调把思考内容透传给上层推送到前端，渲染为可折叠的“深度思考”块。
   */
  onReasoning?: (delta: string) => void
  /** 完成回调（含完整文本和 token 使用） */
  onDone?: (result: ChatResult) => void
  /** 错误回调 */
  onError?: (error: Error) => void
  /**
   * 工具事件回调（v2.4 新增，用于前端可视化真实工具调用）
   *
   * 主对话 Agent 真实调用工具（如 ssh_readonly）时，fullStream 产生 tool-call/
   * tool-result 分片；此回调把它们透传给上层推送到前端。phase 区分开始/结果。
   * v2.6：新增 phase='output' —— ssh_readonly 执行中的 stdout/stderr 块实时透传，
   * 前端得以流式展示命令输出（不再等命令结束才见结果）。
   */
  onToolEvent?: (evt: {
    toolCallId: string
    phase: 'call' | 'output' | 'result'
    toolName: string
    input?: string
    ok?: boolean
    output?: string
  }) => void
  /** 关联 ID（用于日志追踪 + 取消请求） */
  correlationId?: string
  /**
   * 活跃 SSH 会话 ID（可选）。
   * 传入后启用只读 ssh_readonly 工具，供运维诊断查询。
   * 注意：agent-runtime 的 session-registry id 与 SSH session 不同；
   * 此处必须是 SshConnectionManager 的 sessionId。
   */
  sshSessionId?: string
  /**
   * 写命令 HITL 审批回调（v2.9 新增）。
   * ssh_write 工具执行前调用；未注入时写命令一律拒绝（安全默认）。
   * agent-runtime 侧复用 PAOR 审批通道（paor:approval-request 卡片）实现。
   */
  approveWriteCommand?: (command: string, riskLevel: string, riskDescription: string) => Promise<boolean>
}

// ChatResult 类型从 @shared/agent-types 导入（供 preload/renderer 共享）
// 重新导出便于 main 内部从 supervisor 导入
export type { ChatResult } from '@shared/agent-types'

/**
 * PAOR 循环阶段
 */
export type PaorPhase = 'plan' | 'act' | 'observe' | 'reflect'

/**
 * PAOR 单次循环结果
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
  /** 循环决策：继续下一步 / 重试 / 中止 / 计划完成 / 回退重规划（v2.11） */
  decision: 'continue' | 'retry' | 'abort' | 'done' | 'replan'
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
  /** 最终状态：done=计划完成，abort=中止，max_iterations=达到迭代上限，blocked=重规划耗尽仍受阻（v2.11） */
  status: 'done' | 'abort' | 'max_iterations' | 'blocked'
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
  /** 最大重新规划次数（v2.11，默认 0=禁用 replan 回退，保持旧行为） */
  maxReplans?: number
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
  /** 已注册的 Subagent 表（由 Plan 阶段按 type 调度） */
  private readonly subagents: Record<SubagentName, Subagent>

  /** 进行中的请求表：correlationId → AbortController（用于取消请求） */
  private readonly activeRequests = new Map<string, AbortController>()

  /** 是否已初始化（避免重复初始化 Subagent） */
  private initialized = false

  constructor() {
    // 创建所有 Subagent 实例
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
   * D.5: 在入口包一层 withCallbackStreamTrace，记录 Langfuse 流式 trace。
   * 真正的流式逻辑在 chatImpl() 中（未修改）。
   *
   * @param params chat 调用参数
   */
  async chat(params: ChatParams): Promise<void> {
    const correlationId =
      params.correlationId ?? `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // 提取最后一条 user 消息文本作为 trace input（仅 string content，多模态跳过）
    let userQuery: string | undefined
    for (let i = params.messages.length - 1; i >= 0; i--) {
      const m = params.messages[i]
      if (m.role === 'user' && typeof m.content === 'string') {
        userQuery = m.content
        break
      }
    }

    return withCallbackStreamTrace(
      (p) => this.chatImpl(p),
      { ...params, correlationId },
      {
        sessionId: correlationId,
        workflowName: 'supervisor-chat',
        userQuery,
        metadata: {
          providerId: params.providerId,
          strength: params.strength ?? 'standard',
          sshSessionId: params.sshSessionId,
        },
      }
    )
  }

  /**
   * 流式 chat 调用内部实现（被 chat() 包装）
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
   * @param params chat 调用参数（correlationId 由 chat() 保证已设置）
   */
  private async chatImpl(params: ChatParams): Promise<void> {
    const {
      messages,
      providerId,
      strength: requestedStrength = 'standard',
      onToken,
      onReasoning,
      onDone,
      onError,
      onToolEvent,
      correlationId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sshSessionId,
      approveWriteCommand,
    } = params

    // v2.10 快慢思考自动路由：提前提取最后一条用户消息（复用于复杂度评分），
    // strength='auto'（或未知值）时按复杂度解析为 standard/deep；显式档不覆盖。
    // 解析后的 strength 为三档之一，下游（maxTokens/thinking/审批）均无感。
    let earlyUserText = ''
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === 'user' && typeof m.content === 'string') {
        earlyUserText = m.content
        break
      }
    }
    const strengthRoute = resolveThinkingStrength(requestedStrength, earlyUserText)
    const strength: ThinkingStrength = strengthRoute.resolved

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
      // 多模态内容暂不脱敏（当前仅支持纯文本消息）
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
    // v2.11 P0 修复“输出到一半卡死”：streamText 无内建超时，DeepSeek 思考期网络停顿
    // 会让 fullStream 的 for-await 无限等待，onDone/onError 都不触发 → 前端 isStreaming 永远 true。
    // 空闲看门狗状态（method 作用域，供 try/catch/finally 共享）：
    const STREAM_IDLE_TIMEOUT_MS = 90_000
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let streamTimedOut = false

    // 思考强度影响 maxTokens：deep 模式翻倍
    const effectiveMaxTokens =
      strength === 'deep' ? maxTokens * 2 : strength === 'fast' ? Math.floor(maxTokens / 2) : maxTokens

    // v0.9.6 P2 M5+：CoT 熵轨迹收集器
    // v0.9.7 P3 M1 升级：若 provider 支持 logprobs，优先走真实 token entropy 路径
    // Vercel AI SDK v7 路径：streamText 不暴露 per-step content block，
    // logprobs 通过 fullStream 的 providerMetadata 事件返回
    const traceCollector = createCotTraceCollector()

    // Phase J.3：DeepSeek 思考模式参数
    // 当 provider 类型为 deepseek 且思考强度为 deep 时，启用思考模式：
    // - thinking: { type: 'enabled' } — 启用思考链（DeepSeek-V4-Pro）
    // - reasoning_effort: 'high' — 思考强度高（消耗更多 token 但推理更深）
    // 通过 providerOptions 透传到 @ai-sdk/openai 的 createOpenAI 调用，
    // SDK 会原样转发给 DeepSeek API（OpenAI 兼容协议的扩展字段）。
    // 注意：仅在 deepseek + deep 时启用，避免 fast/standard 模式产生不必要的思考开销。
    const enableDeepseekThinking =
      modelInstance.config.type === 'deepseek' && strength === 'deep'

    // v0.9.7 P3 M1：logprobs 直采支持
    // 检查 provider 是否支持 logprobs（OpenAI 协议：deepseek/qwen/volcengine-ark/ollama/openai-compatible）
    // - 支持：透传 providerOptions.openai.logprobs + top_logprobs，fullStream 捕获 providerMetadata
    // - 不支持：保持现有 text-fallback 路径（Claude/google/claude-sdk）
    const caps = getProviderCapabilities(modelInstance.config)
    const enableLogprobs = caps.logprobs === true

    this.log.info('chat 调用开始', {
      correlationId,
      providerId: resolvedProviderId,
      model: modelInstance.resolvedModel,
      strength,
      temperature,
      maxTokens: effectiveMaxTokens,
      messageCount: compaction.messages.length,
      compactionLevel: compaction.level,
      thinkingEnabled: enableDeepseekThinking,
      logprobsEnabled: enableLogprobs,
    })

    try {
      // v2.6：提前提取最后一条用户消息（意图路由 + Skill 路由共用）
      let lastUserText = ''
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (m.role === 'user' && typeof m.content === 'string') {
          lastUserText = m.content
          break
        }
      }

      // 7. 只读 SSH 工具（有活跃 SSH 会话时挂载）—— 下方与知识检索工具合并为 tools
      const sshTools =
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
                execute: async (
                  { command }: { command: string },
                  execOpts?: { toolCallId?: string },
                ) => {
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
                    // v2.6 前置环境预检：执行前先确认命令行涉及的外部命令在目标机存在，
                    // 缺失时直接返回明确原因（而非一堆 command not found 噪音）；
                    // 预检自身失败 fail-open 放行，不阻塞主命令。
                    const streamCallId = execOpts?.toolCallId
                    const pre = await preflightCheck(sshSessionId, command)
                    if (!pre.ok) {
                      return {
                        ok: false,
                        error:
                          `前置检查未通过：服务器上缺少命令 ${pre.missing.join('、')}。` +
                          `请改用系统已有命令，或提示用户先安装对应软件包。`,
                        stdout: '',
                        stderr: '',
                        exitCode: -1,
                        preflight: { checked: pre.checked, missing: pre.missing },
                      }
                    }
                    if (!pre.skipped && streamCallId && onToolEvent) {
                      // 可视化：预检通过作为首行流式输出（同步回显到终端）
                      onToolEvent({
                        toolCallId: streamCallId,
                        phase: 'output',
                        toolName: 'ssh_readonly',
                        output: `[前置检查] ✓ ${pre.checked.join('、')} 均可用\n`,
                      })
                    }
                    // v2.6 流式输出：每收到一块 stdout/stderr 立即经 onToolEvent 推到前端
                    //（phase='output'，与 fullStream 的 call/result 共用 toolCallId 配对），
                    // 总量超 12000 字符后停止推送（累积结果仍完整，result 阶段另行截断）
                    let streamedChars = 0
                    const r = await SshConnectionManager.getInstance().exec(
                      sshSessionId,
                      command,
                      streamCallId && onToolEvent
                        ? (chunk) => {
                            if (streamedChars >= 12000) return
                            const remain = 12000 - streamedChars
                            const piece =
                              chunk.length > remain
                                ? `${chunk.slice(0, remain)}\n...(输出过长，流式展示已截断)`
                                : chunk
                            streamedChars += chunk.length
                            onToolEvent({
                              toolCallId: streamCallId,
                              phase: 'output',
                              toolName: 'ssh_readonly',
                              output: piece,
                            })
                          }
                        : undefined,
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
              // v2.9 写操作工具（HITL 审批）：修改配置/重启服务/装包等，
              // 每次执行前弹审批卡片，用户批准才执行；未注入审批回调一律拒绝
              ssh_write: tool({
                description:
                  '在已连接主机上执行【写操作】命令（修改配置/重启服务/安装软件包等）。' +
                  '每次执行都会弹出审批卡片，必须等用户批准；被拒绝时尊重决定不要重试。' +
                  '只读查询请用 ssh_readonly。',
                inputSchema: z.object({
                  command: z.string().min(1).describe('写操作 shell 命令，如: systemctl restart nginx / yum install -y htop'),
                  reason: z.string().min(1).describe('为什么需要执行（展示给用户的审批理由）'),
                }),
                execute: async (
                  { command, reason }: { command: string; reason: string },
                  execOpts?: { toolCallId?: string },
                ) => {
                  const risk = assessRisk(command)
                  // 被风险引擎硬拦截（fork 炸弹/rm -rf / 等）的命令连审批机会都没有
                  if (risk.blocked) {
                    return { ok: false, error: `命令被风险引擎硬拦截（${risk.level}）：${risk.description}`, exitCode: -1 }
                  }
                  if (!approveWriteCommand) {
                    return { ok: false, error: '当前会话未启用写命令审批通道，写操作已拒绝（安全默认）', exitCode: -1 }
                  }
                  const streamCallId = execOpts?.toolCallId
                  // 可视化：审批等待中提示
                  if (streamCallId && onToolEvent) {
                    onToolEvent({
                      toolCallId: streamCallId,
                      phase: 'output',
                      toolName: 'ssh_write',
                      output: `[等待审批] 理由：${reason}（60 秒内未审批自动拒绝）\n`,
                    })
                  }
                  let approved = false
                  try {
                    approved = await approveWriteCommand(command, risk.level, `${risk.description}｜AI 理由：${reason}`)
                  } catch {
                    approved = false
                  }
                  if (!approved) {
                    return { ok: false, error: '用户拒绝执行（或审批超时）。请尊重决定，不要重试同一命令。', exitCode: -1 }
                  }
                  try {
                    let streamedChars = 0
                    const r = await SshConnectionManager.getInstance().exec(
                      sshSessionId,
                      command,
                      streamCallId && onToolEvent
                        ? (chunk) => {
                            if (streamedChars >= 12000) return
                            const piece = chunk.length > 12000 - streamedChars ? chunk.slice(0, 12000 - streamedChars) : chunk
                            streamedChars += chunk.length
                            onToolEvent({ toolCallId: streamCallId, phase: 'output', toolName: 'ssh_write', output: piece })
                          }
                        : undefined,
                    )
                    return {
                      ok: r.exitCode === 0,
                      exitCode: r.exitCode,
                      stdout: (r.stdout || '').slice(0, 12000),
                      stderr: (r.stderr || '').slice(0, 4000),
                      approved: true,
                      risk: risk.level,
                    }
                  } catch (e) {
                    return { ok: false, error: e instanceof Error ? e.message : String(e), exitCode: -1 }
                  }
                },
              }),
              // v2.9 限时日志追踪：timeout N journalctl -f 实时跟踪后自动停止（纯只读）
              ssh_journal_follow: tool({
                description:
                  '实时追踪系统/服务日志（journalctl -f）指定秒数后自动停止，适合排查间歇性报错。' +
                  '输出实时流式展示；只读操作无需审批。',
                inputSchema: z.object({
                  unit: z.string().optional().describe('systemd 服务名（可选，如 nginx）；不传则跟踪全部日志'),
                  seconds: z.number().int().min(3).max(30).default(10).describe('追踪时长秒数（3-30，默认 10）'),
                }),
                execute: async (
                  { unit, seconds }: { unit?: string; seconds?: number },
                  execOpts?: { toolCallId?: string },
                ) => {
                  // unit 白名单校验防注入（仅允许服务名字符）
                  if (unit && !/^[A-Za-z0-9_.@-]+$/.test(unit)) {
                    return { ok: false, error: `非法服务名：${unit}`, exitCode: -1 }
                  }
                  const dur = Math.min(Math.max(seconds ?? 10, 3), 30)
                  const cmd = `timeout ${dur}s journalctl -f -n 20 --no-pager${unit ? ` -u ${unit}` : ''}`
                  const streamCallId = execOpts?.toolCallId
                  try {
                    let streamedChars = 0
                    const r = await SshConnectionManager.getInstance().exec(
                      sshSessionId,
                      cmd,
                      streamCallId && onToolEvent
                        ? (chunk) => {
                            if (streamedChars >= 12000) return
                            const piece = chunk.length > 12000 - streamedChars ? chunk.slice(0, 12000 - streamedChars) : chunk
                            streamedChars += chunk.length
                            onToolEvent({ toolCallId: streamCallId, phase: 'output', toolName: 'ssh_journal_follow', output: piece })
                          }
                        : undefined,
                    )
                    // timeout 到时退出码 124 = 正常结束（追踪完成）
                    const normalEnd = r.exitCode === 0 || r.exitCode === 124
                    return {
                      ok: normalEnd,
                      exitCode: r.exitCode,
                      stdout: (r.stdout || '').slice(0, 12000),
                      stderr: normalEnd ? '' : (r.stderr || '').slice(0, 2000),
                      followedSeconds: dur,
                    }
                  } catch (e) {
                    return { ok: false, error: e instanceof Error ? e.message : String(e), exitCode: -1 }
                  }
                },
              }),
              // v2.9 远程文件读取：下载日志/配置文件内容分析（只读，内容脱敏）
              sftp_read: tool({
                description:
                  '读取远程服务器上的文本文件内容（日志/配置等）用于分析，上限 512KB。' +
                  '适合“帮我看看这个配置文件/分析这个日志”场景。',
                inputSchema: z.object({
                  path: z.string().min(1).describe('远程文件绝对路径，如 /etc/nginx/nginx.conf'),
                }),
                execute: async ({ path: remotePath }: { path: string }) => {
                  try {
                    const content = await new SftpManager(SshConnectionManager.getInstance()).readFile(
                      sshSessionId,
                      remotePath,
                      512 * 1024,
                    )
                    // HC-2：文件可能含密钥/凭证，强制脱敏后再给模型
                    const safe = redactSecrets(content)
                    return {
                      ok: true,
                      path: remotePath,
                      size: content.length,
                      content: safe.slice(0, 12000),
                      truncated: safe.length > 12000,
                    }
                  } catch (e) {
                    return { ok: false, error: e instanceof Error ? e.message : String(e) }
                  }
                },
              }),
            }
          : undefined

      // 7b. 知识检索工具（只读，无副作用）：DatabaseManager 单例，db 可用即常驻，无需 SSH。
      // 与 ssh_readonly 一样，其 tool-call/tool-result 会被下方 fullStream 捕获并经
      // onToolEvent 推送到前端「执行卡片」，复用同一套可视化通道（v2.4 P2）。
      const db = DatabaseManager.getInstance()
      const candidateTools = {
        // 知识库检索：历史故障案例 / 命令技能（Jaccard 关键词匹配）
        kb_search: tool({
          description:
            '检索本地运维知识库（历史故障案例 / 命令技能），返回匹配条目的标题、问题、修复命令等。' +
            '当用户问"这类问题以前怎么解决 / 有没有处理经验"时优先调用。',
          inputSchema: z.object({
            query: z.string().min(1).describe('检索关键词（中英文均可），如: nginx 502 / 磁盘满 / OOM'),
            limit: z.number().int().min(1).max(5).default(3).describe('返回条数（默认 3，上限 5）'),
          }),
          execute: async ({ query, limit }: { query: string; limit?: number }) => {
            try {
              const entries = new KnowledgeRepository(db).search(query, undefined, limit ?? 3)
              const results = entries.map((e) => ({
                id: e.id,
                type: e.type,
                title: e.title,
                problem: e.problem,
                commands: e.commands,
                keywords: e.keywords,
                successRate: e.successRate,
                useCount: e.useCount,
              }))
              // v2.6：摘要附真实置信信息（成功率/使用次数），模型回答时引用，
              // 用户在对话里能看到知识可信度依据（教程类 successRate 是阅读时长 hack，不标注）
              const summary = results.length
                ? results
                    .map((r, i) => {
                      const cred =
                        r.type === 'tutorial'
                          ? ''
                          : `（成功率 ${Math.round(r.successRate * 100)}%，被使用 ${r.useCount} 次）`
                      return `${i + 1}. [${r.title}]${cred} ${r.problem}`
                    })
                    .join('\n')
                : `未在知识库找到与"${query}"相关的条目`
              return { ok: true, count: results.length, results, summary }
            } catch (e) {
              return { ok: false, error: e instanceof Error ? e.message : String(e) }
            }
          },
        }),
        // 教程检索：官方权威 Linux 教程库
        tutorial_search: tool({
          description:
            '搜索官方 Linux 教程库，返回匹配教程的标题、摘要、分类、来源。' +
            '当用户想学习 / 配置某项功能时优先调用，并在回答中给出教程来源。',
          inputSchema: z.object({
            query: z.string().min(1).describe('教程搜索关键词，如: nginx 反向代理 / systemd 服务'),
            limit: z.number().int().min(1).max(5).default(3).describe('返回条数（默认 3，上限 5）'),
          }),
          execute: async ({ query, limit }: { query: string; limit?: number }) => {
            try {
              const entries = new TutorialRepository(db).search(query, limit ?? 3)
              const results = entries.map((e) => ({
                id: e.id,
                title: e.title,
                summary: e.summary,
                category: e.category,
                sourceName: e.source.name,
              }))
              // v2.6：摘要附来源名，模型回答时可标注教程出处
              const summary = results.length
                ? results
                    .map((r, i) => `${i + 1}. [${r.title}]（来源：${r.sourceName}）${r.summary}`)
                    .join('\n')
                : `未找到与"${query}"相关的教程`
              return { ok: true, count: results.length, results, summary }
            } catch (e) {
              return { ok: false, error: e instanceof Error ? e.message : String(e) }
            }
          },
        }),
        // v2.8 长期记忆回忆：跨会话记忆（用户画像/环境事实/错误教训）关键词检索
        memory_recall: tool({
          description:
            '检索跨会话长期记忆（用户画像/偏好/服务器环境事实/历史错误教训）。' +
            '用户提及"上次/之前/记得吗"或需要历史上下文时调用；记忆仅作参考，当前指令与真实状态优先。',
          inputSchema: z.object({
            query: z.string().min(1).describe('回忆关键词，如: nginx 安装路径 / 用户偏好 / 上次磁盘告警'),
            limit: z.number().int().min(1).max(5).default(3).describe('返回条数（默认 3，上限 5）'),
          }),
          execute: async ({ query, limit }: { query: string; limit?: number }) => {
            try {
              // v2.9 混合检索：优先向量语义召回，不足时关键词兜底（降级安全）
              const { results: memories, mode } = await recallMemories(new MemoryRepository(db), query, limit ?? 3)
              const summary = memories.length
                ? memories
                    .map((m, i) => `${i + 1}. [${m.type}] ${m.text}${m.why ? `（原因：${m.why}）` : ''}`)
                    .join('\n')
                : `长期记忆中没有与"${query}"相关的内容`
              return { ok: true, count: memories.length, mode, summary }
            } catch (e) {
              return { ok: false, error: e instanceof Error ? e.message : String(e) }
            }
          },
        }),
        // 只读 SSH 诊断：有活跃 SSH 会话时才并入（沿用上方 sshTools 定义）
        ...(sshTools ?? {}),
      }

      // 7c. v2.6 意图路由：根据用户消息按需选择本轮挂载的工具子集（零 Token 本地匹配），
      // 并经 onToolEvent 推「工具装配」卡片可视化路由决策（复用 skill_match 卡片模式）。
      const toolRoute = routeChatTools(lastUserText, { ssh: Boolean(sshTools), db: true })
      const tools = Object.fromEntries(
        Object.entries(candidateTools).filter(([name]) =>
          (toolRoute.mounted as string[]).includes(name),
        ),
      ) as typeof candidateTools
      const hasTools = Object.keys(tools).length > 0
      {
        const mountedLabels = CHAT_TOOL_CATALOG
          .filter((e) => toolRoute.mounted.includes(e.id))
          .map((e) => `${e.label}(${e.id})`)
          .join('、')
        const unavailableNote = toolRoute.unavailable.length
          ? `\n不可用：${toolRoute.unavailable.map((u) => `${u.label}（${u.missing}）`).join('、')}`
          : ''
        const routeCallId = `route_${correlationId}`
        onToolEvent?.({
          toolCallId: routeCallId,
          phase: 'call',
          toolName: 'tool_route',
          input: lastUserText.slice(0, 120) || '(无用户消息)',
        })
        onToolEvent?.({
          toolCallId: routeCallId,
          phase: 'result',
          toolName: 'tool_route',
          ok: true,
          output: `${toolRoute.reason}\n挂载：${mountedLabels || '（无）'}${unavailableNote}`,
        })
      }

      // v2.10 快慢思考自动路由可视化：auto 档下推送一张「思考强度」卡片（复用 skill_match 模式），
      // 让用户看到“为什么自动升/不升 deep”；显式档不推（用户已知自己选了什么）
      if (strengthRoute.auto && strengthRoute.score) {
        const sr = strengthRoute.score
        const strengthCallId = `strength_${correlationId}`
        const strengthLabel = strength === 'deep' ? '深度思考' : '标准思考'
        const sigNote = sr.signals.length ? sr.signals.join('、') : '无明显复杂信号'
        onToolEvent?.({ toolCallId: strengthCallId, phase: 'call', toolName: 'thinking_route', input: earlyUserText.slice(0, 80) || '(无用户消息)' })
        onToolEvent?.({
          toolCallId: strengthCallId,
          phase: 'result',
          toolName: 'thinking_route',
          ok: true,
          output: `自动评估 → ${strengthLabel}（复杂度 ${sr.score}）｜信号：${sigNote}`,
        })
      }

      // 8. 调用 streamText（Vercel AI SDK v7；可选 tools + stopWhen）
      // Phase J.3 + v2.4 修复：DeepSeek V4 Flash 默认开启思考模式，会先输出
      // reasoning_content 再输出正文 content。标准 @ai-sdk/openai 流式解析下，
      // 若不显式控制，deep 之外的场景也会走思考模式、正文迟迟不来，甚至
      // 表现为 "No output generated"。因此：
      //   - deep 强度：显式启用思考（thinking enabled + reasoning_effort high）
      //   - 其余强度：对 deepseek 显式【关闭】思考（thinking disabled），确保正文直出
      const isDeepseek = modelInstance.config.type === 'deepseek'
      const providerOptions =
        enableDeepseekThinking || enableLogprobs || isDeepseek
          ? {
              ...(isDeepseek
                ? {
                    deepseek: enableDeepseekThinking
                      ? {
                          thinking: { type: 'enabled' as const },
                          reasoning_effort: 'high' as const,
                        }
                      : {
                          // 非 deep 场景关闭思考模式，正文直接输出，省 token 且避免空输出
                          thinking: { type: 'disabled' as const },
                        },
                  }
                : {}),
              ...(enableLogprobs
                ? {
                    // OpenAI 协议：传 logprobs=true + top_logprobs=5
                    // SDK 会透传到 OpenAI / DeepSeek / Qwen / Volcengine / Ollama 等兼容 API
                    openai: {
                      logprobs: true as const,
                      top_logprobs: 5 as const,
                    },
                  }
                : {}),
            }
          : undefined
      // v2.4 P3：Skill 路由（把内置运维手册接进主对话，B 注入式）。
      // 命中 skill（skill-only/skill-assisted）时，把手册内容注入 system prompt 作权威参考，
      // 并经 onToolEvent 推送「技能匹配」卡片可视化；不短路、仍走 LLM 流式（低风险）。
      let skillInjection = ''
      try {
        if (lastUserText) {
          const skillRoute = (await getSkillRouter()).route(lastUserText)
          if (skillRoute.decision !== 'ai-only' && skillRoute.matches.length > 0) {
            const top = skillRoute.matches[0].skill
            const body =
              top.content.length > 2000 ? top.content.slice(0, 2000) + '\n...(内容已截断)' : top.content
            skillInjection = `\n\n[已匹配运维手册「${top.name}」，请优先依据以下手册组织回答]\n${top.description}\n${body}`
            // 可视化：复用工具执行卡片（call + result 同步补全）
            const skillCallId = `skill_${correlationId}`
            onToolEvent?.({ toolCallId: skillCallId, phase: 'call', toolName: 'skill_match', input: top.name })
            onToolEvent?.({
              toolCallId: skillCallId,
              phase: 'result',
              toolName: 'skill_match',
              ok: true,
              output: `决策 ${skillRoute.decision} | ${skillRoute.matches[0].reason} | 预计省 ${skillRoute.estimatedTokenSavings} token`,
            })
          }
        }
      } catch (err) {
        this.log.warn('Skill 路由失败（已跳过，不影响对话）', {
          correlationId,
          error: err instanceof Error ? err.message : String(err),
        })
      }

      // v2.4：始终注入 system prompt 引导模型【真实调用工具】。
      // v2.6：工具提示改为按本轮实际挂载的工具动态拼接（chat-tool-router 的 promptHints），
      // 未挂载的工具不再占用 prompt；skill 命中则附手册。
      // v2.8：被动注入长期记忆块（硬预算 8KB，correction/画像优先；空库零开销）
      let memoryInjection = ''
      try {
        memoryInjection = new MemoryRepository(db).buildInjectionBlock()
      } catch (err) {
        this.log.warn('长期记忆注入失败（已跳过）', {
          correlationId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      const systemPrompt =
        '你是 Linux 运维与教学助手，回答用中文。' + toolRoute.promptHints + skillInjection + memoryInjection
      const result = streamText({
        model: modelInstance.model,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages: compaction.messages,
        temperature,
        maxOutputTokens: effectiveMaxTokens,
        abortSignal: abortController.signal,
        providerOptions,
        ...(hasTools
          ? {
              tools,
              stopWhen: isStepCount(4),
            }
          : {}),
      })

      // 累积完整文本 + logprobs
      // v0.9.7 P3 M1：遍历 fullStream 而非 textStream，以捕获 providerMetadata 事件
      // 论文依据：Zhao 2026 — 用 token-level answer-distribution entropy 而非 text entropy
      let fullText = ''
      // v2.4 修复：累积 reasoning 文本作为兵底 —— DeepSeek 思考模式下正文可能为空
      // 而内容在 reasoning 里；若最终 fullText 空，用 reasoning 兑底，避免 "No output generated"。
      let reasoningText = ''
      // v2.8：记录每个工具调用的入参（tool-result 失败时沉淀教训需要命令原文）
      const lastToolInputs = new Map<string, string>()
      // v2.11 P0：空闲看门狗 —— 每收到一个 part 重置计时；IDLE_MS 内零活动则判定卡死，abort 流并按超时报错
      const armIdleWatchdog = (): void => {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          streamTimedOut = true
          try { abortController.abort() } catch { /* ignore */ }
        }, STREAM_IDLE_TIMEOUT_MS)
      }
      armIdleWatchdog()
      for await (const part of result.fullStream) {
        armIdleWatchdog() // 收到数据 → 重置空闲计时
        const partType = (part as { type?: string }).type
        if (partType === 'error') {
          // 流式底层错误（如 4xx）：ai-sdk 否则会吞成 "No output generated"，这里记录真实原因便于排查
          const errPart = (part as { error?: unknown }).error
          const errStr =
            errPart instanceof Error ? `${errPart.name}: ${errPart.message}` : String(errPart)
          this.log.error(`fullStream 底层错误：${errStr.slice(0, 800)}`, { correlationId })
        }
        if (partType === 'text-delta') {
          // 文本增量：累积 + 回调 + trace fallback
          const text = (part as { text?: string }).text ?? ''
          if (text) {
            fullText += text
            onToken?.(text)
            // 兑底：若未启用 logprobs，仍累积文本用于 fallback 切分
            if (!enableLogprobs) {
              traceCollector.accumulateFinalText(text)
            }
          }
        } else if (partType === 'reasoning-delta' || partType === 'reasoning') {
          // DeepSeek 思考模式的推理内容：累积作正文兜底 + 回调推送到前端折叠展示（v2.5）
          const rtext =
            (part as { text?: string }).text ??
            (part as { textDelta?: string }).textDelta ??
            ''
          if (rtext) {
            reasoningText += rtext
            onReasoning?.(rtext)
          }
        } else if (partType === 'response-metadata' || partType === 'provider-metadata') {
          // v0.9.7 P3 M1：捕获 OpenAI 协议返回的 logprobs
          // OpenAI 协议将 logprobs 放在 providerMetadata.openai.logprobs[]
          // 每项结构：{ token, logprob, topLogprobs: [{token, logprob, ...}] }
          const meta = (part as { providerMetadata?: { openai?: { logprobs?: unknown } } })
            .providerMetadata
          const logprobsRaw = meta?.openai?.logprobs
          if (Array.isArray(logprobsRaw) && logprobsRaw.length > 0) {
            // 提取每个 token 的 top-N logprobs（数字数组）
            const tokenLogprobs: number[][] = []
            for (const item of logprobsRaw) {
              if (item && typeof item === 'object') {
                const topLps = (item as { topLogprobs?: Array<{ logprob?: number }> })
                  .topLogprobs
                if (Array.isArray(topLps) && topLps.length > 0) {
                  const lps: number[] = []
                  for (const tl of topLps) {
                    if (typeof tl?.logprob === 'number' && Number.isFinite(tl.logprob)) {
                      lps.push(tl.logprob)
                    }
                  }
                  if (lps.length > 0) tokenLogprobs.push(lps)
                }
              }
            }
            if (tokenLogprobs.length > 0) {
              traceCollector.recordTokenLogprobEntropies(tokenLogprobs)
            }
          }
        } else if (partType === 'tool-call' || partType === 'tool-input-available') {
          // v2.4：工具开始调用 → 推送 call 事件（真实发生的调用，非文本抽取）
          const p = part as { toolCallId?: string; toolName?: string; input?: unknown; args?: unknown }
          const rawInput = p.input ?? p.args
          let inputStr = ''
          if (typeof rawInput === 'string') inputStr = rawInput
          else if (rawInput && typeof rawInput === 'object') {
            // 入参优先取可读字段：ssh_readonly={command}，kb_search/tutorial_search={query}
            const obj = rawInput as Record<string, unknown>
            inputStr =
              typeof obj.command === 'string'
                ? obj.command
                : typeof obj.query === 'string'
                  ? obj.query
                  : JSON.stringify(rawInput)
          }
          onToolEvent?.({
            toolCallId: p.toolCallId ?? `tc_${Date.now()}`,
            phase: 'call',
            toolName: p.toolName ?? 'tool',
            input: inputStr.slice(0, 2000),
          })
          // v2.8：缓存入参供失败教训沉淀使用
          if (p.toolCallId) lastToolInputs.set(p.toolCallId, inputStr.slice(0, 200))
        } else if (partType === 'tool-result') {
          // v2.4：工具返回结果 → 推送 result 事件
          const p = part as { toolCallId?: string; toolName?: string; output?: unknown; result?: unknown }
          const rawOut = p.output ?? p.result
          let ok = true
          let outStr = ''
          if (rawOut && typeof rawOut === 'object') {
            const obj = rawOut as Record<string, unknown>
            if (typeof obj.ok === 'boolean') ok = obj.ok
            if (typeof obj.error === 'string' && obj.error) {
              ok = false
              outStr = obj.error
            } else if (typeof obj.stdout === 'string') {
              outStr = obj.stdout || (typeof obj.stderr === 'string' ? obj.stderr : '')
            } else if (typeof obj.summary === 'string') {
              // kb_search / tutorial_search 等检索工具返回可读摘要
              outStr = obj.summary
            } else {
              outStr = JSON.stringify(rawOut)
            }
          } else if (typeof rawOut === 'string') {
            outStr = rawOut
          }
          onToolEvent?.({
            toolCallId: p.toolCallId ?? `tc_${Date.now()}`,
            phase: 'result',
            toolName: p.toolName ?? 'tool',
            ok,
            output: outStr.slice(0, 4000),
          })
          // v2.8：工具失败 → 错误教训快速沉淀（规则直写 correction，无 LLM 开销；
          // 风险拦截/只读拒绝等护栏正常工作不算教训，recordToolFailure 内部过滤）
          if (!ok && p.toolName && p.toolName !== 'tool_route' && p.toolName !== 'skill_match') {
            recordToolFailure(
              new MemoryRepository(db),
              p.toolName,
              lastToolInputs.get(p.toolCallId ?? '') ?? '',
              outStr.slice(0, 300),
              correlationId,
            )
          }
        }
        // 其他事件类型（finish-step / finish 等）忽略
      }

      // 8. 获取 token 使用（v7：result.usage 是 Promise）
      const usage = await result.usage
      const finishReason = await result.finishReason

      // v2.4 修复：正文为空但有 reasoning 时，用 reasoning 兑底并补发一次 onToken，
      // 避免 DeepSeek 思考模式下“连上 API 但运行不显示”。
      if (!fullText && reasoningText) {
        fullText = reasoningText
        onToken?.(reasoningText)
      }
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

      // v2.8：对话完成后 fire-and-forget 自动记忆提取（节流 5 分钟；
      // 失败/超时只记日志，绝不影响主对话）
      void extractMemories(
        new MemoryRepository(db),
        (sys, user, max) => this.callLlm(sys, user, max),
        messages,
        fullText,
        correlationId,
      ).catch(() => { /* fire-and-forget */ })
        .then(() => {
          // v2.9 提取完成后后台回填缺失的 embedding（语义检索基础），
          // 同样 fire-and-forget；模型不可用时自动降级跳过
          void backfillMemoryEmbeddings(new MemoryRepository(db)).catch(() => { /* ignore */ })
        })
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))

      // 区分取消和真实错误
      if (abortController.signal.aborted && streamTimedOut) {
        // v2.11：空闲看门狗触发的超时 abort —— 按错误上报，让前端解卡并提示重试
        this.log.error('chat 流式响应超时（空闲看门狗触发）', {
          correlationId,
          idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
          durationMs: Date.now() - startTime,
        })
        onError?.(new Error('AI 响应超时：模型长时间无输出，已中断。请重试，或在输入框换用更快的思考强度。'))
      } else if (abortController.signal.aborted) {
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
        // v2.3.8 增强：把诊断信息全部写日志，方便用户/开发者从主进程日志定位根因
        // Vercel AI SDK 的错误对象通常含 status / statusCode / responseBody 等字段
        // - status: HTTP 状态码（404/401/429/500）
        // - responseBody: 服务端返回的原始响应（可能含 model 不存在说明）
        // - data: OpenAI 兼容错误对象（type/code/message）
        const apiErr = err as {
          status?: number
          statusCode?: number
          responseBody?: string
          data?: { code?: string; type?: string; message?: string; param?: string }
          url?: string
        }
        this.log.error('chat 调用失败', {
          correlationId,
          providerId: resolvedProviderId,
          model: modelInstance.resolvedModel,
          baseURL: modelInstance.config.baseURL,
          strength,
          temperature,
          maxTokens: effectiveMaxTokens,
          messageCount: compaction.messages.length,
          durationMs: Date.now() - startTime,
          // 关键诊断信息
          errorName: (err as Error)?.name,
          errorMessage: error.message,
          errorStack: error.stack?.split('\n').slice(0, 6).join('\n'),
          httpStatus: apiErr.status ?? apiErr.statusCode,
          responseBody: apiErr.responseBody,
          apiErrorCode: apiErr.data?.code,
          apiErrorType: apiErr.data?.type,
          apiErrorParam: apiErr.data?.param,
          apiErrorMessage: apiErr.data?.message,
          requestUrl: apiErr.url,
        })
        onError?.(error)
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer) // v2.11 P0：清理空闲看门狗，避免泄漏
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
   * 获取已注册的 Subagent
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
      // v2.11 修复运行时 bug：DeepSeek V4 等 reasoning 模型不接受 messages 数组里的
      // system 角色（报 "System messages are not allowed... Use the instructions option"），
      // 导致 callLlm 失败 → 记忆提取/PAOR 规划静默降级。改用 generateText 的 system 选项
      //（与已工作正常的 streamText 路径一致），user 内容走 prompt。
      const result = await generateText({
        model: modelInstance.model,
        system: systemPrompt,
        prompt: userPrompt,
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
    const maxReplans = options.maxReplans ?? 0

    // ── Phase 1: Plan ──
    const { plan, confidence } = await this.plan(task)
    let currentPlan = plan
    this.log.info('[PAOR-Loop] 计划已生成', { goal: currentPlan.goal, steps: currentPlan.steps.length, confidence })

    const iterations: PaorIteration[] = []
    // v2.11 状态图编排：路由决策交给 paor-graph 纯函数，本循环只执行副作用
    let graphState = initPaorState(currentPlan.steps.length)
    let iterationNum = 0
    let status: PaorLoopResult['status'] = 'max_iterations'
    let aborted = false
    const routeLimits: PaorRouteLimits = { maxRetriesPerStep: maxRetries, maxReplans }

    // ── Phase 2: 循环 Act → Observe → Reflect（下一步由 routePaorNext 决定）──
    while (shouldContinueLoop(graphState, iterationNum, maxIterations) && !aborted) {
      iterationNum++
      const stepIndex = graphState.stepIndex
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
          graphState = routeRiskRejected(graphState).state
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
        graphState = { ...graphState, totalSteps: currentPlan.steps.length }
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

      // v2.11 循环控制：路由决策交给纯函数引擎（默认行为与旧 switch 等价）
      const route = routePaorNext(reflectResult.decision as PaorDecision, graphState, routeLimits)
      graphState = route.state
      if (route.action === 'retry-same') {
        this.log.info('[PAOR-Loop] 重试当前步骤', { stepIndex, retryCount: graphState.retryCount })
      } else if (route.action === 'replan') {
        // 失败回退：携失败上下文重新规划（replanCount 已在引擎自增，防震荡）
        this.log.warn('[PAOR-Loop] 回退重新规划', { replanCount: graphState.replanCount })
        const failCtx = `${task}\n\n（上一轮步骤“${command}”未能推进，请重新规划更稳健的步骤）`
        const replanned = await this.plan(failCtx)
        currentPlan = replanned.plan
        graphState = { ...initPaorState(currentPlan.steps.length), replanCount: graphState.replanCount }
      } else if (route.terminal === 'done') {
        status = 'done'
      } else if (route.terminal === 'abort') {
        status = 'abort'
        aborted = true
      } else if (route.terminal === 'blocked') {
        status = 'blocked'
        aborted = true
      }
    }

    // 所有步骤正常走完（最后一步 continue 导致 stepIndex 越界）也视为完成
    if (!aborted && status === 'max_iterations' && graphState.stepIndex >= currentPlan.steps.length) {
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
  // 人工审批闸门接口（Hard Constraint 4）
  // ========================================================================

  /**
   * 判断是否需要人工审批
   *
   * 规则：
   * - running-subagent 的所有任务均需审批（高危命令执行）
   * - 思考强度为 deep 时，所有 Subagent 结果均需审批
   * - 风险等级为 HIGH/CRITICAL 的工具调用均需审批（由 PAOR 风险闸门处理）
   *
   * @param task 待审批的任务
   */
  isApprovalRequired(task: SubagentTask): boolean {
    if (task.type === 'running') return true
    if (task.strength === 'deep') return true
    return false
  }

  /**
   * 请求人工审批
   *
   * 记录审批日志并返回 requiresApproval=true 的挂起结果。
   * 实际的 IPC 推送与 UI 交互由 agent-runtime.ts 的 approveRisk 回调处理。
   *
   * @param task 任务对象
   * @param preview 审批预览文本
   */
  async requestApproval(task: SubagentTask, preview: string): Promise<SubagentResult> {
    this.log.warn('请求人工审批', {
      taskId: task.id,
      preview,
    })
    return {
      taskId: task.id,
      success: false,
      output: null,
      error: '等待人工审批',
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
