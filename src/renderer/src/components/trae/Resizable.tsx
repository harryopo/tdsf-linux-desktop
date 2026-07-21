/**
 * Resizable — TRAE 可调整大小容器（骨架）
 *
 * 说明：
 * - shadcn/ui 的 Resizable 基于 react-resizable-panels（非 Radix）
 * - 本骨架提供基础接口，批次 5 接入真实功能时再安装依赖
 * - 当前实现：简单的 flex 容器，支持 direction / className
 *
 * TODO（批次 5）：安装 react-resizable-panels 并替换为真实实现
 */
import * as React from 'react'
import { cn } from './utils'

export interface ResizableProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 方向：horizontal 水平排列 / vertical 垂直排列 */
  direction?: 'horizontal' | 'vertical'
}

/** TRAE Resizable 可调整大小容器（骨架） */
const Resizable = React.forwardRef<HTMLDivElement, ResizableProps>(
  ({ className, direction = 'horizontal', ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex',
        direction === 'horizontal' ? 'flex-row' : 'flex-col',
        className,
      )}
      {...props}
    />
  ),
)
Resizable.displayName = 'Resizable'

export interface ResizablePanelProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 默认尺寸比例（0-100） */
  defaultSize?: number
  /** 最小尺寸比例（0-100） */
  minSize?: number
  /** 最大尺寸比例（0-100） */
  maxSize?: number
}

/** TRAE ResizablePanel 可调整大小面板（骨架） */
const ResizablePanel = React.forwardRef<HTMLDivElement, ResizablePanelProps>(
  ({ className, defaultSize, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex-1 overflow-hidden', className)}
      style={defaultSize ? { flexBasis: `${defaultSize}%` } : undefined}
      {...props}
    />
  ),
)
ResizablePanel.displayName = 'ResizablePanel'

/** TRAE ResizableHandle 拖拽手柄（骨架，当前不可拖拽） */
const ResizableHandle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { direction?: 'horizontal' | 'vertical' }
>(({ className, direction = 'horizontal', ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex items-center justify-center bg-[var(--trae-border-neutral-l1)] transition-colors hover:bg-[var(--trae-border-neutral-l2)]',
      direction === 'horizontal' ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize',
      className,
    )}
    {...props}
  />
))
ResizableHandle.displayName = 'ResizableHandle'

export { Resizable, ResizablePanel, ResizableHandle }
