/**
 * SettingsSlider — 带数值显示的设置滑块
 *
 * 设计稿：ds-slider（轨道+填充+thumb+数值显示）
 * - 240px 宽（默认）
 * - 数值显示品牌蓝色 + 等宽字体
 * - 滑块基于 TRAE Slider（Radix）
 */
import { Slider } from '@/components/trae/Slider'

export interface SettingsSliderProps {
  /** 当前值 */
  value: number
  /** 最小值 */
  min: number
  /** 最大值 */
  max: number
  /** 步长 */
  step?: number
  /** 数值显示前缀（如 "$"） */
  prefix?: string
  /** 数值显示后缀（如 "px" / "s"） */
  suffix?: string
  /** 数值显示精度（小数位数，默认 0） */
  precision?: number
  /** 自定义宽度（默认 240px） */
  width?: number
  /** 值变化回调 */
  onValueChange: (value: number) => void
}

export function SettingsSlider({
  value,
  min,
  max,
  step = 1,
  prefix = '',
  suffix = '',
  precision = 0,
  width = 240,
  onValueChange,
}: SettingsSliderProps) {
  const displayValue = precision > 0 ? value.toFixed(precision) : String(value)
  return (
    <div className="flex items-center gap-3" style={{ width }}>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(arr) => onValueChange(arr[0] ?? 0)}
        className="flex-1"
      />
      <span className="shrink-0 text-right font-mono text-[13px] font-medium tabular-nums text-[var(--trae-bg-brand)]" style={{ minWidth: 40 }}>
        {prefix}
        {displayValue}
        {suffix}
      </span>
    </div>
  )
}
