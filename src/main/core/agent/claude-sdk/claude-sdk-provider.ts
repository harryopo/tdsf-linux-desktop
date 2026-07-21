/**
 * Claude Agent SDK Provider（主类）
 *
 * 职责：
 * 封装 `@anthropic-ai/claude-agent-sdk` 的 `query()` 异步生成器 API，
 * 对外提供与项目统一的 `generate()` / `stream()` / `cancel()` 接口，
 * 把 SDK 的 agent loop 输出转换为项目统一的 `ChatResult`。
 *
 * 关键事实（基于 @anthropic-ai/claude-agent-sdk@0.3.211 实际 API）：
 * - `query({ prompt: string | AsyncIterable<SDKUserMessage>, options?: Options })`
 *   返回 `AsyncGenerator<SDKMessage, void>`（与 @anthropic-ai/sdk Messages API 不同）。
 * - 自定义工具通过 `createSdkMcpServer({ name, tools })` 创建 in-process MCP server，
 *   再通过 `options.mcpServers: { [name]: config }` 注入（不存在 customTools 选项）。
 * - `Options` 含 `model` / `systemPrompt` / `maxTurns` / `permissionMode` / `cwd` /
 *   `mcpServers` / `abortController` / `env` / `includePartialMessages` / `thinking` 等。
 * - `PermissionMode` = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'
 *
 * 设计决策（与现有 Provider 工厂的差异）：
 * - ClaudeSdkProvider **不**实现 `LanguageModelV2`（@ai-sdk/provider 的 doGenerate/doStream 契约），
 *   因为 Claude Agent SDK 本质是 agent loop（多轮工具调用 + 反思），
 *   强行适配为单次 doGenerate/doStream 会丢失 agent 能力。
 * - `asLanguageModel()` 返回抛错适配器：若调用方误通过 provider-factory 路径使用，
 *   立即抛出明确错误，引导用户改用 `claude-sdk:generate` / `claude-sdk:stream` IPC。
 * - ClaudeSdkProvider 不通过 `createLanguageModel` 创建，而是由 IPC handler 直接实例化。
 *
 * Hard Constraints 对齐：
 * - HC-1 网络日志：generate/stream 入口记录 logger.info（SDK 调用是远程网络操作）
 * - HC-2 redactSecrets：prompt 输入与 text 输出均经 redactSecrets 脱敏
 * - HC-3 本地优先：复用项目已有 SSH/SFTP 服务（通过 createLinuxOpsMcpServer 注入）
 *
 * 方案书依据：v0.9 §3（Provider 抽象）+ 调研文档 §8.1（SDK 调用契约）+ §8.3（Linux 运维工具集注入）
 */
