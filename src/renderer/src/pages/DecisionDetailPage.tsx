/**
 * DecisionDetailPage — AI 可信决策详情（核心页面）
 *
 * 路由：/decision/:id
 *
 * 设计稿：tdsf-linux-redesign/pages/decision-detail.html
 *
 * 7 个 section + footer：
 * 1. 页头（全站唯一 PageHeader：标题 + 副标题）+ 决策摘要条
 *    （决策 ID + 时间 + 场景 + 紧急程度 + 3 个链接）
 * 2. 核心视觉锚点：大型径向置信度仪表（左）+ 命令决策终端（右）
 * 3. 六源证据融合面板（D-S 证据理论透明化）：EvidenceRadar + PCR5Result
 * 4. 证据溯源链（7 步光路时间线）+ 5. 四层风险控制 → 合并为 ApprovalStateMachine
 * 5.5 高危命令拦截清单 → EvidenceList
 * 6. 决策审计日志 → 满宽一张卡（DecisionAuditLog，#174）
 * Footer: Agent 工作流进度条（7 步 5/7）
 *
 * 数据来源：
 * - window.electronAPI.historyGet(id) 获取决策记录
 * - window.electronAPI.credibilityAssess(inputs) 获取可信度评估（可选）
 */
import { useState, useEffect, useCallback } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button, Dialog, DialogContent, PageHeader, TextArea, confirmDialog } from '@/ui'
import { toast } from 'sonner'
import {
  Sparkles, ArrowLeft, Fingerprint, Clock, Activity,
  FileText, ScrollText, AlertTriangle, FileDown,
} from 'lucide-react'
import { EvidenceRadar } from '@/components/decision/EvidenceRadar'
import { PCR5Result } from '@/components/decision/PCR5Result'
import { ApprovalStateMachine } from '@/components/decision/ApprovalStateMachine'
import { EvidenceList } from '@/components/decision/EvidenceList'
import { DecisionAuditLog, ExecutionResult } from '@/components/decision/ExecutionResult'
import type { AuditChainStatus, AuditRow } from '@/components/decision/ExecutionResult'
import { Empty } from '@/components/trae/Empty'
import { ConfidenceGauge } from '@/components/decision/ConfidenceGauge'
import { LoadingState } from '@/components/decision/LoadingState'
import { ErrorState } from '@/components/decision/ErrorState'
import {
  riskLevelMeta,
  parseCommandSegments,
  buildEvidenceSources,
  buildTimelineSteps,
  buildRiskGates,
  buildDangerCommands,
  auditChainStatus,
  toAuditRows,
  buildWorkflowSteps,
  buildCredibilityInputs,
} from '@/utils/decision-mappers'
import type { DecisionCard } from '@shared/models'
import type { ConfidenceAssessment, ConfidenceProvenance } from '@shared/agent-types'
// v2.6：重新执行接真实终端（与 AIPanel 同路径：预检 + 预测回显 + sshRunAuthored 过主进程风险闸）
import { useServerStore } from '@/stores/server-store'
import { useTerminalStore } from '@/stores/terminal-store'
import { resolveShellForCommand, runAuthoredInShell } from '@/terminal/shell-launcher'
import { extractCommandNames, buildMissingCheckScript, parseMissingOutput } from '@shared/command-preflight'

// 工具函数 / ConfidenceGauge / LoadingState / ErrorState 已抽离到：
// - @/utils/decision-mappers
// - @/components/decision/ConfidenceGauge
// - @/components/decision/LoadingState
// - @/components/decision/ErrorState

/** 空状态元信息（IPC 不可用 / 决策不存在 / 异常时填充） */
interface EmptyMeta {
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
}

/** 渲染空状态：基于 trae/Empty 组件 + 返回工作台按钮 */
function EmptyStateView({ meta, onBack }: { meta: EmptyMeta; onBack: () => void }) {
  const action: ReactNode = (
    <button
      type="button"
      onClick={onBack}
      className="btn-press inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] px-3 text-sm text-ink-dim transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-ink active:bg-hover active:text-ink"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      返回工作台
    </button>
  )
  return (
    <main className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[var(--trae-bg-base-default)]">
      <Empty
        icon={meta.icon}
        title={meta.title}
        description={meta.description}
        action={action}
      />
    </main>
  )
}

