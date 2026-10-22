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
import type { AgentMessage } from '@/stores/agent-store'
import type { PaorIteration, PaorPlanObject } from '@shared/paor-types'
import type { PersistedProviderConfig } from '@shared/agent-types'
import LiveMessageRow from './panels/LiveMessageRow'
import PaorPlanCard from './panels/PaorPlanCard'
// v2.6：空态能力卡点击注入提示词到输入框（Composer 消费 injectedAtCommand）
import { useEditorStore } from '@/stores/editor-store'

/** AIPanel 消息滚动区 props */
export interface MessageListProps {
  providers: PersistedProviderConfig[]
  navigate: (path: string) => void
  hasLoopRunning: boolean
  activeSessionId: string | null
  /**
   * 审批不在这里。#170 之前这两个键（paorApprovals / onPaorApprove）一路传进来
   * 又被改名成 _ 前缀放着不用——审批卡只由 dock/permission-bar 画，
   * 队列只住在 stores/approval-store。留着它们等于给下一个读代码的人留一条假通道。
   */
  /** v2.11 任务拆解可视化：PAOR 结构化计划 + 迭代轨迹 + 是否运行中 */
  paorPlan: PaorPlanObject | null
  paorIterations: PaorIteration[]
  paorRunning: boolean
  messagesEndRef: RefObject<HTMLDivElement | null>
  hasLiveConversation: boolean
  liveMessages: AgentMessage[]
  lastError: string | null
  isStreaming: boolean
  onToolAction: (action: string, payload?: string) => void
  onMessageNavigate: (path: string) => void
  /** 报错后的下一步动作（按钮只有接到真回调才会出现在界面上） */
  onRetryMessage: () => void
  onCompressContext: () => void
}