// P-1 修复（运行时补充）：@anthropic-ai/claude-agent-sdk 是 ESM-only（sdk.mjs），
// Electron 主进程编译后为 CommonJS（require），静态 import 会报 ERR_REQUIRE_ESM。
// 改为 type-only import + 运行时动态 import() 调用 query。
import type { Options, SDKMessage, PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import type { LanguageModel } from 'ai'
import type { ProviderConfig, ThinkingStrength } from '../providers/types'
import type { ChatResult, CompactionLevel, ClaudeSdkChatParams } from '@shared/agent-types'
import { redactSecrets } from '../providers/redact'
import { logger } from '../../../services/log/logger'
import { createLinuxOpsMcpServer, TDSF_LINUX_OPS_SERVER_NAME } from './claude-sdk-tools'
import {
  convertClaudeResultToChatResult,
  extractPartialText,
  isAssistantMessage,
  isPartialAssistantMessage,
  isResultMessage,
  extractAssistantText,
} from './claude-sdk-wrapper'
import { createCotTraceCollector } from '../credibility/mass-functions/cot-trace-collector'
import {
  adaptAssistantMessageToCollector,
  adaptPartialMessageToCollector,
  extractNumTurns,
} from '../credibility/mass-functions/sdk-trace-adapter'

/**
 * 主进程内部 chat 调用参数（扩展 shared ClaudeSdkChatParams，增加 IPC 层不暴露的回调与 MCP 配置）
 *
 * - onToken / onDone / onError：流式回调（仅在 main → IPC 推送时使用，不暴露给 preload/renderer）
 * - mcpServers：自定义 MCP server 配置（默认注入 Linux 运维工具集，HC-3）
 */
export interface ClaudeSdkInternalChatParams extends ClaudeSdkChatParams {
  /** token 流式回调（每个 chunk 调用一次） */
  onToken?: (delta: string) => void
  /** 完成回调（含完整结果 ChatResult） */
  onDone?: (result: ChatResult) => void
  /** 错误回调 */
  onError?: (error: Error) => void
  /** 自定义 MCP server 配置（默认注入 Linux 运维工具集，HC-3） */
  mcpServers?: Options['mcpServers']
}

/**
 * 思考强度 → SDK Options 映射
 *
 * - fast：maxTurns=1，thinking disabled（单次调用，无 agent loop）
 * - standard：maxTurns=8，thinking adaptive（运维决策、命令生成）
 * - deep：maxTurns=20，thinking adaptive + effort high（复杂故障排查、方案设计）
 *
 * @param strength 思考强度
 * @returns SDK Options 子集（maxTurns + thinking + effort）
 */
function strengthToSdkOptions(
  strength: ThinkingStrength
): Pick<Options, 'maxTurns' | 'thinking' | 'effort'> {
  switch (strength) {
    case 'fast':
      return {
        maxTurns: 1,
        thinking: { type: 'disabled' },
      }
    case 'deep':
      return {
        maxTurns: 20,
        thinking: { type: 'adaptive' },
        effort: 'high',
      }
    case 'standard':
    default:
      return {
        maxTurns: 8,
        thinking: { type: 'adaptive' },
      }
  }
}

/**
 * 默认系统提示（Linux 运维助手）
 *
 * 引导 Claude 使用 ssh_exec / sftp_* 工具操作远程 Linux 主机，
 * 而非尝试本地 Bash / Read / Edit（这些工具在桌面应用沙箱内不可用）。
 */
const DEFAULT_SYSTEM_PROMPT =
  '你是 tdsf-linux-desktop 的 Linux 运维助手。' +
  '你只能通过 MCP 工具 ssh_exec / sftp_read_file / sftp_write_file / sftp_list 操作远程 Linux 主机，' +
  '不要尝试使用本地 Bash / Read / Edit 等工具（桌面应用沙箱内不可用）。' +
  '执行高危命令（rm -rf / chmod 777 / iptables 等）前先用一句话说明意图。' +
  '所有命令输出与文件内容均已脱敏，不要尝试还原 [REDACTED] 内容。'

/**
 * Claude Agent SDK Provider 主类
 *
 * 生命周期：
 * - 构造时绑定 ProviderConfig（含 apiKey / model / baseURL）
 * - 每次 generate/stream 创建独立 AbortController（支持取消）
 * - stream() 是核心方法；generate() 是 stream() 的同步聚合
 *
 * 线程安全：
 * - 单实例可被并发调用（每次调用独立 AbortController + correlationId）
 * - cancel(correlationId) 仅取消对应请求，不影响其他请求
 */
export class ClaudeSdkProvider {
  /** Provider 配置（含 apiKey，从 SecureStore 解密后传入） */
  private readonly config: ProviderConfig
  /** 子 logger（自动注入 category 前缀） */
  private readonly log = logger.child('AGENT.CLAUDE_SDK')
  /** 进行中的请求表：correlationId → AbortController（用于取消请求） */
  private readonly activeRequests = new Map<string, AbortController>()

  /**
   * @param config Provider 配置（必须含 apiKey + model）
   */
  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new Error(
        `Provider "${config.name}" (${config.id}) 缺少 API Key，请在设置中配置 ANTHROPIC_API_KEY`
      )
    }
    if (!config.model) {
      throw new Error(
        `Provider "${config.name}" (${config.id}) 缺少模型名（如 'claude-sonnet-4-5'）`
      )
    }
    this.config = config
  }

  /**
   * 构造 SDK Options（合并 config + strength + 用户覆盖）
   *
   * @param params chat 调用参数
   * @returns 完整的 SDK Options
   */
  private async buildOptions(params: ClaudeSdkInternalChatParams): Promise<Options> {
    const strength = params.strength ?? 'standard'
    const strengthOpts = strengthToSdkOptions(strength)

    // HC-3：默认注入 Linux 运维工具集（SSH/SFTP），用户可在 params.mcpServers 覆盖
    // 注：createLinuxOpsMcpServer 改为 async（动态 import ESM SDK）
    const mcpServers = params.mcpServers ?? {
      [TDSF_LINUX_OPS_SERVER_NAME]: await createLinuxOpsMcpServer(),
    }

    // 环境变量：合并 process.env + ANTHROPIC_API_KEY（SDK 通过 env 读取 key）
    const env: Record<string, string | undefined> = {
      ...process.env,
      ANTHROPIC_API_KEY: this.config.apiKey,
      // 标识 SDK 客户端应用（SDK 文档推荐）
      CLAUDE_AGENT_SDK_CLIENT_APP: 'tdsf-linux-desktop/0.9.0',
    }

    // baseURL 非空时注入 ANTHROPIC_BASE_URL（支持 Bedrock / 自定义端点）
    if (this.config.baseURL) {
      env.ANTHROPIC_BASE_URL = this.config.baseURL
    }

    const options: Options = {
      model: this.config.model,
      systemPrompt: params.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      permissionMode: 'bypassPermissions' as PermissionMode, // 桌面应用场景：模型通过 MCP 工具操作，内置 Bash/Edit 不可用，bypass 安全
      allowDangerouslySkipPermissions: true, // 配合 bypassPermissions（SDK 强制要求）
      abortController: undefined, // 在 generate/stream 中注入
      cwd: params.cwd ?? process.cwd(),
      mcpServers,
      env,
      includePartialMessages: params.includePartialMessages ?? true,
      ...strengthOpts,
      // 禁用 session 持久化（桌面应用场景：每次 chat 独立，不污染 ~/.claude/projects）
      persistSession: false,
      // 严格 MCP 配置：仅使用注入的 mcpServers，忽略项目 .mcp.json / 用户 settings
      strictMcpConfig: true,
    }

    return options
  }

  /**
   * 流式 chat 调用（核心入口）
   *
   * 流程：
   * 1. redact prompt（HC-2）
   * 2. 构造 SDK Options（含 SSH/SFTP MCP server）
   * 3. 创建 AbortController 并注册到 activeRequests
   * 4. 调用 query() 异步生成器，迭代 SDKMessage 流
   *    - SDKPartialAssistantMessage → 提取文本增量 → onToken 回调
   *    - SDKAssistantMessage → 累积完整 assistant 文本（用于 result.result 不可用时的兜底）
   *    - SDKResultMessage → 转换为 ChatResult → onDone 回调
   * 5. finally：从 activeRequests 移除
   *
   * @param params chat 调用参数
   */
  async stream(params: ClaudeSdkInternalChatParams): Promise<void> {
    const {
      prompt,
      strength = 'standard',
      onToken,
      onDone,
      onError,
      correlationId = `csdk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    } = params

    const startTime = Date.now()

    // HC-2：prompt 脱敏（防止用户输入中包含 .env 路径、API Key 等被发送到云端）
    const safePrompt = redactSecrets(prompt)

    // 创建 AbortController 并注册
    const abortController = new AbortController()
    this.activeRequests.set(correlationId, abortController)

    // 构造 Options（注入 abortController）— buildOptions 改为 async（动态 import ESM SDK）
    const options = await this.buildOptions({
      ...params,
      strength,
      includePartialMessages: params.includePartialMessages ?? true,
    })
    options.abortController = abortController

    this.log.info('ClaudeSdkProvider.stream 调用开始', {
      correlationId,
      providerId: this.config.id,
      model: this.config.model,
      strength,
      promptLength: safePrompt.length,
      maxTurns: options.maxTurns,
      mcpServers: Object.keys(options.mcpServers ?? {}),
    })

    // 累积文本（流式 chunk 拼接，作为 result.result 不可用时的兜底）
    let accumulatedText = ''

    // v0.9.6 P2 M5+：CoT 熵轨迹收集器
    // 3 优先级降级：thinking-block → turn-text → text-fallback（按句子切分）
    // 与 cot-trace-signal.ts 解耦：collector 只产出 number[] 数组
    const traceCollector = createCotTraceCollector()
    let totalThinkingSteps = 0
    let totalAccumulatedTurnChars = 0

    try {
      // 动态 import ESM 模块（@anthropic-ai/claude-agent-sdk 是 ESM-only）
      const { query } = await import('@anthropic-ai/claude-agent-sdk')
      const generator = query({ prompt: safePrompt, options })

      for await (const message of generator) {
        // 已取消时立即跳出（不等待 SDK 内部清理）
        if (abortController.signal.aborted) {
          break
        }

        const sdkMessage: SDKMessage = message
        // 1. 流式增量消息 → onToken + 累积到 trace fallback
        if (isPartialAssistantMessage(sdkMessage)) {
          const delta = extractPartialText(sdkMessage)
          if (delta) {
            accumulatedText += delta
            onToken?.(delta)
            // v0.9.6 P2 M5+：流式 delta 仅用于 fallback 文本累积
            adaptPartialMessageToCollector(sdkMessage, traceCollector)
          }
          continue
        }

        // 2. 助手消息 → 累积完整文本（兜底用）+ 适配 trace collector
        if (isAssistantMessage(sdkMessage)) {
          // 仅在未收到流式增量时累积（避免重复）
          if (!accumulatedText) {
            accumulatedText = extractAssistantText(sdkMessage)
          }
          // v0.9.6 P2 M5+：适配助手消息到 trace collector
          //   - 提取 thinking blocks → recordThinkingBlock
          //   - 提取 text blocks → recordTurnText + accumulateFinalText
          const { thinkingSteps, turnTextLength } = adaptAssistantMessageToCollector(
            sdkMessage,
            traceCollector
          )
          totalThinkingSteps += thinkingSteps
          totalAccumulatedTurnChars += turnTextLength
          continue
        }

        // 3. 终止消息 → 转换为 ChatResult → onDone
        if (isResultMessage(sdkMessage)) {
          const compactionLevel: CompactionLevel = 'none' // SDK 不暴露 compaction 状态
          // v0.9.6 P2 M5+：finalize trace collector，提取熵轨迹
          const traceResult = traceCollector.finalize()
          const cotEntropyTrajectory = traceResult.collected ? traceResult.trajectory : undefined
          const numTurns = extractNumTurns(sdkMessage)
          const chatResult = convertClaudeResultToChatResult(
            sdkMessage,
            {
              providerId: this.config.id,
              model: this.config.model,
              strength,
              compactionLevel,
              correlationId,
            },
            accumulatedText,
            cotEntropyTrajectory
          )

          const durationMs = Date.now() - startTime
          this.log.info('ClaudeSdkProvider.stream 调用完成', {
            correlationId,
            durationMs,
            finishReason: chatResult.finishReason,
            inputTokens: chatResult.usage.inputTokens,
            outputTokens: chatResult.usage.outputTokens,
            textLength: chatResult.text.length,
            // v0.9.6 P2 M5+：CoT trace 元数据
            cotTrace: {
              totalSteps: traceResult.totalSteps,
              usedFallback: traceResult.usedFallback,
              sourceBreakdown: traceResult.sourceBreakdown,
              totalThinkingSteps,
              totalAccumulatedTurnChars,
              sdkNumTurns: numTurns,
            },
          })

          onDone?.(chatResult)
          return
        }

        // 其他消息类型（SDKSystemMessage / SDKUserMessageReplay / SDKHookStartedMessage 等）
        // 暂不处理，继续迭代
      }

      // 迭代结束但未收到 result 消息（可能因 abort 提前结束）
      if (abortController.signal.aborted) {
        const durationMs = Date.now() - startTime
        this.log.info('ClaudeSdkProvider.stream 已取消', { correlationId, durationMs })
        onDone?.({
          text: accumulatedText,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          finishReason: 'cancelled',
          providerId: this.config.id,
          model: this.config.model,
          strength,
          durationMs,
          compactionLevel: 'none',
        })
        return
      }

      // 未收到 result 消息但迭代正常结束（理论不应发生，SDK 终会发 result）
      throw new Error('SDK 迭代结束但未收到 result 消息')
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))

      // 区分取消和真实错误
      if (abortController.signal.aborted) {
        const durationMs = Date.now() - startTime
        this.log.info('ClaudeSdkProvider.stream 已取消（异常路径）', {
          correlationId,
          durationMs,
          error: redactSecrets(error.message),
        })
        onDone?.({
          text: accumulatedText,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          finishReason: 'cancelled',
          providerId: this.config.id,
          model: this.config.model,
          strength,
          durationMs,
          compactionLevel: 'none',
        })
        return
      }

      this.log.error('ClaudeSdkProvider.stream 调用失败', {
        correlationId,
        durationMs: Date.now() - startTime,
        error: redactSecrets(error.message),
      })
      onError?.(error)
    } finally {
      this.activeRequests.delete(correlationId)
    }
  }

  /**
   * 同步聚合调用（stream 的便捷封装，返回完整 ChatResult）
   *
   * 适用场景：不需要流式 token，只需要最终结果（如批量分析、定时任务）。
   *
   * @param params chat 调用参数（onToken/onDone/onOnError 会被覆盖）
   * @returns 完整 ChatResult
   */
  async generate(params: ClaudeSdkInternalChatParams): Promise<ChatResult> {
    return new Promise<ChatResult>((resolve, reject) => {
      void this.stream({
        ...params,
        includePartialMessages: params.includePartialMessages ?? false, // generate 不需要流式增量
        onToken: undefined, // 忽略 token 回调
        onDone: (result) => resolve(result),
        onError: (error) => reject(error),
      })
    })
  }

  /**
   * 取消进行中的请求
   *
   * @param correlationId 关联 ID（stream/generate 调用时传入）
   * @returns 是否成功取消（false 表示请求已结束或不存在）
   */
  cancel(correlationId: string): boolean {
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
   * LanguageModel 适配器（抛错路径）
   *
   * ClaudeSdkProvider **不**实现 LanguageModelV2 契约（doGenerate/doStream），
   * 因为 Claude Agent SDK 本质是 agent loop（多轮工具调用 + 反思），
   * 强行适配为单次 doGenerate/doStream 会丢失 agent 能力。
   *
   * 若调用方误通过 provider-factory 路径使用（如 streamText({ model })），
   * 立即抛出明确错误，引导用户改用 `claude-sdk:generate` / `claude-sdk:stream` IPC。
   *
   * @returns 抛错的 LanguageModel 适配器
   */
  asLanguageModel(): LanguageModel {
    const providerId = this.config.id
    const errorMsg =
      `ClaudeSdkProvider (${providerId}) 不支持 LanguageModel 适配器。` +
      'Claude Agent SDK 是 agent loop，不实现 doGenerate/doStream 单次调用契约。' +
      '请改用 claude-sdk:generate / claude-sdk:stream IPC 通道。'

    // 返回 Proxy 抛错（任何属性访问 / 调用都抛出明确错误）
    return new Proxy(
      {},
      {
        get() {
          throw new Error(errorMsg)
        },
        apply() {
          throw new Error(errorMsg)
        },
      }
    ) as unknown as LanguageModel
  }
}
