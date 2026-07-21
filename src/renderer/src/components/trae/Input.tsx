/**
 * Input — TRAE 输入框（基于 shadcn/ui Input）
 *
 * 设计要点：
 * - 背景 var(--trae-bg-base-default)
 * - 边框 var(--trae-border-neutral-l2)
 * - 圆角 var(--trae-radius-4)
 * - 高度 28px（紧凑 IDE 风格）
 * - focus 时边框变 var(--trae-bg-brand) + ring
 */
import * as React from 'react'
import { cn } from './utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

/** TRAE Input 输入框 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      'flex h-[30px] w-full rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-base-tertiary)] px-2.5 py-1 font-mono text-[13px] text-[var(--trae-text-default)] placeholder:text-[var(--trae-text-tertiary)] transition-colors duration-150 file:border-0 file:bg-transparent file:text-[13px] file:font-medium focus-visible:outline-none focus-visible:border-[var(--trae-bg-brand)] focus-visible:ring-1 focus-visible:ring-[var(--trae-bg-brand)] disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export { Input }
