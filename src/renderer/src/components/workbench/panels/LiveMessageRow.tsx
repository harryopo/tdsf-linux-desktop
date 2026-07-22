import type { FC } from 'react'
import { Clock, Loader2, Sparkles } from 'lucide-react'
import type { AgentMessage } from '@/stores/agent-store'

/**
 * 实时 Agent 消息行（useAgentStore / Supervisor 主路径）
 * 设计稿富文本面板仍由 mock MessageRow 承担；实时路径先做可靠的文本气泡 + 流式光标。
 */
const LiveMessageRow: FC<{ message: AgentMessage }> = ({ message }) => {
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
    </div>
  )
}

export default LiveMessageRow
