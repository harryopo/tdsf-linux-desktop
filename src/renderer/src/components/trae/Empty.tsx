/**
 * Empty — TRAE 空状态
 *
 * 设计要点：
 * - 居中布局
 * - 灰色图标 + 标题 + 描述
 * - 可选操作按钮
 */
import * as React from 'react'
import { cn } from './utils'

export interface EmptyProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** 图标（lucide-react 组件） */
  icon?: React.ComponentType<{ className?: string }>
  /** 标题 */
  title?: React.ReactNode
  /** 描述文字 */
  description?: React.ReactNode
  /** 操作区域（通常放 Button） */
  action?: React.ReactNode
}

/** TRAE Empty 空状态 */
function Empty({ icon: Icon, title, description, action, className, ...props }: EmptyProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-12 px-4 text-center',
        className,
      )}
      {...props}
    >
      {Icon && (
        <div className="flex size-12 items-center justify-center rounded-full bg-[var(--trae-bg-overlay-l2)]">
          <Icon className="size-6 text-[var(--trae-text-tertiary)]" />
        </div>
      )}
      {title && (
        <div className="text-[14px] font-medium text-[var(--trae-text-default)]">{title}</div>
      )}
      {description && (
        <div className="max-w-sm text-[12px] text-[var(--trae-text-secondary)]">{description}</div>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export { Empty }
