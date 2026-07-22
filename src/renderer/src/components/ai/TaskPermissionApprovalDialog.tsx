/**
 * TaskPermissionApprovalDialog — Subagent 调度审批弹窗（v0.9.3 §11 遗留项 2 P2-H）
 *
 * 职责：
 * - 监听 onTaskPermissionApprovalRequest 事件，展示审批请求队列
 * - 显示 taskId / subagentName / inputSummary / mode
 * - 用户批准/拒绝（可选填拒绝原因 + 记住决策）
 * - 调用 taskPermissionApprove IPC 响应
 *
 * 与 SandboxApprovalDialog 的区别：
 * - SandboxApprovalDialog：审批"命令执行"（sandbox:execute）
 * - TaskPermissionApprovalDialog：审批"Subagent 调度"（task-protocol step 2）
 * - 两者独立队列，避免混淆
 *
 * 三态权限审批（R12）：
 * - mode='always'：每次都询问用户（默认，弹窗显示）
 * - mode='auto'：自动允许（不推送，本弹窗不显示）
 * - mode='never'：自动拒绝（不推送，本弹窗不显示）
 *
 * 设计原则：
 * - 与 SandboxApprovalDialog 视觉风格一致（暗色 + brand 色强调）
 * - 单弹窗一次只处理一个请求（队列首部）
 * - "记住决策"复选框默认不勾选（避免用户误操作）
 * - 拒绝时必须填写原因（可选，但推荐，便于审计）
 *
 * 方案书依据：v0.9.3 §11 遗留项 2 + R12 三态权限审批
 */
import React, { useState, useEffect, useCallback } from 'react'
import { Modal, Button, Input, Checkbox, Tag, Typography, Space, Divider, message } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  RobotOutlined,
  ClockCircleOutlined,
  SafetyOutlined,
} from '@ant-design/icons'
import type { TaskPermissionApprovalRequest, TaskPermissionDecision } from '../../types/electron'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import './TaskPermissionApprovalDialog.css'

const { Text, Paragraph } = Typography

interface TaskPermissionApprovalDialogProps {
  /** 待审批的请求队列（首部优先处理） */
  requests: TaskPermissionApprovalRequest[]
  /** 审批请求已处理回调（callId 已从队列移除） */
  onResolved: (callId: string) => void
}

