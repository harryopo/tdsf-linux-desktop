/**
 * Agent Store（v0.9 Supervisor Agent 状态管理）
 *
 * 职责：
 * - 管理与 Supervisor Agent 的对话消息（AgentMessage）
 * - 跟踪流式输出状态 + 当前 correlationId（用于取消请求）
 * - 持有当前思考强度（fast / standard / deep）
 * - 持有当前选择的 Provider ID
 * - 持有 Provider 列表（从 IPC provider:list 加载）
 * - 持有 Token 统计聚合（从 IPC token:stats 加载）
 *
 * 与现有 useAIStore 的关系：
 * - useAIStore 管理 v0.8 旧 AgentWorkflow 的状态（decisionCard / workflowState / toolCalls）
 * - useAgentStore 管理 v0.9 Supervisor chat 的状态（AgentMessage / provider / tokenStats）
 * - 两者并存，ChatPanel 可根据场景选用（v0.9 优先用 agent-store）
 *
 * 流式输出流程：
 * 1. 用户发送消息 → 调用 agentChat IPC → 返回 correlationId
 * 2. 监听 onAgentChunk → appendToken 追加到当前 assistant 消息
 * 3. 监听 onAgentDone → finalizeMessage 标记完成 + 更新 tokenStats
 * 4. 监听 onAgentError → 标记错误 + 清理 streaming 状态
 *
 * 方案书依据：v0.9 §3（Provider 抽象）+ §5（Token 监控）+ §6（思考强度）
 */
import { create } from 'zustand'
import type {
  PersistedProviderConfig,
  ThinkingStrength,
  TokenStats,
  AgentChunkPayload,
  AgentDonePayload,
  AgentErrorPayload,
  AgentMode,
  ModeInfo,
} from '@shared/agent-types'

/**
 * Agent 对话消息（扩展 ChatMessage，含元信息）
 */
export interface AgentMessage {
  /** 消息唯一 ID */
  id: string
  /** 角色（user / assistant / system） */
  role: 'user' | 'assistant' | 'system'
  /** 消息内容 */
  content: string
  /** 时间戳（ms） */
  timestamp: number
  /** 关联的 chat correlationId（assistant 消息用，便于追踪） */
  correlationId?: string
  /** 是否正在流式输出（assistant 消息用） */
  isStreaming?: boolean
  /** 是否出错（assistant 消息用，error 内容来自 AgentErrorPayload） */
  isError?: boolean
  /** 触发的 Provider ID（assistant 消息用，用于展示） */
  providerId?: string
  /** 实际使用的模型名（assistant 消息用，done 事件回填） */
  model?: string
  /** 本次调用的 token 使用（done 事件回填） */
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
}

/**
 * 默认 Token 统计（初始化时用）
 */
const DEFAULT_TOKEN_STATS: TokenStats = {
  today: 0,
  week: 0,
  month: 0,
  total: 0,
  bySubagent: {},
  byProvider: {},
}

/**
 * Agent Store 状态接口
 */
interface AgentState {
  // ===== 状态 =====
  /** 对话消息列表 */
  messages: AgentMessage[]
  /** 是否正在流式输出 */
  isStreaming: boolean
  /** 当前进行中的 chat correlationId（用于取消请求） */
  currentCorrelationId: string | null
  /** 当前思考强度 */
  thinkingStrength: ThinkingStrength
  /** 当前选择的 Provider ID */
  selectedProviderId: string | null
  /** Provider 列表（从 IPC 加载，不含 apiKey） */
  providers: PersistedProviderConfig[]
  /** Token 统计聚合 */
  tokenStats: TokenStats
  /** 最近一次错误（来自 AgentErrorPayload） */
  lastError: string | null
  /** 当前 Agent 模式（v0.9.5 P0：Mode 五模式切换，默认 'chat'） */
  currentMode: AgentMode
  /** 所有可用 mode 配置（v0.9.5 P0：从 IPC mode:list 加载，不含 systemPrompt） */
  modeList: ModeInfo[]

