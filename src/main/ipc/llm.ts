/**
 * LLM IPC Handlers
 *
 * 注册 LLM 相关的 IPC 通道，桥接渲染进程与 LlmClient。
 *
 * 通道列表（与 IpcChannelMap 对应）：
 * - llm:chat             — 普通对话（流式推送 token）
 * - llm:test             — 测试连接
 * - llm:analyze          — 分析问题（集成 Evidence，内置降级）
 * - llm:validate         — 校验 LLM 配置是否有效
 * - llm:chat-with-context — 带系统环境上下文的对话
 *
 * 流式事件推送（主 → 渲染）：
 * - llm:token — 兼容旧版，单个 token 字符串
 * - llm:chunk — 单个 token 块（含 delta 和 totalTokens）
 * - llm:done  — 完成信号（含完整文本）
 * - llm:error — 错误信号（含错误码/消息/是否可重试）
 *
 * 配置获取：LLM 配置从 ConfigStore.getLlmConfig() 读取，
 * API Key 从 SecureStore.getApiKey('llm') 读取并回填。
 *
 * 安全原则：错误信息不泄露内部实现（不返回 stack trace 给渲染进程）
 */

import { ipcMain, BrowserWindow } from 'electron'
import { LLM } from '@shared/ipc-channels'
import { LlmClient } from '../services/llm/client'
import { ConfigStore } from '../services/storage/config-store'
import { SecureStore } from '../services/storage/secure-store'
import type {
  ChatMessage,
  Evidence,
  LlmConfig,
  LlmValidationResult,
  EnvironmentContext,
  LlmStreamChunk,
  LlmError,
} from '@shared/models'

/** 流式 token 推送通道名（兼容旧版） */
const LLM_TOKEN_CHANNEL = 'llm:token'
/** 流式 token 块推送通道名（增强版，含 totalTokens） */
const LLM_CHUNK_CHANNEL = 'llm:chunk'
/** 流式完成信号通道名 */
const LLM_DONE_CHANNEL = 'llm:done'
/** 流式错误信号通道名 */
const LLM_ERROR_CHANNEL = 'llm:error'

/**
 * 错误码映射：根据错误信息判断错误类型
 * @param err 错误对象
 * @returns LlmError（不包含 stack trace）
 */
function toLlmError(err: unknown): LlmError {
  const msg = (err as Error).message ?? '未知错误'
  const lowerMsg = msg.toLowerCase()
  // 认证错误
  if (lowerMsg.includes('401') || lowerMsg.includes('unauthorized') ||
      lowerMsg.includes('invalid api key')) {
    return { code: 'AUTH', message: 'API Key 无效或已过期', retryable: false }
  }
  // 限流
  if (lowerMsg.includes('429') || lowerMsg.includes('rate limit')) {
    return { code: 'RATE_LIMIT', message: '请求过于频繁，请稍后重试', retryable: true }
  }
  // 超时
  if (lowerMsg.includes('timeout') || lowerMsg.includes('aborted')) {
    return { code: 'TIMEOUT', message: '请求超时', retryable: true }
  }
  // 网络错误
  if (lowerMsg.includes('network') || lowerMsg.includes('fetch failed') ||
      lowerMsg.includes('econnreset') || lowerMsg.includes('etimedout')) {
    return { code: 'NETWORK', message: '网络连接异常', retryable: true }
  }
  // 5xx 服务端错误
  if (/\b5\d{2}\b/.test(lowerMsg) || lowerMsg.includes('server error')) {
    return { code: 'SERVER', message: '服务器内部错误', retryable: true }
  }
  // 兜底
  return { code: 'UNKNOWN', message: 'LLM 调用失败', retryable: false }
}

/**
 * 获取 LLM 客户端实例
 *
 * 从 ConfigStore 读取配置，从 SecureStore 读取 API Key，
 * 每次调用都构造新的 LlmClient（配置可能已变更）。
 *
 * @returns LlmClient 实例（API Key 为空时 client.isAvailable() 返回 false）
 */
function getLlmClient(): LlmClient {
  const config = ConfigStore.getLlmConfig()
  if (!config) {
    return new LlmClient({
      baseUrl: '',
      apiKey: '',
      model: '',
      temperature: 0.7,
      maxTokens: 2048,
      timeout: 30_000
    })
  }
  const apiKey = SecureStore.getApiKey('llm') ?? ''
  const fullConfig: LlmConfig = { ...config, apiKey }
  return new LlmClient(fullConfig)
}

/**
 * 向主窗口安全推送事件（检查窗口是否已销毁）
 * @param mainWindow 主窗口
 * @param channel 通道名
 * @param args 参数
 */
