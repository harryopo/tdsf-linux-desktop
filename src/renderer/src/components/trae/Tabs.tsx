/**
 * Tabs — TRAE 标签页（基于 Radix Tabs）
 *
 * 组成：Tabs / TabsList / TabsTrigger / TabsContent
 *
 * 设计要点：
 * - 顶部下划线风格（非卡片式）
 * - 激活态颜色 var(--trae-text-brand)
 * - 激活下划线 var(--trae-bg-brand)
 */
import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from './utils'

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex h-9 items-center justify-center gap-1 border-b border-[var(--trae-border-neutral-l1)] bg-transparent p-0 text-[var(--trae-text-secondary)]',
      className,
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-[13px] font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--trae-bg-brand)] disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-b-[var(--trae-bg-brand)] data-[state=active]:text-[var(--trae-text-default)] data-[state=inactive]:text-[var(--trae-text-secondary)] data-[state=inactive]:hover:text-[var(--trae-text-default)]',
      className,
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--trae-bg-brand)]',
      className,
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
