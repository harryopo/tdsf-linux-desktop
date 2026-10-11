import { useEffect, useRef } from 'react'

/**
 * 横向滚动轨道（rail）的溢出状态。
 *
 * 为什么要它：被裁到一半的 chip 看起来像界面画坏了，用户 2026-10-08 与 2026-10-11
 * 两次提过「标签行被硬裁、不知道能滚」。这里把"还有没有得滚"写到 data 属性上，
 * 由 global.css 的 [data-rail-overflow] 规则画边缘淡出；界面层不感知，
 * 但 scripts/design/ui-audit.mjs 能拿它当判据（被裁却没标 = 红）。
 */
export type RailOverflow = 'none' | 'left' | 'right' | 'both'

export function railOverflowState(scrollLeft: number, clientWidth: number, scrollWidth: number): RailOverflow {
  if (scrollWidth - clientWidth <= 4) return 'none'
  const left = scrollLeft > 4
  const right = scrollLeft + clientWidth < scrollWidth - 4
  if (left && right) return 'both'
  if (right) return 'right'
  return 'left'
}

/** 挂到 overflow-x-auto 的容器上即可；返回的 ref 必须由调用方绑到该元素。 */
export function useRailOverflow<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const sync = () => {
      el.dataset.rail = 'true'
      el.dataset.railOverflow = railOverflowState(el.scrollLeft, el.clientWidth, el.scrollWidth)
    }
    sync()
    el.addEventListener('scroll', sync, { passive: true })
    // 容器尺寸变（窗口缩放/分栏拖动）与内容变（新增标签）都会改变溢出量，两条都要听
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    const mo = new MutationObserver(sync)
    mo.observe(el, { childList: true })
    return () => {
      el.removeEventListener('scroll', sync)
      ro.disconnect()
      mo.disconnect()
    }
  }, [])

  return ref
}
