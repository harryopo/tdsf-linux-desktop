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
import { useAgentStore, type AgentMessage } from '@/stores/agent-store'
import { useServerStore } from '@/stores/server-store'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import type {
  PersistedProviderConfig,
  ThinkingStrength,
  TokenStats,
} from '@shared/agent-types'

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
  /** 发送用户消息（走 agent:chat） */
  send: (text: string) => Promise<void>
  /** 取消当前流式请求 */
  cancel: () => Promise<void>
  /** 清空对话 */
  clear: () => void
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

  const addMessage = useAgentStore((s) => s.addMessage)
  const appendToken = useAgentStore((s) => s.appendToken)
  const finalizeMessage = useAgentStore((s) => s.finalizeMessage)
  const markError = useAgentStore((s) => s.markError)
  const clearMessages = useAgentStore((s) => s.clearMessages)
  const setStreaming = useAgentStore((s) => s.setStreaming)
  const setCurrentCorrelationId = useAgentStore((s) => s.setCurrentCorrelationId)
  const setTokenStats = useAgentStore((s) => s.setTokenStats)
  const setProviders = useAgentStore((s) => s.setProviders)
  const setSelectedProviderId = useAgentStore((s) => s.setSelectedProviderId)
  const setThinkingStrength = useAgentStore((s) => s.setThinkingStrength)

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
    })()
  }, [setProviders, setSelectedProviderId, setTokenStats])

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
    })

    const offError = window.electronAPI.onAgentError((payload) => {
      markError(payload)
      void window.electronAPI.tokenStats?.().then(setTokenStats).catch(() => {})
    })

    return () => {
      subscribedRef.current = false
      offChunk()
      offDone()
      offError()
    }
  }, [appendToken, finalizeMessage, markError, setTokenStats])

  const send = useCallback(
    async (text: string) => {
      const raw = text.trim()
      if (!raw) return
      if (useAgentStore.getState().isStreaming) return

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
    send,
    cancel,
    clear,
  }
}