/** AIPanel 消息滚动区 */
const MessageList: FC<MessageListProps> = ({
  providers,
  navigate,
  hasLoopRunning,
  activeSessionId,
  paorPlan,
  paorIterations,
  paorRunning,
  messagesEndRef,
  hasLiveConversation,
  liveMessages,
  lastError,
  isStreaming,
  onToolAction,
  onMessageNavigate,
  onRetryMessage,
  onCompressContext,
}) => {
  return (
    <div className="ai-messages flex flex-col gap-6">
      {/* v2.11：paorPlan 存在时即进入对话视图（计划先于首条迭代消息到达，不能落回欢迎态） */}
      {hasLiveConversation || paorPlan ? (
        <>
          {liveMessages.map((msg) => (
            <LiveMessageRow
              key={msg.id}
              message={msg}
              onNavigate={onMessageNavigate}
              onToolAction={onToolAction}
              activeSessionId={activeSessionId}
              onRetry={onRetryMessage}
              onCompress={onCompressContext}
            />
          ))}
          {/*
            同一条错误只说一次。markError 做两件事：把错误挂到那条消息上（消息里自己画失败卡），
            并记一份全局 lastError。两个出口都画，就是用户 2026-10-16 截图里上下两遍一样的红字。
            所以这条横幅只兜"错误没落到任何一条消息上"的那种失败（一条消息都还没建起来就报错）。
          */}
          {lastError &&
            !isStreaming &&
            !liveMessages.some((m) => m.isError && m.errorMessage === lastError) && (
              <div className="flex items-start gap-2 rounded-(--ui-radius-card) border border-error/40 bg-error/10 px-3 py-2 text-sm text-error-text">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{lastError}</span>
              </div>
            )}
          {/* v2.11 任务拆解可视化：PAOR 计划步骤卡 */}
          {paorPlan && (
            <PaorPlanCard plan={paorPlan} iterations={paorIterations} isRunning={paorRunning} />
          )}
          <div ref={messagesEndRef} />
        </>
      ) : hasLoopRunning ? (
        /* 循环工程进行中：渲染工作流面板 */
        <>
          {/* v2.11 任务拆解可视化：PAOR 计划步骤卡 */}
          {paorPlan && (
            <PaorPlanCard plan={paorPlan} iterations={paorIterations} isRunning={paorRunning} />
          )}
          <div ref={messagesEndRef} />
        </>
      ) : (
        /* ===== 欢迎态：能力网格 + 快捷 chips（对齐 design-app 视觉） =====
           v2.6：能力卡接真实交互（点击注入提示词到输入框）+ 间距放宽 */
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-10">
          {/* 品牌图标 */}
          <div className="flex size-12 items-center justify-center rounded-[12px] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)]">
            <Sparkles className="size-6 text-[var(--trae-icon-brand)]" />
          </div>

          {/* 问候语 */}
          <div className="mt-5 text-title font-semibold text-ink">
            你好，我是 TDSF AI 运维助手
          </div>
          <div className="mt-2 max-w-[400px] text-center text-sm leading-relaxed text-ink-dim">
            {activeSessionId
              ? '已连接服务器，可以为您执行故障诊断、命令推荐、配置分析、性能优化等运维任务。'
              : '连接 SSH 服务器后，可以为您执行故障诊断、命令推荐、配置分析、性能优化等运维任务。'}
          </div>

          {/* 能力网格（v2.6：真按钮 —— 点击把对应提示词填入输入框并聚焦）
              auto-fit 而不是写死 grid-cols-2：AI 停靠格拖窄后两列各剩 120px，
              「故障诊断」会被从中间断成两行（窄屏审计截图实测到） */}
          <div className="mt-6 grid w-full max-w-[460px] grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
            {([
              { icon: <Search className="size-4" />, title: '故障诊断', desc: '快速定位系统异常', prompt: '请诊断当前主机健康状态：磁盘(df -h)、内存(free -m)、负载(uptime)、关键服务(systemctl --failed)。只读命令，给出结论与建议。' },
              { icon: <Terminal className="size-4" />, title: '命令推荐', desc: '安全执行运维命令', prompt: '我想完成一项运维操作，请推荐安全的命令并说明风险：' },
              { icon: <FileText className="size-4" />, title: '配置分析', desc: '解读配置文件', prompt: '请帮我分析以下配置文件的含义与潜在问题：' },
              { icon: <TrendingUp className="size-4" />, title: '性能优化', desc: '发现性能瓶颈', prompt: '请分析当前服务器的性能瓶颈（CPU/内存/磁盘IO/网络）并给出优化建议，只读命令采集。' },
            ] as const).map((cap) => (
              <button
                key={cap.title}
                type="button"
                onClick={() => useEditorStore.getState().setInjectedAtCommand(cap.prompt)}
                title={`点击将“${cap.title}”提示词填入输入框`}
                className="btn-press flex items-center gap-3 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l1)] px-3.5 py-3 text-left transition-colors duration-150 hover:border-[var(--trae-border-brand)] hover:bg-[var(--trae-bg-overlay-l2)]"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--trae-bg-overlay-l2)] text-[var(--trae-icon-secondary)]">
                  {cap.icon}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{cap.title}</div>
                  <div className="mt-0.5 text-caption text-ink-mute">{cap.desc}</div>
                </div>
              </button>
            ))}
          </div>

          {/* 引导按钮（未连接/未配置时显示） */}
          <div className="mt-7 flex items-center gap-3">
            {!activeSessionId && (
              <button
                type="button"
                onClick={() => navigate('/settings/ssh')}
                className="inline-flex h-7 items-center rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] px-3 text-caption text-(--accent-text) transition-colors duration-150 hover:border-[var(--trae-border-brand)] hover:bg-[var(--trae-bg-brand-popup)]"
              >
                连接 SSH 服务器
              </button>
            )}
            {providers.length === 0 && (
              <button
                type="button"
                onClick={() => navigate('/settings/model')}
                className="inline-flex h-7 items-center rounded-[var(--trae-radius-6)] bg-accent-solid px-3 text-caption font-medium text-[var(--trae-text-onbrand)] transition-opacity duration-150 hover:opacity-90"
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
