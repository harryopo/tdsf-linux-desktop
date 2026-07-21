/**
 * ToolTag 工具类型 Tag（v0.7.0 UI 规范）
 *
 * 统一工具类型标签：图标 + 文本 + 主题色
 * 用于 LLM Tool Calling 卡片、教程关联、监控场景
 *
 * @example
 *   <ToolTag toolId="ssh_exec" />
 *   <ToolTag toolId="tutorial_search" showLabel />
 */
import React from 'react'
import { Tag } from 'antd'
import {
  CodeOutlined,
  BookOutlined,
  RocketOutlined,
  ExperimentOutlined,
  LineChartOutlined,
  ToolOutlined,
} from '@ant-design/icons'

export interface ToolTagProps {
  /** 工具 ID */
  toolId: string
  /** 显示文本（默认根据 toolId 自动映射） */
  label?: string
  /** 紧凑模式 */
  compact?: boolean
}

const TOOL_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  ssh_exec: { icon: <CodeOutlined />, label: 'SSH 命令执行', color: 'blue' },
  tutorial_search: { icon: <BookOutlined />, label: '教程搜索', color: 'purple' },
  deploy_list_templates: { icon: <RocketOutlined />, label: '部署模板', color: 'volcano' },
  profiler_run: { icon: <ExperimentOutlined />, label: '系统架构感知', color: 'magenta' },
  monitor_get_data: { icon: <LineChartOutlined />, label: '监控数据', color: 'cyan' },
}

const ToolTag: React.FC<ToolTagProps> = ({ toolId, label, compact }) => {
  const config = TOOL_CONFIG[toolId] ?? {
    icon: <ToolOutlined />,
    label: toolId,
    color: 'default',
  }
  return (
    <Tag
      color={config.color}
      icon={config.icon}
      style={{
        margin: 0,
        fontSize: compact ? 11 : 12,
      }}
    >
      {label ?? config.label}
    </Tag>
  )
}

export default ToolTag
