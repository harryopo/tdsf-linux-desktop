/**
 * AIPanel — 560px 右侧 AI 助手面板
 *
 * // @ai-session: ai-claude-20260720-wire
 * // @ai-task: Sprint-wire-AIPanel-to-agent-chat
 *
 * P3-C1 重构（2026-07-22）：从 1921 行拆分至 ≤500 行
 * - 子展示组件迁出至 ./panels/ 目录（MiniBar/ToolPanel/ProgressPanel/RollbackPanel/
 *   PausePanel/BlockRenderer/MessageRow/LiveMessageRow/PaorApprovalCard）
 * - 标题栏 → ./AIPanelHeader.tsx
 * - 消息滚动区 → ./MessageList.tsx
 * - 输入区域 → ./Composer.tsx
 * - Token/成本统计行 → ./TokenCostRow.tsx
 *
 * 设计稿：tdsf-linux-redesign/pages/workbench-ai.html 第 2514-3296 行
 *
 * 结构：40px 标题栏（AI运维助手 + Token曲线 + 收起） + 消息滚动区
 *       + Composer chips + Composer 输入框 + Token 预算行
 *
 * Wire-1（2026-07-20）：
 * - 发送/停止 → useAgentChat → agent:chat 主路径（docs/AGENT_MAIN_PATH.md）
 * - 有真实对话时渲染 useAgentStore 消息；空列表默认真实空态（可手动打开设计稿示例）
 * - 工具面板按钮仍多为 mock（Wire-2+ 再接 HITL / 终端）
 *
 * 数据：
 * - 实时：useAgentChat / useAgentStore
 * - 可选示例：mock-data.ts MOCK_CHAT_MESSAGES（showDemo）
 * - chips：快捷运维提示词；token 预算条接 tokenStats
 */
import { useState, useRef, useEffect, type FC } from 'react'
import { useNavigate } from 'react-router-dom'
import { message } from 'antd'
import { useAgentChat } from './useAgentChat'
import { useLoopEngineering } from './useLoopEngineering'
import { usePaorLoop } from './usePaorLoop'
import { useServerStore } from '@/stores/server-store'
import type { PaorApprovalRequest } from '@/types/electron'
import './AIPanel.css'
import AIPanelHeader from './AIPanelHeader'
import MessageList from './MessageList'
import Composer from './Composer'

/** AIPanel props */
export interface AIPanelProps {
  /** 收起 AI 面板回调 */
  onClose?: () => void
}

/**
 * AIPanel 560px AI 助手面板
 *
 * v2.3.6 修复：彻底移除"演示模式"死代码（showDemo/demoMode/MOCK_CHAT_MESSAGES）。
 * 设计稿不再展示设计稿示例消息，发送消息后直接走真实 agent:chat。
 */
