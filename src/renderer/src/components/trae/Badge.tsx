/**
 * Badge — TRAE 徽章（基于 cva 变体）
 *
 * 变体：
 * - default：中性灰底
 * - primary：品牌蓝底
 * - success / warning / error / info：状态色
 * - outline：描边
 *
 * 用途：状态标记、计数、标签
 */
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-[var(--trae-radius-2)] border px-1.5 py-0.5 text-[11px] font-medium leading-tight transition-colors',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-[var(--trae-bg-overlay-l3)] text-[var(--trae-text-default)]',
        primary:
          'border-transparent bg-[var(--trae-status-primary-surface-l1)] text-[var(--trae-text-brand)]',
        secondary:
          'border-transparent bg-[var(--trae-bg-overlay-l2)] text-[var(--trae-text-secondary)]',
        success:
          'border-transparent bg-[var(--trae-status-success-surface-l1)] text-[var(--trae-status-success-default)]',
        warning:
          'border-transparent bg-[var(--trae-status-alert-surface-l1)] text-[var(--trae-status-alert-default)]',
        error:
          'border-transparent bg-[var(--trae-status-error-surface-l1)] text-[var(--trae-status-error-default)]',
        outline:
          'border-[var(--trae-border-neutral-l2)] bg-transparent text-[var(--trae-text-default)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

/** TRAE Badge 徽章 */
function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
