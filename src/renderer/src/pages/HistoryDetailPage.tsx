/**
 * HistoryDetailPage — 历史决策详情页（1:1 复刻 history-detail.html 设计稿）
 *
 * 路由：/history/:id · 设计稿：tdsf-linux-redesign/pages/history-detail.html
 * Spec: build-runnable-tdsf-from-design · Task 2.11 / M2 Task 4
 *
 * 结构（5 张卡片 1:1 对齐设计稿）：
 *   Header（返回工作台 + 返回历史决策 / 状态标签 + 时间戳）
 *   Title（决策记录 #<id>）
 *   Card 1 决策摘要 · Card 2 证据溯源链 7步HITL · Card 3 执行结果
 *   Card 4 知识库更新（关联知识跳转入口）· Card 5 操作日志
 *
 * 数据来源：window.electronAPI.historyGet(id) → DecisionCard
 * 复用工具：@/utils/decision-mappers（buildTimelineSteps / buildAuditRows）
 * 复用组件：@/components/decision/LoadingState / ErrorState
 *
 * data-dom-id：back-workbench / back-history / goto-knowledge-detail
 * 视觉：全部 var(--trae-*) token；代码块背景 var(--trae-bg-code-block)
 * 无障碍：button type="button" + aria-label；prefers-reduced-motion 禁用按压动画
 */
import './HistoryPage.css'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Activity, ArrowLeft, ArrowRight, Book, Check, CheckCircle2,
  Clock, List, ScrollText, Shield, Sparkles, Terminal,
} from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import type { DecisionCard } from '@shared/models'
import { LoadingState } from '@/components/decision/LoadingState'
import { ErrorState } from '@/components/decision/ErrorState'
import {
  buildTimelineSteps, buildAuditRows,
} from '@/utils/decision-mappers'
import type { AuditRow } from '@/components/decision/ExecutionResult'

// ==================== 样式常量 ====================

const MONO_STYLE = { fontFamily: 'var(--trae-font-family-mono)', fontVariantNumeric: 'tabular-nums' as const }

// ==================== 辅助函数 ====================

/** 时间戳格式化为 YYYY-MM-DD HH:mm:ss（本地时区） */
function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** DecisionCard 状态 → 标签 + className（CSS token 仅有 success/warning/danger/brand） */
const STATUS_LABEL: Record<DecisionCard['status'], { label: string; className: string }> = {
  pending: { label: '待执行', className: 'hist-tag' },
  approved: { label: '已批准', className: 'hist-tag' },
  rejected: { label: '已拒绝', className: 'hist-tag hist-tag--danger' },
  executed: { label: '已执行', className: 'hist-tag hist-tag--success' },
  verified: { label: '已验证', className: 'hist-tag hist-tag--success' },
  failed: { label: '执行失败', className: 'hist-tag hist-tag--danger' },
}

/** 审计行结果 → 中文标签 */
const AUDIT_RESULT_LABEL: Record<AuditRow['result'], string> = {
  completed: '已完成',
  waiting: '等待中',
  pending: '待触发',
  passed: '已通过',
}

/** 审计行结果 → tag className */
function auditResultTagClass(result: AuditRow['result']): string {
  if (result === 'completed' || result === 'passed') return 'hist-tag hist-tag--success'
  if (result === 'waiting') return 'hist-tag hist-tag--warning'
  return 'hist-tag'
}

/** 审计行操作者 → 图标名 */
type AuditIconName = 'sparkles' | 'shield' | 'check' | 'terminal' | 'activity' | 'check-circle' | 'dot'

const AUDIT_ICON_PROPS: Record<AuditIconName, { color: string; Icon: typeof Sparkles }> = {
  sparkles: { color: 'var(--trae-text-brand)', Icon: Sparkles },
  shield: { color: 'var(--trae-icon-secondary)', Icon: Shield },
  check: { color: 'var(--trae-status-success-default)', Icon: Check },
  terminal: { color: 'var(--trae-text-brand)', Icon: Terminal },
  activity: { color: 'var(--trae-icon-secondary)', Icon: Activity },
  'check-circle': { color: 'var(--trae-status-success-default)', Icon: CheckCircle2 },
  dot: { color: 'var(--trae-text-tertiary)', Icon: Activity },
}

