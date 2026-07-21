/**
 * AI 对话面板组件 - ChatPanel (v0.9 重构版)
 *
 * 职责：
 * - v0.9 顶部工具栏：Provider 选择器 + 思考强度 Segmented + Token 小号显示
 * - v0.9 输入区改造：TextArea + @命令 Chip 列表 + AtCommandPicker 触发
 * - v0.9 消息列表改造：消息气泡 + @命令 Badge + 流式输出
 * - v0.9 发送逻辑：优先使用 agentChat（Supervisor）+ 拼装 @命令 injectedText
 * - v0.9 可信度面板：DecisionCard 下方嵌入 CredibilityPanel（折叠）
 * - 保留 v0.8 兼容：DecisionCard / AgentWorkflowPanel / ToolCallCard / ToolApprovalModal / prefillMessage
 *
 * 流式事件监听：
 * - onAgentChunk → appendToken（追加到最后一条 assistant 消息）
 * - onAgentDone → finalizeMessage（标记完成 + 回填 usage/model）
 * - onAgentError → markError（标记错误 + 清理 streaming）
 *
 * 苹果极简暗系风格对话 UI
 *
 * 方案书依据：v0.9 §3（Provider 抽象）+ §4（@命令）+ §5（Token 监控）+ §6（思考强度）
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Input, Button, Tooltip, message, Select, Segmented, Tag } from 'antd'
import {
  ArrowUpOutlined,
  ClearOutlined,
  RobotOutlined,
  ThunderboltOutlined,
  StopOutlined,
  DashboardOutlined,
  SettingOutlined,
  ExperimentOutlined,
  ApiOutlined,
} from '@ant-design/icons'
import { useAIStore } from '../../stores/ai-store'
import { useServerStore } from '../../stores/server-store'
import { useAgentStore } from '../../stores/agent-store'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import AgentWorkflowPanel from './AgentWorkflowPanel'
import DecisionCard from './DecisionCard'
import ToolCallCard from './ToolCallCard'
import ToolApprovalModal from './ToolApprovalModal'
import CredibilityPanel from './CredibilityPanel'
import PlanBuildButton from './PlanBuildButton'
import SrePipelinePanel from './SrePipelinePanel'
import SidecarStatusPanel from './SidecarStatusPanel'
import { AtCommandChip, AtCommandPicker, AtCommandBadge, useAtCommandInjection } from './at-commands'
import McpStatusBar from './McpStatusBar'
import type { AtCommand } from '@shared/at-command-types'
import type { ThinkingStrength, PersistedProviderConfig, AgentMode } from '@shared/agent-types'
import './ChatPanel.css'

const { TextArea } = Input

/** P1-4: 根据工作流步骤显示不同的进度提示 */
function getStepHint(step: string | undefined): string {
  switch (step) {
    case 'collect':
      return '正在采集系统环境信息...'
    case 'analyze':
      return '正在分析日志和环境数据...'
    case 'reason':
      return '正在调用 LLM 分析根因...'
    case 'check':
      return '正在进行风险评估...'
    case 'confirm':
      return '等待人工确认...'
    case 'execute':
      return '正在执行修复命令...'
    case 'verify':
      return '正在验证执行结果...'
    default:
      return '思考中...'
  }
}

/** v0.9: 格式化 token 数显示（>1000 用 k 单位） */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** v0.9: 思考强度选项 */
const STRENGTH_OPTIONS: Array<{ label: string; value: ThinkingStrength; title: string }> = [
  { label: '快速', value: 'fast', title: '单次 LLM 调用，无 Subagent（简单问答）' },
  { label: '标准', value: 'standard', title: 'Supervisor + 1-2 Subagent（运维决策）' },
  { label: '深度', value: 'deep', title: '8 Subagent 并行 + 多轮反思（复杂故障排查）' },
]

