/**
 * 决策卡片组件 - DecisionCard (v0.9.5 P1: 自动可信度评估)
 *
 * 职责：
 * - 展示：问题 / 根因 / 证据链 / 置信度 / 风险 / 修复命令
 * - 风险等级色带（左侧 4px 彩色条）
 * - 置信度仪表盘（Recharts RadialBarChart 圆形进度）
 * - P1: 自动调用 credibilityAssess 评估 6 源证据
 *   - 把 Bel/Pl/confidence/conflictLevel 嵌入 ConfidenceBreakdown
 *   - 降级：调用失败时回退到 card.confidence
 * - 修复命令展示 + 复制按钮
 * - 回滚命令展示 + 复制按钮
 * - 执行 / 拒绝 / 修改 三个操作按钮
 * - 状态流转：pending → approved → executed → verified
 *
 * 苹果极简风格：
 * - 细线条卡片，大量留白
 * - 左侧风险色带强化视觉层次
 * - 命令使用终端背景色代码块展示
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { Button, Tag, Tooltip, Collapse, message } from 'antd'
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  CopyOutlined,
  UndoOutlined,
  CloseOutlined,
  PlayCircleOutlined,
  ExperimentOutlined,
} from '@ant-design/icons'
import { RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer } from 'recharts'
import EvidenceChain from './EvidenceChain'
import RiskConfirm from './RiskConfirm'
import SectionTitle from '../common/SectionTitle'
import ConfidenceBreakdown from './ConfidenceBreakdown'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import { buildCredibilityInputs, fingerprint } from '../../utils/evidence-to-input'
import type { DecisionCard as DecisionCardType, RiskLevel } from '@shared/models'
import type { ConfidenceAssessment } from '@shared/agent-types'
import './DecisionCard.css'

/** DecisionCard 组件 Props */
interface DecisionCardProps {
  /** 决策卡片数据 */
  card: DecisionCardType
  /** 批准决策回调（P1-3: 统一批准即执行，不再有 approved 中间状态） */
  onApprove?: (card: DecisionCardType) => void
  /** 拒绝决策回调 */
  onReject?: (card: DecisionCardType) => void
  /** 批准/拒绝进行中标记（P1-2: 防重复点击） */
  confirming?: boolean
}

/** 风险等级配置（v2.2：全部 token 化） */
const RISK_CONFIG: Record<RiskLevel, { color: string; label: string; bgColor: string }> = {
  SAFE: { color: 'var(--color-risk-safe)', label: '安全', bgColor: 'var(--color-success-alpha-10)' },
  LOW: { color: 'var(--color-risk-low)', label: '低风险', bgColor: 'var(--color-link-alpha-10)' },
  MEDIUM: { color: 'var(--color-risk-medium)', label: '中风险', bgColor: 'var(--color-warning-alpha-10)' },
  HIGH: { color: 'var(--color-risk-high)', label: '高风险', bgColor: 'var(--color-error-alpha-08)' },
  CRITICAL: { color: 'var(--color-risk-critical)', label: '极高风险', bgColor: 'var(--color-error-alpha-12)' },
}

/** 决策状态配置（v2.2：全部 token 化） */
const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  pending: { label: '待确认', color: 'var(--color-text-tertiary)', icon: <ClockCircleOutlined /> },
  approved: { label: '已批准', color: 'var(--color-link)', icon: <CheckCircleOutlined /> },
  rejected: { label: '已拒绝', color: 'var(--color-text-tertiary)', icon: <CloseCircleOutlined /> },
  executed: { label: '已执行', color: 'var(--color-warning)', icon: <PlayCircleOutlined /> },
  verified: { label: '已验证', color: 'var(--color-success)', icon: <CheckCircleOutlined /> },
  failed: { label: '执行失败', color: 'var(--color-error)', icon: <ExclamationCircleOutlined /> },
}

