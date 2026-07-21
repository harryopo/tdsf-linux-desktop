/**
 * Button — TRAE 按钮（基于 shadcn/ui Button + cva 变体）
 *
 * 变体：
 * - primary：高对比中性白底（默认主操作）
 * - secondary：中性表面（相邻操作）
 * - ghost：幽灵（无填充无边框，密集工具栏）
 * - outline：描边
 * - destructive：危险（红色）
 * - brand：品牌色（#387BFF，慎用）
 * - link：链接
 *
 * 尺寸：sm(24) / default(28) / lg(32) / xl(36) / icon
 */
import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--trae-radius-4)] border border-transparent font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--trae-bg-brand)] focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--trae-bg-invert)] text-[var(--trae-bg-base-default)] hover:bg-[var(--trae-bg-invert-hover)] active:bg-[var(--trae-bg-invert-active)]',
        secondary:
          'bg-[var(--trae-bg-overlay-l2)] text-[var(--trae-text-default)] hover:bg-[var(--trae-bg-overlay-l3)]',
        ghost: 'bg-transparent text-[var(--trae-text-default)] hover:bg-[var(--trae-bg-overlay-l2)]',
        outline:
          'border-[var(--trae-border-neutral-l2)] bg-transparent text-[var(--trae-text-default)] hover:bg-[var(--trae-bg-overlay-l2)]',
        destructive:
          'bg-[var(--trae-status-error-default)] text-white hover:bg-[var(--trae-status-error-hover)]',
        brand:
          'bg-[var(--trae-bg-brand)] text-[var(--trae-text-onbrand)] hover:bg-[var(--trae-bg-brand-hover)] active:bg-[var(--trae-bg-brand-active)]',
        link: 'bg-transparent text-[var(--trae-text-brand)] underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-6 px-2 text-[11px]',
        default: 'h-7 px-3 text-[12px]',
        lg: 'h-8 px-4 text-[13px]',
        xl: 'h-9 px-5 text-[13px]',
        icon: 'size-7 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

/** TRAE Button 按钮 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
