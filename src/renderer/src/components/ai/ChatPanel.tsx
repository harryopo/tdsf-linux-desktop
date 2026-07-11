/**
 * AI 对话面板组件 - ChatPanel
 *
 * 职责：
 * - 对话消息列表（用户/AI 气泡）
 * - 输入框 + 发送按钮
 * - 支持粘贴日志分析
 * - 流式输出（监听 llm:token 事件）
 * - 对话历史滚动
 * - Agent 工作流状态展示
 * - 决策卡片展示
 *
 * 苹果极简风格对话 UI：
 * - 用户消息右对齐，AI 消息左对齐
 * - 气泡使用浅灰背景，无阴影
 * - 输入框底部固定
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { Input, Button, Tooltip } from 'antd'
import { SendOutlined, ClearOutlined, RobotOutlined } from '@ant-design/icons'
import { useAIStore } from '../../stores/ai-store'
import { useServerStore } from '../../stores/server-store'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import AgentWorkflowPanel from './AgentWorkflowPanel'
import DecisionCard from './DecisionCard'
import type { ChatMessage } from '@shared/models'
import './ChatPanel.css'

const { TextArea } = Input

/** ChatPanel AI 对话面板 */
const ChatPanel: React.FC = () => {
  // ===== Store 状态 =====
  const messages = useAIStore((s) => s.messages)
  const isStreaming = useAIStore((s) => s.isStreaming)
  const decisionCard = useAIStore((s) => s.decisionCard)
  const workflowState = useAIStore((s) => s.workflowState)
  const addMessage = useAIStore((s) => s.addMessage)
  const appendToken = useAIStore((s) => s.appendToken)
  const setStreaming = useAIStore((s) => s.setStreaming)
  const clearMessages = useAIStore((s) => s.clearMessages)
  const setDecisionCard = useAIStore((s) => s.setDecisionCard)
  const setWorkflowState = useAIStore((s) => s.setWorkflowState)
  const activeSessionId = useServerStore((s) => s.activeSessionId)

  // ===== 本地状态 =====
  const [inputValue, setInputValue] = useState('')
  /** 消息列表滚动容器引用 */
  const messagesEndRef = useRef<HTMLDivElement>(null)
  /** 是否已注册事件监听 */
  const listenersRegistered = useRef(false)

  /** 注册 IPC 事件监听（只注册一次） */
  useEffect(() => {
    if (listenersRegistered.current) return
    listenersRegistered.current = true

    // electronAPI 不可用时跳过事件监听注册
    if (!isElectronAPIAvailable()) {
      console.warn('[ChatPanel] electronAPI 不可用，跳过事件监听注册')
      return
    }

    // 监听 LLM 流式 token
    window.electronAPI.onLlmToken((token: string) => {
      appendToken(token)
    })

    // 监听 Agent 工作流步骤更新
    window.electronAPI.onAgentStep((state) => {
      setWorkflowState(state)
      // 如果工作流包含决策卡片，同步到 store
      if (state.decisionCard) {
        setDecisionCard(state.decisionCard)
      }
    })
  }, [appendToken, setWorkflowState, setDecisionCard])

  /** 消息列表自动滚动到底部 */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  /** 发送消息 */
  const handleSend = useCallback(async () => {
    const content = inputValue.trim()
    if (!content || isStreaming) return

    // 添加用户消息
    const userMessage: ChatMessage = { role: 'user', content }
    addMessage(userMessage)
    setInputValue('')

    // 添加空的 AI 回复占位
    const aiMessage: ChatMessage = { role: 'assistant', content: '' }
    addMessage(aiMessage)
    setStreaming(true)

    try {
      // 如果有活跃会话，使用 Agent 工作流；否则使用普通 LLM 对话
      if (!isElectronAPIAvailable()) {
        useAIStore.setState((state) => {
          const newMessages = [...state.messages]
          for (let i = newMessages.length - 1; i >= 0; i--) {
            if (newMessages[i].role === 'assistant') {
              newMessages[i] = {
                ...newMessages[i],
                content: '⚠️ electronAPI 不可用，无法连接 AI 服务',
              }
              break
            }
          }
          return { messages: newMessages }
        })
      } else if (activeSessionId) {
        await window.electronAPI.agentStart(activeSessionId, content)
      } else {
        const reply = await window.electronAPI.llmChat([...messages, userMessage])
        // 直接设置完整回复（非流式）
        useAIStore.setState((state) => {
          const newMessages = [...state.messages]
          for (let i = newMessages.length - 1; i >= 0; i--) {
            if (newMessages[i].role === 'assistant') {
              newMessages[i] = { ...newMessages[i], content: reply }
              break
            }
          }
          return { messages: newMessages }
        })
      }
    } catch (error) {
      // 错误处理：更新最后一条 AI 消息
      const errorMsg = error instanceof Error ? error.message : String(error)
      useAIStore.setState((state) => {
        const newMessages = [...state.messages]
        for (let i = newMessages.length - 1; i >= 0; i--) {
          if (newMessages[i].role === 'assistant') {
            newMessages[i] = {
              ...newMessages[i],
              content: `⚠️ 请求失败: ${errorMsg}`,
            }
            break
          }
        }
        return { messages: newMessages }
      })
    } finally {
      setStreaming(false)
    }
  }, [inputValue, isStreaming, messages, activeSessionId, addMessage, setStreaming])

  /** 清空对话 */
  const handleClear = useCallback(() => {
    clearMessages()
    setDecisionCard(null)
    setWorkflowState(null)
  }, [clearMessages, setDecisionCard, setWorkflowState])

  /** 键盘快捷键：Ctrl+Enter 发送 */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault()
        void handleSend()
      }
    },
    [handleSend]
  )

  return (
    <div className="chat-panel">
      {/* ===== 头部 ===== */}
      <div className="chat-panel-header">
        <div className="chat-panel-title">
          <RobotOutlined />
          <span>AI 运维助手</span>
        </div>
        <Tooltip title="清空对话">
          <Button
            type="text"
            size="small"
            icon={<ClearOutlined />}
            onClick={handleClear}
            disabled={isStreaming}
          />
        </Tooltip>
      </div>

      {/* ===== Agent 工作流状态 ===== */}
      {workflowState && (
        <div className="chat-panel-workflow">
          <AgentWorkflowPanel state={workflowState} />
        </div>
      )}

      {/* ===== 消息列表 ===== */}
      <div className="chat-panel-messages">
        {messages.length === 0 ? (
          <div className="chat-panel-welcome">
            <RobotOutlined className="chat-panel-welcome-icon" />
            <p className="chat-panel-welcome-title">AI 运维助手</p>
            <p className="chat-panel-welcome-desc">
              连接服务器后，粘贴日志或描述问题，AI 将帮您分析根因并提供修复建议。
            </p>
          </div>
        ) : (
          messages.map((msg, index) => (
            <div
              key={index}
              className={`chat-message ${msg.role === 'user' ? 'user' : 'ai'}`}
            >
              <div className="chat-message-bubble">
                {msg.role === 'assistant' && msg.content === '' && isStreaming ? (
                  <span className="chat-message-typing">思考中...</span>
                ) : (
                  <pre className="chat-message-content">{msg.content}</pre>
                )}
              </div>
            </div>
          ))
        )}

        {/* ===== 决策卡片 ===== */}
        {decisionCard && (
          <div className="chat-panel-decision">
            <DecisionCard card={decisionCard} />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ===== 输入区 ===== */}
      <div className="chat-panel-input">
        <TextArea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="描述问题或粘贴日志... (Ctrl+Enter 发送)"
          autoSize={{ minRows: 1, maxRows: 4 }}
          disabled={isStreaming}
          variant="borderless"
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          disabled={!inputValue.trim() || isStreaming}
          loading={isStreaming}
        />
      </div>
    </div>
  )
}

export default ChatPanel
