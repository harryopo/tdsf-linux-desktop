import type { FC } from 'react'
import { CheckCircle2, Clock } from 'lucide-react'
import type { ChatMessage } from '../mock-data'
import BlockRenderer from './BlockRenderer'
import ProgressPanel from './ProgressPanel'
import RollbackPanel from './RollbackPanel'
import PausePanel from './PausePanel'
import ToolPanel from './ToolPanel'

/** 单条消息渲染 */
const MessageRow: FC<{ message: ChatMessage; onAction?: (action: string, payload?: string) => void; onNavigate?: (path: string) => void }> = ({ message, onAction, onNavigate }) => {
  if (message.role === 'user') {
    return (
      <div className="ai-msg ai-msg-user">
        <div className="ai-msg-user-inner">
          <div className="ai-msg-user-bubble">
            {message.text}
          </div>
          {message.time && (
            <span className="ai-msg-time">{message.time}</span>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="ai-msg ai-msg-multi">
      {message.blocks && message.blocks.length > 0 && (
        <BlockRenderer blocks={message.blocks} onNavigate={onNavigate} />
      )}
      {message.panels?.map((panel, i) => {
        if (panel.type === 'progress') return <ProgressPanel key={i} panel={panel} onAction={onAction} />
        if (panel.type === 'rollback') return <RollbackPanel key={i} panel={panel} />
        if (panel.type === 'pause') return <PausePanel key={i} panel={panel} onAction={onAction} />
        return <ToolPanel key={i} panel={panel} onAction={onAction} />
      })}
      {message.summary && message.summaryVariant === 'checked' && (
        <div className="ai-summary-item py-1">
          <CheckCircle2 className="text-[var(--trae-status-success-default)]" />
          <div className="flex-1">
            <div className="text-[11px] leading-[1.6] text-[var(--trae-text-default)]">{message.summary}</div>
          </div>
        </div>
      )}
      {message.summary && message.summaryVariant !== 'checked' && (
        <div className="py-1">
          <div className="text-[11px] leading-[1.6] text-[var(--trae-text-default)]">{message.summary}</div>
          {/* 操作 chips：查看监控 / 记录决策 / 更新知识库（仅 msg-2 summary 显示，设计稿无图标） */}
          {message.id === 'msg-2' && (
            <div className="ai-chips">
              <button
                type="button"
                onClick={() => onNavigate?.('/monitor')}
                className="ai-chip btn-press"
              >
                查看监控
              </button>
              <button
                type="button"
                onClick={() => onNavigate?.('/history')}
                className="ai-chip btn-press"
              >
                记录决策
              </button>
              <button
                type="button"
                onClick={() => onNavigate?.('/knowledge')}
                className="ai-chip btn-press"
              >
                更新知识库
              </button>
            </div>
          )}
        </div>
      )}
      {typeof message.tokens === 'number' && (
        <div className="ai-token-row ai-token-pop">
          <Clock className="size-2.5" />
          <span>
            {message.summaryVariant === 'checked' ? (
              <>
                <span>本次会话累计</span>
                <span>{' · '}</span>
                <span>总计 <span className="font-medium text-[var(--trae-text-default)]">{message.tokens.toLocaleString()}</span> tokens</span>
              </>
            ) : (
              <>
                {'总计 '}
                <span className="text-[var(--trae-text-secondary)]">{message.tokens.toLocaleString()}</span> tokens
                {typeof message.duration === 'number' && message.duration > 0 && (
                  <>{' · 耗时 '}<span className="text-[var(--trae-text-secondary)]">{message.duration.toFixed(1)}s</span></>
                )}
              </>
            )}
          </span>
        </div>
      )}
    </div>
  )
}

export default MessageRow
