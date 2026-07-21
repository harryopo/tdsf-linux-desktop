/**
 * Tooltip — TRAE 提示（基于 Radix Tooltip）
 *
 * 组成：TooltipProvider / Tooltip / TooltipTrigger / TooltipContent
 *
 * 设计要点：
 * - 背景深色 var(--trae-bg-tooltip)
 * - 字号 11px
 * - 圆角 var(--trae-radius-4)
 * - 延迟 300ms（避免误触发）
 */
import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from './utils'

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 overflow-hidden rounded-[var(--trae-radius-4)] bg-[var(--trae-bg-tooltip)] px-2 py-1 text-[11px] text-[var(--trae-text-default)] shadow-[0_2px_8px_rgba(0,0,0,0.4)] data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