/** 根据审计行操作者推断图标 */
function pickAuditIcon(operator: string, result: AuditRow['result']): AuditIconName {
  const op = operator.toLowerCase()
  if (op.includes('engineer')) return result === 'completed' || result === 'passed' ? 'check' : 'shield'
  if (op.includes('ai') || op.includes('engine')) return 'sparkles'
  if (op.includes('executor')) return 'terminal'
  if (op.includes('sandbox')) return 'activity'
  if (result === 'completed' || result === 'passed') return 'check-circle'
  return 'dot'
}

/** 从 buildAuditRows 产生的 timestamp（yyyy-mm-dd HH:MM:SS）提取 HH:MM:SS */
function extractTime(ts: string): string {
  return ts.length >= 19 ? ts.slice(11, 19) : ts
}

// ==================== 辅助子组件 ====================

/** 卡片头部条（1:1 对齐 .hist-section-head） */
function SectionHead({ icon, title, right }: { icon: ReactNode; title: string; right?: ReactNode }) {
  return (
    <div className={right ? 'hist-section-head is-between' : 'hist-section-head'}>
      <div className="hist-section-head-left">
        {icon}
        <span className="hist-section-head-title">{title}</span>
      </div>
      {right}
    </div>
  )
}

/** 摘要行（label + value） */
function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="hist-row">
      <span className="hist-row-label">{label}</span>
      <div className="hist-row-value">{children}</div>
    </div>
  )
}

/** 执行人/审核人徽章 */
function ActorBadge({ type, icon, label }: { type: 'ai' | 'approve'; icon: ReactNode; label: string }) {
  return (
    <span className={type === 'ai' ? 'hist-actor hist-actor--ai' : 'hist-actor hist-actor--approve'}>
      {icon}
      {label}
    </span>
  )
}

/** 日志行图标 */
function AuditLogIcon({ name }: { name: AuditIconName }) {
  const { color, Icon } = AUDIT_ICON_PROPS[name]
  return <Icon className="shrink-0" style={{ width: 14, height: 14, color }} />
}

// ==================== 主组件 ====================

