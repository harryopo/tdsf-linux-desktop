/**
 * AI 对话状态管理 Store（Zustand）
 *
 * 职责：
 * - 管理对话消息列表
 * - 跟踪 LLM 流式输出状态
 * - 持有当前决策卡片（DecisionCard）
 * - 持有 Agent 工作流状态
 *
 * 流式输出时，llm:token 事件逐步追加到最后一条 assistant 消息内容中。
 * DecisionCard 和 AgentWorkflowState 由主进程 Agent 模块推送。
 */
import { create } from 'zustand'
import type { ChatMessage, DecisionCard, AgentWorkflowState } from '@shared/models'

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
  /** 重置整个 AI 状态 */
  resetAIState: () => void
}

/** AI Store */
export const useAIStore = create<AIState>()((set) => ({
  messages: [],
  isStreaming: false,
  decisionCard: null,
  workflowState: null,

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
    set({ messages: [] }),

  // 设置流式输出状态
  setStreaming: (streaming) =>
    set({ isStreaming: streaming }),

  // 设置决策卡片
  setDecisionCard: (card) =>
    set({ decisionCard: card }),

  // 设置 Agent 工作流状态
  setWorkflowState: (workflowState) =>
    set({ workflowState }),

  // 重置整个 AI 状态
  resetAIState: () =>
    set({
      messages: [],
      isStreaming: false,
      decisionCard: null,
      workflowState: null,
    }),
}))
