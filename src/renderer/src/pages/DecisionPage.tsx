/**
 * DecisionPage — 可信决策内核入口页（活跃决策态 / 历史列表态）
 *
 * 路由：/decision
 *
 * 设计稿：参考资料/前端设计/pages/AI可信决策.html
 *
 * 两个状态：
 * 1. 活跃决策态：有 loop 正在运行时（correlationId 非空），订阅 onLoopStep /
 *    onLoopDecision / onLoopDone / onLoopError / onLoopBlocked，展示实时决策进度
 *    （置信度仪表 + 命令决策终端 + 7 步时间线 + 六源证据融合面板）
 * 2. 历史列表态：无活跃决策时，调用 historyList 展示最近 20 条决策卡片，点击跳转
 *    /decision/:id
 *
 * 数据来源：
 * - window.electronAPI.historyList(offset, limit) — 历史列表
 * - window.electronAPI.onLoopStep/onLoopDecision/onLoopDone/onLoopError/onLoopBlocked — 事件流
 * - window.electronAPI.loopConfirm / loopCancel — 决策审批
 *
 * 复用组件（Task 1 抽离）：
 * - ConfidenceGauge / LoadingState / ErrorState / ApprovalStateMachine /
 *   EvidenceRadar / EvidenceList
 *
 * 复用工具函数（Task 1 抽离）：
 * - buildEvidenceSources / buildTimelineSteps / buildRiskGates / buildDangerCommands /
 *   parseCommandSegments / riskLevelMeta
 *
 * Token 合规：所有颜色使用 var(--trae-*) 或 var(--bg-brand)，无硬编码。
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal, Input } from 'antd'
import {
  Sparkles, ArrowLeft, Fingerprint, Clock, Activity,
  AlertTriangle, Terminal, Check, X, Edit3, History,
} from 'lucide-react'
import { ConfidenceGauge } from '@/components/decision/ConfidenceGauge'
import { LoadingState } from '@/components/decision/LoadingState'
import { ErrorState } from '@/components/decision/ErrorState'
import { ApprovalStateMachine } from '@/components/decision/ApprovalStateMachine'
import { EvidenceRadar } from '@/components/decision/EvidenceRadar'
import { EvidenceList } from '@/components/decision/EvidenceList'
import {
  riskLevelMeta,
  parseCommandSegments,
  buildEvidenceSources,
  buildTimelineSteps,
  buildRiskGates,
  buildDangerCommands,
} from '@/utils/decision-mappers'
import type { DecisionCard } from '@shared/models'

// ============================================================================
// 类型定义
// ============================================================================

/** loop:step 事件载荷的 state 子结构（与 electron.d.ts 同步） */
interface LoopStepState {
  currentStep: 'collect' | 'analyze' | 'reason' | 'check' | 'confirm' | 'execute' | 'verify'
  completedSteps: string[]
  stepDetails: Record<string, string>
  waitingForConfirmation: boolean
  decisionCard: unknown | null
  error: string | null
  timestamp: number
}

/** loop:blocked 事件载荷 */
interface LoopBlockedPayload {
  type: 'loop:blocked'
  correlationId: string
  step: string
  reason: string
  message: string
}

/** loop 错误载荷 */
interface LoopErrorPayload {
  type: 'loop:error'
  correlationId: string
  error: string
}

// ============================================================================
// 类型守卫
// ============================================================================

/** 校验 unknown 是否为 DecisionCard（结构最小校验，避免 any） */
function isDecisionCard(value: unknown): value is DecisionCard {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.problem === 'string' &&
    typeof v.confidence === 'number' &&
    typeof v.fixCommand === 'string' &&
    typeof v.timestamp === 'number'
  )
}

// ============================================================================
// 子组件
// ============================================================================

