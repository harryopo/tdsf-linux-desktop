/**
 * 风险确认对话框组件 - RiskConfirm
 *
 * 职责：
 * - Modal 对话框显示待确认的命令
 * - 显示风险等级和风险原因
 * - 确认/拒绝按钮
 * - 倒计时（可选，CRITICAL 级别不给倒计时，必须手动确认）
 *
 * 安全设计：
 * - CRITICAL 级别：无倒计时，必须手动点击确认
 * - HIGH 级别：10 秒倒计时后可自动确认
 * - MEDIUM 及以下：5 秒倒计时
 */
import { useState, useEffect, useCallback } from 'react'
import { Modal, Button, Tag, Typography } from 'antd'
import { WarningOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import type { RiskAssessment, RiskLevel } from '@shared/models'
import './RiskConfirm.css'

const { Text, Paragraph } = Typography

/** RiskConfirm 组件 Props */
interface RiskConfirmProps {
  /** 对话框是否打开 */
  open: boolean
  /** 待确认的命令 */
  command: string
  /** 风险评估结果 */
  risk: RiskAssessment
  /** 确认回调 */
  onConfirm: () => void
  /** 拒绝回调 */
  onReject: () => void
}

/** 风险等级配置 */
const RISK_CONFIG: Record<RiskLevel, { color: string; label: string; countdown: number }> = {
  SAFE: { color: '#34c759', label: '安全', countdown: 0 },
  LOW: { color: '#30b0c7', label: '低风险', countdown: 5 },
  MEDIUM: { color: '#ff9500', label: '中风险', countdown: 5 },
  HIGH: { color: '#ff6b35', label: '高风险', countdown: 10 },
  CRITICAL: { color: '#ff3b30', label: '极高风险', countdown: 0 },
}

/** RiskConfirm 风险确认对话框 */
const RiskConfirm: React.FC<RiskConfirmProps> = ({
  open,
  command,
  risk,
  onConfirm,
  onReject,
}) => {
  /** 剩余倒计时秒数 */
  const [countdown, setCountdown] = useState(0)

  const config = RISK_CONFIG[risk.level]

  /** 倒计时效果 */
  useEffect(() => {
    if (!open) {
      setCountdown(0)
      return
    }
    // CRITICAL 级别不给倒计时
    if (risk.level === 'CRITICAL' || risk.level === 'SAFE') {
      setCountdown(0)
      return
    }
    setCountdown(config.countdown)
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [open, risk.level, config.countdown])

  /** 确认按钮是否可点击 */
  const canConfirm = countdown === 0

  /** 确认 */
  const handleConfirm = useCallback(() => {
    if (!canConfirm) return
    onConfirm()
  }, [canConfirm, onConfirm])

  /** 拒绝 */
  const handleReject = useCallback(() => {
    onReject()
  }, [onReject])

  return (
    <Modal
      open={open}
      onCancel={handleReject}
      title={
        <div className="risk-confirm-title">
          <WarningOutlined style={{ color: config.color }} />
          <span>风险确认</span>
          <Tag color={config.color} className="risk-confirm-level-tag">
            {config.label}
          </Tag>
        </div>
      }
      footer={
        <div className="risk-confirm-footer">
          <Button onClick={handleReject}>拒绝</Button>
          <Button
            type="primary"
            danger={risk.level === 'CRITICAL' || risk.level === 'HIGH'}
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            {canConfirm ? '确认执行' : `请等待 ${countdown}s`}
          </Button>
        </div>
      }
      width={560}
      closable={false}
      maskClosable={false}
    >
      <div className="risk-confirm-body">
        {/* CRITICAL 级别警告横幅 */}
        {risk.level === 'CRITICAL' && (
          <div className="risk-confirm-critical-banner">
            <ExclamationCircleOutlined />
            <span>此命令为极高风险操作，请务必仔细确认！</span>
          </div>
        )}

        {/* 命令展示 */}
        <div className="risk-confirm-section">
          <Text type="secondary" className="risk-confirm-label">
            待执行命令
          </Text>
          <pre className="risk-confirm-command">{command}</pre>
        </div>

        {/* 风险评估 */}
        <div className="risk-confirm-section">
          <Text type="secondary" className="risk-confirm-label">
            风险评估
          </Text>
          <div className="risk-confirm-assessment">
            <div className="risk-confirm-assessment-row">
              <span>风险等级</span>
              <Tag color={config.color}>{config.label}</Tag>
            </div>
            <div className="risk-confirm-assessment-row">
              <span>风险评分</span>
              <span>{risk.score}/100</span>
            </div>
            <div className="risk-confirm-assessment-row">
              <span>风险描述</span>
              <span>{risk.description}</span>
            </div>
            {risk.matchedRules.length > 0 && (
              <div className="risk-confirm-assessment-row">
                <span>命中规则</span>
                <div className="risk-confirm-rules">
                  {risk.matchedRules.map((rule, i) => (
                    <Tag key={i} className="risk-confirm-rule-tag">
                      {rule}
                    </Tag>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 提示信息 */}
        <div className="risk-confirm-hint">
          <Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
            {risk.level === 'CRITICAL'
              ? '极高风险操作需要您手动确认，无法自动执行。'
              : '请确认您了解此操作的风险后再执行。执行后可通过回滚命令撤销。'}
          </Paragraph>
        </div>
      </div>
    </Modal>
  )
}

export default RiskConfirm
