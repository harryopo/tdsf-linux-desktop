/**
 * tests/unit/rail-overflow.test.ts — 横向滚动轨道的溢出状态（任务 #70/#43）
 *
 * 用户两次提到"一排 chip 被硬切一半，看起来像界面画坏了"（2026-10-08 / 2026-10-11）。
 * 淡出遮罩画在哪一边由这里的四态决定，判错边等于把"还有内容"提示画反。
 */
import { describe, it, expect } from 'vitest'
import { railOverflowState } from '../../src/renderer/src/hooks/useRailOverflow'

describe('railOverflowState', () => {
  it('内容没超出可视宽度时是 none，不画任何淡出', () => {
    expect(railOverflowState(0, 300, 300)).toBe('none')
    // 4px 以内的亚像素误差算没溢出（缩放与滚动条会带来这个量级）
    expect(railOverflowState(0, 300, 303)).toBe('none')
  })

  it('停在最左、右边还有内容时是 right', () => {
    expect(railOverflowState(0, 300, 900)).toBe('right')
  })

  it('滚到最右、左边有已看过的内容时是 left', () => {
    expect(railOverflowState(600, 300, 900)).toBe('left')
  })

  it('夹在中间时两边都能滚，是 both', () => {
    expect(railOverflowState(200, 300, 900)).toBe('both')
  })

  it('距边缘 4px 以内不再提示那一边（尽头继续淡出会让人以为还没滚完）', () => {
    // 只滚了 2px：左边那截其实就在眼前，不该画左淡出
    expect(railOverflowState(2, 300, 900)).toBe('right')
    // 距右端还剩 2px：右边已经到底了，不该再画右淡出
    expect(railOverflowState(598, 300, 900)).toBe('left')
    expect(railOverflowState(300, 300, 900)).toBe('both')
  })
})
