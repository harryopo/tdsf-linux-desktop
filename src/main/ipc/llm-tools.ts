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
import { broadcastToWindows } from '../windows/main-window'
import { randomUUID } from 'crypto'
import { LLM } from '@shared/ipc-channels'
import { LlmClient } from '../services/llm/client'
import { resolveLlmBudget } from '../core/agent/llm-budget'
import { resolveLlmConfig } from '../services/llm/llm-config-resolver'
import { ToolRegistry } from '../services/llm/tools/registry'
import { classifyLlmError } from '../core/agent/providers/llm-error'
// D2：审批判定唯一权威 —— 只有字面 true 算批准
import { readApproval } from '../core/security/approval'
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
  // 工具进度与审批请求要让每个应用窗口都收到（见 sandbox-approval 的同名注释）
  void mainWindow
  broadcastToWindows(channel, ...args)
}

/**
 * 错误码映射：单源在 providers/llm-error.ts（#101）
 *
 * 这一份原本只有 6 个分支，而且把原始消息整条丢掉（用户只看到"请求超时"四个字，
 * 无从判断是哪一步）。合并后统一带上脱敏截断过的原始信息。
 */
function toLlmError(err: unknown): LlmError {
  return classifyLlmError(err, 'LLM 调用失败')
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
  // 安全：response 整体是跨进程外部输入，callId 取不到就什么都不做；
  //       批准位只有字面 true 算批准（见 core/security/approval.ts）
  ipcMain.handle(LLM.TOOL_APPROVE, async (_event, response: unknown) => {
    const payload = (response ?? {}) as Partial<ToolApprovalResponse>
    const callId = typeof payload.callId === 'string' ? payload.callId : ''
    const approved = readApproval(payload)
    if (approved !== (payload.approved as unknown)) {
      console.warn(`[llm:tool-approve] 批准位非布尔，按拒绝处理: ${typeof payload.approved}`)
    }
    const pending = pendingApprovals.get(callId)
    if (!pending) {
      console.warn(`[llm:tool-approve] 找不到待审批的 callId: ${callId}`)
      return false
    }
    clearTimeout(pending.timeout)
    pendingApprovals.delete(callId)
    pending.resolve(approved)
    return true
  })

  // ------------------------------------------------------------------
  // llm:chat-with-tools — 带工具调用的对话
  // ------------------------------------------------------------------
  ipcMain.handle(
    'llm:chat-with-tools',
    async (_event, messages: ChatMessage[]) => {
      // 配置统一走 resolveLlmConfig（Provider 体系优先，旧 'llm' Key 兜底）
      const fullConfig: LlmConfig = resolveLlmConfig('ipc/llm-tools')

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
        const budget = resolveLlmBudget({
          settingTimeoutMs: fullConfig.timeout,
          stepCount: 5,
          hasTools: Object.keys(toolMap).length > 0,
        })
        const result = await generateText({
          // 必须 .chat()：createOpenAI 出来的工厂直接调用默认走 Responses API（/responses），
          // 而这里面向的是国产兼容端，只实现了 /chat/completions，
          // 走 Responses 会稳定 404 并被归类成"模型不存在"（provider-factory 同一处已注明）
          model: openai.chat(fullConfig.model),
          messages: aiMessages,
          tools: toolMap as never,
          toolsContext: {} as never, // v7 必填：工具上下文（无工具时为空对象）
          temperature: fullConfig.temperature ?? 0.7,
          maxOutputTokens: fullConfig.maxTokens ?? 2048,
          timeout: budget.timeout,
          maxRetries: budget.maxRetries,
          stopWhen: isStepCount(budget.stepCount), // 防止 LLM 死循环调工具（v7: maxSteps → stopWhen + isStepCount）
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
