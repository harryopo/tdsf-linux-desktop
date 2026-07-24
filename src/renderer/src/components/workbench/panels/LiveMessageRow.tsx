import type { FC } from 'react'
import { Clock, Loader2, Pause, Sparkles } from 'lucide-react'
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
 * v3.1 视觉打磨：内联样式 → Tailwind token 类，添加 btn-press / hover / transition。
 */
const LiveMessageRow: FC<{ message: AgentMessage; onNavigate?: (path: string) => void }> = ({ message, onNavigate }) => {
  /** 渲染 Agent 工作流步骤进度条（如果 message.stepState 存在） */
  const renderStepProgress = () => {
    if (!message.stepState) return null
    const { currentStep, completedSteps, waitingForConfirmation } = message.stepState
    return (
      <div className="mt-1.5 flex gap-1 rounded-[var(--trae-radius-4)] bg-[var(--trae-bg-base-tertiary)] px-2 py-1.5 text-[11px]">
        {ALL_STEPS.map((step) => {
          const isCompleted = completedSteps.includes(step)
          const isCurrent = currentStep === step
          const isWaiting = isCurrent && waitingForConfirmation
          return (
            <span
              key={step}
              className={[
                'inline-flex items-center gap-0.5 rounded-[2px] border px-1.5 py-0.5 transition-colors duration-150',
                isCompleted
                  ? 'border-transparent bg-[var(--trae-bg-brand)] font-medium text-[var(--trae-text-onbrand)]'
                  : isCurrent
                    ? 'border-transparent bg-[var(--trae-status-primary-surface-l2)] font-medium text-[var(--trae-text-brand)]'
                    : 'border-transparent bg-transparent text-[var(--trae-text-tertiary)]',
                isWaiting ? 'border-[var(--trae-status-alert-default)]' : '',
              ].join(' ')}
            >
              {STEP_LABELS[step]}
              {isWaiting && <Pause className="size-2.5" />}
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
      <div className="mt-2 flex gap-2 border-t border-[var(--trae-border-neutral-l1)] pt-2">
        <button
          type="button"
          onClick={() => onNavigate('/monitor')}
          className="btn-press rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-transparent px-2.5 py-1 text-[11px] text-[var(--trae-text-secondary)] transition-colors duration-150 hover:border-[var(--trae-border-neutral-l2)] hover:bg-[var(--trae-bg-overlay-l1)] hover:text-[var(--trae-text-default)]"
        >
          查看监控
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/history')}
          className="btn-press rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-transparent px-2.5 py-1 text-[11px] text-[var(--trae-text-secondary)] transition-colors duration-150 hover:border-[var(--trae-border-neutral-l2)] hover:bg-[var(--trae-bg-overlay-l1)] hover:text-[var(--trae-text-default)]"
        >
          记录决策
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/knowledge')}
          className="btn-press rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-transparent px-2.5 py-1 text-[11px] text-[var(--trae-text-secondary)] transition-colors duration-150 hover:border-[var(--trae-border-neutral-l2)] hover:bg-[var(--trae-bg-overlay-l1)] hover:text-[var(--trae-text-default)]"
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
            className={[
              'ai-card whitespace-pre-wrap',
              message.isError
                ? 'border-[var(--trae-status-error-surface-l2)] bg-[var(--trae-status-error-surface-l1)] text-[var(--trae-status-error-default)]'
                : '',
            ].join(' ')}
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
        <div className="ai-token-row ai-token-pop pl-8">
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
