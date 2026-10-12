/**
 * AIPanel — 右侧 AI 停靠格（宽度由 shell/workbench-layout 的 Panel 管，可拖）
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
 * - P1 修复（2026-07-27）：PAOR 迭代/结果/错误写入消息列表（持久可回看），
 *   不再用 6-10s 自动消失的 toast；假"恢复执行"按钮已移除，"暂停"改为诚实的"停止"
 *
 * 数据：
 * - 实时：useAgentChat / useAgentStore
 * - 可选示例：mock-data.ts MOCK_CHAT_MESSAGES（showDemo）
 * - chips：快捷运维提示词；上下文徽章按选中模型的真实窗口算（#89）
 */
import { useState, useRef, useEffect, type FC } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAgentChat } from './useAgentChat'
import { useLoopEngineering } from './useLoopEngineering'
import { usePaorLoop } from './usePaorLoop'
import { useServerStore } from '@/stores/server-store'
import { useAgentStore } from '@/stores/agent-store'
import { useTerminalStore } from '@/stores/terminal-store'
// v2.6 命令前置环境预检（与主进程 ssh_readonly 共用的纯函数）
import { extractCommandNames, buildMissingCheckScript, parseMissingOutput } from '@shared/command-preflight'
import { buildHistorySaveIntent } from '@/utils/chat-decision'
import type { PaorApprovalRequest } from '@/types/electron'
import './AIPanel.css'
import AIPanelHeader from './AIPanelHeader'
import MessageList from './MessageList'
import Composer from './Composer'
import { PermissionBar } from '@/dock/permission-bar'
import { resolveShellForCommand, runAuthoredInShell } from '@/terminal/shell-launcher'

/** AIPanel props */
export interface AIPanelProps {
  /** 收起 AI 面板回调 */
  onClose?: () => void
}

