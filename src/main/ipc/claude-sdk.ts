/**
 * Claude Agent SDK IPC Handlers（v0.9 P-1 修复补齐）
 *
 * 职责：
 * - 暴露 ClaudeSdkProvider 的 generate / stream / cancel 能力到渲染进程
 * - 流式 token 通过 webContents.send 推送到 claude-sdk:chunk / claude-sdk:done / claude-sdk:error
 * - 通过 providerId 关联 SecureStore 中的 apiKey（不直接暴露 apiKey 给渲染进程）
 *
 * 通道命名规范（与方案书 §11.2 一致）：
 * - claude-sdk:generate — 同步聚合调用，返回 ChatResult
 * - claude-sdk:stream   — 异步流式调用，立即返回 correlationId
 *                        渲染进程通过 onClaudeSdkChunk / onClaudeSdkDone / onClaudeSdkError 监听事件
 * - claude-sdk:cancel   — 取消进行中的请求
 *
 * 推送通道（主 → 渲染，单向）：
 * - claude-sdk:chunk — 流式 token 块（含 correlationId 和 delta）
 * - claude-sdk:done  — 完成信号（含完整 ChatResult）
 * - claude-sdk:error — 错误信号（含 correlationId 和错误信息）
 *
 * 与 agent-runtime.ts 的关系：
 * - agent:chat 是 SupervisorAgent 入口（多 Subagent 编排 + Provider 抽象）
 * - claude-sdk:stream 是 ClaudeSdkProvider 入口（直接走 Claude Agent SDK 的 agent loop）
 * - 两者独立：用户在 Provider 选择器中选 claude-sdk 类型 → 走本通道；其他类型 → 走 agent:chat
 *
 * 安全要点：
 * - HC-1 网络日志：调用入口记录 logger.info（SDK 调用是远程网络操作）
 * - HC-2 redactSecrets：错误信息经 redactSecrets 脱敏后才推送
 * - HC-6 审批闸门：Claude SDK 自身 permissionMode='bypassPermissions'（桌面应用场景，模型通过 MCP 工具操作）
 *                  高危操作由 MCP 工具内部 requireApproval 控制（如 ssh_exec 走 ssh:exec 通道）
 *
 * 方案书依据：v0.9 §3 决策 5（Claude 集成方式 B：@anthropic-ai/claude-agent-sdk）
 * 修复文档：本会话 P-1 阻塞问题修复
 */

import { ipcMain, BrowserWindow } from 'electron'
import { ClaudeSdkProvider } from '../core/agent/claude-sdk'
import { getProviderWithApiKey } from '../core/agent/providers/provider-registry'
import { logger } from '../services/log/logger'
import { redactSecrets } from '../core/agent/providers/redact'
import type {
  ChatResult,
  ClaudeSdkChatParams,
  AgentChunkPayload,
  AgentDonePayload,
  AgentErrorPayload,
} from '@shared/agent-types'
// v0.9.4 新增：session-registry 集中维护 sessionId → AbortController Map，支持 abort signal + TTL 清理
import { getSessionRegistry } from '../core/agent/session-registry'

/** 流式 token 推送通道名 */
const CLAUDE_SDK_CHUNK_CHANNEL = 'claude-sdk:chunk'
/** 流式完成信号通道名 */
const CLAUDE_SDK_DONE_CHANNEL = 'claude-sdk:done'
/** 流式错误信号通道名 */
const CLAUDE_SDK_ERROR_CHANNEL = 'claude-sdk:error'

/**
 * 安全推送事件到渲染进程（窗口已销毁时跳过）
 */
