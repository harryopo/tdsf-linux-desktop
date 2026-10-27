/**
 * MessageList — AIPanel 消息滚动区
 *
 * v2.3.6 修复：彻底移除"演示模式"渲染分支（showDemo + MOCK_CHAT_MESSAGES）。
 * 渲染策略：
 * - hasLiveConversation：渲染实时消息（liveMessages）
 * - 其余：欢迎态（一列建议行，点击填入 Composer）
 *
 * 设计稿不再展示设计稿示例消息。发送后直接走真实 agent:chat。
 */
import type { RefObject, FC } from 'react'
import { AlertTriangle, Search, Terminal, FileText, TrendingUp, Plug, SlidersHorizontal } from 'lucide-react'
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
      ) : (
        /* ===== 欢迎态（面板第①笔）=====
           原来那块居中的能力网格有两个毛病：2×2 卡在窄停靠格里被从中间断成两行
           （窄屏审计实测过），而整块居中让第一条建议离输入框十万八千里。
           现在与消息流共用同一个左缘，一行一条，读起来就是"接下来可以问这些"。 */
        <div className="ai-welcome">
          <div className="ai-welcome-title">问问这台机器</div>
          <div className="ai-welcome-desc">
            {activeSessionId
              ? 'AI 只读地看日志、服务状态和磁盘，改东西的动作仍然要一步步批。'
              : '连上 SSH 之后，AI 可以只读地看日志、服务状态和磁盘。'}
          </div>

          <div className="ai-welcome-list">
            {([
              {
                icon: <Search className="size-4" />,
                label: '查这台机器哪里不对劲：磁盘、内存、负载、失败服务',
                prompt:
                  '请诊断当前主机健康状态：磁盘(df -h)、内存(free -m)、负载(uptime)、关键服务(systemctl --failed)。只读命令，给出结论与建议。',
              },
              {
                icon: <Terminal className="size-4" />,
                label: '解释一条刚跑完的失败命令，并给安全的下一步',
                prompt: '我刚才这条命令失败了，请解释报错原因并推荐安全的下一步：',
              },
              {
                icon: <FileText className="size-4" />,
                label: '读一个配置文件，讲清它写了什么、有什么坑',
                prompt: '请帮我分析以下配置文件的含义与潜在问题：',
              },
              {
                icon: <TrendingUp className="size-4" />,
                label: '找性能瓶颈：CPU、内存、磁盘 IO、网络',
                prompt:
                  '请分析当前服务器的性能瓶颈（CPU/内存/磁盘IO/网络）并给出优化建议，只读命令采集。',
              },
            ] as const).map((cap) => (
              <button
                key={cap.label}
                type="button"
                onClick={() => useEditorStore.getState().setInjectedAtCommand(cap.prompt)}
                title="点击把这段提示词填入下方输入框（不会直接发送）"
                className="ai-sug"
              >
                {cap.icon}
                <span className="ai-sug-label">{cap.label}</span>
              </button>
            ))}

            {/* 还没具备条件时，把入口摆在同一列里——但要说清它去哪 */}
            {!activeSessionId && (
              <button
                type="button"
                onClick={() => navigate('/settings/ssh')}
                className="ai-sug"
                title="打开设置 · SSH，连接一台服务器"
              >
                <Plug className="size-4" />
                <span className="ai-sug-label">去设置里连服务器</span>
              </button>
            )}
            {providers.length === 0 && (
              <button
                type="button"
                onClick={() => navigate('/settings/model')}
                className="ai-sug"
                title="打开设置 · 模型，配置一个可用的模型"
              >
                <SlidersHorizontal className="size-4" />
                <span className="ai-sug-label">还没有可用的模型，去设置里配</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default MessageList
