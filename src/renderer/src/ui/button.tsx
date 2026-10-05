/**
 * 按钮原语（IDE 语言）
 *
 * 尺寸取自 cc-gui 的三档原子尺寸：24 行内动作 / 28 composer 与卡片 / 32 顶栏。
 * 颜色一律走令牌，组件里不出现色值字面量；hover 只做"换底色 + 提亮文字"，
 * 不放大不投影——IDE 里的按钮是控件，不是营销位。
 */
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/components/trae/utils'

const button = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-(--ui-radius-control) ' +
    'font-medium text-ink transition-[background-color,color,border-color,opacity] ' +
    'duration-[var(--ui-dur-fast)] ease-out ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-canvas ' +
    'disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        solid: 'bg-accent-solid text-(--text-on-accent) hover:bg-accent-solid-hover active:bg-accent-solid-active',
        outline: 'border border-line-strong bg-transparent text-ink hover:bg-hover hover:text-ink-strong',
        ghost: 'bg-transparent text-ink-dim hover:bg-hover hover:text-ink',
        danger: 'border border-error/40 bg-transparent text-error hover:bg-error/10 active:bg-error/20',
        selected: 'bg-active text-ink',
      },
      size: {
        sm: 'h-6 px-2 text-caption',
        md: 'h-7 px-3 text-md',
        lg: 'h-8 px-4 text-md',
      },
    },
    defaultVariants: { variant: 'outline', size: 'md' },
  }
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} className={cn(button({ variant, size }), className)} {...props} />
  )
)
Button.displayName = 'Button'

const iconButton = cva(
  'inline-flex shrink-0 items-center justify-center rounded-(--ui-radius-control) ' +
    'text-ink-dim transition-[background-color,color] duration-[var(--ui-dur-fast)] ease-out ' +
    'hover:bg-hover hover:text-ink ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
    'disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      size: { sm: 'size-6', md: 'size-7', lg: 'size-8' },
      active: { true: 'bg-hover text-ink', false: '' },
    },
    defaultVariants: { size: 'md', active: false },
  }
)

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButton> {
  /** 图标按钮没有可见文字，aria-label 必填，否则屏幕阅读器只念出"按钮" */
  label: string
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size, active, label, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(iconButton({ size, active }), className)}
      {...props}
    />
  )
)
IconButton.displayName = 'IconButton'