/** 生成简单唯一 ID */
function genId(): string {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const ChatPanel: React.FC = () => {
  // ===== v0.8 旧 Store 状态（保留兼容） =====
  const decisionCard = useAIStore((s) => s.decisionCard)
  const workflowState = useAIStore((s) => s.workflowState)
  const toolCalls = useAIStore((s) => s.toolCalls)
  const pendingApproval = useAIStore((s) => s.pendingApproval)
  const setDecisionCard = useAIStore((s) => s.setDecisionCard)
  const setWorkflowState = useAIStore((s) => s.setWorkflowState)
  const setPendingApproval = useAIStore((s) => s.setPendingApproval)
  const upsertToolCall = useAIStore((s) => s.upsertToolCall)
  /** v0.8.0 翻译模块联动：预填消息 */
  const prefillMessage = useAIStore((s) => s.prefillMessage)
  const prefillAt = useAIStore((s) => s.prefillAt)
  const setPrefillMessage = useAIStore((s) => s.setPrefillMessage)
  const activeSessionId = useServerStore((s) => s.activeSessionId)

  // ===== v0.9 新 Store 状态（Agent Supervisor） =====
  const agentMessages = useAgentStore((s) => s.messages)
  const isStreaming = useAgentStore((s) => s.isStreaming)
  const thinkingStrength = useAgentStore((s) => s.thinkingStrength)
  const selectedProviderId = useAgentStore((s) => s.selectedProviderId)
  const providers = useAgentStore((s) => s.providers)
  const tokenStats = useAgentStore((s) => s.tokenStats)
  const addAgentMessage = useAgentStore((s) => s.addMessage)
  const appendAgentToken = useAgentStore((s) => s.appendToken)
  const finalizeAgentMessage = useAgentStore((s) => s.finalizeMessage)
  const markAgentError = useAgentStore((s) => s.markError)
  const clearAgentMessages = useAgentStore((s) => s.clearMessages)
  const setStreaming = useAgentStore((s) => s.setStreaming)
  const setCurrentCorrelationId = useAgentStore((s) => s.setCurrentCorrelationId)
  const setThinkingStrength = useAgentStore((s) => s.setThinkingStrength)
  const setSelectedProviderId = useAgentStore((s) => s.setSelectedProviderId)
  const setProviders = useAgentStore((s) => s.setProviders)
  const setTokenStats = useAgentStore((s) => s.setTokenStats)
  // v0.9.5 P0：Mode 五模式切换
  const currentMode = useAgentStore((s) => s.currentMode)
  const modeList = useAgentStore((s) => s.modeList)
  const setCurrentMode = useAgentStore((s) => s.setCurrentMode)
  const setModeList = useAgentStore((s) => s.setModeList)

  // ===== v0.9 @命令注入 hook =====
  const {
    injectedCommands,
    addCommand,
    removeCommand,
    clearAll: clearInjectedCommands,
    buildInjectedText,
    stripAtCommands,
  } = useAtCommandInjection('chat-input')

  // ===== 本地状态 =====
  const [inputValue, setInputValue] = useState('')
  /** P1-2: 批准/拒绝进行中标记，防止重复点击 */
  const [confirming, setConfirming] = useState(false)
  /** v0.9 AtCommandPicker 是否可见 */
  const [pickerVisible, setPickerVisible] = useState(false)
  /** v1.0 SRE 智能诊断面板是否打开 */
  const [sreOpen, setSreOpen] = useState(false)
  /** v1.5: 多 Sidecar 状态面板 */
  const [sidecarStatusOpen, setSidecarStatusOpen] = useState(false)
  /** v0.9 @触发检测的防抖计时器 */
  const pickerDebounceRef = useRef<number | null>(null)
  /** v0.9 消息对应的注入命令记录：messageId → AtCommand[] */
  const [messageCommands, setMessageCommands] = useState<Record<string, AtCommand[]>>({})
  /** 消息列表滚动容器引用 */
  const messagesEndRef = useRef<HTMLDivElement>(null)
  /** 输入框容器引用（用于 Picker 定位） */
  const inputWrapperRef = useRef<HTMLDivElement>(null)

  // ===== v0.9 加载 Provider 列表 =====
  useEffect(() => {
    if (!isElectronAPIAvailable()) return
    void (async () => {
      try {
        const list = await window.electronAPI.providerList(true)
        setProviders(list)
        // 默认选中第一个启用的 Provider
        if (list.length > 0 && !selectedProviderId) {
          setSelectedProviderId(list[0].id)
        }
      } catch (err) {
        console.error('[ChatPanel] 加载 Provider 列表失败:', err)
      }
    })()
  }, [setProviders, setSelectedProviderId, selectedProviderId])

  // ===== v0.9 加载 Token 统计 =====
  useEffect(() => {
    if (!isElectronAPIAvailable()) return
    void (async () => {
      try {
        const stats = await window.electronAPI.tokenStats()
        setTokenStats(stats)
      } catch (err) {
        console.error('[ChatPanel] 加载 Token 统计失败:', err)
      }
    })()
  }, [setTokenStats])

  // ===== v0.9.5 P0 加载 Mode 列表 + 当前 Mode =====
  useEffect(() => {
    if (!isElectronAPIAvailable()) return
    void (async () => {
      try {
        // 并行加载：mode 列表 + 当前 mode
        const [listResp, currentResp] = await Promise.all([
          window.electronAPI.modeList(),
          window.electronAPI.modeGetCurrent(),
        ])
        setModeList(listResp)
        setCurrentMode(currentResp.mode)
        console.info('[ChatPanel] 加载 Mode 完成', {
          list: listResp.map((m) => m.name),
          current: currentResp.mode,
        })
      } catch (err) {
        console.error('[ChatPanel] 加载 Mode 列表失败:', err)
      }
    })()
  }, [setModeList, setCurrentMode])

  // ===== v0.9.5 P0 切换 Mode 处理器 =====
  const handleModeChange = useCallback(
    async (newMode: AgentMode | string) => {
      const target = newMode as AgentMode
      if (target === currentMode) return
      if (!isElectronAPIAvailable() || !window.electronAPI?.modeSetDefault) {
        message.error('IPC 不可用，无法切换模式')
        return
      }
      try {
        const response = await window.electronAPI.modeSetDefault({ mode: target })
        if (response.success) {
          setCurrentMode(target)
          const displayName = modeList.find((m) => m.name === target)?.displayName ?? target
          message.success(`已切到「${displayName}」模式`)
        } else {
          message.error('模式切换失败')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        message.error(`模式切换失败：${msg}`)
      }
    },
    [currentMode, modeList, setCurrentMode]
  )

  // ===== v0.9 监听流式事件（chunk / done / error） =====
  useEffect(() => {
    if (!isElectronAPIAvailable()) {
      console.warn('[ChatPanel] electronAPI 不可用，跳过流式事件监听')
      return
    }

    const offChunk = window.electronAPI.onAgentChunk((payload) => {
      appendAgentToken(payload)
    })

    const offDone = window.electronAPI.onAgentDone((payload) => {
      finalizeAgentMessage(payload)
      // 刷新 Token 统计
      void window.electronAPI.tokenStats().then(setTokenStats).catch(() => {})
    })

    const offError = window.electronAPI.onAgentError((payload) => {
      markAgentError(payload)
      message.error(`Agent 错误: ${payload.message}`)
      // 刷新 Token 统计
      void window.electronAPI.tokenStats().then(setTokenStats).catch(() => {})
    })

    return () => {
      offChunk()
      offDone()
      offError()
    }
  }, [appendAgentToken, finalizeAgentMessage, markAgentError, setTokenStats])

  // ===== v0.8 监听旧 Agent 工作流步骤（保留兼容） =====
  useEffect(() => {
    if (!isElectronAPIAvailable()) return

    const offAgentStep = window.electronAPI.onAgentStep((state) => {
      setWorkflowState(state)
      if (state.error) {
        message.error(`工作流出错: ${state.error}`)
        setDecisionCard(null)
        return
      }
      if (state.decisionCard) {
        setDecisionCard(state.decisionCard)
      } else if (state.currentStep === 'verify' && state.completedSteps.includes('verify')) {
        setDecisionCard(null)
      }
    })

    return () => {
      offAgentStep()
    }
  }, [setWorkflowState, setDecisionCard])

  // ===== v0.5.0 监听工具调用进度与审批请求 =====
  useEffect(() => {
    if (!isElectronAPIAvailable()) return

    const offToolProgress = window.electronAPI.onLlmToolProgress((progress) => {
      upsertToolCall(progress)
    })

    const offToolApproval = window.electronAPI.onLlmToolApproval((request) => {
      setPendingApproval(request)
    })

    return () => {
      offToolProgress()
      offToolApproval()
    }
  }, [upsertToolCall, setPendingApproval])

  // ===== v0.8.0 监听预填消息（终端翻译模块联动） =====
  useEffect(() => {
    if (prefillMessage && prefillAt) {
      setInputValue(prefillMessage)
      setPrefillMessage(null)
    }
  }, [prefillAt, prefillMessage, setPrefillMessage])

  // ===== v0.9 消息列表自动滚动到底部 =====
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [agentMessages])

  // ===== v0.9.5 P0: 判断最后一条 assistant 消息是否有方案输出（用于显示 PlanBuildButton） =====
  const hasPlanOutput = useMemo(() => {
    if (currentMode !== 'plan') return false
    for (let i = agentMessages.length - 1; i >= 0; i--) {
      const msg = agentMessages[i]
      if (msg.role === 'assistant' && !msg.isStreaming && msg.content.trim().length > 0) {
        return true
      }
      // 遇到 user 消息说明还没收到方案
      if (msg.role === 'user') return false
    }
    return false
  }, [agentMessages, currentMode])

  // ===== P2-3: 切换服务器时清理工作流状态和决策卡片 =====
  useEffect(() => {
    setDecisionCard(null)
    setWorkflowState(null)
  }, [activeSessionId, setDecisionCard, setWorkflowState])

  // ===== v0.9 输入框 @触发检测（防抖 200ms） =====
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value
      setInputValue(value)

      // 防抖检测 @ 触发
      if (pickerDebounceRef.current !== null) {
        window.clearTimeout(pickerDebounceRef.current)
      }
      pickerDebounceRef.current = window.setTimeout(() => {
        // 检测最后一个字符是否为 @，且前面是空白或开头
        const lastChar = value[value.length - 1]
        if (lastChar === '@') {
          const prevChar = value[value.length - 2]
          if (!prevChar || /\s/.test(prevChar)) {
            setPickerVisible(true)
          }
        }
      }, 200)
    },
    []
  )

  // ===== v0.9 AtCommandPicker 选中类型回调 =====
  const handlePickerSelect = useCallback(
    (type: AtCommand['type']) => {
      setPickerVisible(false)
      // 弹出参数收集（简化版：用默认空参数 resolve，让主进程 parser 处理）
      // 这里采用最简策略：在输入框中插入 "@type " 让用户继续输入参数
      // 用户按发送时，会调用 atParse 解析整个文本
      setInputValue((prev) => {
        // 把末尾的 @ 替换为 @type
        const newvalue = prev.replace(/@$/, `@${type} `)
        return newvalue
      })
      // 让输入框重新获得焦点
      setTimeout(() => {
        inputWrapperRef.current?.querySelector('textarea')?.focus()
      }, 0)
    },
    []
  )

  // ===== v0.9 发送消息（优先 agentChat） =====
  const handleSend = useCallback(async () => {
    const rawContent = inputValue.trim()
    if (!rawContent || isStreaming) return

    // 拼装 @命令的 injectedText 到 prompt
    const injectedText = buildInjectedText()
    const fullPrompt = injectedText ? `${injectedText}\n\n${rawContent}` : rawContent

    // 添加 user 消息（记录对应的注入命令）
    const userMessageId = genId()
    addAgentMessage({
      id: userMessageId,
      role: 'user',
      content: rawContent,
      timestamp: Date.now(),
    })
    // 记录该消息对应的注入命令（用于 Badge 展示）
    if (injectedCommands.length > 0) {
      setMessageCommands((prev) => ({
        ...prev,
        [userMessageId]: [...injectedCommands],
      }))
    }

    // 添加空的 AI 回复占位
    const assistantMessageId = genId()
    addAgentMessage({
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
    })

    setInputValue('')
    clearInjectedCommands()
    setStreaming(true)

    try {
      if (!isElectronAPIAvailable()) {
        // electronAPI 不可用：直接标记错误
        useAgentStore.setState((state) => {
          const newMessages = [...state.messages]
          for (let i = newMessages.length - 1; i >= 0; i--) {
            if (newMessages[i].id === assistantMessageId) {
              newMessages[i] = {
                ...newMessages[i],
                content: 'electronAPI 不可用，无法连接 AI 服务',
                isStreaming: false,
                isError: true,
              }
              break
            }
          }
          return { messages: newMessages }
        })
        return
      }

      // v0.9 优先使用 agentChat（Supervisor chat）
      if (window.electronAPI.agentChat) {
        const messagesPayload = [
          { role: 'user' as const, content: fullPrompt },
        ]
        const correlationId = await window.electronAPI.agentChat(
          messagesPayload,
          selectedProviderId ?? undefined,
          thinkingStrength
        )
        // 回填 correlationId 到 assistant 消息
        useAgentStore.setState((state) => {
          const newMessages = [...state.messages]
          for (let i = newMessages.length - 1; i >= 0; i--) {
            if (newMessages[i].id === assistantMessageId) {
              newMessages[i] = {
                ...newMessages[i],
                correlationId,
              }
              break
            }
          }
          return { messages: newMessages }
        })
        setCurrentCorrelationId(correlationId)
        return
      }

      // 降级路径：v0.8 agentStart（需要 activeSessionId）
      if (activeSessionId && window.electronAPI.agentStart) {
        await window.electronAPI.agentStart(activeSessionId, fullPrompt)
        return
      }

      // 降级路径：v0.5.0 llmChatWithTools
      if (window.electronAPI.llmChatWithTools) {
        const reply = await window.electronAPI.llmChatWithTools([
          { role: 'user', content: fullPrompt },
        ])
        useAgentStore.setState((state) => {
          const newMessages = [...state.messages]
          for (let i = newMessages.length - 1; i >= 0; i--) {
            if (newMessages[i].id === assistantMessageId) {
              newMessages[i] = { ...newMessages[i], content: reply, isStreaming: false }
              break
            }
          }
          return { messages: newMessages }
        })
        return
      }

      // 最终降级：v0.4 llmChat
      if (window.electronAPI.llmChat) {
        const reply = await window.electronAPI.llmChat([{ role: 'user', content: fullPrompt }])
        useAgentStore.setState((state) => {
          const newMessages = [...state.messages]
          for (let i = newMessages.length - 1; i >= 0; i--) {
            if (newMessages[i].id === assistantMessageId) {
              newMessages[i] = { ...newMessages[i], content: reply, isStreaming: false }
              break
            }
          }
          return { messages: newMessages }
        })
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      useAgentStore.setState((state) => {
        const newMessages = [...state.messages]
        for (let i = newMessages.length - 1; i >= 0; i--) {
          if (newMessages[i].id === assistantMessageId) {
            newMessages[i] = {
              ...newMessages[i],
              content: `请求失败: ${errorMsg}`,
              isStreaming: false,
              isError: true,
            }
            break
          }
        }
        return { messages: newMessages }
      })
    } finally {
      // 注意：agentChat 流式完成由 onAgentDone 事件触发 setStreaming(false)
      // 这里只在降级路径（非流式）后清理
      if (!window.electronAPI?.agentChat) {
        setStreaming(false)
      }
    }
  }, [
    inputValue,
    isStreaming,
    buildInjectedText,
    injectedCommands,
    addAgentMessage,
    setStreaming,
    selectedProviderId,
    thinkingStrength,
    setCurrentCorrelationId,
    clearInjectedCommands,
    activeSessionId,
  ])

  // ===== v0.9 取消流式请求 =====
  const handleCancelStream = useCallback(async () => {
    const correlationId = useAgentStore.getState().currentCorrelationId
    if (!correlationId || !isElectronAPIAvailable()) return
    try {
      await window.electronAPI.agentChatCancel(correlationId)
      message.info('已取消请求')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      message.error(`取消失败: ${msg}`)
    }
  }, [])

  // ===== 清空对话 =====
  const handleClear = useCallback(() => {
    clearAgentMessages()
    setMessageCommands({})
    clearInjectedCommands()
    setDecisionCard(null)
    setWorkflowState(null)
  }, [clearAgentMessages, clearInjectedCommands, setDecisionCard, setWorkflowState])

  // ===== 批准 Agent 决策（v0.8 兼容） =====
  const handleApprove = useCallback(async () => {
    if (confirming || !activeSessionId || !isElectronAPIAvailable()) {
      return
    }
    setConfirming(true)
    try {
      await window.electronAPI.agentConfirm(activeSessionId, true)
      message.success('已批准执行')
      setDecisionCard(null)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes('无活跃工作流')) {
        message.warning('工作流已结束或超时，请重新提问')
      } else {
        message.error(`批准失败: ${msg}`)
      }
    } finally {
      setConfirming(false)
    }
  }, [confirming, activeSessionId, setDecisionCard])

  // ===== 拒绝 Agent 决策（v0.8 兼容） =====
  const handleReject = useCallback(async () => {
    if (confirming || !activeSessionId || !isElectronAPIAvailable()) {
      return
    }
    setConfirming(true)
    try {
      await window.electronAPI.agentConfirm(activeSessionId, false)
      message.success('已拒绝执行')
      setDecisionCard(null)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes('无活跃工作流')) {
        message.warning('工作流已结束或超时，请重新提问')
      } else {
        message.error(`拒绝失败: ${msg}`)
      }
    } finally {
      setConfirming(false)
    }
  }, [confirming, activeSessionId, setDecisionCard])

  // ===== 键盘快捷键：Enter 发送，Shift+Enter 换行 =====
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // 如果 AtCommandPicker 可见，让 Picker 处理键盘事件
      if (pickerVisible) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void handleSend()
      }
    },
    [handleSend, pickerVisible]
  )

  // ===== v0.9 Provider 选项 =====
  const providerOptions = useMemo(() => {
    return providers.map((p: PersistedProviderConfig) => ({
      label: `${p.name} · ${p.type}`,
      value: p.id,
      title: `${p.name} (${p.model})`,
    }))
  }, [providers])

  // ===== v0.9.5 P0 Mode 选项（用于 Segmented 切换） =====
  // 从 modeList 派生 Segmented 的 options（5 个 mode：chat / ask / plan / code / debug）
  const modeOptions = useMemo(() => {
    return modeList.map((m) => ({
      label: m.displayName,
      value: m.name,
      title: m.description,
    }))
  }, [modeList])

  // ===== v0.9 Token 小号显示 =====
  const todayTokens = tokenStats.today
  const tokenTooltipContent = useMemo(() => {
    return (
      <div className="chat-panel-token-tooltip">
        <div>今日：{formatTokens(tokenStats.today)}</div>
        <div>本周：{formatTokens(tokenStats.week)}</div>
        <div>本月：{formatTokens(tokenStats.month)}</div>
        <div>累计：{formatTokens(tokenStats.total)}</div>
        <div className="chat-panel-token-tooltip-hint">点击右上方 Token 监控面板查看详情</div>
      </div>
    )
  }, [tokenStats])

  return (
    <div className="chat-panel">
      {/* ===== v0.9.5 P0 MCP 5 阶段状态条（借鉴 claw-code） ===== */}
      <McpStatusBar />
      {/* ===== v0.9 顶部工具栏 ===== */}
      <div className="chat-panel-toolbar">
        <div className="chat-panel-toolbar-left">
          <RobotOutlined className="chat-panel-toolbar-icon" />
          <span className="chat-panel-toolbar-title">AI 运维助手</span>
        </div>
        <div className="chat-panel-toolbar-right">
          {/* Provider 选择器 */}
          <Select
            size="small"
            value={selectedProviderId ?? undefined}
            onChange={setSelectedProviderId}
            options={providerOptions}
            placeholder="Provider"
            className="chat-panel-provider-select"
            showSearch
            optionFilterProp="label"
            disabled={providers.length === 0}
          />
          {/* 思考强度 Segmented */}
          <Segmented
            size="small"
            value={thinkingStrength}
            onChange={(v) => setThinkingStrength(v as ThinkingStrength)}
            options={STRENGTH_OPTIONS.map((o) => ({ label: o.label, value: o.value, title: o.title }))}
            className="chat-panel-strength"
          />
          {/* v0.9.5 P0: Mode 五模式切换 Segmented */}
          {modeList.length > 0 && (
            <Segmented
              size="small"
              value={currentMode}
              onChange={(v) => void handleModeChange(v)}
              options={modeOptions}
              className="chat-panel-mode"
            />
          )}
          {/* Token 小号显示 */}
          <Tooltip title={tokenTooltipContent} placement="bottom">
            <Tag className="chat-panel-token-tag">
              <DashboardOutlined /> {formatTokens(todayTokens)}
            </Tag>
          </Tooltip>
          {/* v1.0: SRE 智能诊断入口（Sidecar-A Pipeline：日志 → Drain3 → OpenDerisk） */}
          <Tooltip title="SRE 智能诊断（端到端 Pipeline）">
            <Button
              type="text"
              size="small"
              icon={<ExperimentOutlined style={{ color: 'var(--color-primary, #4f46e5)' }} />}
              onClick={() => setSreOpen(true)}
              aria-label="SRE 智能诊断"
            />
          </Tooltip>
          {/* 清空按钮 */}
          <Tooltip title="清空对话">
            <Button
              type="text"
              size="small"
              icon={<ClearOutlined />}
              onClick={handleClear}
              disabled={isStreaming}
              aria-label="清空对话"
            />
          </Tooltip>
        </div>
      </div>

      {/* ===== v0.8 Agent 工作流状态（保留兼容） ===== */}
      {workflowState && (
        <div className="chat-panel-workflow">
          <AgentWorkflowPanel state={workflowState} />
        </div>
      )}

      {/* ===== 消息列表 ===== */}
      <div className="chat-panel-messages">
        {agentMessages.length === 0 ? (
          <div className="chat-panel-welcome">
            <RobotOutlined className="chat-panel-welcome-icon" />
            <p className="chat-panel-welcome-title">AI 运维助手</p>
            <p className="chat-panel-welcome-desc">
              连接服务器后，粘贴日志或描述问题，AI 将帮您分析根因并提供修复建议。
              输入 @ 可注入日志、命令、文件、指标等 8 类上下文。
            </p>
          </div>
        ) : (
          agentMessages.map((msg) => {
            const isUser = msg.role === 'user'
            const cmds = isUser ? messageCommands[msg.id] : undefined
            return (
              <div key={msg.id} className={`chat-message ${isUser ? 'user' : 'ai'}`}>
                <div className="chat-message-bubble">
                  {/* v0.9 @命令 Badge（仅 user 消息） */}
                  {cmds && cmds.length > 0 && (
                    <div className="chat-message-badges">
                      {cmds.map((cmd, idx) => (
                        <AtCommandBadge key={`${cmd.type}-${idx}`} command={cmd} />
                      ))}
                    </div>
                  )}
                  {msg.role === 'assistant' && msg.content === '' && msg.isStreaming ? (
                    <span className="chat-message-typing">
                      {workflowState ? getStepHint(workflowState.currentStep) : '思考中...'}
                    </span>
                  ) : (
                    <pre className="chat-message-content">{msg.content}</pre>
                  )}
                  {/* v0.9 消息元信息：providerId / model / usage */}
                  {msg.role === 'assistant' && !msg.isStreaming && (msg.providerId || msg.usage) && (
                    <div className="chat-message-meta">
                      {msg.providerId && <span className="chat-message-meta-provider">{msg.providerId}</span>}
                      {msg.model && <span className="chat-message-meta-model">{msg.model}</span>}
                      {msg.usage && (
                        <span className="chat-message-meta-usage">
                          {formatTokens(msg.usage.totalTokens)} tokens
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}

        {/* ===== v0.8 决策卡片（保留兼容） ===== */}
        {decisionCard && (
          <div className="chat-panel-decision">
            <DecisionCard
              card={decisionCard}
              onApprove={handleApprove}
              onReject={handleReject}
              confirming={confirming}
            />
          </div>
        )}

        {/* ===== v0.9 可信度面板（决策卡片下方，折叠） ===== */}
        {decisionCard && (
          <CredibilityPanel defaultCollapsed />
        )}

        {/* ===== v0.5.0 工具调用卡片（保留兼容） ===== */}
        {toolCalls.length > 0 && (
          <div className="chat-panel-tool-calls">
            <div className="chat-panel-tool-calls-title">
              <ThunderboltOutlined style={{ marginRight: 6 }} />
              LLM 调用了 {toolCalls.length} 个工具
            </div>
            {toolCalls.map((call) => (
              <ToolCallCard key={call.callId} call={call} />
            ))}
          </div>
        )}

        {/* ===== v0.9.5 P0: Plan→Build 双模衔接按钮（仅 plan 模式 + 有方案输出时显示） ===== */}
        <PlanBuildButton hasPlanOutput={hasPlanOutput} />

        <div ref={messagesEndRef} />
      </div>

      {/* ===== v1.0 SRE Pipeline 弹窗（端到端诊断：日志 → Drain3 → OpenDerisk） ===== */}
      <SrePipelinePanel open={sreOpen} onClose={() => setSreOpen(false)} />

      {/* ===== v1.5 多 Sidecar 状态面板 ===== */}
      <SidecarStatusPanel open={sidecarStatusOpen} onClose={() => setSidecarStatusOpen(false)} />

      {/* ===== v0.5.0 工具调用审批弹窗 ===== */}
      <ToolApprovalModal
        request={pendingApproval}
        onClose={() => setPendingApproval(null)}
      />

      {/* ===== v0.9 输入区（含 @命令 Chip 列表 + Picker） ===== */}
      <div className="chat-panel-input-wrapper" ref={inputWrapperRef}>
        {/* AtCommandPicker（紧贴输入框上方） */}
        <AtCommandPicker
          visible={pickerVisible}
          onSelect={handlePickerSelect}
          onClose={() => setPickerVisible(false)}
        />

        {/* 已注入的 @命令 Chip 列表（横向滚动） */}
        {injectedCommands.length > 0 && (
          <div className="chat-panel-chips">
            {injectedCommands.map((cmd) => (
              <AtCommandChip
                key={cmd.id}
                command={cmd}
                onRemove={(c) => removeCommand(c.id)}
              />
            ))}
            <Button
              type="text"
              size="small"
              onClick={clearInjectedCommands}
              className="chat-panel-chips-clear"
              aria-label="清空注入命令"
            >
              清空
            </Button>
          </div>
        )}

        {/* 输入框 + 发送按钮 */}
        <div className="chat-panel-input">
          <TextArea
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="描述问题或粘贴日志... 输入 @ 注入命令，Enter 发送，Shift+Enter 换行"
            autoSize={{ minRows: 1, maxRows: 4 }}
            disabled={isStreaming}
            variant="borderless"
            style={{ flex: 1, padding: '4px 4px' }}
          />
          {isStreaming ? (
            <Button
              danger
              icon={<StopOutlined />}
              onClick={handleCancelStream}
              className="chat-panel-send-btn"
              title="取消请求"
            />
          ) : (
            <Button
              type="primary"
              icon={<ArrowUpOutlined />}
              onClick={handleSend}
              disabled={!inputValue.trim()}
              className="chat-panel-send-btn"
              title="发送 (Enter)"
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default ChatPanel
