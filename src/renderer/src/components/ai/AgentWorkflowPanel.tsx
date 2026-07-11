/**
 * Agent 工作流可视化组件 - AgentWorkflowPanel
 *
 * 职责：
 * - 7 步骤横向时间轴：collect→analyze→reason→check→confirm→execute→verify
 * - 当前步骤高亮
 * - 已完成步骤打勾
 * - 等待确认步骤闪烁
 * - 每步骤可点击查看详情
 *
 * 视觉设计：
 * - 横向时间轴，步骤之间用细线连接
 * - 当前步骤使用链接蓝高亮
 * - 已完成步骤使用绿色打勾
 * - 等待确认步骤闪烁动画
 */
import { useState } from 'react'
import { Tooltip, Popover } from 'antd'
import {
  CheckOutlined,
  CloudSyncOutlined,
  SearchOutlined,
  BulbOutlined,
  SafetyOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import type { AgentWorkflowState, AgentStep } from '@shared/models'
import './AgentWorkflowPanel.css'

/** AgentWorkflowPanel 组件 Props */
interface AgentWorkflowPanelProps {
  /** Agent 工作流状态 */
  state: AgentWorkflowState | null
}

/** 步骤配置 */
const STEP_CONFIG: Array<{
  key: AgentStep
  label: string
  icon: React.ReactNode
  desc: string
}> = [
  { key: 'collect', label: '采集', icon: <CloudSyncOutlined />, desc: '采集环境信息' },
  { key: 'analyze', label: '分析', icon: <SearchOutlined />, desc: '分析日志和指标' },
  { key: 'reason', label: '推理', icon: <BulbOutlined />, desc: '生成修复建议' },
  { key: 'check', label: '检查', icon: <SafetyOutlined />, desc: '安全风险评估' },
  { key: 'confirm', label: '确认', icon: <TeamOutlined />, desc: '等待人工确认' },
  { key: 'execute', label: '执行', icon: <ThunderboltOutlined />, desc: '执行修复命令' },
  { key: 'verify', label: '验证', icon: <CheckCircleOutlined />, desc: '验证修复结果' },
]

/** AgentWorkflowPanel Agent 工作流可视化 */
const AgentWorkflowPanel: React.FC<AgentWorkflowPanelProps> = ({ state }) => {
  /** 当前选中的步骤（用于查看详情） */
  const [selectedStep, setSelectedStep] = useState<AgentStep | null>(null)

  // 无状态时显示空占位
  if (!state) {
    return (
      <div className="agent-workflow-empty">
        <span>Agent 工作流未启动</span>
      </div>
    )
  }

  /** 判断步骤状态 */
  const getStepStatus = (step: AgentStep): 'completed' | 'current' | 'waiting' | 'pending' => {
    if (state.completedSteps.includes(step)) return 'completed'
    if (step === state.currentStep) {
      // 等待人工确认时闪烁
      if (state.waitingForConfirmation && step === 'confirm') return 'waiting'
      return 'current'
    }
    return 'pending'
  }

  return (
    <div className="agent-workflow">
      {/* 步骤时间轴 */}
      <div className="agent-workflow-timeline">
        {STEP_CONFIG.map((stepConfig, index) => {
          const status = getStepStatus(stepConfig.key)
          const detail = state.stepDetails[stepConfig.key]
          return (
            <div key={stepConfig.key} className="agent-workflow-step-container">
              {/* 步骤节点 */}
              <Popover
                content={
                  <div className="agent-workflow-detail">
                    <div className="agent-workflow-detail-title">
                      {stepConfig.label} - {stepConfig.desc}
                    </div>
                    {detail && (
                      <div className="agent-workflow-detail-content">{detail}</div>
                    )}
                  </div>
                }
                title={stepConfig.label}
                trigger="click"
                open={selectedStep === stepConfig.key}
                onOpenChange={(open) => {
                  setSelectedStep(open ? stepConfig.key : null)
                }}
              >
                <Tooltip title={stepConfig.desc}>
                  <div
                    className={`agent-workflow-step ${status}`}
                    onClick={() =>
                      setSelectedStep(selectedStep === stepConfig.key ? null : stepConfig.key)
                    }
                  >
                    {/* 步骤图标 */}
                    <div className="agent-workflow-step-icon">
                      {status === 'completed' ? <CheckOutlined /> : stepConfig.icon}
                    </div>
                    {/* 步骤标签 */}
                    <span className="agent-workflow-step-label">{stepConfig.label}</span>
                  </div>
                </Tooltip>
              </Popover>

              {/* 连接线（最后一个步骤不显示） */}
              {index < STEP_CONFIG.length - 1 && (
                <div
                  className={`agent-workflow-connector ${
                    status === 'completed' ? 'completed' : ''
                  }`}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* 错误信息 */}
      {state.error && (
        <div className="agent-workflow-error">
          <span>错误: {state.error}</span>
        </div>
      )}
    </div>
  )
}

export default AgentWorkflowPanel
