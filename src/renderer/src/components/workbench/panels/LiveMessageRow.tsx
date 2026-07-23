import type { FC } from 'react'
import { Clock, Loader2, Sparkles } from 'lucide-react'
import type { AgentMessage } from '@/stores/agent-store'
import type { AgentStep } from '@shared/models'

/** Agent 工作流 7 步骤有序列表 */
const ALL_STEPS: AgentStep[] = ['collect', 'analyze', 'reason', 'check', 'confirm', 'execute', 'verify']

/** 步骤中文标签 */
const STEP_LABELS: Record<AgentStep, string> = {
  collect: '采集',
  analyze: '分析',
  reason: '推理',
  check: '检查',
  confirm: '确认',
  execute: '执行',
  verify: '验证',
}

/**
 * 实时 Agent 消息行（useAgentStore / Supervisor 主路径）
 * 设计稿富文本面板仍由 mock MessageRow 承担；实时路径先做可靠的文本气泡 + 流式光标。
 *
 * M1 Task 7-8：新增 onAgentStep 流式步骤进度条 + 底部 3 动作按钮（查看监控/记录决策/更新知识库）。
 */
const LiveMessageRow: FC<{ message: AgentMessage; onNavigate?: (path: string) => void }> = ({ message, onNavigate }) => {
  /** 渲染 Agent 工作流步骤进度条（如果 message.stepState 存在） */
  const renderStepProgress = () => {
    if (!message.stepState) return null
    const { currentStep, completedSteps, waitingForConfirmation } = message.stepState
    return (
      <div
        style={{
          display: 'flex',
          gap: 4,
          marginTop: 6,
          padding: '6px 8px',
          background: 'var(--trae-bg-base-tertiary, #2A2D31)',
          borderRadius: 'var(--radius-4, 4px)',
          fontSize: 11,
        }}
      >
        {ALL_STEPS.map((step) => {
          const isCompleted = completedSteps.includes(step)
          const isCurrent = currentStep === step
          const isWaiting = isCurrent && waitingForConfirmation
          return (
            <span
              key={step}
              style={{
                padding: '2px 6px',
                borderRadius: 'var(--radius-2, 2px)',
                background: isCompleted
                  ? 'var(--bg-brand, #387BFF)'
                  : isCurrent
                  ? 'rgba(56,123,255,0.2)'
                  : 'transparent',
                color: isCompleted
                  ? '#fff'
                  : isCurrent
                  ? 'var(--bg-brand, #387BFF)'
                  : 'var(--trae-text-tertiary)',
                border: isWaiting ? '1px solid var(--trae-status-alert, #D29D00)' : '1px solid transparent',
                fontWeight: isCurrent ? 500 : 400,
              }}
            >
              {STEP_LABELS[step]}
              {isWaiting && ' ⏸'}
            </span>
          )
        })}
      </div>
    )
  }

  /** 渲染底部 3 动作按钮（消息完成且非错误时显示） */
  const renderActionButtons = () => {
    if (message.isStreaming || message.isError) return null
    if (!onNavigate) return null
    return (
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginTop: 8,
          paddingTop: 8,
          borderTop: '1px solid var(--trae-border-neutral-l1, #3c3c3c)',
        }}
      >
        <button
          type="button"
          onClick={() => onNavigate('/monitor')}
          style={{
            padding: '4px 10px',
            fontSize: 11,
            border: '1px solid var(--trae-border-neutral-l1)',
            background: 'transparent',
            color: 'var(--trae-text-secondary)',
            borderRadius: 'var(--radius-4, 4px)',
            cursor: 'pointer',
          }}
        >
          查看监控
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/history')}
          style={{
            padding: '4px 10px',
            fontSize: 11,
            border: '1px solid var(--trae-border-neutral-l1)',
            background: 'transparent',
            color: 'var(--trae-text-secondary)',
            borderRadius: 'var(--radius-4, 4px)',
            cursor: 'pointer',
          }}
        >
          记录决策
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/knowledge')}
          style={{
            padding: '4px 10px',
            fontSize: 11,
            border: '1px solid var(--trae-border-neutral-l1)',
            background: 'transparent',
            color: 'var(--trae-text-secondary)',
            borderRadius: 'var(--radius-4, 4px)',
            cursor: 'pointer',
          }}
        >
          更新知识库
        </button>
      </div>
    )
  }

  if (message.role === 'user') {
    const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    })
    return (
      <div className="ai-msg ai-msg-user">
        <div className="ai-msg-user-inner">
          <div className="ai-msg-user-bubble whitespace-pre-wrap">
            {message.content}
          </div>
          <span className="ai-msg-time">{time}</span>
        </div>
      </div>
    )
  }

  // assistant / system
  return (
    <div className="ai-msg ai-msg-multi">
      <div className="ai-msg-with-avatar">
        <div className="ai-avatar">
          {message.isStreaming ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Sparkles />
          )}
        </div>
        <div className="ai-card-wrap">
          <div
            className="ai-card whitespace-pre-wrap"
            style={message.isError ? {
              borderColor: 'var(--trae-status-error-surface-l2)',
              background: 'var(--trae-status-error-surface-l1)',
              color: 'var(--trae-status-error-default)',
            } : undefined}
          >
            {message.content || (message.isStreaming ? '思考中…' : '')}
            {message.isStreaming && (
              <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse bg-[var(--trae-bg-brand)] align-middle" />
            )}
          </div>
        </div>
      </div>
      {renderStepProgress()}
      {(message.usage || message.model) && !message.isStreaming && (
        <div className="ai-token-row ai-token-pop" style={{ paddingLeft: 32 }}>
          <Clock className="size-3" />
          <span>
            {message.model ? `${message.model} · ` : ''}
            {message.usage
              ? `${message.usage.totalTokens.toLocaleString()} tokens`
              : ''}
          </span>
        </div>
      )}
      {renderActionButtons()}
    </div>
  )
}

export default LiveMessageRow