const TaskPermissionApprovalDialog: React.FC<TaskPermissionApprovalDialogProps> = ({
  requests,
  onResolved,
}) => {
  // 拒绝原因输入（callId → reason）
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({})
  // "记住决策"复选框（callId → remember）
  const [rememberDecisions, setRememberDecisions] = useState<Record<string, boolean>>({})
  // 提交中标记（callId，防止重复点击）
  const [submitting, setSubmitting] = useState<string | null>(null)
  // 倒计时（秒，30 → 0）
  const [countdown, setCountdown] = useState<number>(30)

  const currentRequest = requests[0] ?? null

  // 倒计时效果：每秒递减，到 0 时主进程会自动拒绝
  useEffect(() => {
    if (!currentRequest) {
      setCountdown(30)
      return
    }
    setCountdown(30)
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => clearInterval(timer)
  }, [currentRequest])

  /**
   * 批准当前请求
   */
  const handleApprove = useCallback(async () => {
    if (!currentRequest || !isElectronAPIAvailable()) return
    const { callId } = currentRequest
    setSubmitting(callId)
    try {
      const decision: TaskPermissionDecision = {
        approved: true,
        remember: rememberDecisions[callId] ?? false,
      }
      await window.electronAPI.taskPermissionApprove(callId, decision)
      message.success(`已批准 Subagent "${currentRequest.subagentName}" 调度`)
      onResolved(callId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      message.error(`批准失败：${msg}`)
    } finally {
      setSubmitting(null)
    }
  }, [currentRequest, rememberDecisions, onResolved])

  /**
   * 拒绝当前请求
   */
  const handleReject = useCallback(async () => {
    if (!currentRequest || !isElectronAPIAvailable()) return
    const { callId } = currentRequest
    setSubmitting(callId)
    try {
      const decision: TaskPermissionDecision = {
        approved: false,
        rejectReason: rejectReasons[callId]?.trim() || undefined,
        remember: rememberDecisions[callId] ?? false,
      }
      await window.electronAPI.taskPermissionApprove(callId, decision)
      message.info(`已拒绝 Subagent "${currentRequest.subagentName}" 调度`)
      onResolved(callId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      message.error(`拒绝失败：${msg}`)
    } finally {
      setSubmitting(null)
    }
  }, [currentRequest, rejectReasons, rememberDecisions, onResolved])

  if (!currentRequest) return null

  const isSubmitting = submitting === currentRequest.callId

  return (
    <Modal
      open={true}
      title={
        <Space>
          <SafetyOutlined style={{ color: 'var(--trae-text-brand)' }} />
          <span>Subagent 调度审批</span>
          <Tag color="blue">{currentRequest.mode.toUpperCase()}</Tag>
        </Space>
      }
      closable={false}
      maskClosable={false}
      width={520}
      footer={
        <div className="task-permission-footer">
          <div className="task-permission-countdown">
            <ClockCircleOutlined />
            <span>{countdown}s 后自动拒绝</span>
          </div>
          <Space>
            <Button
              type="primary"
              danger
              icon={<CloseCircleOutlined />}
              onClick={handleReject}
              loading={isSubmitting}
              disabled={isSubmitting}
            >
              拒绝
            </Button>
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              onClick={handleApprove}
              loading={isSubmitting}
              disabled={isSubmitting}
            >
              批准调度
            </Button>
          </Space>
        </div>
      }
      className="task-permission-dialog"
    >
      <div className="task-permission-content">
        {/* Subagent 信息 */}
        <div className="task-permission-section">
          <div className="task-permission-row">
            <RobotOutlined className="task-permission-icon" />
            <Text strong className="task-permission-subagent-name">
              {currentRequest.subagentName}
            </Text>
          </div>
          <div className="task-permission-meta">
            <span className="task-permission-label">任务 ID：</span>
            <Text code className="task-permission-task-id">
              {currentRequest.taskId}
            </Text>
          </div>
          {currentRequest.parentSessionId && (
            <div className="task-permission-meta">
              <span className="task-permission-label">父会话：</span>
              <Text code>{currentRequest.parentSessionId}</Text>
            </div>
          )}
          {currentRequest.correlationId && (
            <div className="task-permission-meta">
              <span className="task-permission-label">关联 ID：</span>
              <Text code>{currentRequest.correlationId}</Text>
            </div>
          )}
        </div>

        <Divider className="task-permission-divider" />

        {/* 输入摘要 */}
        {currentRequest.inputSummary && (
          <div className="task-permission-section">
            <div className="task-permission-section-title">任务输入摘要</div>
            <Paragraph className="task-permission-input-summary">
              {currentRequest.inputSummary}
            </Paragraph>
          </div>
        )}

        {/* 权限模式说明 */}
        <div className="task-permission-section task-permission-mode-info">
          <div className="task-permission-section-title">权限模式</div>
          <div className="task-permission-mode-description">
            {currentRequest.mode === 'always' && (
              <Text type="secondary">
                当前模式 <Tag color="orange">ALWAYS</Tag>：每次调度该 Subagent 都会询问用户批准。
                如需自动批准，可在设置中切换为 AUTO 模式。
              </Text>
            )}
            {currentRequest.mode === 'auto' && (
              <Text type="secondary">
                当前模式 <Tag color="green">AUTO</Tag>：自动批准（本弹窗不应出现，可能是 UI 误触发）。
              </Text>
            )}
            {currentRequest.mode === 'never' && (
              <Text type="secondary">
                当前模式 <Tag color="red">NEVER</Tag>：自动拒绝（本弹窗不应出现，可能是 UI 误触发）。
              </Text>
            )}
          </div>
        </div>

        <Divider className="task-permission-divider" />

        {/* 拒绝原因（可选） */}
        <div className="task-permission-section">
          <div className="task-permission-section-title">拒绝原因（可选，便于审计）</div>
          <Input.TextArea
            value={rejectReasons[currentRequest.callId] ?? ''}
            onChange={(e) =>
              setRejectReasons((prev) => ({
                ...prev,
                [currentRequest.callId]: e.target.value,
              }))
            }
            placeholder="如：该 Subagent 不需要调度，或输入超出预期范围..."
            rows={2}
            maxLength={200}
            showCount
            disabled={isSubmitting}
            className="task-permission-reject-reason"
          />
        </div>

        {/* 记住决策 */}
        <div className="task-permission-section task-permission-remember">
          <Checkbox
            checked={rememberDecisions[currentRequest.callId] ?? false}
            onChange={(e) =>
              setRememberDecisions((prev) => ({
                ...prev,
                [currentRequest.callId]: e.target.checked,
              }))
            }
            disabled={isSubmitting}
          >
            记住决策（下次该 Subagent 调度自动应用，v1.6 实现持久化规则表）
          </Checkbox>
        </div>

        {/* 队列信息 */}
        {requests.length > 1 && (
          <div className="task-permission-queue-info">
            <Text type="secondary">队列中还有 {requests.length - 1} 个待审批请求</Text>
          </div>
        )}
      </div>
    </Modal>
  )
}

export default TaskPermissionApprovalDialog
