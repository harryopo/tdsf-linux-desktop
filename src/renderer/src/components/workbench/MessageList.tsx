import type { RefObject } from 'react'
import type { FC } from 'react'
import { AlertTriangle, Sparkles, Workflow } from 'lucide-react'
import { LoopWorkflowPanel } from './LoopWorkflowPanel'
import { MOCK_CHAT_MESSAGES } from './mock-data'
import { useLoopEngineering } from './useLoopEngineering'
import type { AgentMessage } from '@/stores/agent-store'
import type { PaorApprovalRequest } from '@/types/electron'
import type { PersistedProviderConfig } from '@shared/agent-types'
import LiveMessageRow from './panels/LiveMessageRow'
import MessageRow from './panels/MessageRow'
import PaorApprovalCard from './panels/PaorApprovalCard'

/** AIPanel 消息滚动区 props */
export interface MessageListProps {
  providers: PersistedProviderConfig[]
  navigate: (path: string) => void
  demoMode: boolean
  hasLoopRunning: boolean
  activeSessionId: string | null
  loop: ReturnType<typeof useLoopEngineering>
  paorApprovals: PaorApprovalRequest[]
  onPaorApprove: (callId: string, approved: boolean) => void
  messagesEndRef: RefObject<HTMLDivElement>
  hasLiveConversation: boolean
  liveMessages: AgentMessage[]
  lastError: string | null
  isStreaming: boolean
  showDemo: boolean
  onToolAction: (action: string, payload?: string) => void
  onMessageNavigate: (path: string) => void
}

/** AIPanel 消息滚动区 */
const MessageList: FC<MessageListProps> = ({
  providers,
  navigate,
  demoMode,
  hasLoopRunning,
  activeSessionId,
  loop,
  paorApprovals,
  onPaorApprove,
  messagesEndRef,
  hasLiveConversation,
  liveMessages,
  lastError,
  isStreaming,
  showDemo,
  onToolAction,
  onMessageNavigate,
}) => {
  return (
    <div className="ai-messages flex flex-col gap-6">
      {providers.length === 0 && (
        <div className="flex items-start gap-2 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] px-3 py-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--trae-status-alert-default)]" />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium text-[var(--trae-text-default)]">
              尚未配置模型 Provider
            </div>
            <div className="mt-0.5 text-[11px] leading-4 text-[var(--trae-text-tertiary)]">
              Agent 主路径需要 API Key。配置后即可在此流式对话。
            </div>
            <button
              type="button"
              onClick={() => navigate('/settings/model')}
              className="mt-2 inline-flex h-8 items-center rounded-[var(--trae-radius-6)] bg-[var(--trae-bg-brand)] px-3 text-[12px] font-medium text-[var(--trae-text-onbrand)] hover:bg-[var(--trae-bg-brand-hover)]"
            >
              去配置模型
            </button>
          </div>
        </div>
      )}

      {demoMode ? (
        /* 演示模式：渲染循环工程工作流面板 */
        <>
          {/* 演示模式说明条 */}
          {!hasLoopRunning && (
            <div className="rounded-[var(--trae-radius-6)] border border-dashed border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-3 py-2.5 text-[11px] leading-[1.6] text-[var(--trae-text-secondary)]">
              <div className="mb-1 flex items-center gap-1.5">
                <Workflow className="size-3.5 text-[var(--trae-text-brand)]" />
                <span className="font-semibold text-[var(--trae-text-brand)]">演示模式已开启</span>
              </div>
              <div className="text-[var(--trae-text-tertiary)]">
                输入运维问题（如「nginx 服务启动失败」），将触发完整 7 步 HITL 工作流：
                <span className="text-[var(--trae-text-secondary)]"> 假设计 → 决策卡片 → 人工确认 → 执行 → 验证</span>。
              </div>
              {!activeSessionId && (
                <div className="mt-1.5 flex items-center gap-1 text-[var(--trae-status-alert-default)]">
                  <AlertTriangle className="size-3" />
                  <span>请先在左侧服务器列表连接一台 SSH 主机。</span>
                </div>
              )}
            </div>
          )}
          <LoopWorkflowPanel loop={loop} />
          {paorApprovals.map((req) => (
            <PaorApprovalCard key={req.callId} request={req} onApprove={onPaorApprove} />
          ))}
          <div ref={messagesEndRef} />
        </>
      ) : hasLiveConversation ? (
        <>
          {liveMessages.map((msg) => (
            <LiveMessageRow key={msg.id} message={msg} />
          ))}
          {lastError && !isStreaming && (
            <div className="flex items-start gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-status-error-surface-l2)] bg-[var(--trae-status-error-surface-l1)] px-2.5 py-2 text-[12px] text-[var(--trae-status-error-default)]">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{lastError}</span>
            </div>
          )}
          {paorApprovals.map((req) => (
            <PaorApprovalCard key={req.callId} request={req} onApprove={onPaorApprove} />
          ))}
          <div ref={messagesEndRef} />
        </>
      ) : showDemo ? (
        <>
          <div className="rounded-[var(--trae-radius-6)] border border-dashed border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] px-2.5 py-1.5 text-[11px] text-[var(--trae-text-tertiary)]">
            下方为设计稿示例（mock）。发送消息后走真实 agent:chat。
          </div>
          {MOCK_CHAT_MESSAGES.map((msg) => (
            <MessageRow
              key={msg.id}
              message={msg}
              onAction={onToolAction}
              onNavigate={onMessageNavigate}
            />
          ))}
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
          <Sparkles className="size-7 text-[var(--trae-text-brand)] opacity-80" />
          <div className="text-[14px] font-medium text-[var(--trae-text-default)]">开始与运维 Agent 对话</div>
          <div className="max-w-[300px] text-[12px] leading-5 text-[var(--trae-text-tertiary)]">
            主路径：agent:chat → Supervisor
            {activeSessionId ? '（已连 SSH，可调用只读诊断工具）' : '（未连 SSH 时仅文本；连接后可只读摸机）'}
            。也可打开「演示模式」走 7 步 HITL。
          </div>
          {!activeSessionId && (
            <button
              type="button"
              onClick={() => navigate('/settings/ssh')}
              className="inline-flex h-8 items-center rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] px-3 text-[12px] text-[var(--trae-text-brand)] hover:bg-[var(--trae-bg-overlay-l2)]"
            >
              去连接 SSH
            </button>
          )}
          {providers.length === 0 && (
            <button
              type="button"
              onClick={() => navigate('/settings/model')}
              className="inline-flex h-8 items-center rounded-[var(--trae-radius-6)] bg-[var(--trae-bg-brand)] px-3 text-[12px] font-medium text-[var(--trae-text-onbrand)]"
            >
              去配置模型
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default MessageList