  // ===== Actions =====
  /** 添加消息 */
  addMessage: (message: AgentMessage) => void
  /** 追加流式 token 到最后一条 assistant 消息 */
  appendToken: (payload: AgentChunkPayload) => void
  /** 完成消息（done 事件回填 usage/model 等） */
  finalizeMessage: (payload: AgentDonePayload) => void
  /** 标记错误 */
  markError: (payload: AgentErrorPayload) => void
  /** 清空所有消息 */
  clearMessages: () => void
  /** 设置流式输出状态 */
  setStreaming: (streaming: boolean) => void
  /** 设置当前 correlationId */
  setCurrentCorrelationId: (id: string | null) => void
  /** 设置思考强度 */
  setThinkingStrength: (strength: ThinkingStrength) => void
  /** 设置选中的 Provider ID */
  setSelectedProviderId: (id: string | null) => void
  /** 设置 Provider 列表（从 IPC 加载后调用） */
  setProviders: (providers: PersistedProviderConfig[]) => void
  /** 设置 Token 统计 */
  setTokenStats: (stats: TokenStats) => void
  /** 设置当前 Agent mode（v0.9.5 P0） */
  setCurrentMode: (mode: AgentMode) => void
  /** 设置 mode 列表（v0.9.5 P0） */
  setModeList: (list: ModeInfo[]) => void
  /** 重置整个 Agent 状态 */
  resetAgentState: () => void
}

/**
 * Agent Store（zustand）
 */
export const useAgentStore = create<AgentState>()((set) => ({
  // ===== 初始状态 =====
  messages: [],
  isStreaming: false,
  currentCorrelationId: null,
  thinkingStrength: 'standard',
  selectedProviderId: null,
  providers: [],
  tokenStats: DEFAULT_TOKEN_STATS,
  lastError: null,
  currentMode: 'chat',
  modeList: [],

  // ===== Actions =====

  // 添加消息
  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),

  // 追加流式 token 到最后一条 assistant 消息
  appendToken: (payload) =>
    set((state) => {
      const messages = [...state.messages]
      // 找到最后一条 assistant 消息（按 correlationId 匹配，回退到最后一条 assistant）
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        if (msg.role === 'assistant') {
          // 优先按 correlationId 匹配，找不到则回退到最后一条 assistant
          if (payload.correlationId && msg.correlationId && msg.correlationId !== payload.correlationId) {
            continue
          }
          messages[i] = {
            ...msg,
            content: msg.content + payload.delta,
            isStreaming: true,
          }
          break
        }
      }
      return { messages }
    }),

  // 完成消息（done 事件回填 usage/model/providerId 等）
  finalizeMessage: (payload) =>
    set((state) => {
      const messages = [...state.messages]
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        if (msg.role === 'assistant') {
          if (msg.correlationId && msg.correlationId !== payload.correlationId) {
            continue
          }
          messages[i] = {
            ...msg,
            isStreaming: false,
            providerId: payload.result.providerId,
            model: payload.result.model,
            usage: payload.result.usage,
          }
          break
        }
      }
      return {
        messages,
        isStreaming: false,
        currentCorrelationId: null,
      }
    }),

  // 标记错误
  markError: (payload) =>
    set((state) => {
      const messages = [...state.messages]
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        if (msg.role === 'assistant') {
          if (msg.correlationId && msg.correlationId !== payload.correlationId) {
            continue
          }
          messages[i] = {
            ...msg,
            isStreaming: false,
            isError: true,
            // 错误时追加错误信息到内容末尾（便于用户看到）
            content: msg.content
              ? `${msg.content}\n\n[错误] ${payload.message}`
              : `[错误] ${payload.message}`,
          }
          break
        }
      }
      return {
        messages,
        isStreaming: false,
        currentCorrelationId: null,
        lastError: payload.message,
      }
    }),

  // 清空所有消息
  clearMessages: () =>
    set({
      messages: [],
      isStreaming: false,
      currentCorrelationId: null,
      lastError: null,
    }),

  // 设置流式输出状态
  setStreaming: (streaming) => set({ isStreaming: streaming }),

  // 设置当前 correlationId
  setCurrentCorrelationId: (id) => set({ currentCorrelationId: id }),

  // 设置思考强度
  setThinkingStrength: (strength) => set({ thinkingStrength: strength }),

  // 设置选中的 Provider ID
  setSelectedProviderId: (id) => set({ selectedProviderId: id }),

  // 设置 Provider 列表
  setProviders: (providers) => set({ providers }),

  // 设置 Token 统计
  setTokenStats: (stats) => set({ tokenStats: stats }),

  // 设置当前 Agent mode（v0.9.5 P0）
  setCurrentMode: (mode) => set({ currentMode: mode }),

  // 设置 mode 列表（v0.9.5 P0）
  setModeList: (list) => set({ modeList: list }),

  // 重置整个 Agent 状态
  resetAgentState: () =>
    set({
      messages: [],
      isStreaming: false,
      currentCorrelationId: null,
      lastError: null,
      // currentMode 不重置（用户的 mode 偏好跨会话保持）
      // thinkingStrength / selectedProviderId / providers / tokenStats / modeList 不重置
    }),
}))
