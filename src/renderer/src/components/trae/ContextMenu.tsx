/**
 * ContextMenu — TRAE 右键菜单（基于 Radix ContextMenu）
 *
 * 组成：ContextMenu / ContextMenuTrigger / ContextMenuContent / ContextMenuItem / ContextMenuSeparator
 *
 * 设计要点：
 * - 与 Dropdown 视觉一致
 * - 触发方式：右键
 */
import * as React from 'react'
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import { cn } from './utils'

const ContextMenu = ContextMenuPrimitive.Root
const ContextMenuTrigger = ContextMenuPrimitive.Trigger
const ContextMenuPortal = ContextMenuPrimitive.Portal
const ContextMenuGroup = ContextMenuPrimitive.Group

const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPortal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={cn(
        'z-50 min-w-[10rem] overflow-hidden rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-menu)] p-1 text-[var(--trae-text-default)] shadow-[0_4px_16px_rgba(0,0,0,0.4)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  </ContextMenuPortal>
))
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName

const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-default select-none items-center gap-2 rounded-[var(--trae-radius-2)] px-2 py-1.5 text-[13px] outline-none transition-colors focus:bg-[var(--trae-bg-overlay-l2)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-3.5',
      className,
    )}
    {...props}
  />
))
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName

const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-[var(--trae-border-neutral-l1)]', className)}
    {...props}
  />
))
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuGroup,
  ContextMenuPortal,
}
