/**
 * RiskTag 风险等级 Tag（v0.7.0 UI 规范）
 *
 * 统一风险等级标签：图标 + 文本 + 语义化颜色
 * 替代历史 emoji + 颜色散乱方案
 *
 * @example
 *   <RiskTag level="critical" />
 *   <RiskTag level="high" label="高风险命令" />
 */
import React from 'react'
import { Tag } from 'antd'
import {
  CheckCircleFilled,
  MinusCircleOutlined,
  ExclamationCircleOutlined,
  WarningOutlined,
  WarningFilled,
  CloseCircleFilled,
  InfoCircleOutlined,
} from '@ant-design/icons'

export type RiskLevel =
  | 'safe'
  | 'low'
  | 'medium'
  | 'high'
  | 'critical'
  | 'info'
  | 'SAFE'
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'CRITICAL'

export interface RiskTagProps {
  /** 风险等级（兼容大写 CRITICAL/小写 critical） */
  level: RiskLevel
  /** 自定义标签文本 */
  label?: string
  /** 紧凑模式（无 padding） */
  compact?: boolean
  /** 显示为细线条（outline） */
  outlined?: boolean
}

const RISK_CONFIG: Record<
  string,
  { color: string; icon: React.ReactNode; defaultLabel: string }
> = {
  // Profiler 风险等级（小写）
  critical: {
    color: 'red',
    icon: <WarningFilled />,
    defaultLabel: '严重',
  },
  high: {
    color: 'volcano',
    icon: <WarningOutlined />,
    defaultLabel: '高',
  },
  medium: {
    color: 'gold',
    icon: <ExclamationCircleOutlined />,
    defaultLabel: '中',
  },
  low: {
    color: 'green',
    icon: <CheckCircleFilled />,
    defaultLabel: '低',
  },
  info: {
    color: 'blue',
    icon: <InfoCircleOutlined />,
    defaultLabel: '提示',
  },
  // 部署风险等级（小写）
  safe: {
    color: 'green',
    icon: <CheckCircleFilled />,
    defaultLabel: '安全',
  },
  // RiskConfirm 风险等级（大写）
  SAFE: {
    color: 'green',
    icon: <CheckCircleFilled />,
    defaultLabel: '安全',
  },
  LOW: {
    color: 'cyan',
    icon: <MinusCircleOutlined />,
    defaultLabel: '低风险',
  },
  MEDIUM: {
    color: 'gold',
    icon: <ExclamationCircleOutlined />,
    defaultLabel: '中风险',
  },
  HIGH: {
    color: 'volcano',
    icon: <WarningOutlined />,
    defaultLabel: '高风险',
  },
  CRITICAL: {
    color: 'red',
    icon: <CloseCircleFilled />,
    defaultLabel: '极高风险',
  },
}

const RiskTag: React.FC<RiskTagProps> = ({ level, label, compact, outlined }) => {
  const config = RISK_CONFIG[level] ?? RISK_CONFIG.medium
  return (
    <Tag
      color={config.color}
      icon={config.icon}
      bordered={!outlined}
      style={{
        margin: 0,
        padding: compact ? '0 4px' : undefined,
        fontSize: compact ? 11 : 12,
      }}
    >
      {label ?? config.defaultLabel}
    </Tag>
  )
}

export default RiskTag
