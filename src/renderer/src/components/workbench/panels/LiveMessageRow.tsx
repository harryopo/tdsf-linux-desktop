import { type FC } from 'react'
import { Clock, Loader2, Pause, Play, Shield, Sparkles } from 'lucide-react'
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

/** 从消息文本中提取 shell 命令（```bash 代码块或 $ 前缀行） */
function extractCommands(content: string): string[] {
  const commands: string[] = []
  // 匹配 ```bash ... ``` 代码块
  const codeBlockRe = /```(?:bash|shell|sh|zsh)?\s*\n([\s\S]*?)```/g
  let match = codeBlockRe.exec(content)
  while (match) {
    const lines = match[1].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    commands.push(...lines)
    match = codeBlockRe.exec(content)
  }
  // 如果没有代码块，尝试匹配 $ 前缀行
  if (commands.length === 0) {
    const dollarRe = /^\$\s+(.+)$/gm
    let m = dollarRe.exec(content)
    while (m) {
      commands.push(m[1].trim())
      m = dollarRe.exec(content)
    }
  }
  return commands
}

interface LiveMessageRowProps {
  message: AgentMessage
  onNavigate?: (path: string) => void
  /** 工具操作回调（执行/沙箱预演等） */
  onToolAction?: (action: string, payload?: string) => void
  /** 活跃 SSH 会话 ID（执行命令需要） */
  activeSessionId?: string | null
}

/**
 * 实时 Agent 消息行（useAgentStore / Supervisor 主路径）
 *
 * v3.2 命令检测：自动解析 agent 回复中的 bash 代码块，添加"执行"/"沙箱预演"按钮。
 */
const LiveMessageRow: FC<LiveMessageRowProps> = ({ message, onNavigate, onToolAction, activeSessionId }) => {
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

  /** 从消息中提取命令，渲染执行/沙箱预演按钮 */
  const renderCommandButtons = () => {
    if (message.isStreaming || message.isError) return null
    if (!onToolAction || !activeSessionId) return null
    const commands = extractCommands(message.content)
    if (commands.length === 0) return null
    return (
      <div className="mt-2 flex flex-col gap-1.5 border-t border-[var(--trae-border-neutral-l1)] pt-2">
        <div className="text-[10px] text-[var(--trae-text-tertiary)]">检测到 {commands.length} 条命令：</div>
        {commands.map((cmd, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <code className="flex-1 truncate rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l1)] px-2 py-1 font-mono text-[11px] text-[var(--trae-text-default)]">
              {cmd}
            </code>
            <button
              type="button"
              onClick={() => onToolAction('execute', cmd)}
              title="在终端执行"
              className="btn-press inline-flex shrink-0 items-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-bg-brand)] bg-[var(--trae-bg-brand)] px-2 py-1 text-[10px] font-medium text-[var(--trae-text-onbrand)] transition-opacity hover:opacity-90"
            >
              <Play className="size-3" />
              执行
            </button>
            <button
              type="button"
              onClick={() => onToolAction('sandbox', cmd)}
              title="沙箱预演"
              className="btn-press inline-flex shrink-0 items-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] bg-transparent px-2 py-1 text-[10px] text-[var(--trae-text-secondary)] transition-colors hover:border-[var(--trae-border-brand)] hover:text-[var(--trae-text-brand)]"
            >
              <Shield className="size-3" />
              沙箱
            </button>
          </div>
        ))}
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
      {renderCommandButtons()}
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