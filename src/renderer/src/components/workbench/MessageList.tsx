/**
 * MessageList — AIPanel 消息滚动区
 *
 * v2.3.6 修复：彻底移除"演示模式"渲染分支（showDemo + MOCK_CHAT_MESSAGES）。
 * 渲染策略：
 * - hasLiveConversation：渲染实时消息（liveMessages）
 * - hasLoopRunning：渲染 PAOR 审批
 * - 其余：欢迎态（能力网格 + 快捷 chips + 配置引导）
 *
 * 设计稿不再展示设计稿示例消息。发送后直接走真实 agent:chat。
 */
import type { RefObject, FC } from 'react'
import { Sparkles, AlertTriangle, Search, Terminal, FileText, TrendingUp } from 'lucide-react'
import { useLoopEngineering } from './useLoopEngineering'
import type { AgentMessage } from '@/stores/agent-store'
import type { PaorApprovalRequest } from '@/types/electron'
import type { PersistedProviderConfig } from '@shared/agent-types'
import LiveMessageRow from './panels/LiveMessageRow'
import PaorApprovalCard from './panels/PaorApprovalCard'

/** AIPanel 消息滚动区 props */
export interface MessageListProps {
  providers: PersistedProviderConfig[]
  navigate: (path: string) => void
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
  onToolAction: (action: string, payload?: string) => void
  onMessageNavigate: (path: string) => void
}

/** AIPanel 消息滚动区 */
const MessageList: FC<MessageListProps> = ({
  providers,
  navigate,
  hasLoopRunning,
  activeSessionId,
  // v2.3.7 修复：loop 仍由 AIPanel 持有，MessageList 暂不需要（仅 hasLoopRunning 触发 workflow 分支）
  loop: _loop,
  paorApprovals,
  onPaorApprove,
  messagesEndRef,
  hasLiveConversation,
  liveMessages,
  lastError,
  isStreaming,
  onToolAction,
  onMessageNavigate,
}) => {
  return (
    <div className="ai-messages flex flex-col gap-6">
      {hasLiveConversation ? (
        <>
          {liveMessages.map((msg) => (
            <LiveMessageRow key={msg.id} message={msg} onNavigate={onMessageNavigate} onToolAction={onToolAction} activeSessionId={activeSessionId} />
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
      ) : hasLoopRunning ? (
        /* 循环工程进行中：渲染工作流面板 */
        <>
          {paorApprovals.map((req) => (
            <PaorApprovalCard key={req.callId} request={req} onApprove={onPaorApprove} />
          ))}
          <div ref={messagesEndRef} />
        </>
      ) : (
        /* ===== 欢迎态：能力网格 + 快捷 chips（对齐 design-app 视觉） ===== */
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-8">
          {/* 品牌图标 */}
          <div className="flex size-10 items-center justify-center rounded-[10px] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)]">
            <Sparkles className="size-5 text-[var(--trae-icon-brand)]" />
          </div>

          {/* 问候语 */}
          <div className="mt-3 text-[13px] font-semibold text-[var(--trae-text-default)]">
            你好，我是 TDSF AI 运维助手
          </div>
          <div className="mt-1.5 max-w-[380px] text-center text-[11px] leading-relaxed text-[var(--trae-text-secondary)]">
            {activeSessionId
              ? '已连接服务器，可以为您执行故障诊断、命令推荐、配置分析、性能优化等运维任务。'
              : '连接 SSH 服务器后，可以为您执行故障诊断、命令推荐、配置分析、性能优化等运维任务。'}
          </div>

          {/* 能力网格 2×2 */}
          <div className="mt-4 grid w-full max-w-[400px] grid-cols-2 gap-2">
            {([
              { icon: <Search className="size-3" />, title: '故障诊断', desc: '快速定位系统异常' },
              { icon: <Terminal className="size-3" />, title: '命令执行', desc: '安全执行运维命令' },
              { icon: <FileText className="size-3" />, title: '配置分析', desc: '解读配置文件' },
              { icon: <TrendingUp className="size-3" />, title: '性能优化', desc: '发现性能瓶颈' },
            ] as const).map((cap) => (
              <div
                key={cap.title}
                className="flex items-center gap-2 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l1)] px-2.5 py-2 text-left transition-colors duration-150 hover:border-[var(--trae-border-neutral-l2)] hover:bg-[var(--trae-bg-overlay-l2)]"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-[4px] bg-[var(--trae-bg-overlay-l2)] text-[var(--trae-icon-secondary)]">
                  {cap.icon}
                </span>
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-[var(--trae-text-default)]">{cap.title}</div>
                  <div className="text-[10px] text-[var(--trae-text-tertiary)]">{cap.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* 引导按钮（未连接/未配置时显示） */}
          <div className="mt-5 flex items-center gap-2">
            {!activeSessionId && (
              <button
                type="button"
                onClick={() => navigate('/settings/ssh')}
                className="inline-flex h-7 items-center rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] px-3 text-[11px] text-[var(--trae-text-brand)] transition-colors duration-150 hover:border-[var(--trae-border-brand)] hover:bg-[var(--trae-bg-brand-popup)]"
              >
                连接 SSH 服务器
              </button>
            )}
            {providers.length === 0 && (
              <button
                type="button"
                onClick={() => navigate('/settings/model')}
                className="inline-flex h-7 items-center rounded-[var(--trae-radius-6)] bg-[var(--trae-bg-brand)] px-3 text-[11px] font-medium text-[var(--trae-text-onbrand)] transition-opacity duration-150 hover:opacity-90"
              >
                配置 AI 模型
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default MessageList
