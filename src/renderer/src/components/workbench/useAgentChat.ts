/**
 * useAgentChat — Workbench AIPanel 接入 Supervisor 主路径
 *
 * // @ai-session: ai-claude-20260720-wire2
 * // @ai-task: Wire-2-provider-terminal-status
 *
 * 主路径（见 docs/AGENT_MAIN_PATH.md）：
 *   AIPanel → agentChat IPC → Supervisor.chat → agent:chunk/done/error → useAgentStore
 *
 * Wire-1：流式 send/cancel + 事件订阅
 * Wire-2：挂载时加载 providerList + tokenStats；暴露 Provider 选择给 AIPanel
 */
import { useCallback, useEffect, useRef } from 'react'
import { message } from 'antd'
import { useAgentStore, type AgentMessage } from '@/stores/agent-store'
import { useServerStore } from '@/stores/server-store'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import type {
  PersistedProviderConfig,
  ThinkingStrength,
  TokenStats,
  CostStats,
} from '@shared/agent-types'
import type { AgentWorkflowState } from '@shared/models'

function genId(prefix = 'msg'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export interface UseAgentChatResult {
  /** 对话消息（来自 useAgentStore） */
  messages: AgentMessage[]
  /** 是否正在流式输出 */
  isStreaming: boolean
  /** 最近错误 */
  lastError: string | null
  /** 当前 correlationId */
  currentCorrelationId: string | null
  /** Provider 列表（不含 apiKey） */
  providers: PersistedProviderConfig[]
  /** 当前选中的 Provider ID */
  selectedProviderId: string | null
  /** 设置 Provider */
  setSelectedProviderId: (id: string | null) => void
  /** 思考强度 */
  thinkingStrength: ThinkingStrength
  /** 设置思考强度 */
  setThinkingStrength: (s: ThinkingStrength) => void
  /** Token 统计 */
  tokenStats: TokenStats
  /**
   * 成本统计（v0.9.3 §11 改进点 26 P2-F 新增）
   *
   * USD 成本聚合（todayCost/weekCost/monthCost/totalCost + by 维度）。
   * 由 IPC token:cost-stats 加载，在 agent:done/error 后刷新。
   */
  costStats: CostStats
  /**
   * 本次会话累计成本（v0.9.3 §11 改进点 26 P2-F 新增）
   *
   * = costStats.totalCost - sessionCostBaseline（≥0）。
   * 让用户感知当前会话的真实开销，与"今日累计"区分开。
   */
  sessionCost: number
  /**
   * 重置本次会话成本基线（v0.9.3 §11 改进点 26 P2-F 新增）
   *
   * 用户主动点击"重置会话成本"按钮时调用，让 sessionCost 从 0 重新累计。
   */
  resetSessionCost: () => void
  /** 发送用户消息（走 agent:chat） */
  send: (text: string) => Promise<void>
  /** 取消当前流式请求 */
  cancel: () => Promise<void>
  /** 清空对话 */
  clear: () => void
  /** 压缩上下文（T.7） */
  compressContext: () => void
}

/**
 * Workbench 侧 Agent chat hook。
 * 组件挂载时订阅 agent:chunk / agent:done / agent:error，并加载 Provider / Token。
 */
export function useAgentChat(): UseAgentChatResult {
  const messages = useAgentStore((s) => s.messages)
  const isStreaming = useAgentStore((s) => s.isStreaming)
  const lastError = useAgentStore((s) => s.lastError)
  const currentCorrelationId = useAgentStore((s) => s.currentCorrelationId)
  const thinkingStrength = useAgentStore((s) => s.thinkingStrength)
  const selectedProviderId = useAgentStore((s) => s.selectedProviderId)
  const activeSessionId = useServerStore((s) => s.activeSessionId)
  const providers = useAgentStore((s) => s.providers)
  const tokenStats = useAgentStore((s) => s.tokenStats)
  // v0.9.3 §11 改进点 26 P2-F：从 store 读取成本统计 + 会话基线
  const costStats = useAgentStore((s) => s.costStats)
  const sessionCostBaseline = useAgentStore((s) => s.sessionCostBaseline)

  const addMessage = useAgentStore((s) => s.addMessage)
  const appendToken = useAgentStore((s) => s.appendToken)
  const finalizeMessage = useAgentStore((s) => s.finalizeMessage)
  const markError = useAgentStore((s) => s.markError)
  const clearMessages = useAgentStore((s) => s.clearMessages)
  const compressMessages = useAgentStore((s) => s.compressMessages)
  const setStreaming = useAgentStore((s) => s.setStreaming)
  const setCurrentCorrelationId = useAgentStore((s) => s.setCurrentCorrelationId)
  const setTokenStats = useAgentStore((s) => s.setTokenStats)
  const setProviders = useAgentStore((s) => s.setProviders)
  const setSelectedProviderId = useAgentStore((s) => s.setSelectedProviderId)
  const setThinkingStrength = useAgentStore((s) => s.setThinkingStrength)
  // v0.9.3 §11 改进点 26 P2-F：设置成本统计 + 重置会话基线
  const setCostStats = useAgentStore((s) => s.setCostStats)
  const resetSessionCostBaseline = useAgentStore((s) => s.resetSessionCostBaseline)
  // M1 Task 7：订阅 onAgentStep，写入流式消息 stepState
  const updateStepState = useAgentStore((s) => s.updateStepState)

  const subscribedRef = useRef(false)

  // Wire-2：加载 Provider 列表 + Token 统计（只跑一次）
  useEffect(() => {
    if (!isElectronAPIAvailable()) return

    void (async () => {
      try {
        if (window.electronAPI.providerList) {
          const list = await window.electronAPI.providerList(true)
          setProviders(list)
          const current = useAgentStore.getState().selectedProviderId
          if (list.length > 0 && !current) {
            setSelectedProviderId(list[0].id)
          }
        }
      } catch (err) {
        console.error('[useAgentChat] 加载 Provider 失败:', err)
      }

      try {
        if (window.electronAPI.tokenStats) {
          const stats = await window.electronAPI.tokenStats()
          setTokenStats(stats)
        }
      } catch (err) {
        console.error('[useAgentChat] 加载 Token 统计失败:', err)
      }

      // v0.9.3 §11 改进点 26 P2-F：加载成本统计（USD）
      // 首次加载时 store 会自动记录 sessionCostBaseline
      try {
        if (window.electronAPI.tokenCostStats) {
          const costStats = await window.electronAPI.tokenCostStats()
          setCostStats(costStats)
        }
      } catch (err) {
        console.error('[useAgentChat] 加载成本统计失败:', err)
      }
    })()
  }, [setProviders, setSelectedProviderId, setTokenStats, setCostStats])

  // 订阅主进程流式事件
  useEffect(() => {
    if (!isElectronAPIAvailable()) {
      return
    }
    subscribedRef.current = true

    const offChunk = window.electronAPI.onAgentChunk((payload) => {
      appendToken(payload)
    })

    const offDone = window.electronAPI.onAgentDone((payload) => {
      finalizeMessage(payload)
      void window.electronAPI.tokenStats?.().then(setTokenStats).catch(() => {})
      // v0.9.3 §11 改进点 26 P2-F：流式结束后刷新成本统计
      void window.electronAPI.tokenCostStats?.().then(setCostStats).catch(() => {})
    })

    const offError = window.electronAPI.onAgentError((payload) => {
      markError(payload)
      void window.electronAPI.tokenStats?.().then(setTokenStats).catch(() => {})
      // v0.9.3 §11 改进点 26 P2-F：错误后也刷新成本统计（部分 token 可能已计费）
      void window.electronAPI.tokenCostStats?.().then(setCostStats).catch(() => {})
    })

    // M1 Task 7：订阅 onAgentStep，将工作流状态写入当前流式消息
    const offStep = window.electronAPI.onAgentStep?.((state: AgentWorkflowState) => {
      updateStepState(state)
    })

    return () => {
      subscribedRef.current = false
      offChunk()
      offDone()
      offError()
      offStep?.()
    }
  }, [appendToken, finalizeMessage, markError, setTokenStats, setCostStats, updateStepState])

  const send = useCallback(
    async (text: string) => {
      const raw = text.trim()
      if (!raw) return
      if (useAgentStore.getState().isStreaming) return

      // v2.3.9 修复：AI 对话走 Provider 系统，必须确认已配置 API Key。
      // 旧 LLM 设置页的"测试连接"只验证 llmTest 通道，不会把 Key 同步到
      // Provider 的 SecureStore（key='provider:${id}'）。如果用户测试通过但
      // 没保存，agent:chat 会调用失败。这里提前拦截，给出明确引导。
      const state = useAgentStore.getState()
      const selectedProvider = state.providers.find((p) => p.id === state.selectedProviderId)
      if (selectedProvider && selectedProvider.hasApiKey === false) {
        message.warning(
          `当前模型 "${selectedProvider.name || selectedProvider.id}" 未配置 API Key，请到设置 → 模型中配置并保存`
        )
        return
      }

      const userMessage: AgentMessage = {
        id: genId('user'),
        role: 'user',
        content: raw,
        timestamp: Date.now(),
      }
      addMessage(userMessage)

      const assistantId = genId('assistant')
      addMessage({
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
        providerId: selectedProviderId ?? undefined,
      })
      setStreaming(true)

      if (!isElectronAPIAvailable() || !window.electronAPI.agentChat) {
        useAgentStore.setState((state) => {
          const next = [...state.messages]
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].id === assistantId) {
              next[i] = {
                ...next[i],
                content:
                  'electronAPI / agentChat 不可用。请在 Electron 桌面端运行，并确认 preload 已暴露 agentChat。',
                isStreaming: false,
                isError: true,
              }
              break
            }
          }
          return {
            messages: next,
            isStreaming: false,
            currentCorrelationId: null,
            lastError: 'agentChat unavailable',
          }
        })
        return
      }

      try {
        const history = useAgentStore
          .getState()
          .messages.filter(
            (m) =>
              (m.role === 'user' || m.role === 'assistant') &&
              !(m.role === 'assistant' && m.id === assistantId)
          )
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }))

        const payload =
          history.length > 0
            ? history
            : [{ role: 'user' as const, content: raw }]

        const correlationId = await window.electronAPI.agentChat(
          payload,
          selectedProviderId ?? undefined,
          thinkingStrength,
          activeSessionId ?? undefined,
        )

        useAgentStore.setState((state) => {
          const next = [...state.messages]
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].id === assistantId) {
              next[i] = { ...next[i], correlationId }
              break
            }
          }
          return { messages: next }
        })
        setCurrentCorrelationId(correlationId)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        useAgentStore.setState((state) => {
          const next = [...state.messages]
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].id === assistantId) {
              next[i] = {
                ...next[i],
                content: `请求失败: ${msg}`,
                isStreaming: false,
                isError: true,
              }
              break
            }
          }
          return {
            messages: next,
            isStreaming: false,
            currentCorrelationId: null,
            lastError: msg,
          }
        })
      }
    },
    [
      addMessage,
      selectedProviderId,
      setCurrentCorrelationId,
      setStreaming,
      thinkingStrength,
      activeSessionId,
    ]
  )

  const cancel = useCallback(async () => {
    const correlationId = useAgentStore.getState().currentCorrelationId
    if (!correlationId || !isElectronAPIAvailable()) return
    try {
      if (window.electronAPI.agentChatCancel) {
        await window.electronAPI.agentChatCancel(correlationId)
      } else if (window.electronAPI.agentCancel) {
        await window.electronAPI.agentCancel(correlationId)
      }
    } catch {
      // 取消失败不抛到 UI；流可能已结束
    }
  }, [])

  const clear = useCallback(() => {
    clearMessages()
  }, [clearMessages])

  /**
   * 压缩上下文（T.7）
   *
   * 非流式状态下触发 store.compressMessages，保留 system + 最近 N 条，
   * 中间历史用本地摘要消息替换。
   */
  const compressContext = useCallback(() => {
    compressMessages()
  }, [compressMessages])

  /**
   * 重置本次会话成本基线（v0.9.3 §11 改进点 26 P2-F）
   *
   * 用户主动点击"重置会话成本"按钮时调用。
   * 将 sessionCostBaseline 设为当前 totalCost，让 sessionCost 从 0 重新累计。
   */
  const resetSessionCost = useCallback(() => {
    resetSessionCostBaseline()
  }, [resetSessionCostBaseline])

  // 计算本次会话累计成本：currentTotalCost - sessionCostBaseline（≥0）
  // baseline 为 null 时（未加载过 costStats）返回 0
  const sessionCost =
    sessionCostBaseline === null
      ? 0
      : Math.max(0, costStats.totalCost - sessionCostBaseline)

  return {
    messages,
    isStreaming,
    lastError,
    currentCorrelationId,
    providers,
    selectedProviderId,
    setSelectedProviderId,
    thinkingStrength,
    setThinkingStrength,
    tokenStats,
    costStats,
    sessionCost,
    resetSessionCost,
    send,
    cancel,
    clear,
    compressContext,
  }
}
