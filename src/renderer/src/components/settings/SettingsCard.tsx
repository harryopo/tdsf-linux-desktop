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
    <div
      className={
        'rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-shadow duration-200 hover:shadow-[0_2px_8px_rgba(0,0,0,0.4)] ' +
        (className ?? '')
      }
    >
      <div className="mb-1 flex items-center gap-2 border-b border-[var(--trae-border-neutral-l1)] pb-3">
        <Icon className="size-4 text-[var(--trae-bg-brand)]" />
        <span className="text-[13px] font-semibold leading-tight text-[var(--trae-text-default)]">
          {title}
        </span>
        {tag != null && tag !== '' && (
          <span className="ml-auto font-mono text-[10px] text-[var(--trae-text-tertiary)]">
            {tag}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}