/** 置信度仪表盘（Recharts RadialBarChart 圆形进度） */
const ConfidenceGauge: React.FC<{ value: number }> = ({ value }) => {
  const percent = Math.round(value * 100)
  const color = value >= 0.7 ? 'var(--color-success)' : value >= 0.5 ? 'var(--color-warning)' : 'var(--color-error)'
  /** RadialBarChart 数据 */
  const data = [{ name: 'confidence', value: percent, fill: color }]

  return (
    <div className="confidence-gauge">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          cx="50%"
          cy="50%"
          innerRadius="70%"
          outerRadius="100%"
          barSize={8}
          data={data}
          startAngle={90}
          endAngle={90 - 360 * (percent / 100)}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar background={{ fill: 'var(--color-border)' }} dataKey="value" cornerRadius={4} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="confidence-gauge-text" style={{ color }}>
        {percent}%
      </div>
    </div>
  )
}

/**
 * Trident 三叉决策评分展示（借鉴 instructkr/claw-code §3.1）
 *
 * 三个子评分：
 * - 安全度（命令危险度反向）：高 = 安全
 * - 幂等度（操作可重入性）：高 = 可重复执行
 * - 关联度（证据充分性）：高 = 证据链完整
 *
 * 颜色编码：
 * - ≥ 0.7 绿（var(--color-success)）
 * - ≥ 0.5 黄（var(--color-warning)）
 * - < 0.5 红（var(--color-error)）
 */