/**
 * AIPanel 右侧 AI 停靠格
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

  /** P1 修复：PAOR 进展/结果写入消息列表（而非 toast 一闪而过） */
  const addAgentMessage = useAgentStore((s) => s.addMessage)

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
   * 监听 PAOR 迭代进度，写入消息列表（P1 修复）
   *
   * 每轮迭代（Plan→Act→Observe→Reflect）完成后追加一条 assistant 消息：
   * - 显示迭代序号 + 执行命令 + 观察状态 + 反思决策
   * - 高危命令被拦截时显示 riskBlocked 提示
   *
   * 旧实现用 message.info toast（6 秒自动消失），用户错过就永远看不到结果；
   * 现在写入 useAgentStore 消息列表，持久可回看。
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
    // 状态用词不用表情：这些文本会进 markdown 消息与决策记录，
    // 屏幕阅读器念不出符号，复制出去也容易变乱码
    const statusWord =
      latest.riskBlocked
        ? '已拦截'
        : latest.observe.status === 'success'
          ? '成功'
          : latest.observe.status === 'partial'
            ? '部分完成'
            : '失败'
    const decisionMap: Record<string, string> = {
      continue: '继续下一步',
      retry: '重试当前步骤',
      abort: '中止循环',
      done: '任务完成',
      replan: '回退重新规划',
    }
    const decisionText = decisionMap[latest.reflect.decision] ?? latest.reflect.decision
    addAgentMessage({
      id: `paor_iter_${latest.iteration}_${Date.now()}`,
      role: 'assistant',
      content: `**PAOR 迭代 ${latest.iteration} · ${statusWord}**\n\n- 命令：\`${cmdPreview}\`${latest.riskBlocked ? '（高危命令已拦截）' : ''}\n- 观察：${latest.observe.status}\n- 决策：${decisionText}`,
      timestamp: Date.now(),
    })
  }, [paor.iterations, addAgentMessage])

  /** PAOR 完成时把最终摘要写入消息列表（P1 修复：不再用 10s toast） */
  useEffect(() => {
    if (!paor.result) return
    const statusMap: Record<string, string> = {
      done: '计划完成',
      abort: '已中止',
      max_iterations: '达到迭代上限',
      blocked: '重规划耗尽仍受阻',
    }
    const statusText = statusMap[paor.result.status] ?? paor.result.status
    addAgentMessage({
      id: `paor_result_${Date.now()}`,
      role: 'assistant',
      content: `**PAOR 循环结束** ${statusText}\n\n- 迭代轮次：${paor.result.iterations.length}\n- 耗时：${(paor.result.durationMs / 1000).toFixed(1)}s\n\n**摘要**：${paor.result.summary}`,
      timestamp: Date.now(),
    })
  }, [paor.result, addAgentMessage])

  /** PAOR 出错时写入消息列表（标记 isError，错误必须上屏且可回看） */
  useEffect(() => {
    if (!paor.error) return
    addAgentMessage({
      id: `paor_error_${Date.now()}`,
      role: 'assistant',
      content: `[错误] PAOR 循环失败：${paor.error}`,
      timestamp: Date.now(),
      isError: true,
    })
  }, [paor.error, addAgentMessage])

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
    if (!scrollContainer) return
    // v2.4 修复（流式滚动抽摞）：流式期间用 'auto'（即时置底），不要用 'smooth'。
    // smooth 在每个 token 都重启一次平滑动画、互相打断 → 视觉抽摞；
    // auto 每帧瞬时贴底，配合 rAF 批处理，观感反而顺滑。仅流式结束后用一次 smooth。
    const behavior: ScrollBehavior = isStreaming ? 'auto' : 'smooth'
    // v2.11 修复“输入框被顶不丝滑”：仅当用户已在底部附近才跟随置底。
    // 若用户上滚阅读历史（距底 > 160px），尊重其位置、不强行拽回底部。
    const distanceToBottom =
      scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight
    if (distanceToBottom > 160) return
    const raf = requestAnimationFrame(() => {
      scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior })
    })
    return () => cancelAnimationFrame(raf)
  }, [liveMessages, hasLiveConversation, isStreaming, hasLoopRunning, loop.phase, loop.workflowState, loop.decisionCard, loop.finalCard])

  /** 处理工具面板操作（在终端运行/执行/回滚/停止/终止）
   *
   * Wire-2（2026-07-22）：真实 IPC 接线
   * - copyCommand: 复制命令到剪贴板
   * - runInTerminal / execute / rollback / rollbackExec: 走 run-authored（A1：整条代写命令
   *   必须在主进程过风险闸，block 级直接拒），命令与回显在终端全程可见；
   *   写入前先发 Ctrl+U 清理半截输入，并登记预测回显（v2.5）
   * - pauseExec / terminateTask: 调用 agentChatCancel(currentCorrelationId) 取消流
   * - resumeExec: 当前 IPC 不支持恢复，提示用户重新发送
   * - sandbox: v2.5 已全量移除沙箱功能，存量 block 数据的沙箱动作降级为提示
   *
   * 非 Electron 环境降级为提示消息，UI 不崩溃。
   */
  const handleToolAction = async (action: string, payload?: string) => {
    // 1. 复制命令：直接写入剪贴板
    if (action === 'copyCommand') {
      if (payload) {
        try {
          await navigator.clipboard.writeText(payload)
          toast.success('命令已复制到剪贴板')
        } catch {
          toast.error('复制失败，请手动选择文本')
        }
      }
      return
    }

    // 2. 停止 / 终止任务：取消当前 agent chat 流
    // P1 修复：后端无"暂停/恢复"能力，pauseExec 实为终止；文案统一为"停止"，不再谎称"已暂停"
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
        toast('已停止当前任务（如需继续请重新发送消息）')
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        toast.error(`操作失败：${reason}`)
      }
      return
    }

    // 3. resumeExec：后端无恢复能力，假"恢复执行"按钮已从 PausePanel 移除；
    //    保留此分支兼容存量 block 数据，诚实告知用户重新发送
    if (action === 'resumeExec') {
      toast('当前不支持恢复已停止的任务，请重新发送消息')
      return
    }

    // 4. 命令类操作（runInTerminal / execute / rollback / rollbackExec）必须有 payload
    if (!payload) {
      toast.warning('未找到可执行的命令')
      return
    }

    const api = window.electronAPI

    // 4.1 沙箱功能已全量移除（v2.5）：存量 block 数据的沙箱动作降级为提示
    if (action === 'sandbox') {
      toast('沙箱功能已移除，请使用“在终端执行”')
      return
    }

    // 4.2 SSH 命令执行：runInTerminal / execute / rollback / rollbackExec
    // v2.5 改造：从后台 sshExec（只弹 toast，用户看不到输出）改为写入终端 Shell，
    // 命令与回显直接出现在终端里，用户全程可见、可中断（Ctrl+C）。
    // 命令投进"该去的那个终端"：当前活跃终端（本机或远端都算）→ 当前会话上顺手开一个
    // → 没连服务器就开一条本机终端。用户点的是"在终端执行"，先让他去找按钮、
    // 或者因为"没连 SSH"就拒绝本机命令，都是把成本推回去。
    const target = await resolveShellForCommand(activeSessionId)
    if (!target.ok) {
      toast.error(`没能为这条命令准备终端：${target.reason}`)
      return
    }
    const shell = target.shell

    // v2.6 前置环境预检：发送到终端前先确认命令在服务器上存在（command -v），
    // 缺失时阻断并明确提示；预检自身失败 fail-open 照常发送。
    // 只对远端终端做：本机终端要查的就是本机，用户自己机器上有没有这条命令不该由这里断。
    const preflightNames = extractCommandNames(payload)
    if (shell.kind === 'ssh' && preflightNames.length > 0 && api.sshExec && shell.sessionId) {
      try {
        const pre = await api.sshExec(shell.sessionId, buildMissingCheckScript(preflightNames))
        const missing = parseMissingOutput(pre.stdout)
        if (missing.length > 0) {
          toast.error(`前置检查未通过：服务器缺少命令 ${missing.join('、')}，已取消发送（可先安装对应软件包）`)
          return
        }
      } catch (err) {
        // fail-open：预检失败不阻塞用户批准的执行
        console.warn('[AIPanel] 命令前置预检失败，照常发送', err)
      }
    }

    try {
      // v2.5 预测回显：先登记到 terminal-store（终端顶部回显条立即可见），
      // 再发 Ctrl+U 清掉 shell 当前行可能的半截输入，避免命令拼接乱码
      useTerminalStore.getState().setPendingCommand({ command: payload, sentAt: Date.now() })
      // 走 run-authored 而不是裸 shell write：命令由 AI 起草，主进程要过风险闸
      await runAuthoredInShell(shell, payload)
      toast.success('命令已发送到终端，请在终端查看回显')

      // v2.5 决策落库：用户批准执行 = 一次真实决策（AI 建议 → 人工批准 → 执行），
      // 记入决策历史供 HistoryPage 展示；失败不打断主流程
      void recordChatDecision(payload)
    } catch (err) {
      useTerminalStore.getState().setPendingCommand(null)
      const reason = err instanceof Error ? err.message : String(err)
      toast.error(`命令发送失败：${reason}`)
    }
  }

  /** v2.5：把“用户批准执行的命令”作为决策记录落库（history:save）
   *
   * P0-5：这里只交**意图**（命令 + 上下文 + 证据来源 + "用户确实批准执行了"）。
   * 风险等级、置信度、id、时间戳都由主进程判定后写入，
   * 所以渲染层不再有 riskCheck 往返，也无法把风险改低。
   */
  const recordChatDecision = async (command: string): Promise<void> => {
    const api = window.electronAPI
    if (!api?.historySave) return
    try {
      const msgs = useAgentStore.getState().messages
      const lastUser = [...msgs].reverse().find((m) => m.role === 'user') ?? null
      const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant' && !m.isError) ?? null

      await api.historySave(
        buildHistorySaveIntent({
          command,
          userMessage: lastUser,
          assistantMessage: lastAssistant,
          sessionId: activeSessionId,
        })
      )
    } catch (err) {
      // 落库失败不影响命令执行主流程，仅记日志
      console.error('[AIPanel] 决策历史落库失败:', err)
    }
  }

  /** 处理消息中的导航操作（查看监控/记录决策/更新知识库） */
  const handleMessageNavigate = (path: string) => {
    navigate(path)
  }

  return (
    <div className="wb-aipanel relative flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-line bg-canvas">
      {/* ===== 停靠格头部（高度取 --ui-size-panel-header，与另两栏同高） ===== */}
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
        paorPlan={paor.plan}
        paorIterations={paor.iterations}
        paorRunning={paor.isRunning}
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
        send={send}
        cancel={cancel}
        onCompressContext={compressContext}
      />

      {/* 高危命令审批：贴底固定条，默认选中"拒绝"、Esc 即拒（详见 dock/permission-bar.tsx） */}
      <PermissionBar requests={paorApprovals} onRespond={handlePaorApprove} />
    </div>
  )
}

export default AIPanel