function safeSend(mainWindow: BrowserWindow, channel: string, ...args: unknown[]): void {
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

/**
 * 注册 LLM 相关 IPC handlers
 *
 * @param mainWindow 主窗口实例，用于推送流式 token 到渲染进程
 */
export function registerLlmHandlers(mainWindow: BrowserWindow): void {
  // ------------------------------------------------------------------
  // llm:chat — 普通对话（流式推送 token）
  // ------------------------------------------------------------------

  ipcMain.handle(LLM.CHAT, async (_event, messages: ChatMessage[]) => {
    const client = getLlmClient()
    if (!client.isAvailable()) {
      const err: LlmError = {
        code: 'AUTH',
        message: '未配置 API Key，请在设置中配置',
        retryable: false
      }
      safeSend(mainWindow, LLM_ERROR_CHANNEL, err)
      throw new Error(err.message)
    }
    try {
      // 流式模式推送 token，同时返回完整文本
      const fullText = await client.chatStream(messages, (token) => {
        // 兼容旧版：推送 llm:token
        safeSend(mainWindow, LLM_TOKEN_CHANNEL, token)
        // 增强版：推送 llm:chunk（含 delta）
        const chunk: LlmStreamChunk = { delta: token }
        safeSend(mainWindow, LLM_CHUNK_CHANNEL, chunk)
      })
      // 完成信号
      safeSend(mainWindow, LLM_DONE_CHANNEL, fullText)
      return fullText
    } catch (err) {
      const llmErr = toLlmError(err)
      safeSend(mainWindow, LLM_ERROR_CHANNEL, llmErr)
      throw new Error(llmErr.message)
    }
  })

  // ------------------------------------------------------------------
  // llm:test — 测试连接
  // ------------------------------------------------------------------

  ipcMain.handle(LLM.TEST, async (_event, config: LlmConfig) => {
    const client = new LlmClient(config)
    if (!client.isAvailable()) {
      return false
    }
    return client.testConnection()
  })

  // ------------------------------------------------------------------
  // llm:validate — 校验 LLM 配置是否有效（不发起网络请求）
  // ------------------------------------------------------------------

  ipcMain.handle(LLM.VALIDATE, async (_event, config: LlmConfig): Promise<LlmValidationResult> => {
    const client = new LlmClient(config)
    return client.validateConfig()
  })

  // ------------------------------------------------------------------
  // llm:chat-with-context — 带系统环境上下文的对话
  // ------------------------------------------------------------------

  /**
   * 接收 ChatMessage[] 和 EnvironmentContext，返回 LLM 回复文本。
   * 将当前系统状态（CPU/内存/磁盘使用率等）注入提示词，让 LLM 感知系统状态。
   */
  ipcMain.handle(
    'llm:chat-with-context',
    async (_event, messages: ChatMessage[], envCtx: EnvironmentContext) => {
      const client = getLlmClient()
      if (!client.isAvailable()) {
        const err: LlmError = {
          code: 'AUTH',
          message: '未配置 API Key，请在设置中配置',
          retryable: false
        }
        safeSend(mainWindow, LLM_ERROR_CHANNEL, err)
        throw new Error(err.message)
      }
      try {
        const fullText = await client.chatWithContext(messages, envCtx)
        safeSend(mainWindow, LLM_DONE_CHANNEL, fullText)
        return fullText
      } catch (err) {
        const llmErr = toLlmError(err)
        safeSend(mainWindow, LLM_ERROR_CHANNEL, llmErr)
        throw new Error(llmErr.message)
      }
    }
  )

  // ------------------------------------------------------------------
  // llm:analyze — 分析问题（内置降级机制）
  // ------------------------------------------------------------------

  /**
   * 接收问题描述和证据列表，返回分析结果（JSON 字符串）。
   * 内置降级机制：LLM 不可用时自动使用规则引擎。
   */
  ipcMain.handle(
    'llm:analyze',
    async (_event, problem: string, evidences: Evidence[]) => {
      const client = getLlmClient()
      try {
        // analyze() 内置降级机制，无论 LLM 是否可用都会返回结果
        const result = await client.analyze(problem, evidences)
        return JSON.stringify(result)
      } catch (err) {
        // 兜底降级：返回低置信度结果（不泄露 stack trace）
        const fallback = {
          hypothesis: `分析失败: ${toLlmError(err).message}`,
          fixCommand: 'echo "需要人工诊断"',
          confidence: 0.1
        }
        return JSON.stringify(fallback)
      }
    }
  )
}
