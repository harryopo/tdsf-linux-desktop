/**
 * Label — TRAE 标签（基于 Radix Label）
 *
 * 设计要点：
 * - 字号 12px（紧凑）
 * - 字重 500
 * - 颜色 var(--trae-text-default)
 * - 支持 hover 颜色变化
 */
import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from './utils'

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'text-[12px] font-medium text-[var(--trae-text-default)] leading-tight peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
      className,
    )}
    {...props}
  />
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }
