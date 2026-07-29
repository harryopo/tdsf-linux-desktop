/**
 * DecisionDetailPage — AI 可信决策详情（核心页面）
 *
 * 路由：/decision/:id
 *
 * 设计稿：tdsf-linux-redesign/pages/decision-detail.html
 *
 * 7 个 section + footer：
 * 1. Header（决策摘要 + 决策 ID + 时间 + 场景 + 紧急程度 + 3 个链接）
 * 2. 核心视觉锚点：大型径向置信度仪表（左）+ 命令决策终端（右）
 * 3. 六源证据融合面板（D-S 证据理论透明化）：EvidenceRadar + PCR5Result
 * 4. 证据溯源链（7 步光路时间线）+ 5. 四层风险控制 → 合并为 ApprovalStateMachine
 * 5.5 高危命令拦截清单 → EvidenceList
 * 6. 决策审计日志 → 已内置在 ExecutionResult
 * Footer: Agent 工作流进度条（7 步 5/7）
 *
 * 数据来源：
 * - window.electronAPI.historyGet(id) 获取决策记录
 * - window.electronAPI.credibilityAssess(inputs) 获取可信度评估（可选）
 */
import { useState, useEffect, useCallback } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Modal, Input, message } from 'antd'
import {
  Sparkles, ArrowLeft, Fingerprint, Clock, Activity,
  FileText, ScrollText, AlertTriangle, FileDown,
} from 'lucide-react'
import { EvidenceRadar } from '@/components/decision/EvidenceRadar'
import { PCR5Result } from '@/components/decision/PCR5Result'
import { ApprovalStateMachine } from '@/components/decision/ApprovalStateMachine'
import { EvidenceList } from '@/components/decision/EvidenceList'
import { ExecutionResult } from '@/components/decision/ExecutionResult'
import type { AuditRow } from '@/components/decision/ExecutionResult'
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
  buildAuditRows,
  buildWorkflowSteps,
  buildCredibilityInputs,
} from '@/utils/decision-mappers'
import type { DecisionCard } from '@shared/models'
import type { ConfidenceAssessment } from '@shared/agent-types'
// v2.6：重新执行接真实终端（与 AIPanel 同路径：预检 + 预测回显 + sshShellWrite）
import { useServerStore } from '@/stores/server-store'
import { useTerminalStore } from '@/stores/terminal-store'
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
      className="btn-press inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] px-3 text-[12px] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)] active:bg-[var(--trae-bg-overlay-l3)] active:text-[var(--trae-text-default)]"
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
  /** v2.6：审计日志行（真 SHA-256 链，异步计算） */
  const [auditRows, setAuditRows] = useState<AuditRow[]>([])
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

  // v2.6：卡片就绪后异步计算真 SHA-256 链式审计行
  useEffect(() => {
    if (!card) {
      setAuditRows([])
      return
    }
    let cancelled = false
    void buildAuditRows(card).then((rows) => {
      if (!cancelled) setAuditRows(rows)
    })
    return () => { cancelled = true }
  }, [card])

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
   * 高危二次确认：risk.level ∈ {HIGH, CRITICAL} 时弹 Modal.confirm
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
      Modal.confirm({
        title: '确认采纳执行',
        content: `当前决策为「${card.risk.level}」级别风险，确认要采纳执行此命令吗？`,
        okText: '确认执行',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: () => doApprove(),
      })
    } else {
      void doApprove()
    }
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
      Modal.confirm({
        title: '确认拒绝决策',
        content: `当前决策为「${card.risk.level}」级别风险，确认要拒绝此命令吗？`,
        okText: '确认拒绝',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: () => doReject(),
      })
    } else {
      void doReject()
    }
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
    if (!activeSessionId) {
      message.warning('重新执行需要先连接 SSH 服务器（顶栏服务器菜单或「设置 → SSH」）')
      return
    }
    if (!api?.sshShellWrite) {
      message.warning('当前环境不支持终端执行（非 Electron 环境）')
      return
    }
    setRerunning(true)
    try {
      // 前置环境预检（缺命令阻断；预检自身失败 fail-open）
      const names = extractCommandNames(card.fixCommand)
      if (names.length > 0 && api.sshExec) {
        try {
          const pre = await api.sshExec(activeSessionId, buildMissingCheckScript(names))
          const missing = parseMissingOutput(pre.stdout)
          if (missing.length > 0) {
            message.error(`前置检查未通过：服务器缺少命令 ${missing.join('、')}，已取消发送`)
            return
          }
        } catch (err) {
          console.warn('[DecisionDetailPage] 前置预检失败，照常发送', err)
        }
      }
      useTerminalStore.getState().setPendingCommand({ command: card.fixCommand, sentAt: Date.now() })
      const cmd = card.fixCommand.endsWith('\n') ? card.fixCommand : `${card.fixCommand}\n`
      await api.sshShellWrite(activeSessionId, `\x15${cmd}`)
      message.success('命令已发送到终端，请到工作台终端查看回显')
    } catch (err) {
      useTerminalStore.getState().setPendingCommand(null)
      message.error(`发送失败：${err instanceof Error ? err.message : String(err)}`)
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
        message.success(`HTML 报告已导出到：${filepath}`)
      } else {
        message.warning('导出完成但未获取到文件路径')
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      message.error(`导出 HTML 报告失败：${reason}`)
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
  const evidenceSources = buildEvidenceSources(card.evidences, credibility?.confidence ?? card.confidence)
  const timelineSteps = buildTimelineSteps(card)
  const riskGates = buildRiskGates(card)
  const dangerCommands = buildDangerCommands(card)
  const commandSegments = parseCommandSegments(card.fixCommand)
  const workflowSteps = buildWorkflowSteps(card)

  // 置信度：优先使用 credibilityAssess 结果，其次原始 credibility，最后 card.confidence
  const rawCredibility = credibility?.confidence ?? card.confidence
  const displayConfidence = rawCredibility
  const conflictK = credibility?.conflictLevel ?? 0
  const fusedValue = credibility?.confidence ?? card.confidence

  // 时间格式化
  const timestamp = new Date(card.timestamp)
  const timeStr = `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, '0')}-${String(timestamp.getDate()).padStart(2, '0')} ${String(timestamp.getHours()).padStart(2, '0')}:${String(timestamp.getMinutes()).padStart(2, '0')}:${String(timestamp.getSeconds()).padStart(2, '0')} CST`

  // 工作流完成计数
  const completedSteps = workflowSteps.filter(s => s.status === 'completed').length

  return (
    <main className="flex h-full w-full flex-col overflow-y-auto bg-[var(--trae-bg-base-default)]">
      {/* ===== Section 1: 决策摘要 Header ===== */}
      <header className="flex flex-col gap-4 px-8 pb-4 pt-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Sparkles className="h-6 w-6 shrink-0 text-[var(--trae-bg-brand)]" />
            <div className="flex flex-col gap-1">
              <span className="text-[28px] font-semibold leading-[36px] text-[var(--trae-text-default)]">
                可信决策内核
              </span>
              <span className="text-[11px] text-[var(--trae-text-tertiary)]">
                Human-in-the-Loop · 可解释 · 可审计 · #{id}
              </span>
            </div>
          </div>
          <button
            type="button"
            data-dom-id="back-workbench"
            onClick={() => navigate('/workbench')}
            style={{ display: 'none' }}
            className="inline-flex h-7 items-center gap-1.5 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] px-2.5 text-[11px] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
            aria-label="返回工作台"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回工作台
          </button>
        </div>

        {/* 决策摘要条 */}
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Fingerprint className="h-3 w-3 text-[var(--trae-text-secondary)]" />
            <span className="font-mono text-[10px] text-[var(--trae-text-secondary)]">决策ID</span>
            <span className="font-mono text-[12px] font-medium tabular-nums text-[var(--trae-text-default)]">
              #{card.id}
            </span>
          </div>
          <span className="h-3.5 w-px bg-[var(--trae-border-neutral-l2)]" />
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3 text-[var(--trae-text-secondary)]" />
            <span className="font-mono text-[10px] tabular-nums text-[var(--trae-text-secondary)]">
              {timeStr}
            </span>
          </div>
          <span className="h-3.5 w-px bg-[var(--trae-border-neutral-l2)]" />
          <div className="flex items-center gap-1.5">
            <Activity className="h-3 w-3 text-[var(--trae-text-secondary)]" />
            <span className="text-[10px] text-[var(--trae-text-secondary)]">场景</span>
            <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-2 text-[10px] font-medium text-[var(--trae-text-brand)]">
              {card.problem.slice(0, 20)}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--trae-text-tertiary)]">紧急程度</span>
            <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-status-alert-default)] bg-[rgba(210,157,0,0.12)] px-2 text-[10px] font-medium text-[var(--trae-status-alert-default)]">
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
              className="inline-flex items-center gap-1 rounded-[var(--trae-radius-4)] px-2 py-0.5 text-[10px] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
            >
              <FileText className="h-3 w-3" />
              关联知识
            </button>
            <button
              type="button"
              onClick={() => navigate('/history')}
              data-dom-id="goto-history-decisions"
              aria-label="跳转到历史决策"
              className="inline-flex items-center gap-1 rounded-[var(--trae-radius-4)] px-2 py-0.5 text-[10px] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
            >
              <Clock className="h-3 w-3" />
              历史决策
            </button>
            <button
              type="button"
              onClick={() => navigate('/logs')}
              data-dom-id="goto-system-logs"
              aria-label="跳转到系统日志"
              className="inline-flex items-center gap-1 rounded-[var(--trae-radius-4)] px-2 py-0.5 text-[10px] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
            >
              <ScrollText className="h-3 w-3" />
              系统日志
            </button>
          </div>
        </div>
      </header>

      {/* ===== Section 2: 置信度仪表 + 命令决策终端 ===== */}
      <section className="flex flex-wrap items-stretch gap-6 px-8 pb-4">
        <div className="flex min-w-[300px] flex-[0_0_38%] flex-col gap-3">
          <ConfidenceGauge value={displayConfidence} sources={evidenceSources} />
        </div>
        <ExecutionResult
          decisionId={card.id}
          commandSegments={commandSegments}
          commandComment={card.fixDescription}
          impact={card.risk.description || '目标服务'}
          rollback={card.rollbackCommand ?? 'N/A'}
          auditRows={auditRows}
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

      {/* ===== Section 3: 六源证据融合（D-S 证据理论透明化）===== */}
      <section className="px-8 pb-6">
        <div className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] p-6">
          {/* 标题栏 */}
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[var(--trae-text-brand)]" />
              <span className="text-[16px] font-semibold text-[var(--trae-text-default)]">六源证据融合</span>
              <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-2 text-[10px] font-medium text-[var(--trae-text-brand)]">
                D-S 证据理论
              </span>
            </div>
            <span className="text-[10px] text-[var(--trae-text-tertiary)]">
              Dempster-Shafer · {credibility ? `规则: ${credibility.ruleUsed}` : '透明可追溯'}
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
          className="btn-press inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] px-3 text-[12px] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)] active:bg-[var(--trae-bg-overlay-l3)] active:text-[var(--trae-text-default)]"
        >
          <FileDown className="h-3.5 w-3.5" />
          导出 HTML 报告
        </button>
      </section>

      {/* ===== Footer: Agent 工作流进度条 ===== */}
      <footer className="mt-auto border-t border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] px-8 py-3">
        <div className="flex items-center gap-4">
          <div className="flex shrink-0 items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-[var(--trae-bg-brand)]" />
            <span className="text-[10px] text-[var(--trae-text-secondary)]">Agent 工作流</span>
          </div>
          <div className="flex flex-1 items-center gap-2">
            {workflowSteps.map((step, idx) => (
              <div key={step.label} className="flex flex-1 items-center gap-2">
                <div className="flex items-center gap-1.5">
                  {step.status === 'completed' && (
                    <span className="h-2 w-2 rounded-full bg-[var(--trae-bg-brand)]" />
                  )}
                  {step.status === 'in-progress' && (
                    <span className="relative h-2.5 w-2.5">
                      <span
                        className="absolute inset-0 rounded-full bg-[var(--trae-bg-brand)] opacity-50"
                        style={{ animation: 'pulse-ring 2s cubic-bezier(.4,0,.6,1) infinite' }}
                      />
                      <span className="absolute inset-0 rounded-full bg-[var(--trae-bg-brand)]" />
                    </span>
                  )}
                  {step.status === 'pending' && (
                    <span className="h-2 w-2 rounded-full border border-[var(--trae-border-neutral-l2)] bg-transparent" />
                  )}
                  <span
                    className={`text-[10px] ${
                      step.status === 'in-progress'
                        ? 'font-medium text-[var(--trae-text-brand)]'
                        : step.status === 'pending'
                        ? 'text-[var(--trae-text-tertiary)]'
                        : 'text-[var(--trae-text-secondary)]'
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
                {idx < workflowSteps.length - 1 && (
                  <div
                    className={`h-0.5 flex-1 rounded-full ${
                      step.status === 'completed' ? 'bg-[var(--trae-bg-brand)]' : 'bg-[var(--trae-border-neutral-l1)]'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
          <span className="shrink-0 font-mono text-[12px] tabular-nums text-[var(--trae-text-secondary)]">
            {completedSteps} / 7
          </span>
        </div>
      </footer>

      {/* 操作反馈浮层 */}
      {actionFeedback && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-4 py-2 text-[12px] font-medium text-[var(--trae-text-brand)] shadow-lg">
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
      <Modal
        title={<span id="modify-execution-modal-title">修改修复命令</span>}
        open={modifyModalOpen}
        onOk={() => void handleModifyConfirm()}
        onCancel={() => setModifyModalOpen(false)}
        okText="确认提交"
        cancelText="取消"
        confirmLoading={confirming}
        okButtonProps={{ disabled: !modifyCommand.trim() || confirming }}
        destroyOnClose
        maskClosable={false}
        focusTriggerAfterClose
      >
        <div className="flex flex-col gap-2 py-2">
          <label htmlFor="modify-fix-command" className="text-[12px] text-[var(--trae-text-secondary)]">
            修复命令（提交后将以本命令执行变更）
          </label>
          <Input.TextArea
            id="modify-fix-command"
            value={modifyCommand}
            onChange={(e) => setModifyCommand(e.target.value)}
            placeholder="例如：systemctl restart nginx"
            autoSize={{ minRows: 2, maxRows: 6 }}
            disabled={confirming}
            autoFocus
            className="font-mono text-[12px]"
            aria-label="修改后的修复命令"
          />
          <p className="text-[11px] text-[var(--trae-text-tertiary)]">
            提示：修改命令后将重新提交人工审批流程；按 ESC 可取消
          </p>
        </div>
      </Modal>
    </main>
  )
}
