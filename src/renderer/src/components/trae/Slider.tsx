/**
 * Slider — TRAE 滑块（基于 Radix Slider）
 *
 * 设计要点：
 * - 高 4px 轨道
 * - 圆形 thumb 14×14
 * - 已选区段品牌蓝
 * - 未选区段灰色
 */
import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { cn } from './utils'

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      'relative flex w-full touch-none select-none items-center',
      className,
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-[var(--trae-bg-overlay-l3)]">
      <SliderPrimitive.Range className="absolute h-full bg-[var(--trae-bg-brand)]" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block size-4 rounded-full border-2 border-[var(--trae-bg-base-default)] bg-white shadow-[0_0_0_2px_var(--trae-bg-brand),0_1px_4px_rgba(0,0,0,0.4)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--trae-bg-brand)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50" />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
