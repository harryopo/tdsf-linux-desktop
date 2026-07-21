/**
 * LLM Tool Calling IPC Handlers
 *
 * 桥接渲染进程与主进程 LLM Tool Calling 能力。
 *
 * 通道：
 * - llm:chat-with-tools  — 工具调用对话（流式推送 + 工具进度）
 * - llm:tool-approve     — 工具审批响应（仅 high 风险工具）
 *
 * 流式事件推送（主 → 渲染）：
 * - llm:tool-progress    — 单个工具调用进度（start/executing/success/failed/awaiting-approval）
 * - llm:tool-approval    — 需要用户审批（推送到渲染端弹窗）
 * - llm:chunk            — LLM 流式 token（复用旧通道）
 * - llm:done             — 完成信号
 * - llm:error            — 错误信号
 *
 * 工作流：
 * 1. renderer 调 llm:chat-with-tools(messages, sessionId?)
 * 2. main 调 LLM（带 5 工具）
 * 3. LLM 决定调某工具 → main 推送 llm:tool-progress(start)
 * 4. 如需审批（ssh_exec）→ 推送 llm:tool-approval → renderer 弹窗
 * 5. renderer 调 llm:tool-approve(callId, approved)
 * 6. main 继续执行工具 → 推送 llm:tool-progress(success/failed)
 * 7. LLM 继续生成 → 推送 llm:chunk → 推 llm:done
 */

import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { LLM } from '@shared/ipc-channels'
import { LlmClient } from '../services/llm/client'
import { ConfigStore } from '../services/storage/config-store'
import { SecureStore } from '../services/storage/secure-store'
import { ToolRegistry } from '../services/llm/tools/registry'
import { generateText, isStepCount } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import type {
  ChatMessage,
  LlmConfig,
  LlmStreamChunk,
  LlmError,
} from '@shared/models'
import type {
  ToolCallProgress,
  ToolApprovalRequest,
  ToolApprovalResponse,
  ToolCallResult,
  ToolId,
} from '@shared/llm-tool-types'

/** 通道名 */
const LLM_TOOL_PROGRESS_CHANNEL = 'llm:tool-progress'
const LLM_TOOL_APPROVAL_CHANNEL = 'llm:tool-approval'
const LLM_CHUNK_CHANNEL = 'llm:chunk'
const LLM_DONE_CHANNEL = 'llm:done'
const LLM_ERROR_CHANNEL = 'llm:error'

/** 待审批的工具调用池（callId → resolve 函数） */
const pendingApprovals: Map<string, {
  resolve: (approved: boolean) => void
  reject: (err: Error) => void
  timeout: NodeJS.Timeout
}> = new Map()

/** 审批超时（30 秒后自动拒绝） */
const APPROVAL_TIMEOUT_MS = 30_000

/**
 * 安全推送事件
 */
function safeSend(mainWindow: BrowserWindow, channel: string, ...args: unknown[]): void {
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

/**
 * 错误码映射
 */
function toLlmError(err: unknown): LlmError {
  const msg = (err as Error).message ?? '未知错误'
  const lower = msg.toLowerCase()
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid api key')) {
    return { code: 'AUTH', message: 'API Key 无效', retryable: false }
  }
  if (lower.includes('429') || lower.includes('rate limit')) {
    return { code: 'RATE_LIMIT', message: '请求过于频繁', retryable: true }
  }
  if (lower.includes('timeout') || lower.includes('aborted')) {
    return { code: 'TIMEOUT', message: '请求超时', retryable: true }
  }
  if (lower.includes('network') || lower.includes('fetch failed')) {
    return { code: 'NETWORK', message: '网络连接异常', retryable: true }
  }
  if (/\b5\d{2}\b/.test(lower)) {
    return { code: 'SERVER', message: '服务器内部错误', retryable: true }
  }
  return { code: 'UNKNOWN', message: 'LLM 调用失败', retryable: false }
}

/**
 * 等待用户审批
 */
function waitForApproval(
  mainWindow: BrowserWindow,
  callId: string,
  approval: Omit<ToolApprovalRequest, 'callId'>
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const request: ToolApprovalRequest = { callId, ...approval }
    safeSend(mainWindow, LLM_TOOL_APPROVAL_CHANNEL, request)

    const timeout = setTimeout(() => {
      pendingApprovals.delete(callId)
      reject(new Error('用户审批超时（30秒），自动拒绝'))
    }, APPROVAL_TIMEOUT_MS)

    pendingApprovals.set(callId, { resolve, reject, timeout })
  })
}

/**
 * 注册 LLM Tool Calling IPC handlers
 */
