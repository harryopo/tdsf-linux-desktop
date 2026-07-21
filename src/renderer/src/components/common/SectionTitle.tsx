/**
 * SectionTitle 区块标题组件 v2.2（生产交付级极致美学）
 *
 * 统一标题样式：图标 + 文本 + 可选 Tag + 可选副操作
 *
 * v2.2 升级：
 * - 移除底部 border-bottom，减少视觉噪音
 * - 字号更克制（sm→xs / md→sm / lg→md）
 * - 图标颜色弱于标题，形成主次
 * - 颜色 100% token 化，无 fallback 硬编码
 *
 * @example
 *   <SectionTitle
 *     icon={<FileTextOutlined />}
 *     title="Markdown 报告"
 *     tag={{ label: '可编辑', color: 'blue' }}
 *     extra={<Button size="small">导出</Button>}
 *   />
 */
import React from 'react'
import { Tag } from 'antd'
import type { ReactNode } from 'react'

export interface SectionTitleProps {
  /** 区块图标（Ant Design Icons） */
  icon?: ReactNode
  /** 标题文本 */
  title: string
  /** 副标题或描述 */
  description?: string
  /** 右侧 Tag 徽标 */
  tag?: {
    label: ReactNode
    color?: string
  }
  /** 右侧额外操作 */
  extra?: ReactNode
  /** 紧凑模式（小字号） */
  size?: 'sm' | 'md' | 'lg'
  /** 自定义样式 */
  style?: React.CSSProperties
  /** 自定义类名 */
  className?: string
}

const SectionTitle: React.FC<SectionTitleProps> = ({
  icon,
  title,
  description,
  tag,
  extra,
  size = 'md',
  style,
  className,
}) => {
  // v2.2 字号档位：更克制，层级更清晰
  const sizeMap = {
    sm: { fontSize: 'var(--font-size-xs)', titleWeight: 500 },     // 12px
    md: { fontSize: 'var(--font-size-sm)', titleWeight: 600 },     // 13.5px
    lg: { fontSize: 'var(--font-size-md)', titleWeight: 600 },     // 16px
  } as const

  const currentSize = sizeMap[size]
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',         /* 8px */
        marginBottom: 'var(--space-3)',/* 13px */
        // v2.2：移除 borderBottom 与 paddingBottom，标题更干净
        animation: 'fadeInUp 200ms cubic-bezier(0.19, 1, 0.22, 1) both',
        ...style,
      }}
    >
      {icon && (
        <span
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-tertiary)',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          {icon}
        </span>
      )}
      <h3
        style={{
          margin: 0,
          fontSize: currentSize.fontSize,
          fontWeight: currentSize.titleWeight,
          color: 'var(--color-text-primary)',
          lineHeight: 'var(--line-height-snug)',
          letterSpacing: 'var(--letter-spacing-tight)',
        }}
      >
        {title}
      </h3>
      {description && (
        <span
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-tertiary)',
            fontWeight: 'var(--font-weight-regular)',
            marginLeft: 'var(--space-1)',
            letterSpacing: 'var(--letter-spacing-wide)',
          }}
        >
          {description}
        </span>
      )}
      {tag && (
        <Tag
          color={tag.color}
          style={{
            margin: 0,
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--font-size-xs)',
            fontWeight: 'var(--font-weight-medium)',
          }}
        >
          {tag.label}
        </Tag>
      )}
      {extra && (
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            gap: 'var(--space-2)',
            alignItems: 'center',
          }}
        >
          {extra}
        </div>
      )}
    </div>
  )
}

export default SectionTitle