/** 历史决策卡片：决策ID + 时间 + 场景 + 置信度 + 状态 */
function HistoryCard({ card, onClick }: { card: DecisionCard; onClick: () => void }) {
  const ts = new Date(card.timestamp)
  const timeStr = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}:${String(ts.getSeconds()).padStart(2, '0')}`
  const riskMeta = riskLevelMeta(card.risk.level)
  const statusText: Record<DecisionCard['status'], string> = {
    pending: '待审批',
    approved: '已批准',
    rejected: '已拒绝',
    executed: '已执行',
    verified: '已验证',
    failed: '执行失败',
  }
  const statusClass: Record<DecisionCard['status'], string> = {
    pending: 'border-[var(--trae-status-alert-default)] bg-[rgba(210,157,0,0.12)] text-[var(--trae-status-alert-default)]',
    approved: 'border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] text-[var(--trae-text-brand)]',
    rejected: 'border-[var(--trae-status-error-default)] bg-[rgba(246,90,90,0.12)] text-[var(--trae-status-error-default)]',
    executed: 'border-[var(--trae-status-success-default)] bg-[rgba(51,193,146,0.12)] text-[var(--trae-status-success-default)]',
    verified: 'border-[var(--trae-status-success-default)] bg-[rgba(51,193,146,0.12)] text-[var(--trae-status-success-default)]',
    failed: 'border-[var(--trae-status-error-default)] bg-[rgba(246,90,90,0.12)] text-[var(--trae-status-error-default)]',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col gap-2 rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] p-4 text-left transition-colors hover:border-[var(--trae-border-brand)] hover:bg-[var(--trae-bg-overlay-l2)]"
      aria-label={`查看决策 ${card.id} 详情`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Fingerprint className="h-3 w-3 text-[var(--trae-text-secondary)]" />
          <span className="font-mono text-[11px] font-medium tabular-nums text-[var(--trae-text-default)]">
            #{card.id}
          </span>
        </div>
        <span className={`inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border px-2 text-[10px] font-medium ${statusClass[card.status]}`}>
          {statusText[card.status]}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[12px] text-[var(--trae-text-default)]">
        <Activity className="h-3 w-3 text-[var(--trae-text-secondary)]" />
        <span className="truncate">{card.problem.slice(0, 40) || '未命名场景'}</span>
      </div>
      <div className="flex items-center justify-between gap-3 text-[10px] text-[var(--trae-text-tertiary)]">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3" />
          <span className="font-mono tabular-nums">{timeStr}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="text-[var(--trae-text-tertiary)]">置信度</span>
            <span className="font-mono font-medium tabular-nums text-[var(--trae-text-brand)]">
              {card.confidence.toFixed(2)}
            </span>
          </span>
          <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l1)] px-2 text-[10px] text-[var(--trae-text-secondary)]">
            {riskMeta.urgency}
          </span>
        </div>
      </div>
    </button>
  )
}

/** 命令决策终端（活跃态简化版：fixCommand + 修复说明 + 三按钮） */
function CommandTerminal({
  card,
  waiting,
  confirming,
  onAccept,
  onModify,
  onReject,
}: {
  card: DecisionCard
  waiting: boolean
  confirming: boolean
  onAccept: () => void
  onModify: () => void
  onReject: () => void
}) {
  const segments = parseCommandSegments(card.fixCommand)
  const disabled = confirming || !waiting
  return (
    <div className="flex min-w-[340px] flex-1 flex-col overflow-hidden rounded-[var(--trae-radius-10)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)]">
      {/* 终端 header */}
      <div className="flex items-center gap-2 border-b border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--trae-status-error-default)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--trae-status-alert-default)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--trae-status-success-default)]" />
        </div>
        <div className="flex items-center gap-1.5">
          <Terminal className="h-3 w-3 text-[var(--trae-text-secondary)]" />
          <span className="font-mono text-[10px] text-[var(--trae-text-secondary)]">
            决策命令 · #{card.id}
          </span>
        </div>
        {waiting && (
          <span className="ml-auto inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-2 text-[10px] font-medium text-[var(--trae-text-brand)]">
            等待确认
          </span>
        )}
      </div>
      {/* 命令展示 */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-default)] px-4 py-3 font-mono text-[14px] leading-[1.8]">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-[var(--trae-text-tertiary)]">$</span>
            <code className="flex-1 break-all">
              {segments.map((seg, i) => (
                <span
                  key={i}
                  className={
                    seg.type === 'name'
                      ? 'text-[var(--trae-text-brand)]'
                      : seg.type === 'flag'
                      ? 'text-[var(--trae-text-default)]'
                      : seg.type === 'path'
                      ? 'text-[var(--trae-text-default)]'
                      : seg.type === 'sym'
                      ? 'text-[var(--trae-text-tertiary)]'
                      : seg.type === 'comment'
                      ? 'text-[var(--trae-text-tertiary)]'
                      : 'text-[var(--trae-text-default)]'
                  }
                >
                  {i > 0 && seg.type !== 'comment' ? ' ' : ''}
                  {seg.text}
                </span>
              ))}
            </code>
          </div>
        </div>
        {card.fixDescription && (
          <p className="text-[11px] leading-[1.6] text-[var(--trae-text-secondary)]">
            {card.fixDescription}
          </p>
        )}
        {/* 三按钮 */}
        <div className="mt-auto flex gap-2">
          <button
            type="button"
            onClick={onAccept}
            disabled={disabled}
            data-dom-id="accept-execute"
            className="btn-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-[var(--trae-radius-4)] bg-[var(--bg-brand)] px-3 py-1.5 text-[12px] font-medium text-[var(--trae-text-onbrand)] transition-colors hover:bg-[var(--bg-brand-hover)] disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            采纳并执行
          </button>
          <button
            type="button"
            onClick={onModify}
            disabled={disabled}
            data-dom-id="modify-cmd"
            className="btn-press inline-flex items-center justify-center gap-1.5 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] px-3 py-1.5 text-[12px] font-medium text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)] disabled:opacity-50"
          >
            <Edit3 className="h-3.5 w-3.5" />
            修改
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={confirming}
            data-dom-id="reject-cmd"
            className="btn-press inline-flex items-center justify-center gap-1.5 rounded-[var(--trae-radius-4)] border border-[var(--trae-status-error-default)] bg-[rgba(246,90,90,0.06)] px-3 py-1.5 text-[12px] font-medium text-[var(--trae-status-error-default)] transition-colors hover:bg-[rgba(246,90,90,0.12)] disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            拒绝
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// DecisionPage 主组件
// ============================================================================

export function DecisionPage() {
  const navigate = useNavigate()

  // ===== 活跃决策态 state =====
  const [correlationId, setCorrelationId] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState<LoopStepState['currentStep'] | null>(null)
  const [decisionCard, setDecisionCard] = useState<DecisionCard | null>(null)
  const [waitingForConfirmation, setWaitingForConfirmation] = useState(false)
  const [loopError, setLoopError] = useState<string | null>(null)
  const [loopBlocked, setLoopBlocked] = useState<LoopBlockedPayload | null>(null)
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const [modifyModalOpen, setModifyModalOpen] = useState(false)
  const [modifyCommand, setModifyCommand] = useState('')
  const [confirming, setConfirming] = useState(false)

  // ===== 历史列表态 state =====
  const [historyCards, setHistoryCards] = useState<DecisionCard[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)

  /** 加载历史决策列表 */
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    setHistoryError(null)
    if (!window.electronAPI?.historyList) {
      setHistoryCards([])
      setHistoryLoading(false)
      return
    }
    try {
      const cards = await window.electronAPI.historyList(0, 20)
      setHistoryCards(cards)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载决策历史失败'
      setHistoryError(msg)
      console.warn('[DecisionPage] historyList failed:', err)
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  /** 显示操作反馈（2 秒后清除） */
  const showFeedback = useCallback((text: string) => {
    setActionFeedback(text)
    window.setTimeout(() => setActionFeedback(null), 2000)
  }, [])

  // ===== mount 时加载历史 + 订阅 loop 事件 =====
  useEffect(() => {
    void loadHistory()

    // IPC 不可用时不订阅（spec：禁止 mock fallback）
    if (!window.electronAPI) return

    const unsubs: Array<() => void> = []

    // loop:step — 步骤变化
    if (window.electronAPI.onLoopStep) {
      unsubs.push(
        window.electronAPI.onLoopStep((payload) => {
          setCorrelationId(payload.correlationId)
          setCurrentStep(payload.state.currentStep)
          setWaitingForConfirmation(payload.state.waitingForConfirmation)
          setLoopError(payload.state.error)
          // 决策卡片类型守卫：unknown → DecisionCard | null
          if (payload.state.decisionCard && isDecisionCard(payload.state.decisionCard)) {
            setDecisionCard(payload.state.decisionCard)
          }
          // 收到 step 事件时清除 blocked 状态（functional update 避免 stale closure）
          setLoopBlocked((prev) => (prev ? null : prev))
        }),
      )
    }

    // loop:decision — 决策卡片就绪
    if (window.electronAPI.onLoopDecision) {
      unsubs.push(
        window.electronAPI.onLoopDecision((payload) => {
          if (payload.decisionCard && isDecisionCard(payload.decisionCard)) {
            setDecisionCard(payload.decisionCard)
          }
        }),
      )
    }

    // loop:done — 工作流完成
    if (window.electronAPI.onLoopDone) {
      unsubs.push(
        window.electronAPI.onLoopDone(() => {
          showFeedback('决策工作流已完成')
          // 完成后刷新历史列表 + 退出活跃态（保留 decisionCard 5 秒让用户看到最终结果）
          void loadHistory()
          window.setTimeout(() => {
            setCorrelationId(null)
            setCurrentStep(null)
            setDecisionCard(null)
            setWaitingForConfirmation(false)
          }, 5000)
        }),
      )
    }

    // loop:error — 工作流错误
    if (window.electronAPI.onLoopError) {
      unsubs.push(
        window.electronAPI.onLoopError((payload: LoopErrorPayload) => {
          setLoopError(payload.error)
          showFeedback(`决策工作流出错：${payload.error}`)
          void loadHistory()
        }),
      )
    }

    // loop:blocked — 工作流被阻止
    if (window.electronAPI.onLoopBlocked) {
      unsubs.push(
        window.electronAPI.onLoopBlocked((payload: LoopBlockedPayload) => {
          setLoopBlocked(payload)
          showFeedback(payload.message)
          void loadHistory()
        }),
      )
    }

    // 清理所有订阅
    return () => {
      for (const unsub of unsubs) {
        try {
          unsub()
        } catch (err) {
          console.warn('[DecisionPage] unsubscribe failed:', err)
        }
      }
    }
  }, [])

  // ===== 决策审批回调 =====

  /** 采纳并执行：调用 loopConfirm(correlationId, true) */
  const handleAccept = useCallback(async () => {
    if (!correlationId || !decisionCard) return
    setConfirming(true)
    try {
      if (window.electronAPI?.loopConfirm) {
        const ok = await window.electronAPI.loopConfirm(correlationId, true)
        if (ok) {
          showFeedback('已采纳执行：等待主进程执行')
        } else {
          showFeedback('审批未通过：主进程拒绝执行')
        }
      } else {
        showFeedback('IPC 桥接不可用：无法执行审批')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showFeedback(`审批调用失败：${msg}`)
      console.warn('[DecisionPage] loopConfirm accept failed:', err)
    } finally {
      setConfirming(false)
    }
  }, [correlationId, decisionCard, showFeedback])

  /** 打开修改弹窗 */
  const handleModifyOpen = useCallback(() => {
    if (!decisionCard) return
    setModifyCommand(decisionCard.fixCommand)
    setModifyModalOpen(true)
  }, [decisionCard])

  /** 确认修改后的 fixCommand 并提交审批 */
  const handleModifyConfirm = useCallback(async () => {
    if (!correlationId || !decisionCard || !modifyCommand.trim()) return
    setConfirming(true)
    try {
      const trimmed = modifyCommand.trim()
      if (window.electronAPI?.loopConfirm) {
        await window.electronAPI.loopConfirm(correlationId, true, trimmed)
      }
      // 同步本地 fixCommand（IPC 降级路径）
      setDecisionCard((prev) => (prev ? { ...prev, fixCommand: trimmed } : prev))
      showFeedback(`已修改命令并提交：${trimmed.slice(0, 40)}`)
      setModifyModalOpen(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showFeedback(`修改命令提交失败：${msg}`)
      console.warn('[DecisionPage] loopConfirm modify failed:', err)
    } finally {
      setConfirming(false)
    }
  }, [correlationId, decisionCard, modifyCommand, showFeedback])

  /** 拒绝决策：调用 loopConfirm(correlationId, false) 或 loopCancel */
  const handleReject = useCallback(async () => {
    if (!correlationId || !decisionCard) return
    setConfirming(true)
    try {
      if (window.electronAPI?.loopConfirm) {
        const ok = await window.electronAPI.loopConfirm(correlationId, false)
        if (ok) {
          showFeedback('已拒绝该决策')
        } else {
          showFeedback('拒绝失败：主进程未响应')
        }
      } else if (window.electronAPI?.loopCancel) {
        await window.electronAPI.loopCancel(correlationId)
        showFeedback('已取消该决策工作流')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showFeedback(`拒绝调用失败：${msg}`)
      console.warn('[DecisionPage] loopConfirm reject failed:', err)
    } finally {
      setConfirming(false)
    }
  }, [correlationId, decisionCard, showFeedback])

  // ===== 渲染 =====

  const isActive = correlationId !== null

  return (
    <main className="flex h-full w-full flex-col overflow-y-auto bg-[var(--trae-bg-base-default)]">
      {/* ===== Header ===== */}
      <header className="flex flex-col gap-4 px-8 pb-4 pt-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Sparkles className="h-6 w-6 shrink-0 text-[var(--bg-brand)]" />
            <div className="flex flex-col gap-0.5">
              <span className="text-[24px] font-semibold leading-[32px] text-[var(--trae-text-default)]">
                可信决策内核
              </span>
              <span className="text-[11px] text-[var(--trae-text-tertiary)]">
                Human-in-the-Loop · 可解释 · 可审计
                {isActive && correlationId && (
                  <span className="ml-2 font-mono text-[var(--trae-text-brand)]">
                    · #{correlationId.slice(0, 12)}
                  </span>
                )}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/workbench')}
            data-dom-id="back-workbench"
            aria-label="返回工作台"
            className="inline-flex h-7 items-center gap-1.5 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] px-2.5 text-[11px] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回工作台
          </button>
        </div>

        {/* 活跃决策态摘要条 */}
        {isActive && decisionCard && (
          <div className="flex flex-wrap items-center gap-3 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-3 py-2">
            <div className="flex items-center gap-1.5">
              <Activity className="h-3 w-3 text-[var(--trae-text-brand)]" />
              <span className="text-[10px] text-[var(--trae-text-secondary)]">当前步骤</span>
              <span className="font-mono text-[12px] font-medium tabular-nums text-[var(--trae-text-brand)]">
                {currentStep ?? '—'}
              </span>
            </div>
            <span className="h-3.5 w-px bg-[var(--trae-border-neutral-l2)]" />
            <div className="flex items-center gap-1.5">
              <Fingerprint className="h-3 w-3 text-[var(--trae-text-secondary)]" />
              <span className="text-[10px] text-[var(--trae-text-secondary)]">决策ID</span>
              <span className="font-mono text-[12px] font-medium tabular-nums text-[var(--trae-text-default)]">
                #{decisionCard.id}
              </span>
            </div>
            <span className="h-3.5 w-px bg-[var(--trae-border-neutral-l2)]" />
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-[var(--trae-text-tertiary)]">场景</span>
              <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-2 text-[10px] font-medium text-[var(--trae-text-brand)]">
                {decisionCard.problem.slice(0, 24) || '未命名场景'}
              </span>
            </div>
            {loopBlocked && (
              <span className="ml-auto inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-status-alert-default)] bg-[rgba(210,157,0,0.12)] px-2 text-[10px] font-medium text-[var(--trae-status-alert-default)]">
                阻塞 · {loopBlocked.step}
              </span>
            )}
          </div>
        )}
      </header>

      {/* ===== 主体内容 ===== */}
      {isActive ? (
        // ---------- 活跃决策态 ----------
        loopError ? (
          <ErrorState message={`决策工作流出错：${loopError}`} onRetry={() => void loadHistory()} />
        ) : !decisionCard ? (
          <LoadingState />
        ) : (
          <>
            {/* 区域2：置信度仪表 + 命令决策终端 */}
            <section className="flex flex-wrap items-stretch gap-6 px-8 pb-4">
              <ConfidenceGauge value={decisionCard.confidence} sources={buildEvidenceSources(decisionCard.evidences)} />
              <CommandTerminal
                card={decisionCard}
                waiting={waitingForConfirmation}
                confirming={confirming}
                onAccept={() => void handleAccept()}
                onModify={handleModifyOpen}
                onReject={() => void handleReject()}
              />
            </section>

            {/* 区域4+5：7 步时间线 + 四层风险控制 */}
            <section className="px-8 pb-6">
              <ApprovalStateMachine
                steps={buildTimelineSteps(decisionCard)}
                gates={buildRiskGates(decisionCard)}
              />
            </section>

            {/* 区域3：六源证据融合面板（雷达图 + 拦截清单） */}
            <section className="px-8 pb-6">
              <div className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] p-6">
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-[var(--bg-brand)]" />
                    <span className="text-[16px] font-semibold text-[var(--trae-text-default)]">六源证据融合</span>
                    <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-2 text-[10px] font-medium text-[var(--trae-text-brand)]">
                      D-S 证据理论
                    </span>
                  </div>
                  <span className="text-[10px] text-[var(--trae-text-tertiary)]">
                    Dempster-Shafer · 透明可追溯
                  </span>
                </div>
                <div className="flex flex-col gap-8 lg:flex-row">
                  <EvidenceRadar sources={buildEvidenceSources(decisionCard.evidences)} />
                  <div className="flex-1">
                    <EvidenceList
                      commands={buildDangerCommands(decisionCard)}
                      defaultExpanded={false}
                    />
                  </div>
                </div>
              </div>
            </section>
          </>
        )
      ) : (
        // ---------- 历史列表态 ----------
        historyLoading ? (
          <LoadingState />
        ) : historyError ? (
          <ErrorState message={historyError} onRetry={() => void loadHistory()} />
        ) : historyCards.length === 0 ? (
          <div className="flex h-[400px] flex-col items-center justify-center gap-4">
            <AlertTriangle className="h-8 w-8 text-[var(--trae-text-tertiary)]" />
            <span className="text-[13px] text-[var(--trae-text-secondary)]">
              暂无决策记录
            </span>
            <button
              type="button"
              onClick={() => navigate('/workbench')}
              className="btn-press inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] px-3 text-[12px] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回工作台触发首次决策
            </button>
          </div>
        ) : (
          <section className="px-8 pb-8">
            <div className="mb-4 flex items-center gap-2">
              <History className="h-4 w-4 text-[var(--bg-brand)]" />
              <span className="text-[16px] font-semibold text-[var(--trae-text-default)]">最近决策</span>
              <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l1)] px-2 text-[10px] text-[var(--trae-text-secondary)]">
                {historyCards.length} 条
              </span>
              <span className="text-[10px] text-[var(--trae-text-tertiary)]">
                点击卡片查看完整决策详情
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {historyCards.map((card) => (
                <HistoryCard
                  key={card.id}
                  card={card}
                  onClick={() => navigate(`/decision/${card.id}`)}
                />
              ))}
            </div>
          </section>
        )
      )}

      {/* ===== 修改命令弹窗 ===== */}
      <Modal
        title="修改修复命令"
        open={modifyModalOpen}
        onOk={() => void handleModifyConfirm()}
        onCancel={() => setModifyModalOpen(false)}
        okText="提交审批"
        cancelText="取消"
        confirmLoading={confirming}
        okButtonProps={{ disabled: !modifyCommand.trim() }}
      >
        <div className="py-2">
          <p className="mb-2 text-[12px] text-[var(--trae-text-secondary)]">
            修改后的命令将通过 loopConfirm 提交主进程执行。
          </p>
          <Input.TextArea
            value={modifyCommand}
            onChange={(e) => setModifyCommand(e.target.value)}
            autoSize={{ minRows: 3, maxRows: 8 }}
            placeholder="请输入修改后的修复命令"
            className="font-mono"
          />
        </div>
      </Modal>

      {/* ===== 操作反馈浮层 ===== */}
      {actionFeedback && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-4 py-2 text-[12px] font-medium text-[var(--trae-text-brand)] shadow-lg">
          {actionFeedback}
        </div>
      )}
    </main>
  )
}
