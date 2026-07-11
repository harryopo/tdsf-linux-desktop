/**
 * 决策卡片组件 - DecisionCard
 *
 * 职责：
 * - 展示：问题 / 根因 / 证据链 / 置信度 / 风险 / 修复命令
 * - 置信度仪表盘（SVG 圆形进度条）
 * - 风险等级标签（颜色编码）
 * - 修复命令展示 + 一键执行按钮
 * - 回滚命令展示
 * - 状态流转：pending → approved → executed → verified
 *
 * 苹果极简风格：
 * - 细线条卡片，大量留白
 * - 圆形进度条用 SVG 实现，无第三方依赖
 * - 命令使用黑色背景代码块展示
 */
import { useState, useCallback } from 'react'
import { Button, Tag, Tooltip, Collapse, message } from 'antd'
import {
  PlayCircleOutlined,
  UndoOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  CopyOutlined,
} from '@ant-design/icons'
import EvidenceChain from './EvidenceChain'
import RiskConfirm from './RiskConfirm'
import type { DecisionCard as DecisionCardType, RiskLevel } from '@shared/models'
import './DecisionCard.css'

/** DecisionCard 组件 Props */
interface DecisionCardProps {
  /** 决策卡片数据 */
  card: DecisionCardType
  /** 执行修复命令回调 */
  onExecute?: (card: DecisionCardType) => void
  /** 执行回滚命令回调 */
  onRollback?: (card: DecisionCardType) => void
  /** 批准决策回调 */
  onApprove?: (card: DecisionCardType) => void
  /** 拒绝决策回调 */
  onReject?: (card: DecisionCardType) => void
}

/** 风险等级配置 */
const RISK_CONFIG: Record<RiskLevel, { color: string; label: string; bgColor: string }> = {
  SAFE: { color: '#34c759', label: '安全', bgColor: 'rgba(52, 199, 89, 0.1)' },
  LOW: { color: '#30b0c7', label: '低风险', bgColor: 'rgba(48, 176, 199, 0.1)' },
  MEDIUM: { color: '#ff9500', label: '中风险', bgColor: 'rgba(255, 149, 0, 0.1)' },
  HIGH: { color: '#ff6b35', label: '高风险', bgColor: 'rgba(255, 107, 53, 0.1)' },
  CRITICAL: { color: '#ff3b30', label: '极高风险', bgColor: 'rgba(255, 59, 48, 0.1)' },
}

/** 决策状态配置 */
const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  pending: { label: '待确认', color: '#86868b', icon: <ClockCircleOutlined /> },
  approved: { label: '已批准', color: '#0071e3', icon: <CheckCircleOutlined /> },
  rejected: { label: '已拒绝', color: '#86868b', icon: <CloseCircleOutlined /> },
  executed: { label: '已执行', color: '#ff9500', icon: <PlayCircleOutlined /> },
  verified: { label: '已验证', color: '#34c759', icon: <CheckCircleOutlined /> },
  failed: { label: '执行失败', color: '#ff3b30', icon: <ExclamationCircleOutlined /> },
}

/** 置信度仪表盘（SVG 圆形进度条） */
const ConfidenceGauge: React.FC<{ value: number }> = ({ value }) => {
  const radius = 28
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - value)
  const color = value >= 0.7 ? '#34c759' : value >= 0.5 ? '#ff9500' : '#ff3b30'

  return (
    <div className="confidence-gauge">
      <svg width="64" height="64" viewBox="0 0 64 64">
        {/* 背景圆环 */}
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="#e5e5e7"
          strokeWidth="4"
        />
        {/* 进度圆环 */}
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 32 32)"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <div className="confidence-gauge-text" style={{ color }}>
        {(value * 100).toFixed(0)}%
      </div>
    </div>
  )
}

