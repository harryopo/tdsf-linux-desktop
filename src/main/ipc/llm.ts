/**
 * LLM IPC Handlers
 *
 * 注册 LLM 相关的 IPC 通道，桥接渲染进程与 LlmClient。
 *
 * 通道列表（与 IpcChannelMap 对应）：
 * - llm:chat    — 普通对话（一次性返回）
 * - llm:test    — 测试连接
 * - llm:analyze — 分析问题（集成 Evidence）
 *
 * 流式 token 推送：
 * - llm:chat 在流式模式下，通过 mainWindow.webContents.send('llm:token', token) 推送
 * - 当前实现：chat 使用普通模式（非流式），渲染进程如需流式请单独调用
 *
 * 配置获取：
 * - LLM 配置从 ConfigStore.getLlmConfig() 读取
 * - API Key 从 SecureStore.getApiKey('llm') 读取并回填
 */

import { ipcMain, BrowserWindow } from 'electron'
import { LlmClient } from '../services/llm/client'
import { ConfigStore } from '../services/storage/config-store'
import { SecureStore } from '../services/storage/secure-store'
import type { ChatMessage, Evidence, LlmConfig } from '@shared/models'

/** 流式 token 推送通道名 */
const LLM_TOKEN_CHANNEL = 'llm:token'

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
    // 返回一个不可用的客户端（API Key 为空）
    return new LlmClient({
      baseUrl: '',
      apiKey: '',
      model: '',
      temperature: 0.7,
      maxTokens: 2048,
      timeout: 30_000
    })
  }
  // 从 SecureStore 读取 API Key 并回填
  const apiKey = SecureStore.getApiKey('llm') ?? ''
  const fullConfig: LlmConfig = { ...config, apiKey }
  return new LlmClient(fullConfig)
}

/**
 * 注册 LLM 相关 IPC handlers
 *
 * @param mainWindow 主窗口实例，用于推送流式 token 到渲染进程
 */
export function registerLlmHandlers(mainWindow: BrowserWindow): void {
  // ------------------------------------------------------------------
  // llm:chat — 普通对话
  // ------------------------------------------------------------------

  /**
   * 接收 ChatMessage[]，返回 LLM 回复文本。
   * 当 LLM 不可用时抛出 Error（渲染进程可降级显示提示）。
   */
  ipcMain.handle('llm:chat', async (_event, messages: ChatMessage[]) => {
    const client = getLlmClient()
    if (!client.isAvailable()) {
      throw new Error('LLM 不可用：未配置 API Key，请在设置中配置')
    }
    try {
      // 使用流式模式推送 token，同时返回完整文本
      const fullText = await client.chatStream(messages, (token) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send(LLM_TOKEN_CHANNEL, token)
        }
      })
      return fullText
    } catch (err) {
      throw new Error(`LLM 对话失败: ${(err as Error).message}`)
    }
  })

  // ------------------------------------------------------------------
  // llm:test — 测试连接
  // ------------------------------------------------------------------

  /**
   * 接收 LlmConfig，测试连接是否可用。
   * 不依赖全局配置，使用传入的 config 构造临时客户端。
   */
  ipcMain.handle('llm:test', async (_event, config: LlmConfig) => {
    const client = new LlmClient(config)
    if (!client.isAvailable()) {
      return false
    }
    return client.testConnection()
  })

  // ------------------------------------------------------------------
  // llm:analyze — 分析问题
  // ------------------------------------------------------------------

  /**
   * 接收问题描述和证据列表，返回分析结果（JSON 字符串）。
   * 内置降级机制：LLM 不可用时自动使用规则引擎。
   *
   * 返回格式：JSON.stringify({ hypothesis, fixCommand, confidence })
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
        // 兜底降级：返回低置信度结果
        const fallback = {
          hypothesis: `分析失败: ${(err as Error).message}`,
          fixCommand: 'echo "需要人工诊断"',
          confidence: 0.1
        }
        return JSON.stringify(fallback)
      }
    }
  )
}
