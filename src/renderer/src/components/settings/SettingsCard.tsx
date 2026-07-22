/**
 * SettingsCard — 设置卡片
 *
 * 设计稿：ds-card（头部图标+标题+标签 + 内容区）
 * - 背景 var(--trae-bg-base-secondary)
 * - 边框 var(--trae-border-neutral-l1)
 * - 圆角 var(--trae-radius-8)
 * - 头部底边分隔线
 * - hover 阴影加深（仅阴影变化）
 */
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface SettingsCardProps {
  /** 头部图标（Lucide） */
  icon: LucideIcon
  /** 卡片标题 */
  title: string
  /** 卡片右侧标签（如 "shell.defaults"） */
  tag?: string
  /** 卡片内容 */
  children: ReactNode
  /** 卡片根 className（用于自定义 padding 等） */
  className?: string
}

export function SettingsCard({
  icon: Icon,
  title,
  tag,
  children,
  className,
}: SettingsCardProps) {
  return (
    <div className={'set-card ' + (className ?? '')}>
      <div className="set-card__head">
        <Icon className="di-16" />
        <span className="set-card__title">
          {title}
        </span>
        {tag != null && tag !== '' && (
          <span className="set-card__tag">
            {tag}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}
