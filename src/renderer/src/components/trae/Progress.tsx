/**
 * Progress — TRAE 进度条（基于 Radix Progress）
 *
 * 设计要点：
 * - 高 4px 轨道
 * - 圆角 var(--trae-radius-full)
 * - 已完成区段品牌蓝
 */
import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'
import { cn } from './utils'

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      'relative h-1 w-full overflow-hidden rounded-full bg-[var(--trae-bg-overlay-l3)]',
      className,
    )}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="h-full w-full flex-1 bg-[var(--trae-bg-brand)] transition-transform duration-300"
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </ProgressPrimitive.Root>
))
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
