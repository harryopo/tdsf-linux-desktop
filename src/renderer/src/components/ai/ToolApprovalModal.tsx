/**
 * 工具调用审批弹窗（v0.5.0）
 *
 * high 风险工具（ssh_exec）执行前必须经用户审批。
 * 显示：工具名 / 参数 / 风险等级 / 风险原因 / 命令预览（仅 ssh_exec）
 */
import React, { useState } from 'react'
import { Modal, Button, Input, Tag, Space, Typography, Alert } from 'antd'
import { ExclamationCircleOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons'
import type { ToolApprovalRequest } from '@shared/llm-tool-types'
import { TOOL_RISK_LABELS, TOOL_RISK_COLORS } from '@shared/llm-tool-types'
import { isElectronAPIAvailable } from '../../utils/electron-api'

const { Text, Paragraph } = Typography

interface ToolApprovalModalProps {
  request: ToolApprovalRequest | null
  onClose: () => void
}

/** 工具名 → 中文 label 映射 */
const TOOL_LABELS: Record<string, string> = {
  ssh_exec: 'SSH 命令执行',
  tutorial_search: '教程搜索',
  deploy_list_templates: '部署模板列表',
  profiler_run: '系统架构感知',
  monitor_get_data: '监控数据获取',
}

const ToolApprovalModal: React.FC<ToolApprovalModalProps> = ({ request, onClose }) => {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!request) return null

  const label = TOOL_LABELS[request.toolId] ?? request.toolId
  const isHighRisk = request.risk === 'high' || request.risk === 'critical'

  const handleApprove = async () => {
    if (!isElectronAPIAvailable()) return
    setSubmitting(true)
    try {
      await window.electronAPI.llmToolApprove({
        callId: request.callId,
        approved: true,
      })
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  const handleReject = async () => {
    if (!isElectronAPIAvailable()) return
    setSubmitting(true)
    try {
      await window.electronAPI.llmToolApprove({
        callId: request.callId,
        approved: false,
        reason: reason || '用户拒绝',
      })
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={!!request}
      title={
        <Space>
          <ExclamationCircleOutlined style={{ color: TOOL_RISK_COLORS[request.risk] }} />
          <span>工具调用审批</span>
        </Space>
      }
      onCancel={onClose}
      footer={null}
      maskClosable={false}
      width={640}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          type={isHighRisk ? 'error' : 'warning'}
          message={
            <Space>
              <span>LLM 想要调用工具：</span>
              <Text strong>{label}</Text>
              <Tag color={TOOL_RISK_COLORS[request.risk]}>
                {TOOL_RISK_LABELS[request.risk]}风险
              </Tag>
            </Space>
          }
          description={request.riskReason}
        />

        {request.commandPreview && (
          <div>
            <Text strong>命令预览：</Text>
            <Paragraph>
              <pre
                style={{
                  background: 'var(--trae-bg-code-block, #1e1e1e)',
                  color: 'var(--trae-code-text, #d4d4d4)',
                  padding: 12,
                  borderRadius: 4,
                  overflow: 'auto',
                  maxHeight: 200,
                }}
              >
                {request.commandPreview}
              </pre>
            </Paragraph>
          </div>
        )}

        <div>
          <Text strong>完整参数：</Text>
          <Paragraph>
            <pre
              style={{
                background: 'var(--bg-secondary, #f5f5f5)',
                padding: 12,
                borderRadius: 4,
                overflow: 'auto',
                maxHeight: 160,
                fontSize: 12,
              }}
            >
              {JSON.stringify(request.args, null, 2)}
            </pre>
          </Paragraph>
        </div>

        <div>
          <Text type="secondary">拒绝原因（可选）：</Text>
          <Input.TextArea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例如：命令看起来不对 / 我想用别的方法"
            rows={2}
          />
        </div>

        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button
            danger
            icon={<CloseOutlined />}
            onClick={handleReject}
            loading={submitting}
          >
            拒绝
          </Button>
          <Button
            type="primary"
            icon={<CheckOutlined />}
            onClick={handleApprove}
            loading={submitting}
            disabled={!isElectronAPIAvailable()}
          >
            批准执行
          </Button>
        </Space>
      </Space>
    </Modal>
  )
}

export default ToolApprovalModal