function safeSend(mainWindow: BrowserWindow, channel: string, ...args: unknown[]): void {
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

/**
 * 错误码识别（与 agent-runtime.ts toAgentError 风格一致）
 */
function toClaudeSdkError(err: unknown): { message: string; code: AgentErrorPayload['code'] } {
  const msg = (err as Error)?.message ?? '未知错误'
  const lowerMsg = msg.toLowerCase()
  if (lowerMsg.includes('401') || lowerMsg.includes('unauthorized') || lowerMsg.includes('invalid api key')) {
    return { message: 'Anthropic API Key 无效或已过期', code: 'AUTH' }
  }
  if (lowerMsg.includes('429') || lowerMsg.includes('rate limit')) {
    return { message: '请求过于频繁，请稍后重试', code: 'RATE_LIMIT' }
  }
  if (lowerMsg.includes('timeout') || lowerMsg.includes('aborted')) {
    return { message: '请求超时或已取消', code: 'TIMEOUT' }
  }
  if (lowerMsg.includes('network') || lowerMsg.includes('fetch failed') || lowerMsg.includes('econnreset')) {
    return { message: '网络连接异常', code: 'NETWORK' }
  }
  if (/\b5\d{2}\b/.test(lowerMsg) || lowerMsg.includes('server error')) {
    return { message: 'Anthropic 服务器内部错误', code: 'SERVER' }
  }
  return { message: 'Claude SDK 调用失败', code: 'UNKNOWN' }
}

/**
 * ClaudeSdkProvider 实例缓存（providerId → 实例）
 *
 * 缓存策略：
 * - 首次调用时实例化（从 SecureStore 解密 apiKey 后构造）
 * - 后续调用复用实例（避免重复构造 + 重复校验）
 * - Provider 配置变更时（provider:save）应主动清理缓存（暂未实现，因 ClaudeSdkProvider 不持久化 apiKey 之外的状态）
 */
const providerCache = new Map<string, ClaudeSdkProvider>()

/**
 * 获取或创建 ClaudeSdkProvider 实例
 *
 * @param providerId Provider ID（必须是 type='claude-sdk' 的 Provider）
 * @returns ClaudeSdkProvider 实例
 * @throws 如果 Provider 不存在、类型不是 claude-sdk、或缺少 apiKey
 */
function getOrCreateProvider(providerId: string): ClaudeSdkProvider {
  // 检查缓存
  const cached = providerCache.get(providerId)
  if (cached) {
    return cached
  }

  // 从 Provider 注册中心获取完整配置（含 apiKey）
  const config = getProviderWithApiKey(providerId)
  if (!config) {
    throw new Error(`Provider "${providerId}" 不存在，请在设置中先配置`)
  }
  if (config.type !== 'claude-sdk') {
    throw new Error(
      `Provider "${providerId}" 类型为 "${config.type}"，仅 'claude-sdk' 类型可通过本通道调用。` +
        '其他类型请使用 agent:chat 通道（SupervisorAgent）。'
    )
  }
  if (!config.apiKey) {
    throw new Error(
      `Provider "${config.name}" (${providerId}) 缺少 API Key，请在设置中配置 ANTHROPIC_API_KEY`
    )
  }

  // 实例化并缓存
  const provider = new ClaudeSdkProvider(config)
  providerCache.set(providerId, provider)
  logger.info('IPC.CLAUDE_SDK', `ClaudeSdkProvider 实例已创建并缓存`, {
    providerId,
    model: config.model,
    baseURL: config.baseURL || '(default)',
  })
  return provider
}

/**
 * 注册 Claude SDK IPC handlers
 *
 * @param mainWindow 主窗口实例，用于推送流式事件到渲染进程
 */
export function registerClaudeSdkHandlers(mainWindow: BrowserWindow): void {
  // ------------------------------------------------------------------
  // claude-sdk:generate — 同步聚合调用（返回完整 ChatResult）
  // ------------------------------------------------------------------
  // 参数：(providerId: string, params: ClaudeSdkChatParams)
  // 返回：ChatResult（完整结果，含 usage / finishReason / text）
  // 异常：抛出错误对象 { message, code } 供渲染进程捕获
  ipcMain.handle(
    'claude-sdk:generate',
    async (
      _event,
      providerId: string,
      params: ClaudeSdkChatParams
    ): Promise<ChatResult> => {
      try {
        const provider = getOrCreateProvider(providerId)
        logger.info('IPC.CLAUDE_SDK', `claude-sdk:generate 调用`, {
          providerId,
          strength: params.strength ?? 'standard',
          promptLength: params.prompt?.length ?? 0,
          correlationId: params.correlationId,
        })
        const result = await provider.generate({
          ...params,
          includePartialMessages: params.includePartialMessages ?? false,
        })
        logger.info('IPC.CLAUDE_SDK', `claude-sdk:generate 完成`, {
          providerId,
          correlationId: params.correlationId,
          finishReason: result.finishReason,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          durationMs: result.durationMs,
        })
        return result
      } catch (err) {
        const errInfo = toClaudeSdkError(err)
        logger.error('IPC.CLAUDE_SDK', `claude-sdk:generate 失败`, {
          providerId,
          error: redactSecrets(errInfo.message),
        })
        // 抛出可序列化对象（IPC 不能传 Error 实例）
        throw errInfo
      }
    }
  )

  // ------------------------------------------------------------------
  // claude-sdk:stream — 异步流式调用（立即返回 correlationId）
  // ------------------------------------------------------------------
  // 参数：(providerId: string, params: ClaudeSdkChatParams)
  //   - v0.9.4 起 params.sessionId 可选，未提供时主进程自动生成并通过事件 payload 回传
  // 返回：correlationId（渲染进程用它监听 claude-sdk:chunk/done/error + 取消请求）
  // 后续事件：通过 webContents.send 推送
  ipcMain.handle(
    'claude-sdk:stream',
    async (
      _event,
      providerId: string,
      params: ClaudeSdkChatParams
    ): Promise<string> => {
      const correlationId =
        params.correlationId ?? `csdk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

      // v0.9.4：注册到 session-registry（如未提供 sessionId，registry 自动生成）
      const registry = getSessionRegistry()
      const resolvedSessionId = registry.register({
        sessionId: params.sessionId,
        correlationId,
        kind: 'claude-sdk:stream',
        providerId,
      })

      try {
        const provider = getOrCreateProvider(providerId)
        logger.info('IPC.CLAUDE_SDK', `claude-sdk:stream 启动`, {
          providerId,
          correlationId,
          sessionId: resolvedSessionId,
          strength: params.strength ?? 'standard',
          promptLength: params.prompt?.length ?? 0,
        })

        // 异步启动流式 chat（不阻塞 IPC 响应）
        void provider
          .stream({
            ...params,
            correlationId,
            includePartialMessages: params.includePartialMessages ?? true,
            onToken: (delta) => {
              // 推送 token 块到渲染进程（v0.9.4：携带 sessionId）
              const payload: AgentChunkPayload = { correlationId, delta, sessionId: resolvedSessionId }
              safeSend(mainWindow, CLAUDE_SDK_CHUNK_CHANNEL, payload)
            },
            onDone: (result: ChatResult) => {
              // 推送完成信号到渲染进程
              const payload: AgentDonePayload = { correlationId, result, sessionId: resolvedSessionId }
              safeSend(mainWindow, CLAUDE_SDK_DONE_CHANNEL, payload)
              // 请求结束，从 session-registry 移除（释放内存）
              registry.remove(resolvedSessionId)
            },
            onError: (error: Error) => {
              // 推送错误信号到渲染进程（错误信息经 redactSecrets 脱敏，HC-2）
              const errInfo = toClaudeSdkError(error)
              const payload: AgentErrorPayload = {
                correlationId,
                message: errInfo.message,
                code: errInfo.code,
                sessionId: resolvedSessionId,
              }
              safeSend(mainWindow, CLAUDE_SDK_ERROR_CHANNEL, payload)
              // 请求结束，从 session-registry 移除（释放内存）
              registry.remove(resolvedSessionId)
            },
          })
          .catch((err: unknown) => {
            // 兜底：provider.stream 内部异常（理论不应发生，因 onError 已处理）
            const errInfo = toClaudeSdkError(err)
            const payload: AgentErrorPayload = {
              correlationId,
              message: errInfo.message,
              code: errInfo.code,
              sessionId: resolvedSessionId,
            }
            safeSend(mainWindow, CLAUDE_SDK_ERROR_CHANNEL, payload)
            // 异常路径也需清理 session-registry
            registry.remove(resolvedSessionId)
            logger.error('IPC.CLAUDE_SDK', `claude-sdk:stream 异常`, {
              correlationId,
              sessionId: resolvedSessionId,
              error: redactSecrets(errInfo.message),
            })
          })

        // 立即返回 correlationId（渲染进程用它监听后续事件 + 取消请求）
        // 注意：sessionId 通过事件 payload 中的 sessionId 字段回传，不破坏返回类型
        return correlationId
      } catch (err) {
        // 同步错误（如 Provider 不存在 / apiKey 缺失）
        const errInfo = toClaudeSdkError(err)
        logger.error('IPC.CLAUDE_SDK', `claude-sdk:stream 启动失败`, {
          providerId,
          correlationId,
          sessionId: resolvedSessionId,
          error: redactSecrets(errInfo.message),
        })
        // 推送错误到渲染进程（让 onClaudeSdkError 监听器收到）
        const payload: AgentErrorPayload = {
          correlationId,
          message: errInfo.message,
          code: errInfo.code,
          sessionId: resolvedSessionId,
        }
        safeSend(mainWindow, CLAUDE_SDK_ERROR_CHANNEL, payload)
        // 同步错误也需清理 session-registry
        registry.remove(resolvedSessionId)
        // 仍返回 correlationId（保持 invoke 成功，错误通过事件流传递）
        return correlationId
      }
    }
  )

  // ------------------------------------------------------------------
  // claude-sdk:cancel — 取消进行中的请求
  // ------------------------------------------------------------------
  // 参数：(sessionIdOrCorrelationId: string)
  //   - v0.9.4 起兼容两种 ID：优先按 sessionId 查找，回退到 correlationId
  //   - 旧版调用方仍可传 correlationId（向后兼容）
  // 返回：boolean（是否成功取消）
  ipcMain.handle(
    'claude-sdk:cancel',
    async (_event, sessionIdOrCorrelationId: string): Promise<boolean> => {
      const registry = getSessionRegistry()

      // 1. 通过 session-registry 取消（按 sessionId 或 correlationId 查找）
      const registryOk = registry.abortById(sessionIdOrCorrelationId)

      // 2. 若 sessionIdOrCorrelationId 是 sessionId，通过 registry 反查 correlationId
      //    再调用 ClaudeSdkProvider.cancel(correlationId) 取消 SDK 内部的请求
      let correlationId = sessionIdOrCorrelationId
      const entry = registry
        .list()
        .find(
          (e) => e.sessionId === sessionIdOrCorrelationId || e.correlationId === sessionIdOrCorrelationId
        )
      if (entry) {
        correlationId = entry.correlationId
      }

      // 遍历所有缓存的 provider 查找对应 correlationId
      // （通常只有一个 provider，但仍支持多 provider 并发）
      let providerOk = false
      let matchedProviderId: string | undefined
      for (const [providerId, provider] of providerCache.entries()) {
        const ok = provider.cancel(correlationId)
        if (ok) {
          providerOk = true
          matchedProviderId = providerId
          break
        }
      }

      const ok = registryOk || providerOk
      logger.info('IPC.CLAUDE_SDK', `claude-sdk:cancel`, {
        inputId: sessionIdOrCorrelationId,
        correlationId,
        registryOk,
        providerOk,
        matchedProviderId,
        success: ok,
      })

      // 取消后清理 session-registry（避免 TTL 等待）
      if (entry) {
        registry.remove(entry.sessionId)
      }
      return ok
    }
  )

  logger.info('IPC.CLAUDE_SDK', `Claude Agent SDK IPC handlers 已注册`, {
    channels: ['claude-sdk:generate', 'claude-sdk:stream', 'claude-sdk:cancel'],
    pushChannels: [CLAUDE_SDK_CHUNK_CHANNEL, CLAUDE_SDK_DONE_CHANNEL, CLAUDE_SDK_ERROR_CHANNEL],
    // v0.9.4 新增能力：sessionId + abort signal（向后兼容，旧调用方不受影响）
    v094Features: [
      'claude-sdk:stream 的 params.sessionId 可选，未提供时主进程自动生成并通过事件 payload 回传',
      'claude-sdk:cancel 兼容 sessionId 与 correlationId 两种 ID',
      'claude-sdk:chunk / done / error 事件 payload 新增可选 sessionId 字段',
      'session-registry 集中维护 sessionId → AbortController Map，TTL 30 分钟自动清理',
    ],
  })
}
