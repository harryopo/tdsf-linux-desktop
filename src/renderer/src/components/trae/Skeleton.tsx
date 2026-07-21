/**
 * Skeleton — TRAE 骨架屏
 *
 * 设计要点：
 * - 背景 var(--trae-bg-overlay-l2)
 * - animate-pulse 闪烁动画
 * - 支持任意尺寸（通过 className 控制）
 */
import * as React from 'react'
import { cn } from './utils'

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-[var(--trae-radius-4)] bg-[var(--trae-bg-overlay-l2)]', className)}
      {...props}
    />
  )
}

export { Skeleton }
