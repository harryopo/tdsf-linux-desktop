/**
 * useAgentChat — Workbench AIPanel 接入 Supervisor 主路径
 *
 * // @ai-session: ai-claude-20260720-wire2
 * // @ai-task: Wire-2-provider-terminal-status
 *
 * 主路径（见 docs/AGENT_MAIN_PATH.md）：
 *   AIPanel → agentChat IPC → Supervisor.chat → agent:chunk/done/error → useAgentStore
 *
 * Wire-1：流式 send/cancel（事件订阅已提升到 stores/agent-stream-subscription 全局绑定）
 * Wire-2：挂载时加载 providerList + tokenStats；暴露 Provider 选择给 AIPanel
 */
import { useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { latestUserQuestion, useAgentStore, type AgentMessage, type CompressResult } from '@/stores/agent-store'
import { useServerStore } from '@/stores/server-store'
import { useTerminalStore } from '@/stores/terminal-store'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import { resolveSelectedProvider, usableProviders } from './provider-choice'
import type {
  PersistedProviderConfig,
  ThinkingStrength,
  TokenStats,
  CostStats,
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
  thinkingStrength: ThinkingStrength | 'auto'
  /** 设置思考强度 */
  setThinkingStrength: (s: ThinkingStrength | 'auto') => void
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
  /** 压缩上下文（T.7）；返回真实压缩结果供 UI 准确反馈 */
  compressContext: () => CompressResult
  /** 错误后的"重试"：重发最近一条用户提问 */
  retryLast: () => Promise<void>
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

  // Wire-2：加载 Provider 列表 + Token 统计（只跑一次）
  useEffect(() => {
    if (!isElectronAPIAvailable()) return

    void (async () => {
      try {
        if (window.electronAPI.providerList) {
          const [all, defaultId] = await Promise.all([
            window.electronAPI.providerList(true),
            window.electronAPI.providerGetDefault
              ? window.electronAPI.providerGetDefault().catch(() => '')
              : Promise.resolve(''),
          ])
          // 选择器只列"真能用"的模型；剩下两条规则（当前选择优先、其次用户设的默认）
          // 都在 provider-choice 里，判据见 tests/unit/provider-choice.test.ts
          const usable = usableProviders(all)
          setProviders(usable)
          setSelectedProviderId(
            resolveSelectedProvider({
              providers: usable,
              current: useAgentStore.getState().selectedProviderId,
              defaultId,
            }),
          )
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

  // 流式事件（agent:chunk/done/error/step）的订阅已提升到应用入口全局绑定
  // （stores/agent-stream-subscription.ts），面板收起/卸载不再丢失事件。

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
        toast.warning(
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

        // 终端命令块随请求带去主进程（阶段 F 的消费端）。用 getState() 而不是 hook 订阅：
        // 发送是一次性动作，不该因此让对话面板重渲染。空串传 undefined，主进程侧就不注入。
        const terminalContext = useTerminalStore.getState().commandBlocks?.context ?? ''

        const correlationId = await window.electronAPI.agentChat(
          payload,
          selectedProviderId ?? undefined,
          thinkingStrength,
          activeSessionId ?? undefined,
          terminalContext || undefined,
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
   * 错误后的"重试"：把最近一条用户提问原样再发一次。
   * 提问会作为新一轮再进对话（用户看得见自己重问了什么），不做静默替换。
   */
  const retryLast = useCallback(async () => {
    const question = latestUserQuestion(useAgentStore.getState().messages)
    if (!question) return
    await send(question)
  }, [send])

  /**
   * 压缩上下文：留多少由"这台模型的窗口 × 主进程同一份比例"决定（见 agent-store）。
   * 窗口从 store 里的 provider 配置现取，未知时按 0 传（走绝对阈值那把尺），不编一个窗口。
   */
  const compressContext = useCallback((): CompressResult => {
    const { providers, selectedProviderId } = useAgentStore.getState()
    const windowTokens =
      providers.find((p) => p.id === selectedProviderId)?.capabilities?.contextWindow ?? 0
    return compressMessages({ windowTokens })
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
    retryLast,
  }
}
