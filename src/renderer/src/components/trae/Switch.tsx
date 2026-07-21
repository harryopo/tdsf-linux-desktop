/**
 * Switch — TRAE 开关（基于 Radix Switch）
 *
 * 设计要点：
 * - 关闭：灰底 var(--trae-bg-overlay-l3)
 * - 开启：品牌蓝 var(--trae-bg-brand)
 * - 圆形 thumb（28×16 容器，12 thumb）
 */
import * as React from 'react'
import * as SwitchPrimitives from '@radix-ui/react-switch'
import { cn } from './utils'

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      'peer inline-flex h-[18px] w-[34px] shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--trae-bg-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--trae-bg-base-default)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[var(--trae-bg-brand)] data-[state=unchecked]:bg-[var(--trae-border-neutral-l3)]',
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'pointer-events-none block size-3.5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.3)] ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0',
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
