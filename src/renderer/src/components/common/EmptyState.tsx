/**
 * EmptyState 空状态组件（v0.7.0 UI 规范）
 *
 * 设计原则：
 * - 极简留白：图标 + 标题 + 描述 + 主操作
 * - 统一 Ant Design Icons，禁止 emoji
 * - 居中布局，浅色文字
 *
 * @example
 *   <EmptyState
 *     icon={<FileSearchOutlined />}
 *     title="暂无教程"
 *     description="该分类下还没有教程，尝试切换分类或搜索关键词"
 *     action={{ label: '刷新教程', onClick: handleRefresh }}
 *   />
 */
import React from 'react'
import { Button } from 'antd'
import type { ReactNode } from 'react'

export interface EmptyStateProps {
  /** 主图标（必填，使用 Ant Design Icons） */
  icon: ReactNode
  /** 标题文本（简短说明） */
  title: string
  /** 描述文本（可多行） */
  description?: string
  /** 主操作按钮配置 */
  action?: {
    label: string
    onClick: () => void
    icon?: ReactNode
    type?: 'primary' | 'default' | 'dashed'
  }
  /** 自定义样式 */
  style?: React.CSSProperties
  /** 紧凑模式（无 padding） */
  compact?: boolean
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  style,
  compact = false,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: compact ? '16px' : '48px 24px',
        textAlign: 'center',
        color: 'var(--color-text-secondary, #86868b)',
        ...style,
      }}
    >
      <div
        style={{
          fontSize: 48,
          color: 'var(--color-text-tertiary, #c7c7cc)',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--color-text-primary, #1d1d1f)',
          marginBottom: description ? 6 : 16,
        }}
      >
        {title}
      </div>
      {description && (
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.6,
            maxWidth: 360,
            marginBottom: action ? 20 : 0,
          }}
        >
          {description}
        </div>
      )}
      {action && (
        <Button
          type={action.type ?? 'primary'}
          icon={action.icon}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      )}
    </div>
  )
}

export default EmptyState