const TridentScores: React.FC<{
  trident: NonNullable<DecisionCardType['trident']>
}> = ({ trident }) => {
  /** 子项颜色 */
  const colorOf = (v: number) =>
    v >= 0.7 ? 'var(--color-success)' : v >= 0.5 ? 'var(--color-warning)' : 'var(--color-error)'

  const items = [
    { key: 'danger', label: '安全度', desc: '命令危险度反向', value: trident.dangerScore },
    { key: 'idem', label: '幂等度', desc: '操作可重入性', value: trident.idempotentScore },
    { key: 'rel', label: '关联度', desc: '证据充分性', value: trident.relevanceScore },
  ]

  return (
    <div className="trident-scores">
      <div className="trident-scores-header">
        <span className="trident-scores-title">Trident 三叉决策</span>
        <Tooltip title={`来源：${trident.source}（heuristic=启发式 / llm=大模型 / hybrid=混合）`}>
          <Tag color="default" className="trident-source-tag">
            {trident.source}
          </Tag>
        </Tooltip>
      </div>
      <div className="trident-scores-grid">
        {items.map((it) => (
          <div key={it.key} className="trident-score-item">
            <div className="trident-score-label">{it.label}</div>
            <div className="trident-score-bar">
              <div
                className="trident-score-bar-fill"
                style={{
                  width: `${Math.round(it.value * 100)}%`,
                  background: colorOf(it.value),
                }}
              />
            </div>
            <div className="trident-score-value" style={{ color: colorOf(it.value) }}>
              {Math.round(it.value * 100)}%
            </div>
            <div className="trident-score-desc">{it.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 命令代码块（带复制按钮） */
const CommandBlock: React.FC<{
  command: string
  variant?: 'fix' | 'rollback'
  onCopy: (command: string) => void
}> = ({ command, variant = 'fix', onCopy }) => {
  return (
    <div className={`decision-card-command-wrapper ${variant}`}>
      <Tooltip title="复制命令">
        <Button
          type="text"
          size="small"
          icon={<CopyOutlined />}
          className="decision-card-command-copy"
          onClick={(e) => {
            e.stopPropagation()
            onCopy(command)
          }}
        />
      </Tooltip>
      <pre className="decision-card-command">{command}</pre>
    </div>
  )
}

/**
 * 把单一 confidence 数值退化为 ConfidenceAssessment（用于 IPC 不可用时降级）
 */
function fallbackAssessment(confidence: number): ConfidenceAssessment {
  const c = Math.max(0, Math.min(1, confidence))
  // 简化假设：belief = c × 0.9, uncertainty = c × 0.1
  const belief = c * 0.9
  const uncertainty = Math.max(0, 1 - c) * 0.1
  const plausibility = Math.min(1, belief + uncertainty)
  return {
    belief,
    plausibility,
    confidence: c,
    uncertainty,
    conflictLevel: 0,
    ruleUsed: 'dempster',
    sources: [],
    fusionSteps: [],
    fusedMassFunction: {
      sourceId: 'fallback',
      sourceName: '降级评估',
      confidence: c,
      focalElements: [],
    },
  }
}

/** DecisionCard 决策卡片 */
const DecisionCard: React.FC<DecisionCardProps> = ({
  card,
  onApprove,
  onReject,
  confirming = false,
}) => {
  /** 风险确认对话框是否打开 */
  const [riskConfirmOpen, setRiskConfirmOpen] = useState(false)
  /** P1: 可信度评估结果（IPC 调用） */
  const [assessment, setAssessment] = useState<ConfidenceAssessment | null>(null)
  /** P1: 评估加载中 */
  const [credLoading, setCredLoading] = useState(false)
  /** P1: 评估错误（用于降级提示） */
  const [credError, setCredError] = useState<string | null>(null)
  /** 防止组件卸载后 setState */
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  /** P1: 自动调用 credibilityAssess（基于 evidence + card.confidence） */
  useEffect(() => {
    if (!isElectronAPIAvailable() || !window.electronAPI?.credibilityAssess) {
      // IPC 不可用：使用 card.confidence 降级
      setAssessment(fallbackAssessment(card.confidence))
      return
    }
    // 输入指纹去重（evidences 内容未变时不重算）
    const fp = fingerprint({
      cardId: card.id,
      evidences: card.evidences,
      llmVerbalized: card.confidence,
    })
    if (fp === lastFingerprintRef.current) return
    lastFingerprintRef.current = fp

    setCredLoading(true)
    setCredError(null)
    const inputs = buildCredibilityInputs({
      cardId: card.id,
      evidences: card.evidences,
      llmVerbalized: card.confidence,
    })

    void window.electronAPI
      .credibilityAssess(inputs)
      .then((result) => {
        if (isMountedRef.current) {
          setAssessment(result)
        }
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[DecisionCard] credibilityAssess 失败，降级到 card.confidence', msg)
        if (isMountedRef.current) {
          setCredError(msg)
          setAssessment(fallbackAssessment(card.confidence))
        }
      })
      .finally(() => {
        if (isMountedRef.current) {
          setCredLoading(false)
        }
      })
  }, [card.id, card.confidence, card.evidences])

  /** 上一指纹（用于 useEffect 内部比较） */
  const lastFingerprintRef = useRef<string>('')

  const riskConfig = RISK_CONFIG[card.risk.level]
  const statusConfig = STATUS_CONFIG[card.status] ?? STATUS_CONFIG.pending

  /** 复制命令到剪贴板 */
  const handleCopy = useCallback((command: string) => {
    navigator.clipboard.writeText(command).then(() => {
      message.success('已复制到剪贴板')
    })
  }, [])

  /** P1-3: 统一批准逻辑 — 如果需要风险确认则弹出确认框，否则直接批准 */
  const handleApproveClick = useCallback(() => {
    if (card.risk.requireConfirmation) {
      setRiskConfirmOpen(true)
    } else {
      onApprove?.(card)
    }
  }, [card, onApprove])

  /** 风险确认通过 */
  const handleRiskConfirm = useCallback(() => {
    setRiskConfirmOpen(false)
    onApprove?.(card)
  }, [card, onApprove])

  /** 风险确认拒绝 */
  const handleRiskReject = useCallback(() => {
    setRiskConfirmOpen(false)
    onReject?.(card)
  }, [card, onReject])

  /** P1-3: 只在 pending 状态显示批准/拒绝按钮 */
  const canApprove = card.status === 'pending'
  /** 是否可以回滚 */
  const canRollback =
    card.status === 'executed' || card.status === 'verified' || card.status === 'failed'

  return (
    <div
      className="decision-card"
      style={{ borderLeftColor: riskConfig.color }}
    >
      {/* ===== v2.1：头部用 SectionTitle 统一（图标 + 标题 + 风险 Tag） ===== */}
      <SectionTitle
        icon={<ExperimentOutlined />}
        title="决策建议"
        tag={{ label: riskConfig.label, color: riskConfig.color }}
        size="sm"
        className="decision-card-title"
      />

      {/* ===== 头部：问题 + 状态 + 置信度 ===== */}
      <div className="decision-card-header">
        <div className="decision-card-header-left">
          <div className="decision-card-problem">{card.problem}</div>
          <div className="decision-card-meta">
            <Tag icon={statusConfig.icon} color={statusConfig.color}>
              {statusConfig.label}
            </Tag>
            <span className="decision-card-time">
              {new Date(card.timestamp).toLocaleString('zh-CN')}
            </span>
          </div>
        </div>
        <ConfidenceGauge value={card.confidence} />
      </div>

      {/* ===== P1: 可信度评估明细（D-S + PCR5 6 源融合） ===== */}
      {assessment && (
        <ConfidenceBreakdown assessment={assessment} />
      )}
      {credLoading && !assessment && (
        <div className="decision-card-cred-loading">正在评估 6 源证据...</div>
      )}
      {credError && (
        <div className="decision-card-cred-error">
          可信度评估不可用（{credError}），已降级到 LLM 自报置信度
        </div>
      )}

      {/* ===== 根因假设 ===== */}
      <div className="decision-card-section">
        <div className="decision-card-section-label">根因假设</div>
        <div className="decision-card-section-content">{card.hypothesis}</div>
      </div>

      {/* ===== Trident 三叉决策评分（借鉴 claw-code） ===== */}
      {card.trident && <TridentScores trident={card.trident} />}

      {/* ===== 修复说明 ===== */}
      <div className="decision-card-section">
        <div className="decision-card-section-label">修复说明</div>
        <div className="decision-card-section-content">{card.fixDescription}</div>
      </div>

      {/* ===== 修复命令 ===== */}
      <div className="decision-card-section">
        <div className="decision-card-section-label">修复命令</div>
        <CommandBlock command={card.fixCommand} variant="fix" onCopy={handleCopy} />
      </div>

      {/* ===== 回滚命令 ===== */}
      {card.rollbackCommand && (
        <div className="decision-card-section">
          <div className="decision-card-section-label">回滚命令</div>
          <CommandBlock
            command={card.rollbackCommand}
            variant="rollback"
            onCopy={handleCopy}
          />
        </div>
      )}

      {/* ===== 证据链（可折叠） ===== */}
      <Collapse
        ghost
        className="decision-card-evidence-collapse"
        items={[
          {
            key: 'evidence',
            label: `证据链 (${card.evidences.length})`,
            children: <EvidenceChain evidences={card.evidences} />,
          },
        ]}
      />

      {/* ===== 操作按钮：P1-3 统一为批准/拒绝，不再有 approved 中间状态 ===== */}
      <div className="decision-card-actions">
        {canApprove && (
          <>
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              onClick={handleApproveClick}
              loading={confirming}
              disabled={confirming}
            >
              批准执行
            </Button>
            <Button
              danger
              icon={<CloseOutlined />}
              onClick={() => onReject?.(card)}
              disabled={confirming}
            >
              拒绝
            </Button>
          </>
        )}
        {canRollback && card.rollbackCommand && (
          <Button
            icon={<UndoOutlined />}
            onClick={() => card.rollbackCommand && handleCopy(card.rollbackCommand)}
          >
            复制回滚命令
          </Button>
        )}
      </div>

      {/* ===== 风险确认对话框 ===== */}
      <RiskConfirm
        open={riskConfirmOpen}
        command={card.fixCommand}
        risk={card.risk}
        onConfirm={handleRiskConfirm}
        onReject={handleRiskReject}
      />
    </div>
  )
}

export default DecisionCard
