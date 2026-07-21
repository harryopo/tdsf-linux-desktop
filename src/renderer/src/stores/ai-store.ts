/**
 * AI 对话状态管理 Store（Zustand）
 *
 * 职责：
 * - 管理对话消息列表
 * - 跟踪 LLM 流式输出状态
 * - 持有当前决策卡片（DecisionCard）
 * - 持有 Agent 工作流状态
 * - 持有当前工具调用列表（v0.5.0 Tool Calling）
 *
 * 流式输出时，llm:token 事件逐步追加到最后一条 assistant 消息内容中。
 * DecisionCard 和 AgentWorkflowState 由主进程 Agent 模块推送。
 */
import { create } from 'zustand'
import type { ChatMessage, DecisionCard, AgentWorkflowState } from '@shared/models'
import type { ToolCallProgress, ToolApprovalRequest } from '@shared/llm-tool-types'

/** AI Store 状态接口 */
interface AIState {
  /** 对话消息列表 */
  messages: ChatMessage[]
  /** 是否正在流式输出 */
  isStreaming: boolean
  /** 当前决策卡片 */
  decisionCard: DecisionCard | null
  /** Agent 工作流状态 */
  workflowState: AgentWorkflowState | null
  /** v0.5.0 工具调用记录（每次对话累积，清空时重置） */
  toolCalls: ToolCallProgress[]
  /** v0.5.0 当前待审批的工具（弹窗用） */
  pendingApproval: ToolApprovalRequest | null
  /** v0.8.0 翻译模块联动：待预填到输入框的消息（不自动发送） */
  prefillMessage: string | null
  /** v0.8.0 预填消息的时间戳（用于触发 ChatPanel 监听） */
  prefillAt: number | null

  // ===== Actions =====
  /** 添加消息 */
  addMessage: (message: ChatMessage) => void
  /** 追加流式 token 到最后一条 assistant 消息 */
  appendToken: (token: string) => void
  /** 清空所有消息 */
  clearMessages: () => void
  /** 设置流式输出状态 */
  setStreaming: (streaming: boolean) => void
  /** 设置决策卡片 */
  setDecisionCard: (card: DecisionCard | null) => void
  /** 设置 Agent 工作流状态 */
  setWorkflowState: (state: AgentWorkflowState | null) => void
  /** v0.5.0 添加/更新工具调用 */
  upsertToolCall: (progress: ToolCallProgress) => void
  /** v0.5.0 设置待审批工具 */
  setPendingApproval: (req: ToolApprovalRequest | null) => void
  /** v0.8.0 设置预填消息（终端翻译模块联动） */
  setPrefillMessage: (msg: string | null) => void
  /** 重置整个 AI 状态 */
  resetAIState: () => void
}

/** AI Store */
export const useAIStore = create<AIState>()((set) => ({
  messages: [],
  isStreaming: false,
  decisionCard: null,
  workflowState: null,
  toolCalls: [],
  pendingApproval: null,
  prefillMessage: null,
  prefillAt: null,

  // 添加消息
  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),

  // 追加流式 token 到最后一条 assistant 消息
  appendToken: (token) =>
    set((state) => {
      const messages = [...state.messages]
      // 找到最后一条 assistant 消息
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') {
          messages[i] = {
            ...messages[i],
            content: messages[i].content + token,
          }
          break
        }
      }
      return { messages }
    }),

  // 清空所有消息
  clearMessages: () =>
    set({ messages: [], toolCalls: [], pendingApproval: null }),

  // 设置流式输出状态
  setStreaming: (streaming) =>
    set({ isStreaming: streaming }),

  // 设置决策卡片
  setDecisionCard: (card) =>
    set({ decisionCard: card }),

  // 设置 Agent 工作流状态
  setWorkflowState: (workflowState) =>
    set({ workflowState }),

  // v0.5.0 工具调用：根据 callId 追加或更新
  upsertToolCall: (progress) =>
    set((state) => {
      const idx = state.toolCalls.findIndex((t) => t.callId === progress.callId)
      if (idx >= 0) {
        const next = [...state.toolCalls]
        next[idx] = progress
        return { toolCalls: next }
      }
      return { toolCalls: [...state.toolCalls, progress] }
    }),

  // v0.5.0 设置待审批
  setPendingApproval: (req) =>
    set({ pendingApproval: req }),

  // v0.8.0 设置预填消息（带时间戳，方便 ChatPanel 监听变化）
  setPrefillMessage: (msg) =>
    set({
      prefillMessage: msg,
      prefillAt: msg ? Date.now() : null,
    }),

  // 重置整个 AI 状态
  resetAIState: () =>
    set({
      messages: [],
      isStreaming: false,
      decisionCard: null,
      workflowState: null,
      toolCalls: [],
      pendingApproval: null,
      prefillMessage: null,
      prefillAt: null,
    }),
}))
