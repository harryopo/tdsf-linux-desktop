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
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * 本项目在 @theme 里自定义的字阶档位（tailwind.css 的 --text-*）。
 *
 * 为什么要显式登记：tailwind-merge 只认识 Tailwind 自带的档位，
 * 自定义的 `text-head` / `text-md` / `text-micro` 会被它当成**颜色类**（`text-*` 默认归到 text-color 组），
 * 于是 `cn('text-md text-ink')` 里前一个被当作"同组冲突"静默丢掉——
 * 界面上就是字号退回继承值，而源码看着完全正常（2026-10-08 查 AI 输入框 11px 时抓到，全仓 179 行受影响）。
 * 登记进 font-size 组后，字阶与颜色各归各组，不再互相吞。
 */
const FONT_SIZE_TIERS = [
  'text-micro',
  'text-caption',
  'text-md',
  'text-body',
  'text-composer',
  'text-title',
  'text-head',
  'text-display',
  'text-splash',
] as const

const mergeTw = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [...FONT_SIZE_TIERS],
    },
  },
})

/** 合并 Tailwind className（shadcn 标准工具，字阶档位已登记） */
export function cn(...inputs: ClassValue[]): string {
  return mergeTw(clsx(inputs))
}
