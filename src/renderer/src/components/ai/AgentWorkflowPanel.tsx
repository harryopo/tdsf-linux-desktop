/**
 * Agent 工作流可视化组件 - AgentWorkflowPanel
 *
 * 职责：
 * - 7 步骤工作流：collect→analyze→reason→check→confirm→execute→verify
 * - 使用自定义纵向步骤列表（摆脱 Ant Design Steps 原生样式）
 * - 当前步骤加载动画（Loading）
 * - 已完成步骤绿色对勾
 * - 失败步骤红色错误图标
 * - 等待用户确认步骤脉冲高亮
 * - 每步显示：步骤名、描述、详情（Popover）
 *
 * 视觉设计（v2.2）：
 * - 自定义步骤列表，左侧 3px 状态色条
 * - 状态图标与标签同行
 * - 与全局卡片设计语言一致
 */
import { useState } from 'react'
import { Tooltip, Popover } from 'antd'
import {
  CheckOutlined,
  CloudSyncOutlined,
  SearchOutlined,
  ExperimentOutlined,
  SafetyOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  CheckCircleFilled,
  CloseCircleOutlined,
  LoadingOutlined,
} from '@ant-design/icons'
import type { AgentWorkflowState, AgentStep } from '@shared/models'
import './AgentWorkflowPanel.css'

/** AgentWorkflowPanel 组件 Props */
interface AgentWorkflowPanelProps {
  /** Agent 工作流状态 */
  state: AgentWorkflowState | null
}

/** 步骤配置（v2.1：reason → ExperimentOutlined 学术试管，verify → CheckCircleFilled 实心） */
const STEP_CONFIG: Array<{
  key: AgentStep
  label: string
  icon: React.ReactNode
  desc: string
}> = [
  { key: 'collect', label: '采集', icon: <CloudSyncOutlined />, desc: '采集环境信息' },
  { key: 'analyze', label: '分析', icon: <SearchOutlined />, desc: '分析日志和指标' },
  { key: 'reason', label: '推理', icon: <ExperimentOutlined />, desc: '生成修复建议' },
  { key: 'check', label: '检查', icon: <SafetyOutlined />, desc: '安全风险评估' },
  { key: 'confirm', label: '确认', icon: <TeamOutlined />, desc: '等待人工确认' },
  { key: 'execute', label: '执行', icon: <ThunderboltOutlined />, desc: '执行修复命令' },
  { key: 'verify', label: '验证', icon: <CheckCircleFilled />, desc: '验证修复结果' },
]

/** 步骤状态类型 */
type StepVisualStatus = 'completed' | 'current' | 'waiting' | 'pending' | 'error'

/** AgentWorkflowPanel Agent 工作流可视化 */
const AgentWorkflowPanel: React.FC<AgentWorkflowPanelProps> = ({ state }) => {
  /** 当前选中的步骤（用于查看详情） */
  const [selectedStep, setSelectedStep] = useState<AgentStep | null>(null)

  // 无状态时显示空占位
  if (!state) {
    return (
      <div className="agent-workflow-panel">
        <div className="agent-workflow-empty">
          <span>Agent 工作流未启动</span>
        </div>
      </div>
    )
  }

  /** 判断步骤视觉状态 */
  const getStepStatus = (step: AgentStep): StepVisualStatus => {
    // 存在错误且当前步骤即为失败步骤
    if (state.error && step === state.currentStep) return 'error'
    if (state.completedSteps.includes(step)) return 'completed'
    if (step === state.currentStep) {
      // 等待人工确认时高亮
      if (state.waitingForConfirmation && step === 'confirm') return 'waiting'
      return 'current'
    }
    return 'pending'
  }

  /** 获取步骤图标 */
  const getStepIcon = (step: AgentStep, status: StepVisualStatus): React.ReactNode => {
    if (status === 'completed') return <CheckOutlined />
    if (status === 'error') return <CloseCircleOutlined />
    if (status === 'current') return <LoadingOutlined />
    if (status === 'waiting') return <TeamOutlined />
    const config = STEP_CONFIG.find((s) => s.key === step)
    return config?.icon ?? null
  }

  /** 头部状态点样式 */
  const headerStatusClass = state.error ? 'error' : 'running'

  return (
    <div className="agent-workflow-panel">
      {/* 工作流状态头部 */}
      <div className="agent-workflow-header">
        <span className={`agent-workflow-status-dot ${headerStatusClass}`} />
        <span>Agent 工作流</span>
      </div>

      {/* 自定义步骤列表 */}
      <div className="agent-workflow-steps">
        {STEP_CONFIG.map((stepConfig, index) => {
          const status = getStepStatus(stepConfig.key)
          const detail = state.stepDetails[stepConfig.key]
          const icon = getStepIcon(stepConfig.key, status)

          return (
            <Popover
              key={stepConfig.key}
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
              onOpenChange={(open) => setSelectedStep(open ? stepConfig.key : null)}
            >
              <Tooltip title={stepConfig.desc}>
                <div
                  className={`agent-workflow-step ${status}`}
                  onClick={() =>
                    setSelectedStep(
                      selectedStep === stepConfig.key ? null : stepConfig.key
                    )
                  }
                >
                  <span className="agent-workflow-step-num">{index + 1}</span>
                  <span className="agent-workflow-step-icon">{icon}</span>
                  <span className="agent-workflow-step-label">{stepConfig.label}</span>
                </div>
              </Tooltip>
            </Popover>
          )
        })}
      </div>

      {/* 错误信息 */}
      {state.error && (
        <div className="agent-workflow-error">
          <CloseCircleOutlined style={{ marginRight: 6 }} />
          <span>错误: {state.error}</span>
        </div>
      )}

      {/* 等待确认提示 */}
      {state.waitingForConfirmation && state.currentStep === 'confirm' && (
        <div className="agent-workflow-waiting-hint">
          <TeamOutlined style={{ marginRight: 6 }} />
          <span>等待人工确认，请审核决策卡片</span>
        </div>
      )}
    </div>
  )
}

export default AgentWorkflowPanel
