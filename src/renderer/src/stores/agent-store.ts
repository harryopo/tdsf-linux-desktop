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
  CostStats,
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
 * 默认成本统计（v0.9.3 §11 改进点 26 P2-F 新增）
 *
 * 与 DEFAULT_TOKEN_STATS 对应，用于 Token 监控面板展示 USD 成本。
 * 初始值全 0，由 useAgentChat 在挂载时通过 IPC token:cost-stats 加载。
 */
const DEFAULT_COST_STATS: CostStats = {
  todayCost: 0,
  weekCost: 0,
  monthCost: 0,
  totalCost: 0,
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
  /**
   * 成本统计聚合（v0.9.3 §11 改进点 26 P2-F 新增）
   *
   * 与 tokenStats 对应，展示 USD 成本（todayCost/weekCost/monthCost/totalCost + by 维度）。
   * 由 useAgentChat 通过 IPC token:cost-stats 加载，并在 agent:done 事件后刷新。
   */
  costStats: CostStats
  /**
   * 本次会话成本基线（v0.9.3 §11 改进点 26 P2-F 新增）
   *
   * 在 useAgentChat 首次加载 costStats 时记录 totalCost 作为基线。
   * sessionCost = currentTotalCost - sessionCostBaseline（≥0）。
   * 用于"本次会话累计成本：$X.XX"展示，让用户感知当前会话的真实开销。
   * 初始为 null（未加载过 costStats），加载后为非负数字。
   */
  sessionCostBaseline: number | null
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
  /**
   * 上下文压缩（T.7）
   *
   * 简单策略：保留 system 消息 + 最近 N 条对话，中间历史用本地摘要消息替换，
   * 避免长对话超出模型上下文窗口。仅在非流式状态下执行。
   */
  compressMessages: (opts?: { keepRecent?: number }) => void
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
  /**
   * 设置成本统计（v0.9.3 §11 改进点 26 P2-F 新增）
   *
   * 同时处理 sessionCostBaseline：
   * - 如果当前 sessionCostBaseline 为 null（首次加载），则记录当前 totalCost 作为基线
   * - 否则保留现有基线，仅更新 costStats
   */
  setCostStats: (stats: CostStats) => void
  /**
   * 重置本次会话成本基线（v0.9.3 §11 改进点 26 P2-F 新增）
   *
   * 用户主动"重置会话成本"或清空对话时调用，将基线设为当前 totalCost，
   * 让"本次会话"从 0 重新累计。
   */
  resetSessionCostBaseline: () => void
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
  costStats: DEFAULT_COST_STATS,
  sessionCostBaseline: null,
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

  // 上下文压缩（T.7）：保留 system 消息 + 最近 N 条，中间历史生成本地摘要
  compressMessages: (opts) =>
    set((state) => {
      if (state.isStreaming || state.messages.length === 0) return state

      const keepRecent = Math.max(2, opts?.keepRecent ?? 6)
      const systemMessages = state.messages.filter((m) => m.role === 'system')
      const chatMessages = state.messages.filter((m) => m.role === 'user' || m.role === 'assistant')

      // 消息数未超过阈值，无需压缩
      if (chatMessages.length <= keepRecent) return state

      const kept = chatMessages.slice(-keepRecent)
      const dropped = chatMessages.slice(0, chatMessages.length - keepRecent)
      const userCount = dropped.filter((m) => m.role === 'user').length
      const assistantCount = dropped.filter((m) => m.role === 'assistant').length
      const droppedTokens = dropped.reduce((sum, m) => sum + (m.content?.length ?? 0), 0)

      // 本地摘要：提取被压缩段落的主题/命令片段（启发式）
      const snippets = dropped
        .filter((m) => m.role === 'user')
        .map((m) => m.content.slice(0, 40))
        .filter(Boolean)
        .slice(0, 3)
      const summaryText =
        snippets.length > 0
          ? `[上下文已压缩] 前面 ${userCount} 轮对话 / ${assistantCount} 条回复 / 约 ${droppedTokens} 字符已被摘要。主题包括：${snippets.join('；')}。`
          : `[上下文已压缩] 前面 ${userCount} 轮对话 / ${assistantCount} 条回复 / 约 ${droppedTokens} 字符已被摘要。`

      const summaryMessage: AgentMessage = {
        id: `compress_${Date.now()}`,
        role: 'assistant',
        content: summaryText,
        timestamp: Date.now(),
      }

      return {
        messages: [...systemMessages, summaryMessage, ...kept],
      }
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

  // 设置成本统计（v0.9.3 §11 改进点 26 P2-F）
  // 首次加载时记录 sessionCostBaseline，后续保留基线只更新 costStats
  setCostStats: (stats) =>
    set((state) => ({
      costStats: stats,
      sessionCostBaseline:
        state.sessionCostBaseline === null ? stats.totalCost : state.sessionCostBaseline,
    })),

  // 重置本次会话成本基线（用户主动重置时调用）
  resetSessionCostBaseline: () =>
    set((state) => ({
      sessionCostBaseline: state.costStats.totalCost,
    })),

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