// ============================================================================
// DecisionDetailPage 主组件
// ============================================================================

export function DecisionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [card, setCard] = useState<DecisionCard | null>(null)
  const [credibility, setCredibility] = useState<ConfidenceAssessment | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [emptyMeta, setEmptyMeta] = useState<EmptyMeta | null>(null)
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const [modifyModalOpen, setModifyModalOpen] = useState(false)
  const [modifyCommand, setModifyCommand] = useState('')
  const [confirming, setConfirming] = useState(false)
  /** 任务 #174：审计链的行 / 状态 / 断点行号，全部来自库里的 decision_audit */
  const [auditRows, setAuditRows] = useState<AuditRow[]>([])
  const [auditStatus, setAuditStatus] = useState<AuditChainStatus>('unavailable')
  const [auditBrokenAtSeq, setAuditBrokenAtSeq] = useState<number | null>(null)
  /** v2.6：重新执行需要活跃 SSH 会话 */
  const activeSessionId = useServerStore((s) => s.activeSessionId)
  const [rerunning, setRerunning] = useState(false)

  /** 加载决策数据 */
  const loadData = useCallback(async () => {
    if (!id) {
      setError('缺少决策 ID 参数')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    setEmptyMeta(null)

    // Guard: electronAPI 不可用 → 显示空状态提示（spec：禁止 mock fallback）
    if (!window.electronAPI?.historyGet) {
      setCard(null)
      setCredibility(null)
      setEmptyMeta({
        icon: AlertTriangle,
        title: 'IPC 桥接不可用',
        description: '请重启应用以恢复 IPC 通道',
      })
      setLoading(false)
      return
    }

    try {
      const result = await window.electronAPI.historyGet(id)
      if (!result) {
        // 决策记录不存在 → 显示空状态提示（spec：禁止 mock fallback）
        setCard(null)
        setCredibility(null)
        setEmptyMeta({
          icon: Fingerprint,
          title: '暂无决策数据',
          description: `未找到决策记录 #${id}，请先在工作台触发一次决策`,
        })
        setLoading(false)
        return
      }
      setCard(result)

      // 尝试获取可信度评估（可选，失败不影响主流程）
      if (window.electronAPI.credibilityAssess) {
        try {
          const inputs = buildCredibilityInputs(result)
          const assessment = await window.electronAPI.credibilityAssess(inputs)
          setCredibility(assessment)
        } catch {
          // 可信度评估失败不阻塞页面渲染
          setCredibility(null)
        }
      }
    } catch (err) {
      // 加载异常 → 显示错误状态（spec：禁止 mock fallback）
      setCard(null)
      setCredibility(null)
      const message = err instanceof Error ? err.message : '加载决策详情失败'
      setError(message)
      console.warn('[DecisionDetailPage] historyGet failed:', err)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadData()
  }, [loadData])

  /**
   * 任务 #174：审计链读库里那一份，不在渲染层现编事件、也不算哈希。
   *
   * 只按 card.id 走：批准后本地 status 会变，但库里的链在那一刻还没有新行，
   * 跟着整个卡片对象重读只会多打一次 IPC。
   */
  const cardId = card?.id ?? null
  useEffect(() => {
    if (!cardId) {
      setAuditRows([])
      setAuditStatus('unavailable')
      setAuditBrokenAtSeq(null)
      return
    }
    if (!window.electronAPI?.historyAudit) {
      setAuditRows([])
      setAuditStatus('unavailable')
      setAuditBrokenAtSeq(null)
      return
    }
    let cancelled = false
    window.electronAPI
      .historyAudit(cardId)
      .then((view) => {
        if (cancelled) return
        setAuditRows(toAuditRows(view.rows))
        setAuditStatus(auditChainStatus(view))
        setAuditBrokenAtSeq(view.brokenAtSeq)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.warn('[DecisionDetailPage] historyAudit failed:', err)
        setAuditRows([])
        setAuditStatus('unavailable')
        setAuditBrokenAtSeq(null)
      })
    return () => {
      cancelled = true
    }
  }, [cardId])

  /** 显示操作反馈 */
  const handleAction = (action: string) => {
    setActionFeedback(action)
    setTimeout(() => setActionFeedback(null), 2000)
  }

  /**
   * 调用 loopConfirm IPC 进行决策审批
   *
   * preload 签名：loopConfirm(correlationId: string, approved: boolean, newCommand?: string) => Promise<boolean>
   * T.6: 已扩展 newCommand 参数，支持修改修复命令后批准执行。
   *
   * 失败降级：IPC 不可用或调用失败时，回退到本地 card.status 更新 + handleAction 浮层提示
   * 高危二次确认：risk.level ∈ {HIGH, CRITICAL} 时弹 confirmDialog
   */
  const handleApprove = useCallback(async () => {
    if (!card) return
    const isHighRisk = card.risk.level === 'HIGH' || card.risk.level === 'CRITICAL'

    const doApprove = async () => {
      setConfirming(true)
      try {
        if (window.electronAPI?.loopConfirm) {
          const ok = await window.electronAPI.loopConfirm(card.id, true)
          if (ok) {
            setCard((prev) => (prev ? { ...prev, status: 'approved' as const } : prev))
            handleAction('已采纳执行：等待人工审批通过后启动')
          } else {
            handleAction('审批未通过：主进程拒绝执行')
          }
        } else {
          // IPC 通道未暴露 → 降级到本地 state 更新
          setCard((prev) => (prev ? { ...prev, status: 'approved' as const } : prev))
          handleAction('已采纳执行（本地降级）：等待人工审批通过后启动')
        }
      } catch (err) {
        console.warn('[DecisionDetailPage] loopConfirm approve failed:', err)
        // catch 块仅显示错误，不更新 status（避免与"失败"提示不一致）
        handleAction(`审批调用失败：${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setConfirming(false)
      }
    }

    if (isHighRisk) {
      const ok = await confirmDialog({
        title: '确认采纳执行',
        description: `当前决策为「${card.risk.level}」级别风险，确认要采纳执行此命令吗？`,
        okText: '确认执行',
        danger: true,
      })
      if (!ok) return
    }
    void doApprove()
  }, [card])

  /** 拒绝决策执行：调用 loopConfirm(correlationId, false) */
  const handleReject = useCallback(async () => {
    if (!card) return
    const isHighRisk = card.risk.level === 'HIGH' || card.risk.level === 'CRITICAL'

    const doReject = async () => {
      setConfirming(true)
      try {
        if (window.electronAPI?.loopConfirm) {
          const ok = await window.electronAPI.loopConfirm(card.id, false)
          if (ok) {
            setCard((prev) => (prev ? { ...prev, status: 'rejected' as const } : prev))
            handleAction('已拒绝该决策')
          } else {
            handleAction('拒绝失败：主进程未响应')
          }
        } else {
          setCard((prev) => (prev ? { ...prev, status: 'rejected' as const } : prev))
          handleAction('已拒绝该决策（本地降级）')
        }
      } catch (err) {
        console.warn('[DecisionDetailPage] loopConfirm reject failed:', err)
        // catch 块仅显示错误，不更新 status（避免与"失败"提示不一致）
        handleAction(`拒绝调用失败：${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setConfirming(false)
      }
    }

    if (isHighRisk) {
      const ok = await confirmDialog({
        title: '确认拒绝决策',
        description: `当前决策为「${card.risk.level}」级别风险，确认要拒绝此命令吗？`,
        okText: '确认拒绝',
        danger: true,
      })
      if (!ok) return
    }
    void doReject()
  }, [card])

  /** 打开修改弹窗：编辑 fixCommand 字符串 */
  const handleModifyOpen = useCallback(() => {
    if (!card) return
    setModifyCommand(card.fixCommand)
    setModifyModalOpen(true)
  }, [card])



  /**
   * 确认修改后的 fixCommand 并提交审批
   *
   * T.6: loopConfirm 已扩展支持 newCommand 参数。
   * 调用 loopConfirm(card.id, true, trimmed) 将修改后的命令传回主进程执行。
   */
  const handleModifyConfirm = useCallback(async () => {
    if (!card || !modifyCommand.trim()) return
    setConfirming(true)
    try {
      const trimmed = modifyCommand.trim()
      if (window.electronAPI?.loopConfirm) {
        await window.electronAPI.loopConfirm(card.id, true, trimmed)
      }
      // 无论 IPC 是否可用，都同步本地 fixCommand（IPC 降级路径）
      setCard((prev) => (prev ? { ...prev, fixCommand: trimmed, status: 'approved' as const } : prev))
      handleAction(`已修改命令并提交：${trimmed.slice(0, 40)}`)
      setModifyModalOpen(false)
    } catch (err) {
      console.warn('[DecisionDetailPage] loopConfirm modify failed:', err)
      setCard((prev) => (prev ? { ...prev, fixCommand: modifyCommand.trim() } : prev))
      handleAction(`修改命令已本地保存，但主进程同步失败：${err instanceof Error ? err.message : String(err)}`)
      setModifyModalOpen(false)
    } finally {
      setConfirming(false)
    }
  }, [card, modifyCommand])

  /**
   * v2.6：重新在终端执行（历史已执行卡的真实功能，替代对 dec_ 卡无效的审批按钮）
   *
   * 与 AIPanel 「在终端执行」同路径：前置预检（command -v，fail-open）→
   * 预测回显条 → Ctrl+U 清行 + 写入交互 Shell，命令与回显在终端全程可见。
   */
  const handleRerun = useCallback(async () => {
    if (!card) return
    const api = window.electronAPI
    setRerunning(true)
    try {
      // 投进"该去的那个终端"：当前活跃终端（本机或远端）→ 当前会话上顺手开一个 →
      // 没连服务器就开一条本机终端。点"重新执行"却先被要求去连 SSH，是本末倒置。
      const target = await resolveShellForCommand(activeSessionId)
      if (!target.ok) {
        toast.error(`没能为这条命令准备终端：${target.reason}`)
        return
      }
      const shell = target.shell
      // 前置环境预检（缺命令阻断；预检自身失败 fail-open）。
      // 只对远端终端做：本机终端查的就是本机，用户机器上有没有这条命令不该由这里断。
      const names = extractCommandNames(card.fixCommand)
      if (shell.kind === 'ssh' && names.length > 0 && api?.sshExec && shell.sessionId) {
        try {
          const pre = await api.sshExec(shell.sessionId, buildMissingCheckScript(names))
          const missing = parseMissingOutput(pre.stdout)
          if (missing.length > 0) {
            toast.error(`前置检查未通过：服务器缺少命令 ${missing.join('、')}，已取消发送`)
            return
          }
        } catch (err) {
          console.warn('[DecisionDetailPage] 前置预检失败，照常发送', err)
        }
      }
      useTerminalStore.getState().setPendingCommand({ command: card.fixCommand, sentAt: Date.now() })
      // 代写命令（历史上由 AI 起草）→ 走 run-authored，由主进程过风险闸
      await runAuthoredInShell(shell, card.fixCommand)
      toast.success('命令已发送到终端，请到工作台终端查看回显')
    } catch (err) {
      useTerminalStore.getState().setPendingCommand(null)
      toast.error(`发送失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRerunning(false)
    }
  }, [card, activeSessionId])

  /**
   * 导出 HTML 审计报告
   *
   * 调用 credibilityExportAudit IPC 导出 HTML 格式报告。
   * 主进程内部从 DecisionCard 构造简化 AuditReportInput 并导出 HTML 文件。
   * 调用失败时通过 message 提示用户。
   */
  const handleExportHtml = useCallback(async () => {
    if (!card) return
    try {
      const filepath = await window.electronAPI.credibilityExportAudit(card.id, 'html')
      if (filepath) {
        toast.success(`HTML 报告已导出到：${filepath}`)
      } else {
        toast.warning('导出完成但未获取到文件路径')
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      toast.error(`导出 HTML 报告失败：${reason}`)
      console.warn('[DecisionDetailPage] credibilityExportAudit failed:', err)
    }
  }, [card])

  // ===== 状态渲染 =====
  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} onRetry={() => void loadData()} />
  if (!card || emptyMeta) {
    const meta: EmptyMeta = emptyMeta ?? {
      icon: Fingerprint,
      title: '暂无决策数据',
      description: `未找到决策记录 #${id ?? ''}`,
    }
    return <EmptyStateView meta={meta} onBack={() => navigate('/workbench')} />
  }

  // ===== 数据映射 =====
  const riskMeta = riskLevelMeta(card.risk.level)
  // 六源里那一根"模型"轴只能是模型自报的数；以前这里塞的是融合结果，标签却写着"模型"
  const evidenceSources = buildEvidenceSources(card.evidences, card.confidence)
  const timelineSteps = buildTimelineSteps(card)
  const riskGates = buildRiskGates(card)
  const dangerCommands = buildDangerCommands(card)
  const commandSegments = parseCommandSegments(card.fixCommand)
  const workflowSteps = buildWorkflowSteps(card)

  // 置信度：有融合结论就用结论（来源标 fused），否则只有模型自报（来源标 self-reported）
  const displayConfidence = credibility?.confidence ?? card.confidence
  const confidenceProvenance: ConfidenceProvenance = credibility ? 'fused' : 'self-reported'
  // 没有评估就是没有：不许拿模型自报数去顶 m(A) 与 K 的坑（顶上去就等于编了一个融合结论）
  const fusedValue = credibility?.confidence ?? null
  const conflictK = credibility?.conflictLevel ?? null

  // 时间格式化
  const timestamp = new Date(card.timestamp)
  const timeStr = `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, '0')}-${String(timestamp.getDate()).padStart(2, '0')} ${String(timestamp.getHours()).padStart(2, '0')}:${String(timestamp.getMinutes()).padStart(2, '0')}:${String(timestamp.getSeconds()).padStart(2, '0')} CST`

  // 工作流完成计数
  const completedSteps = workflowSteps.filter(s => s.status === 'completed').length

  return (
    <main className="flex h-full w-full flex-col bg-[var(--trae-bg-base-default)]">
      {/* ===== 页头（全站唯一 PageHeader，八个模块左上角对齐）===== */}
      <PageHeader
        icon={Sparkles}
        title="可信决策内核"
        subtitle={`Human-in-the-Loop · 可解释 · 可审计 · #${id}`}
        actions={
          <Button
            variant="outline"
            size="md"
            onClick={() => navigate('/workbench')}
            data-dom-id="back-workbench"
            aria-label="返回工作台"
            style={{ display: 'none' }}
          >
            <ArrowLeft className="size-4" />
            <span>返回工作台</span>
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ===== Section 1: 决策摘要条 ===== */}
        <div className="mx-8 mt-4 mb-4 flex flex-wrap items-center gap-3 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Fingerprint className="h-3 w-3 text-ink-dim" />
            <span className="font-mono text-micro text-ink-dim">决策ID</span>
            <span className="font-mono text-sm font-medium tabular-nums text-ink">
              #{card.id}
            </span>
          </div>
          <span className="h-3.5 w-px bg-[var(--trae-border-neutral-l2)]" />
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3 text-ink-dim" />
            <span className="font-mono text-micro tabular-nums text-ink-dim">
              {timeStr}
            </span>
          </div>
          <span className="h-3.5 w-px bg-[var(--trae-border-neutral-l2)]" />
          <div className="flex items-center gap-1.5">
            <Activity className="h-3 w-3 text-ink-dim" />
            <span className="text-micro text-ink-dim">场景</span>
            <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-2 text-micro font-medium text-(--accent-text)">
              {card.problem.slice(0, 20)}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-micro text-ink-mute">紧急程度</span>
            <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-status-alert-default)] bg-[rgba(210,157,0,0.12)] px-2 text-micro font-medium text-[var(--trae-status-alert-default)]">
              {riskMeta.urgency}
            </span>
          </div>
          <span className="h-3.5 w-px bg-[var(--trae-border-neutral-l2)]" />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => navigate('/knowledge')}
              data-dom-id="goto-related-knowledge"
              aria-label="跳转到关联知识库"
              className="inline-flex items-center gap-1 rounded-[var(--trae-radius-4)] px-2 py-0.5 text-micro text-ink-dim transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-ink"
            >
              <FileText className="h-3 w-3" />
              关联知识
            </button>
            <button
              type="button"
              onClick={() => navigate('/history')}
              data-dom-id="goto-history-decisions"
              aria-label="跳转到历史决策"
              className="inline-flex items-center gap-1 rounded-[var(--trae-radius-4)] px-2 py-0.5 text-micro text-ink-dim transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-ink"
            >
              <Clock className="h-3 w-3" />
              历史决策
            </button>
            <button
              type="button"
              onClick={() => navigate('/logs')}
              data-dom-id="goto-system-logs"
              aria-label="跳转到系统日志"
              className="inline-flex items-center gap-1 rounded-[var(--trae-radius-4)] px-2 py-0.5 text-micro text-ink-dim transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-ink"
            >
              <ScrollText className="h-3 w-3" />
              系统日志
            </button>
          </div>
        </div>

      {/* ===== Section 2: 置信度仪表 + 命令决策终端 =====
          items-start：审计卡拆成满宽之后，这里再 items-stretch 就会把命令卡拉成
          和仪表一样高，底下多出 200px 空白（1280 宽实测）。 */}
      <section className="flex flex-wrap items-start gap-6 px-8 pb-4">
        <div className="flex min-w-[300px] flex-[0_0_38%] flex-col gap-3">
          <ConfidenceGauge
            value={displayConfidence}
            provenance={confidenceProvenance}
            sources={evidenceSources}
          />
        </div>
        <ExecutionResult
          decisionId={card.id}
          commandSegments={commandSegments}
          commandComment={card.fixDescription}
          impact={card.risk.description || '目标服务'}
          rollback={card.rollbackCommand ?? 'N/A'}
          // v2.6：已执行/已拒绝/已验证的历史卡 → 只读态（审批按钮对历史卡无效），
          // 提供真实的「重新在终端执行」；仅 pending/approved（活跃工作流）保留审批按钮
          mode={card.status === 'pending' || card.status === 'approved' ? 'approval' : 'readonly'}
          statusLabel={
            card.status === 'executed' ? '已执行'
            : card.status === 'verified' ? '已验证'
            : card.status === 'rejected' ? '已拒绝'
            : card.status === 'failed' ? '执行失败'
            : undefined
          }
          verified={card.evidences.some((e) => e.verified)}
          rerunning={rerunning}
          canRerun={Boolean(activeSessionId)}
          onRerun={() => void handleRerun()}
          onAccept={() => void handleApprove()}
          onModify={handleModifyOpen}
          onReject={() => void handleReject()}
        />
      </section>

      {/* ===== Section 2.5: 决策审计日志（满宽一张卡，六列表格不再被仪表挤） ===== */}
      <section className="px-8 pb-4">
        <DecisionAuditLog
          rows={auditRows}
          status={auditStatus}
          brokenAtSeq={auditBrokenAtSeq}
        />
      </section>

      {/* ===== Section 3: 六源证据融合（D-S 证据理论透明化）===== */}
      <section className="px-8 pb-6">
        <div className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] p-6">
          {/* 标题栏 */}
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-(--accent-text)" />
              <span className="text-title font-semibold text-ink">六源证据融合</span>
              {credibility && (
                <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-2 text-micro font-medium text-(--accent-text)">
                  D-S 证据理论
                </span>
              )}
            </div>
            <span className="text-micro text-ink-mute">
              {credibility
                ? `Dempster-Shafer · 规则: ${credibility.ruleUsed}`
                : '未执行融合评估 · 下方仅为各来源自报权重'}
            </span>
          </div>

          {/* 左右布局：雷达图 + 明细列表 */}
          <div className="flex flex-col gap-8 lg:flex-row">
            <EvidenceRadar sources={evidenceSources} />
            <PCR5Result sources={evidenceSources} fusedValue={fusedValue} conflictK={conflictK} />
          </div>
        </div>
      </section>

      {/* ===== Section 4 + 5: 证据溯源链 + 四层风险控制（ApprovalStateMachine）===== */}
      <section className="px-8 pb-6">
        <ApprovalStateMachine steps={timelineSteps} gates={riskGates} />
      </section>

      {/* ===== Section 5.5: 高危命令拦截清单（EvidenceList）===== */}
      {dangerCommands.length > 0 && (
        <section className="px-8 pb-6">
          <EvidenceList commands={dangerCommands} defaultExpanded />
        </section>
      )}

      {/* ===== 导出 HTML 报告区域 ===== */}
      <section className="flex justify-end px-8 pb-6">
        <button
          type="button"
          onClick={() => void handleExportHtml()}
          aria-label="导出 HTML 报告"
          className="btn-press inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] px-3 text-sm text-ink-dim transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-ink active:bg-hover active:text-ink"
        >
          <FileDown className="h-3.5 w-3.5" />
          导出 HTML 报告
        </button>
      </section>
      </div>

      {/* ===== Footer: Agent 工作流进度条（固定在页底，不随正文滚动）===== */}
      <footer className="mt-auto shrink-0 border-t border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] px-8 py-3">
        <div className="flex items-center gap-4">
          <div className="flex shrink-0 items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-(--accent-text)" />
            <span className="text-micro text-ink-dim">Agent 工作流</span>
          </div>
          <div className="flex flex-1 items-center gap-2">
            {workflowSteps.map((step, idx) => (
              <div key={step.label} className="flex flex-1 items-center gap-2">
                <div className="flex items-center gap-1.5">
                  {step.status === 'completed' && (
                    <span className="h-2 w-2 rounded-full bg-accent-solid" />
                  )}
                  {step.status === 'in-progress' && (
                    <span className="relative h-2.5 w-2.5">
                      <span
                        className="absolute inset-0 rounded-full bg-accent-solid opacity-50"
                        style={{ animation: 'pulse-ring 2s cubic-bezier(.4,0,.6,1) infinite' }}
                      />
                      <span className="absolute inset-0 rounded-full bg-accent-solid" />
                    </span>
                  )}
                  {step.status === 'pending' && (
                    <span className="h-2 w-2 rounded-full border border-[var(--trae-border-neutral-l2)] bg-transparent" />
                  )}
                  <span
                    className={`text-micro ${
                      step.status === 'in-progress'
                        ? 'font-medium text-(--accent-text)'
                        : step.status === 'pending'
                        ? 'text-ink-mute'
                        : 'text-ink-dim'
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
                {idx < workflowSteps.length - 1 && (
                  <div
                    className={`h-0.5 flex-1 rounded-full ${
                      step.status === 'completed' ? 'bg-accent-solid' : 'bg-[var(--trae-border-neutral-l1)]'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
          <span className="shrink-0 font-mono text-sm tabular-nums text-ink-dim">
            {completedSteps} / 7
          </span>
        </div>
      </footer>

      {/* 操作反馈浮层 */}
      {actionFeedback && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-4 py-2 text-sm font-medium text-(--accent-text) shadow-lg">
          {actionFeedback}
        </div>
      )}

      {/* 内联 keyframes */}
      <style>{`
        @keyframes pulse-ring {
          0%, 100% { box-shadow: 0 0 0 0 var(--trae-bg-brand-popup); }
          50% { box-shadow: 0 0 0 6px transparent; }
        }
      `}</style>

      {/* modify-execution 弹窗：编辑 fixCommand 字符串后提交审批
          无障碍：title 关联 aria-labelledby（rc-dialog 自动生成 ariaId）、autoFocus 聚焦 TextArea、ESC 关闭（AntD 默认 keyboard=true） */}
      <Dialog open={modifyModalOpen} onOpenChange={(next) => !next && setModifyModalOpen(false)}>
        <DialogContent
          title="修改修复命令"
          closeOnOverlayClick={false}
          footer={
            <>
              <Button onClick={() => setModifyModalOpen(false)}>取消</Button>
              <Button
                variant="solid"
                disabled={!modifyCommand.trim() || confirming}
                onClick={() => void handleModifyConfirm()}
              >
                {confirming ? '提交中…' : '确认提交'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-2">
            <label htmlFor="modify-fix-command" className="text-sm text-ink-dim">
              修复命令（提交后将以本命令执行变更）
            </label>
            <TextArea
              id="modify-fix-command"
              value={modifyCommand}
              onChange={(e) => setModifyCommand(e.target.value)}
              placeholder="例如：systemctl restart nginx"
              rows={3}
              disabled={confirming}
              autoFocus
              className="font-mono text-sm"
            />
            <p className="text-caption text-ink-mute">
              提示：修改命令后将重新提交人工审批流程；按 Esc 可取消
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  )
}
