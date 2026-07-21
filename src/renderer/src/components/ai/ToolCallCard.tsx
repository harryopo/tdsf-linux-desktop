/**
 * 工具调用卡片组件（v0.5.0）
 *
 * 在 ChatPanel 消息列表中展示 LLM 调用的工具及其结果。
 * 设计：折叠面板，hover 展开，固定高度可滚动
 *
 * 设计原则（v0.7.0 UI 规范）：
 * - 工具类型用 Ant Design 图标代替 emoji（统一图标语言）
 * - 状态用 Tag 颜色 + 图标（状态色语义化）
 */
import React from 'react'
import { Tag, Tooltip, Collapse } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  CodeOutlined,
  BookOutlined,
  RocketOutlined,
  ExperimentOutlined,
  LineChartOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import type { ReactNode } from 'react'
import type { ToolCallProgress } from '@shared/llm-tool-types'
import { TOOL_RISK_LABELS, TOOL_RISK_COLORS } from '@shared/llm-tool-types'

/** 工具名 → 图标 + label 映射（统一 Ant Design Icons 体系） */
const TOOL_DISPLAY: Record<string, { icon: ReactNode; label: string }> = {
  ssh_exec: { icon: <CodeOutlined />, label: 'SSH 命令执行' },
  tutorial_search: { icon: <BookOutlined />, label: '教程搜索' },
  deploy_list_templates: { icon: <RocketOutlined />, label: '部署模板列表' },
  profiler_run: { icon: <ExperimentOutlined />, label: '系统架构感知' },
  monitor_get_data: { icon: <LineChartOutlined />, label: '监控数据获取' },
}

interface ToolCallCardProps {
  call: ToolCallProgress
}

/** 阶段对应的图标 */
function PhaseIcon({ phase }: { phase: ToolCallProgress['phase'] }) {
  switch (phase) {
    case 'start':
    case 'executing':
      return <LoadingOutlined spin style={{ color: '#1890ff' }} />
    case 'success':
      return <CheckCircleOutlined style={{ color: '#52c41a' }} />
    case 'failed':
      return <CloseCircleOutlined style={{ color: '#f5222d' }} />
    case 'awaiting-approval':
      return <ExclamationCircleOutlined style={{ color: '#fa8c16' }} />
    default:
      return <ClockCircleOutlined style={{ color: '#999' }} />
  }
}

/** 阶段对应的中文标签 */
function PhaseLabel({ phase }: { phase: ToolCallProgress['phase'] }): string {
  switch (phase) {
    case 'start': return '准备中'
    case 'awaiting-approval': return '等待审批'
    case 'executing': return '执行中'
    case 'success': return '已完成'
    case 'failed': return '已失败'
    default: return '未知'
  }
}

const ToolCallCard: React.FC<ToolCallCardProps> = ({ call }) => {
  const display = TOOL_DISPLAY[call.toolId] ?? { icon: <ToolOutlined />, label: call.toolId }
  const phaseLabel = PhaseLabel({ phase: call.phase })

  // 结果摘要（最多 5 行）
  const resultSummary = call.result?.data
    ? JSON.stringify(call.result.data, null, 2).split('\n').slice(0, 8).join('\n')
    : call.result?.error
      ? `错误: ${call.result.error}`
      : '等待结果...'

  return (
    <div className="tool-call-card">
      <div className="tool-call-header">
        <PhaseIcon phase={call.phase} />
        <span className="tool-call-icon">{display.icon}</span>
        <span className="tool-call-label">{display.label}</span>
        <Tag color={call.risk ? TOOL_RISK_COLORS[call.risk] : 'default'}>
          {call.risk ? TOOL_RISK_LABELS[call.risk] : 'unknown'}风险
        </Tag>
        <span className="tool-call-phase">{phaseLabel}</span>
        {call.result && (
          <Tooltip title="执行耗时">
            <span className="tool-call-duration">{call.result.durationMs}ms</span>
          </Tooltip>
        )}
      </div>
      <Collapse
        ghost
        size="small"
        items={[
          {
            key: 'args',
            label: <span style={{ fontSize: 12 }}>参数 / 结果</span>,
            children: (
              <pre className="tool-call-details">
                {call.args && (
                  <>
                    <strong>参数：</strong>
                    {'\n'}
                    {JSON.stringify(call.args, null, 2)}
                    {'\n\n'}
                  </>
                )}
                <strong>结果：</strong>
                {'\n'}
                {resultSummary}
              </pre>
            ),
          },
        ]}
      />
    </div>
  )
}

export default ToolCallCard
