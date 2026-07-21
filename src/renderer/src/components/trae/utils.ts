/**
 * shadcn/ui 工具函数
 *
 * 提供 cn() 函数用于合并 Tailwind className：
 * - clsx：条件拼接 className
 * - tailwind-merge：解决 Tailwind 类名冲突（后者覆盖前者）
 *
 * 标准用法：
 * ```tsx
 * <div className={cn('px-4 py-2', isActive && 'bg-primary', className)} />
 * ```
 */
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** 合并 Tailwind className（shadcn 标准工具） */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
