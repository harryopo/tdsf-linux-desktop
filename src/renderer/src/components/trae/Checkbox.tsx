/**
 * Checkbox — TRAE 复选框（基于 Radix Checkbox）
 *
 * 设计要点：
 * - 14×14 方形
 * - 圆角 var(--trae-radius-2)
 * - 选中：品牌蓝底 + 白色对勾
 * - 未选中：透明底 + 灰色边框
 */
import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'
import { cn } from './utils'

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer size-4 shrink-0 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-base-tertiary)] ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--trae-bg-brand)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-[var(--trae-bg-brand)] data-[state=checked]:bg-[var(--trae-bg-brand)] data-[state=checked]:text-[var(--trae-text-onbrand)]',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn('flex items-center justify-center text-current')}>
      <Check className="size-3" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