/** DecisionCard 决策卡片 */
const DecisionCard: React.FC<DecisionCardProps> = ({
  card,
  onExecute,
  onRollback,
  onApprove,
  onReject,
}) => {
  /** 风险确认对话框是否打开 */
  const [riskConfirmOpen, setRiskConfirmOpen] = useState(false)

  const riskConfig = RISK_CONFIG[card.risk.level]
  const statusConfig = STATUS_CONFIG[card.status] ?? STATUS_CONFIG.pending

  /** 复制命令到剪贴板 */
  const handleCopy = useCallback((command: string) => {
    navigator.clipboard.writeText(command).then(() => {
      message.success('已复制到剪贴板')
    })
  }, [])

  /** 点击执行按钮 */
  const handleExecuteClick = useCallback(() => {
    // 需要风险确认的级别弹出确认框
    if (card.risk.requireConfirmation) {
      setRiskConfirmOpen(true)
    } else {
      onExecute?.(card)
    }
  }, [card, onExecute])

  /** 风险确认通过 */
  const handleRiskConfirm = useCallback(() => {
    setRiskConfirmOpen(false)
    onExecute?.(card)
  }, [card, onExecute])

  /** 风险确认拒绝 */
  const handleRiskReject = useCallback(() => {
    setRiskConfirmOpen(false)
    onReject?.(card)
  }, [card, onReject])

  /** 是否可以执行 */
  const canExecute = card.status === 'approved' || card.status === 'pending'
  /** 是否可以批准 */
  const canApprove = card.status === 'pending'
  /** 是否可以回滚 */
  const canRollback = card.status === 'executed' || card.status === 'verified' || card.status === 'failed'

  return (
    <div className="decision-card">
      {/* ===== 头部：问题 + 状态 + 置信度 ===== */}
      <div className="decision-card-header">
        <div className="decision-card-header-left">
          <div className="decision-card-problem">{card.problem}</div>
          <div className="decision-card-meta">
            <Tag icon={statusConfig.icon} color={statusConfig.color}>
              {statusConfig.label}
            </Tag>
            <Tag color={riskConfig.color}>{riskConfig.label}</Tag>
            <span className="decision-card-time">
              {new Date(card.timestamp).toLocaleString('zh-CN')}
            </span>
          </div>
        </div>
        <ConfidenceGauge value={card.confidence} />
      </div>

      {/* ===== 根因假设 ===== */}
      <div className="decision-card-section">
        <div className="decision-card-section-label">根因假设</div>
        <div className="decision-card-section-content">{card.hypothesis}</div>
      </div>

      {/* ===== 修复说明 ===== */}
      <div className="decision-card-section">
        <div className="decision-card-section-label">修复说明</div>
        <div className="decision-card-section-content">{card.fixDescription}</div>
      </div>

      {/* ===== 修复命令 ===== */}
      <div className="decision-card-section">
        <div className="decision-card-section-label">
          修复命令
          <Tooltip title="复制命令">
            <CopyOutlined
              className="decision-card-copy-icon"
              onClick={() => handleCopy(card.fixCommand)}
            />
          </Tooltip>
        </div>
        <pre className="decision-card-command">{card.fixCommand}</pre>
      </div>

      {/* ===== 回滚命令 ===== */}
      {card.rollbackCommand && (
        <div className="decision-card-section">
          <div className="decision-card-section-label">
            回滚命令
            <Tooltip title="复制命令">
              <CopyOutlined
                className="decision-card-copy-icon"
                onClick={() => handleCopy(card.rollbackCommand!)}
              />
            </Tooltip>
          </div>
          <pre className="decision-card-command rollback">{card.rollbackCommand}</pre>
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

      {/* ===== 操作按钮 ===== */}
      <div className="decision-card-actions">
        {canApprove && (
          <>
            <Button type="primary" onClick={() => onApprove?.(card)}>
              批准
            </Button>
            <Button onClick={() => onReject?.(card)}>拒绝</Button>
          </>
        )}
        {canExecute && (
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleExecuteClick}
          >
            执行修复
          </Button>
        )}
        {canRollback && card.rollbackCommand && (
          <Button
            icon={<UndoOutlined />}
            onClick={() => onRollback?.(card)}
          >
            回滚
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
