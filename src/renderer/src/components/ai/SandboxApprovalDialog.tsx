/**
 * Sandbox 命令审批对话框（v0.9.3 §11 改进点 4 P2-C）
 *
 * 替代旧的 ToolApprovalModal 中"只显示命令 + 风险等级"的简陋形式，
 * 展示完整的审批上下文：
 * - 命令文本 + 风险等级 + 风险原因
 * - 可能的副作用（v0.9.3 §11 改进点 4 新增）
 * - 推荐的回滚命令（v0.9.3 §11 改进点 4 新增）
 * - 建议的更安全替代方案（v0.9.3 §11 改进点 4 新增）
 *
 * 用户从"按按钮确认"升级为"理解后确认"，符合教学赋能定位。
 *
 * 方案书依据：v0.9.3 §11.1 改进点 4
 */

import React, { useState } from 'react'
import { Modal, Button, Tag, Space, Typography, Alert, Divider, Tooltip, Input } from 'antd'
import {
  ExclamationCircleOutlined,
  CheckOutlined,
  CloseOutlined,
  WarningOutlined,
  RollbackOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import type { SandboxApprovalRequest } from '../../types/electron'
import { isElectronAPIAvailable } from '../../utils/electron-api'

const { Text, Paragraph } = Typography

/** 风险等级 → 颜色映射 */
const RISK_COLOR: Record<string, string> = {
  low: 'success',
  medium: 'warning',
  high: 'error',
}

/** 风险等级 → 中文标签映射 */
const RISK_LABEL: Record<string, string> = {
  low: '低危',
  medium: '中危',
  high: '高危',
}

interface SandboxApprovalDialogProps {
  /** 待审批请求列表（支持多个排队） */
  requests: SandboxApprovalRequest[]
  /** 审批完成后回调（callId → 已处理） */
  onResolved: (callId: string) => void
}

const SandboxApprovalDialog: React.FC<SandboxApprovalDialogProps> = ({
  requests,
  onResolved,
}) => {
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState<string | null>(null)

  /** 当前展示的请求（取第一个） */
  const currentRequest = requests[0] ?? null

  if (!currentRequest) return null

  /** 批准当前请求 */
  const handleApprove = async () => {
    if (!isElectronAPIAvailable() || !window.electronAPI?.sandboxApprove) return
    setSubmitting(currentRequest.callId)
    try {
      await window.electronAPI.sandboxApprove(currentRequest.callId, true)
      onResolved(currentRequest.callId)
    } catch (err) {
      console.error('[SandboxApprovalDialog] 批准失败:', err)
    } finally {
      setSubmitting(null)
    }
  }

  /** 拒绝当前请求 */
  const handleReject = async () => {
    if (!isElectronAPIAvailable() || !window.electronAPI?.sandboxApprove) return
    setSubmitting(currentRequest.callId)
    try {
      const reason = rejectReasons[currentRequest.callId] || '用户拒绝执行'
      // sandboxApprove 第二参数为 approved: boolean，拒绝时不传 reason
      // 但日志中可记录（此处 reason 仅用于本地状态展示）
      console.info('[SandboxApprovalDialog] 用户拒绝原因:', reason)
      await window.electronAPI.sandboxApprove(currentRequest.callId, false)
      onResolved(currentRequest.callId)
    } catch (err) {
      console.error('[SandboxApprovalDialog] 拒绝失败:', err)
    } finally {
      setSubmitting(null)
    }
  }

  const isHighRisk = currentRequest.risk === 'high'
  const riskColor = RISK_COLOR[currentRequest.risk] ?? 'default'
  const riskLabel = RISK_LABEL[currentRequest.risk] ?? currentRequest.risk
  const currentRejectReason = rejectReasons[currentRequest.callId] ?? ''

  return (
    <Modal
      open={!!currentRequest}
      title={
        <Space>
          <ExclamationCircleOutlined style={{ color: isHighRisk ? 'var(--trae-status-error-default, #ff4d4f)' : 'var(--trae-status-alert-default, #faad14)' }} />
          <span>沙箱命令审批</span>
          {requests.length > 1 && (
            <Tag color="processing">待审批 {requests.length} 条</Tag>
          )}
        </Space>
      }
      onCancel={() => onResolved(currentRequest.callId)}
      footer={null}
      maskClosable={false}
      width={720}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {/* 顶部告警：命令 + 风险等级 */}
        <Alert
          type={isHighRisk ? 'error' : 'warning'}
          message={
            <Space>
              <span>待执行的命令：</span>
              <Tag color={riskColor}>{riskLabel}风险</Tag>
            </Space>
          }
          description={
            <Paragraph style={{ marginBottom: 0 }}>
              <pre
                style={{
                  background: 'var(--color-bg-inset, #1e1e1e)',
                  color: 'var(--color-text-primary, #d4d4d4)',
                  padding: 12,
                  borderRadius: 6,
                  overflow: 'auto',
                  maxHeight: 160,
                  margin: 0,
                  fontFamily: 'var(--font-family-mono, monospace)',
                  fontSize: 13,
                }}
              >
                {currentRequest.command}
              </pre>
            </Paragraph>
          }
        />

        {/* 风险原因列表 */}
        {currentRequest.reasons.length > 0 && (
          <div>
            <Text strong>
              <WarningOutlined style={{ marginRight: 6 }} />
              风险原因：
            </Text>
            <div style={{ marginTop: 8 }}>
              {currentRequest.reasons.map((reason, idx) => (
                <Tag
                  key={`reason-${idx}`}
                  color={riskColor}
                  style={{ marginBottom: 4 }}
                >
                  {reason}
                </Tag>
              ))}
            </div>
          </div>
        )}

        {/* 可能的副作用（v0.9.3 §11 改进点 4 P2-C 新增） */}
        {currentRequest.sideEffects && currentRequest.sideEffects.length > 0 && (
          <div>
            <Text strong type="danger">
              <ThunderboltOutlined style={{ marginRight: 6 }} />
              可能的副作用：
            </Text>
            <ul style={{ margin: '8px 0 0 20px', padding: 0 }}>
              {currentRequest.sideEffects.map((effect, idx) => (
                <li
                  key={`effect-${idx}`}
                  style={{
                    color: 'var(--color-text-secondary)',
                    fontSize: 13,
                    marginBottom: 4,
                  }}
                >
                  {effect}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 推荐的回滚命令（v0.9.3 §11 改进点 4 P2-C 新增） */}
        {currentRequest.rollbackCommand && (
          <div>
            <Text strong type="warning">
              <RollbackOutlined style={{ marginRight: 6 }} />
              推荐的回滚命令：
            </Text>
            <Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
              <pre
                style={{
                  background: 'var(--color-bg-inset, #f5f5f5)',
                  color: 'var(--color-text-primary, #d4d4d4)',
                  padding: 10,
                  borderRadius: 6,
                  overflow: 'auto',
                  maxHeight: 80,
                  margin: 0,
                  fontFamily: 'var(--font-family-mono, monospace)',
                  fontSize: 12,
                  border: '1px solid var(--color-border, #d9d9d9)',
                }}
              >
                {currentRequest.rollbackCommand}
              </pre>
            </Paragraph>
          </div>
        )}

        {/* 建议的更安全替代方案（v0.9.3 §11 改进点 4 P2-C 新增） */}
        {currentRequest.saferAlternative && (
          <Alert
            type="info"
            showIcon
            icon={<SafetyCertificateOutlined />}
            message={
              <Space direction="vertical" size={4}>
                <Text strong>建议的更安全替代方案：</Text>
                <Text>{currentRequest.saferAlternative}</Text>
              </Space>
            }
          />
        )}

        <Divider style={{ margin: '4px 0' }} />

        {/* 会话信息 */}
        {currentRequest.sessionId && (
          <Tooltip title="会话 ID（用于审计追溯）">
            <Text type="secondary" style={{ fontSize: 11 }}>
              会话 ID：{currentRequest.sessionId}
            </Text>
          </Tooltip>
        )}

        {/* 拒绝原因输入（可选） */}
        <div>
          <Text type="secondary">拒绝原因（可选）：</Text>
          <Input.TextArea
            value={currentRejectReason}
            onChange={(e) =>
              setRejectReasons((prev) => ({
                ...prev,
                [currentRequest.callId]: e.target.value,
              }))
            }
            placeholder="例如：命令风险太高 / 我想用别的方法"
            rows={2}
            style={{ marginTop: 6 }}
          />
        </div>

        {/* 操作按钮 */}
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button
            danger
            icon={<CloseOutlined />}
            onClick={handleReject}
            loading={submitting === currentRequest.callId}
          >
            拒绝
          </Button>
          <Button
            type="primary"
            icon={<CheckOutlined />}
            onClick={handleApprove}
            loading={submitting === currentRequest.callId}
            disabled={!isElectronAPIAvailable() || !window.electronAPI?.sandboxApprove}
          >
            {isHighRisk ? '确认执行（高危）' : '批准执行'}
          </Button>
        </Space>
      </Space>
    </Modal>
  )
}

export default SandboxApprovalDialog
