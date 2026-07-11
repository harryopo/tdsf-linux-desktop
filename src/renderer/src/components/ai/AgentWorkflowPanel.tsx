/**
 * Agent 工作流可视化组件 - AgentWorkflowPanel
 *
 * 职责：
 * - 7 步骤工作流：collect→analyze→reason→check→confirm→execute→verify
 * - 使用 Ant Design Steps 组件渲染
 * - 当前步骤加载动画（Loading）
 * - 已完成步骤绿色对勾
 * - 失败步骤红色错误图标
 * - 等待用户确认步骤脉冲高亮
 * - 每步显示：步骤名、描述、详情（Popover）
 *
 * 视觉设计：
 * - 苹果极简风格，细线条
 * - 横向 Steps，步骤间细线连接
 * - 当前步骤使用链接蓝高亮
 */
import { useState } from 'react'
import { Steps, Tooltip, Popover } from 'antd'
import {
  CheckOutlined,
  CloudSyncOutlined,
  SearchOutlined,
  BulbOutlined,
  SafetyOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
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

/** 步骤状态类型 */
type StepVisualStatus = 'completed' | 'current' | 'waiting' | 'pending' | 'error'

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

  /** 将视觉状态映射为 Ant Design Steps 状态 */
  const mapToStepsStatus = (
    status: StepVisualStatus
  ): 'finish' | 'process' | 'wait' | 'error' => {
    switch (status) {
      case 'completed':
        return 'finish'
      case 'current':
      case 'waiting':
        return 'process'
      case 'error':
        return 'error'
      default:
        return 'wait'
    }
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

  /** 当前步骤在配置中的索引（用于 Steps current 属性） */
  const currentIndex = STEP_CONFIG.findIndex((s) => s.key === state.currentStep)

  return (
    <div className="agent-workflow">
      {/* Steps 工作流 */}
      <Steps
        current={currentIndex >= 0 ? currentIndex : 0}
        size="small"
        className="agent-workflow-steps"
        items={STEP_CONFIG.map((stepConfig) => {
          const status = getStepStatus(stepConfig.key)
          const detail = state.stepDetails[stepConfig.key]
          const isWaiting = status === 'waiting'
          const isError = status === 'error'
          return {
            title: (
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
                <span
                  className={`agent-workflow-step-title ${isWaiting ? 'waiting' : ''} ${
                    isError ? 'error' : ''
                  }`}
                  onClick={() =>
                    setSelectedStep(selectedStep === stepConfig.key ? null : stepConfig.key)
                  }
                >
                  {stepConfig.label}
                </span>
              </Popover>
            ),
            description: (
              <Tooltip title={stepConfig.desc}>
                <span className="agent-workflow-step-desc">{stepConfig.desc}</span>
              </Tooltip>
            ),
            status: mapToStepsStatus(status),
            icon: getStepIcon(stepConfig.key, status),
          }
        })}
      />

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