const AIPanel: FC<AIPanelProps> = ({ onClose }) => {
  const navigate = useNavigate()
  const [showTranslation, setShowTranslation] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const {
    messages: liveMessages,
    isStreaming,
    lastError,
    currentCorrelationId,
    providers,
    selectedProviderId,
    setSelectedProviderId,
    tokenStats,
    send,
    cancel,
    clear,
    compressContext,
  } = useAgentChat()

  /** 循环工程子 Agent —— PAOR 循环专用 */
  const loop = useLoopEngineering()

  /** PAOR 自动循环（v0.9.5 P0-3：Plan→Act→Observe→Reflect 主进程编排） */
  const paor = usePaorLoop()

  /** 当前活跃 SSH 会话 ID（PAOR 循环工程 + 只读 SSH 工具用） */
  const activeSessionId = useServerStore((s) => s.activeSessionId)

  /** v0.9.5 PAOR 审批请求队列（高危命令等待用户批准/拒绝） */
  const [paorApprovals, setPaorApprovals] = useState<PaorApprovalRequest[]>([])

  const hasLiveConversation = liveMessages.length > 0
  /** 循环工程已启动（loop.phase !== 'idle'）则视为有"实时"内容 */
  const hasLoopRunning = loop.phase !== 'idle'

  /** 监听主进程推送的 PAOR 审批请求 */
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onPaorApprovalRequest) return
    return api.onPaorApprovalRequest((request: PaorApprovalRequest) => {
      setPaorApprovals((prev) => [...prev, request])
    })
  }, [])

  /** 处理 PAOR 审批响应（批准/拒绝） */
  const handlePaorApprove = async (callId: string, approved: boolean) => {
    const api = window.electronAPI
    if (!api?.paorApprove) return
    await api.paorApprove(callId, approved)
    setPaorApprovals((prev) => prev.filter((r) => r.callId !== callId))
  }

  /**
   * 监听 PAOR 迭代进度，实时展示在 message.info（v0.9.5 P0-3）
   *
   * 每轮迭代（Plan→Act→Observe→Reflect）完成后触发：
   * - 显示迭代序号 + 执行命令 + 观察状态 + 反思决策
   * - 高危命令被拦截时显示 riskBlocked 提示
   *
   * 注意：用 message.info 而非 message.loading，因为迭代可能间隔较长（数秒），
   * loading 会持续显示直到下一次迭代，体验更佳；但 message.info 不会自动消失，
   * 需手动控制时长（设为 6 秒，避免堆积）。
   */
  const lastIterationRef = useRef(0)
  useEffect(() => {
    if (paor.iterations.length === 0) return
    const latest = paor.iterations[paor.iterations.length - 1]
    if (latest.iteration <= lastIterationRef.current) return
    lastIterationRef.current = latest.iteration

    const cmdPreview =
      latest.act.command.length > 60
        ? `${latest.act.command.slice(0, 60)}...`
        : latest.act.command
    const statusIcon =
      latest.riskBlocked
        ? '⛔'
        : latest.observe.status === 'success'
          ? '✅'
          : latest.observe.status === 'partial'
            ? '⚠️'
            : '❌'
    const decisionMap: Record<string, string> = {
      continue: '继续下一步',
      retry: '重试当前步骤',
      abort: '中止循环',
      done: '任务完成',
    }
    const decisionText = decisionMap[latest.reflect.decision] ?? latest.reflect.decision
    message.info({
      content: `PAOR 迭代 ${latest.iteration} ${statusIcon}\n命令：${cmdPreview}\n观察：${latest.observe.status} → 决策：${decisionText}`,
      duration: 6,
    })
  }, [paor.iterations])

  /** PAOR 完成时展示最终摘要 */
  useEffect(() => {
    if (!paor.result) return
    const statusMap: Record<string, string> = {
      done: '✅ 计划完成',
      abort: '⛔ 已中止',
      max_iterations: '⏱️ 达到迭代上限',
    }
    const statusText = statusMap[paor.result.status] ?? paor.result.status
    message.success({
      content: `PAOR 循环结束 ${statusText}（${paor.result.iterations.length} 轮迭代，耗时 ${(paor.result.durationMs / 1000).toFixed(1)}s）\n摘要：${paor.result.summary}`,
      duration: 10,
    })
  }, [paor.result])

  /** PAOR 出错时提示 */
  useEffect(() => {
    if (!paor.error) return
    message.error(`PAOR 错误：${paor.error}`)
  }, [paor.error])

  /**
   * 实时消息滚动到底部
   *
   * v2.3.4 修复：原实现 messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
   *   默认 block:'start' 会把空 div 滚到 .ai-messages 视口顶部，导致最后一条消息正文
   *   被推到视口外，用户感知为"输入后消息不见"。改为直接 scrollTo 到 .ai-messages
   *   的 scrollHeight（= 滚到底），配合 .ai-messages 的 padding-bottom 留出 Composer 空间。
   * v2.3.5 配合：AIPanel.css 已加 scroll-padding-bottom: 8px + padding-bottom: 16px，
   *   scrollTo 末尾时 Composer 与最后一条消息有呼吸空间。
   */
  useEffect(() => {
    if (!hasLiveConversation && !hasLoopRunning) return
    const end = messagesEndRef.current
    if (!end) return
    // 找到 .ai-messages 滚动容器（closest 找到最近 .ai-messages 祖先）
    const scrollContainer = (end.closest('.ai-messages') as HTMLElement | null) ?? end.parentElement
    if (!scrollContainer) {
      // 兜底：找不到滚动容器时退回 scrollIntoView
      end.scrollIntoView({ block: 'end', behavior: 'smooth' })
      return
    }
    // 直接 scrollTo 到容器底部（等价于贴齐最后一行消息的下边缘）
    scrollContainer.scrollTo({
      top: scrollContainer.scrollHeight,
      behavior: 'smooth',
    })
  }, [liveMessages, hasLiveConversation, isStreaming, hasLoopRunning, loop.phase, loop.workflowState, loop.decisionCard, loop.finalCard])

  /** 处理工具面板操作（在终端运行/执行/沙箱预演/回滚/暂停/终止）
   *
   * Wire-2（2026-07-22）：真实 IPC 接线
   * - copyCommand: 复制命令到剪贴板
   * - runInTerminal / execute / rollback / rollbackExec: 调用 sshExec(activeSessionId, cmd)
   * - sandbox: 调用 sandboxCreate + sandboxExecute（沙箱预演）
   * - pauseExec / terminateTask: 调用 agentChatCancel(currentCorrelationId) 取消流
   * - resumeExec: 当前 IPC 不支持恢复，提示用户重新发送
   *
   * 非 Electron 环境降级为提示消息，UI 不崩溃。
   */
  const handleToolAction = async (action: string, payload?: string) => {
    // 1. 复制命令：直接写入剪贴板
    if (action === 'copyCommand') {
      if (payload) {
        try {
          await navigator.clipboard.writeText(payload)
          message.success('命令已复制到剪贴板')
        } catch {
          message.error('复制失败，请手动选择文本')
        }
      }
      return
    }

    // 2. 暂停 / 终止任务：取消当前 agent chat 流
    if (action === 'pauseExec' || action === 'terminateTask') {
      try {
        const api = window.electronAPI
        // 优先使用 agentChatCancel(correlationId) 取消当前对话流
        if (currentCorrelationId && api?.agentChatCancel) {
          await api.agentChatCancel(currentCorrelationId)
        } else if (activeSessionId && api?.agentCancel) {
          // fallback: agentCancel(sessionId) —— v0.8 旧接口，按 sessionId 取消
          await api.agentCancel(activeSessionId)
        } else {
          void cancel()
        }
        message.info(action === 'pauseExec' ? '已暂停当前任务' : '已终止当前任务')
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        message.error(`操作失败：${reason}`)
      }
      return
    }

    // 3. 恢复执行：当前 IPC 不支持恢复，提示用户重新发送
    if (action === 'resumeExec') {
      message.info('当前任务已暂停，请重新发送消息以恢复执行')
      return
    }

    // 4. 命令类操作（runInTerminal / execute / sandbox / rollback / rollbackExec）必须有 payload
    if (!payload) {
      message.warning('未找到可执行的命令')
      return
    }

    const api = window.electronAPI

    // 4.1 沙箱预演：sandboxCreate + sandboxExecute
    if (action === 'sandbox') {
      if (!api?.sandboxCreate || !api?.sandboxExecute) {
        message.warning('当前环境不支持沙箱执行（非 Electron 环境）')
        return
      }
      const hide = message.loading('准备沙箱环境...', 0)
      try {
        // 查找现有沙箱（复用 RUNNING 状态的沙箱）
        let sandboxId: string | null = null
        if (api.sandboxList) {
          const listResult = await api.sandboxList(10)
          if (listResult && 'items' in listResult && Array.isArray(listResult.items)) {
            const ready = listResult.items.find((s) => s.status === 'RUNNING')
            if (ready) sandboxId = ready.id
          }
        }
        if (!sandboxId) {
          const createResult = await api.sandboxCreate()
          if (!createResult || 'success' in createResult) {
            const err = createResult as { success: false; error: string } | null
            throw new Error(`沙箱创建失败：${err?.error || '未知错误'}`)
          }
          if (!createResult.id) throw new Error('沙箱创建返回无效 ID')
          sandboxId = createResult.id
        }

        // 执行命令
        const execResult = await api.sandboxExecute(sandboxId, payload)
        hide()
        if (!execResult || 'success' in execResult) {
          const err = execResult as { success: false; error: string } | null
          throw new Error(err?.error || '沙箱执行返回未知错误')
        }
        if (execResult.exitCode === 0) {
          message.success(`沙箱执行成功（耗时 ${execResult.durationMs ?? 0}ms）`)
        } else {
          message.warning(`沙箱执行完成（exit=${execResult.exitCode}）`)
        }
      } catch (err) {
        hide()
        const reason = err instanceof Error ? err.message : String(err)
        message.error(`沙箱执行失败：${reason}`)
      }
      return
    }

    // 4.2 SSH 命令执行：runInTerminal / execute / rollback / rollbackExec
    if (!activeSessionId) {
      message.warning('该功能需要连接 SSH 服务器后使用')
      return
    }
    if (!api?.sshExec) {
      message.warning('当前环境不支持 SSH 执行（非 Electron 环境）')
      return
    }

    const hide = message.loading(`正在执行命令：${payload}`, 0)
    try {
      const result = await api.sshExec(activeSessionId, payload)
      hide()
      if (result.exitCode === 0) {
        message.success(`命令执行成功（耗时 ${result.duration}ms）`)
      } else {
        message.warning(`命令执行完成（exit=${result.exitCode}）`)
      }
    } catch (err) {
      hide()
      const reason = err instanceof Error ? err.message : String(err)
      message.error(`命令执行失败：${reason}`)
    }
  }

  /** 处理消息中的导航操作（查看监控/记录决策/更新知识库） */
  const handleMessageNavigate = (path: string) => {
    navigate(path)
  }

  return (
    <div className="wb-aipanel flex h-full min-h-0 w-[560px] shrink-0 flex-col overflow-hidden border-l border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-default)]">
      {/* ===== 标题栏 40px ===== */}
      <AIPanelHeader
        onClose={onClose}
        isStreaming={isStreaming}
        hasLiveConversation={hasLiveConversation}
        showTranslation={showTranslation}
        setShowTranslation={setShowTranslation}
        onClear={() => {
          clear()
        }}
      />

      {/* ===== 消息滚动区 ===== */}
      <MessageList
        providers={providers}
        navigate={navigate}
        hasLoopRunning={hasLoopRunning}
        activeSessionId={activeSessionId}
        loop={loop}
        paorApprovals={paorApprovals}
        onPaorApprove={handlePaorApprove}
        messagesEndRef={messagesEndRef}
        hasLiveConversation={hasLiveConversation}
        liveMessages={liveMessages}
        lastError={lastError}
        isStreaming={isStreaming}
        onToolAction={handleToolAction}
        onMessageNavigate={handleMessageNavigate}
      />

      {/* ===== Composer（chips + 输入框 + 工具栏） ===== */}
      <Composer
        isStreaming={isStreaming}
        loop={loop}
        paor={paor}
        activeSessionId={activeSessionId}
        providers={providers}
        selectedProviderId={selectedProviderId}
        setSelectedProviderId={setSelectedProviderId}
        tokenStats={tokenStats}
        send={send}
        cancel={cancel}
        onCompressContext={compressContext}
      />

      {/* Token/成本统计行已移除 — 设计稿无此区域，节省垂直空间 */}
    </div>
  )
}

export default AIPanel