export function registerLlmToolHandlers(
  mainWindow: BrowserWindow,
  db: import('../services/db/database').DatabaseManager | null
): void {
  // 工具注册器
  const registry = new ToolRegistry(db ?? undefined)

  // ------------------------------------------------------------------
  // llm:tool-approve — 用户审批响应
  // ------------------------------------------------------------------
  ipcMain.handle(LLM.TOOL_APPROVE, async (_event, response: ToolApprovalResponse) => {
    const pending = pendingApprovals.get(response.callId)
    if (!pending) {
      console.warn(`[llm:tool-approve] 找不到待审批的 callId: ${response.callId}`)
      return false
    }
    clearTimeout(pending.timeout)
    pendingApprovals.delete(response.callId)
    if (response.approved) {
      pending.resolve(true)
    } else {
      pending.resolve(false)
    }
    return true
  })

  // ------------------------------------------------------------------
  // llm:chat-with-tools — 带工具调用的对话
  // ------------------------------------------------------------------
  ipcMain.handle(
    'llm:chat-with-tools',
    async (_event, messages: ChatMessage[]) => {
      const config = ConfigStore.getLlmConfig()
      const apiKey = SecureStore.getApiKey('llm') ?? ''
      const fullConfig: LlmConfig = config
        ? { ...config, apiKey }
        : { baseUrl: '', apiKey: '', model: '', temperature: 0.7, maxTokens: 2048, timeout: 30_000 }

      // 无 API Key 降级到普通 LlmClient（不带工具）
      if (!fullConfig.apiKey || !fullConfig.baseUrl || !fullConfig.model) {
        const client = new LlmClient(fullConfig)
        try {
          const text = await client.chat(messages)
          safeSend(mainWindow, LLM_DONE_CHANNEL, text)
          return text
        } catch (err) {
          const llmErr = toLlmError(err)
          safeSend(mainWindow, LLM_ERROR_CHANNEL, llmErr)
          throw new Error(llmErr.message)
        }
      }

      try {
        const openai = createOpenAI({
          baseURL: fullConfig.baseUrl,
          apiKey: fullConfig.apiKey,
        })

        // 转换消息格式
        const aiMessages = messages.map((m) => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        }))

        // 把工具转成 Vercel AI SDK 的 tool() 格式
        const toolMap = registry.list().reduce<Record<string, unknown>>((acc, t) => {
          acc[t.name] = {
            description: t.description,
            parameters: t.parameters,
            // 自定义 execute：包装审批逻辑
            execute: async (args: unknown) => {
              const callId = randomUUID()
              // 工具元数据（风险/标签/审批）从 meta 映射查
              const toolMeta = registry.getMeta(t.name as ToolId)

              // 推送 start 进度
              const startProgress: ToolCallProgress = {
                callId,
                toolId: t.name,
                phase: 'start',
                args: args as Record<string, unknown>,
                timestamp: Date.now(),
              }
              safeSend(mainWindow, LLM_TOOL_PROGRESS_CHANNEL, startProgress)

              // 需要审批
              if (toolMeta?.requiresApproval) {
                safeSend(mainWindow, LLM_TOOL_PROGRESS_CHANNEL, {
                  ...startProgress,
                  phase: 'awaiting-approval',
                  risk: toolMeta.risk,
                } satisfies ToolCallProgress)

                try {
                  const approved = await waitForApproval(mainWindow, callId, {
                    toolId: t.name,
                    args: args as Record<string, unknown>,
                    risk: toolMeta.risk,
                    riskReason: `${toolMeta.label}（${toolMeta.description}）`,
                    commandPreview: (args as { command?: string })?.command,
                  })
                  if (!approved) {
                    return {
                      toolId: t.name,
                      success: false,
                      error: '用户拒绝执行该工具',
                      durationMs: 0,
                      timestamp: Date.now(),
                    } satisfies ToolCallResult
                  }
                } catch (err) {
                  return {
                    toolId: t.name,
                    success: false,
                    error: (err as Error).message,
                    durationMs: 0,
                    timestamp: Date.now(),
                  } satisfies ToolCallResult
                }
              }

              // 推送 executing
              safeSend(mainWindow, LLM_TOOL_PROGRESS_CHANNEL, {
                ...startProgress,
                phase: 'executing',
              } satisfies ToolCallProgress)

              // 执行
              const result = (await t.execute(args)) as ToolCallResult

              // 推送 success/failed
              safeSend(mainWindow, LLM_TOOL_PROGRESS_CHANNEL, {
                callId,
                toolId: t.name,
                phase: result.success ? 'success' : 'failed',
                result,
                timestamp: Date.now(),
              } satisfies ToolCallProgress)

              return result
            },
          }
          return acc
        }, {})

        // 流式调用 LLM（v7：tools 必须配 toolsContext）
        const result = await generateText({
          model: openai(fullConfig.model),
          messages: aiMessages,
          tools: toolMap as never,
          toolsContext: {} as never, // v7 必填：工具上下文（无工具时为空对象）
          temperature: fullConfig.temperature ?? 0.7,
          maxOutputTokens: fullConfig.maxTokens ?? 2048,
          stopWhen: isStepCount(5), // 防止 LLM 死循环调工具（v7: maxSteps → stopWhen + isStepCount）
        })

        // 推送流式 token（如果有）
        if (result.text) {
          // generateText 返回完整文本，逐字符推送模拟流式（避免阻塞）
          const chunk: LlmStreamChunk = { delta: result.text, totalTokens: result.usage?.totalTokens }
          safeSend(mainWindow, LLM_CHUNK_CHANNEL, chunk)
        }

        safeSend(mainWindow, LLM_DONE_CHANNEL, result.text)
        return result.text
      } catch (err) {
        const llmErr = toLlmError(err)
        safeSend(mainWindow, LLM_ERROR_CHANNEL, llmErr)
        throw new Error(llmErr.message)
      }
    }
  )
}