export function HistoryDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  const [card, setCard] = useState<DecisionCard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /** 加载决策数据 */
  const loadCard = useCallback(async () => {
    if (!id) {
      setError('缺少决策 ID')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.historyGet(id)
      setCard(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载决策详情失败')
      console.warn('[HistoryDetailPage] historyGet failed:', err)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void loadCard() }, [loadCard])

  const handleBackWorkbench = () => navigate('/workbench')
  const handleBackHistory = () => navigate('/history')

  // ===== 状态渲染 =====
  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} onRetry={() => void loadCard()} />

  // 空状态：决策不存在
  if (!card) {
    return (
      <main className="hist-detail-page">
        <header className="hist-detail-header">
          <div className="hist-detail-back-row">
            <button type="button" aria-label="返回历史决策" onClick={handleBackHistory} className="hist-back-btn hist-btn-press">
              <ArrowLeft className="shrink-0" style={{ width: 14, height: 14 }} />
              返回历史决策
            </button>
          </div>
        </header>
        <div className="flex h-[60vh] w-full flex-col items-center justify-center gap-4">
          <CheckCircle2 className="shrink-0" style={{ width: 32, height: 32, color: 'var(--trae-text-tertiary)' }} />
          <span className="text-[13px]" style={{ color: 'var(--trae-text-secondary)' }}>
            决策不存在（#{id ?? 'N/A'}）
          </span>
          <button
            type="button"
            onClick={handleBackHistory}
            className="hist-back-btn hist-btn-press"
          >
            <ArrowLeft className="shrink-0" style={{ width: 14, height: 14 }} />
            返回历史决策
          </button>
        </div>
      </main>
    )
  }

  // ===== 数据映射 =====
  const timelineSteps = buildTimelineSteps(card)
  const auditRows = buildAuditRows(card)
  const statusMeta = STATUS_LABEL[card.status]
  const timestampStr = formatTimestamp(card.timestamp)
  const durationLabel = card.durationMs != null ? `${card.durationMs}ms` : '—'
  const completedSteps = timelineSteps.filter(s => s.status === 'completed').length
  const allCompleted = completedSteps === timelineSteps.length

  // Card 3 执行结果状态展示
  const executionSuccess = card.status === 'executed' || card.status === 'verified'
  const executionFailed = card.status === 'failed'
  const executionHeadline = executionSuccess
    ? { text: '执行成功', color: 'var(--trae-status-success-default)' }
    : executionFailed
      ? { text: '执行失败', color: 'var(--trae-status-error-default)' }
      : { text: statusMeta.label, color: 'var(--trae-status-alert-default)' }

  return (
    <main className="hist-detail-page">
      {/* 1. Page header */}
      <header className="hist-detail-header">
        <div className="hist-detail-back-row">
          <button type="button" data-dom-id="back-workbench" aria-label="返回工作台" onClick={handleBackWorkbench} className="hist-back-btn hist-btn-press">
            <ArrowLeft className="shrink-0" style={{ width: 14, height: 14 }} />
            返回工作台
          </button>
          <button type="button" data-dom-id="back-history" aria-label="返回历史决策" onClick={handleBackHistory} className="hist-back-btn hist-btn-press">
            <ArrowLeft className="shrink-0" style={{ width: 14, height: 14 }} />
            返回历史决策
          </button>
        </div>
        <div className="hist-detail-actions">
          <span className={statusMeta.className}>{statusMeta.label}</span>
          <span className="hist-detail-timestamp">
            <Clock className="shrink-0" style={{ width: 12, height: 12, color: 'var(--trae-text-tertiary)' }} />
            <span className="hist-detail-timestamp-val">{timestampStr}</span>
          </span>
        </div>
      </header>

      {/* 2. Title block */}
      <div className="hist-detail-title-wrap">
        <h1 className="hist-detail-title">
          决策记录 <span className="hist-detail-id">#{card.id}</span>
        </h1>
      </div>

      {/* 3. Content cards */}
      <div className="hist-detail-content">
        {/* Card 1: 决策摘要 */}
        <section className="hist-card">
          <SectionHead icon={<ScrollText className="shrink-0" style={{ width: 16, height: 16, color: 'var(--trae-icon-default)' }} />} title="决策摘要" />
          <SummaryRow label="问题">{card.problem}</SummaryRow>
          <SummaryRow label="根因">{card.hypothesis}</SummaryRow>
          <SummaryRow label="决策">{card.fixDescription}</SummaryRow>
          <SummaryRow label="执行命令">
            <div className="hist-cmd">
              <span style={{ color: 'var(--trae-text-default)' }}>{card.fixCommand}</span>
            </div>
          </SummaryRow>
          <SummaryRow label="置信度">
            <div className="hist-conf-wrap">
              <span className="hist-conf-val">{card.confidence.toFixed(2)}</span>
              <div className="hist-conf-bar">
                <div
                  className="hist-conf-bar-fill"
                  style={{ width: `${Math.min(Math.max(card.confidence, 0), 1) * 100}%` }}
                />
              </div>
            </div>
          </SummaryRow>
          <SummaryRow label="执行人">
            <ActorBadge type="ai" icon={<Sparkles style={{ width: 12, height: 12 }} />} label="AI Agent" />
          </SummaryRow>
          <SummaryRow label="审核人">
            <ActorBadge
              type="approve"
              icon={<Check style={{ width: 12, height: 12 }} />}
              label={card.risk.requireConfirmation ? 'Engineer' : '低风险自动通过'}
            />
          </SummaryRow>
        </section>

        {/* Card 2: 证据溯源链 */}
        <section className="hist-card">
          <SectionHead
            icon={<ScrollText className="shrink-0" style={{ width: 16, height: 16, color: 'var(--trae-icon-default)' }} />}
            title="证据溯源链"
            right={
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="hist-tag">7步 · HITL</span>
                <span className={allCompleted ? 'hist-tag hist-tag--success' : 'hist-tag'}>
                  {completedSteps}/7 已完成
                </span>
              </div>
            }
          />
          <div className="hist-timeline">
            {timelineSteps.map((step, idx) => {
              const isLast = idx === timelineSteps.length - 1
              const isCompleted = step.status === 'completed'
              const isInProgress = step.status === 'in-progress'
              const dotStyle: CSSProperties = isCompleted
                ? {}
                : isInProgress
                  ? { background: 'var(--trae-bg-brand)', opacity: 0.6 }
                  : { background: 'transparent', border: '2px dashed var(--trae-border-neutral-l2)' }
              const stepLabel = isCompleted ? '已完成' : isInProgress ? '进行中' : '待执行'
              return (
                <div key={step.num} className={isLast ? 'hist-ev-step is-last' : 'hist-ev-step'}>
                  <div className="hist-ev-step-rail">
                    <div className="hist-ev-step-dot" style={dotStyle}>
                      {isCompleted && <Check style={{ width: 12, height: 12, color: 'var(--trae-text-onbrand)' }} />}
                    </div>
                    {!isLast && (
                      <div
                        className="hist-ev-step-connector"
                        style={isCompleted ? undefined : { background: 'var(--trae-border-neutral-l1)' }}
                      />
                    )}
                  </div>
                  <div className={isLast ? 'hist-ev-step-body is-last' : 'hist-ev-step-body'}>
                    <div className="hist-ev-step-title-row">
                      <span className="hist-ev-step-title">Step {step.num} · {step.title}</span>
                      <span className={isCompleted ? 'hist-tag hist-tag--success' : 'hist-tag'}>
                        {stepLabel}
                      </span>
                    </div>
                    <p className="hist-ev-step-desc">{step.desc}</p>
                    {step.timestamp && <p className="hist-ev-step-time">{extractTime(step.timestamp)}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Card 3: 执行结果（DecisionCard 无 before/after 指标对比数据） */}
        <section className="hist-card">
          <SectionHead
            icon={<Activity className="shrink-0" style={{ width: 16, height: 16, color: 'var(--trae-icon-default)' }} />}
            title="执行结果"
            right={
              <span className="hist-result-success" style={{ color: executionHeadline.color }}>
                <CheckCircle2 className="shrink-0" style={{ width: 14, height: 14, color: executionHeadline.color }} />
                {executionHeadline.text}
              </span>
            }
          />
          <div className="hist-row">
            <span className="hist-row-label">状态</span>
            <div className="hist-row-value">
              <span className={statusMeta.className}>{statusMeta.label}</span>
            </div>
          </div>
          <div className="hist-row">
            <span className="hist-row-label">执行命令</span>
            <div className="hist-row-value">
              <div className="hist-cmd">
                <span style={{ color: 'var(--trae-text-default)' }}>{card.fixCommand}</span>
              </div>
            </div>
          </div>
          <div className="hist-row">
            <span className="hist-row-label">耗时</span>
            <div className="hist-row-value">
              <span style={MONO_STYLE}>{durationLabel}</span>
            </div>
          </div>
          {/* DecisionCard 无 before/after 指标对比数据，显示占位表格 */}
          <div className="hist-table-wrap" style={{ marginTop: 12 }}>
            <table className="hist-table">
              <thead>
                <tr>
                  {['指标', '执行前', '执行后', '变化'].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', color: 'var(--trae-text-tertiary)' }}>
                    暂无指标对比数据
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Card 4: 知识库更新（DecisionCard 无 knowledgeId，展示决策已归档） */}
        <section className="hist-card">
          <SectionHead icon={<Book className="shrink-0" style={{ width: 16, height: 16, color: 'var(--trae-icon-default)' }} />} title="知识库更新" />
          <div className="hist-kb-row">
            <div className="hist-kb-left">
              <CheckCircle2 className="shrink-0" style={{ width: 16, height: 16, color: 'var(--trae-status-success-default)' }} />
              <span className="hist-kb-desc">决策已归档至本地历史库</span>
              <span className="hist-kb-link">{card.id}</span>
            </div>
            <button
              type="button"
              data-dom-id="goto-knowledge-detail"
              aria-label="查看关联知识库"
              onClick={() => navigate('/knowledge')}
              className="hist-kb-btn hist-btn-press"
            >
              查看知识库
              <ArrowRight className="shrink-0" style={{ width: 12, height: 12 }} />
            </button>
          </div>
        </section>

        {/* Card 5: 操作日志（使用 buildAuditRows） */}
        <section className="hist-card">
          <SectionHead icon={<List className="shrink-0" style={{ width: 16, height: 16, color: 'var(--trae-icon-default)' }} />} title="操作日志" />
          <div className="hist-timeline">
            {auditRows.map((row, idx) => {
              const iconName = pickAuditIcon(row.operator, row.result)
              return (
                <div key={idx} className="hist-log-row">
                  <span className="hist-log-time">{extractTime(row.timestamp)}</span>
                  <span className="hist-log-icon">
                    <AuditLogIcon name={iconName} />
                  </span>
                  <span className="hist-log-desc">
                    <span style={{ color: 'var(--trae-text-secondary)', marginRight: 6 }}>[{row.operator}]</span>
                    {row.action}
                    <span style={{ marginLeft: 8, color: 'var(--trae-text-tertiary)', fontFamily: 'var(--trae-font-family-mono)' }}>
                      {row.hash}
                    </span>
                    <span className={auditResultTagClass(row.result)} style={{ marginLeft: 8 }}>
                      {AUDIT_RESULT_LABEL[row.result]}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </main>
  )
}
