/**
 * 三栏默认宽度判据（黄金分割 + 下限优先级）
 *
 * 用户要求"默认布局是黄金分割比例，对标 VS Code / Trae"。这里钉三件事：
 *   1) 中间∶右栏 ≈ φ，而且**换窗口宽度仍然是 φ**（不是写死的像素）
 *   2) 三栏加起来等于容器宽度（含分隔条），不许凭空多出或少掉像素
 *   3) 挤到极限时主区下限优先于右栏下限——终端不能先没
 * 另有一条量具自检：sanitise 掉的必须是真脏值，合法值不许被顺手丢。
 */
import { describe, it, expect } from 'vitest'
import {
  EDITOR_MIN,
  GOLDEN_RATIO,
  SEPARATOR_PX,
  defaultWidths,
  sanitizeSavedLayout,
} from '@/shell/workbench-metrics'

const BOTH = { tree: true, ai: true }

function ratio(w: { editor: number; ai: number }): number {
  return w.editor / w.ai
}

describe('defaultWidths', () => {
  it.each([[1450], [1920], [2512], [1232]])('%ipx 宽时中间∶右栏 = φ', (width) => {
    const w = defaultWidths(width, BOTH)
    expect(ratio(w)).toBeCloseTo(GOLDEN_RATIO, 2)
  })

  it.each([[1450], [2512], [1232]])('%ipx 宽时像素守恒（含分隔条）', (width) => {
    const w = defaultWidths(width, BOTH)
    expect(w.tree + w.editor + w.ai + 2 * SEPARATOR_PX).toBe(width)
  })

  it('左栏按占比取，但夹在 200~300（窄屏不缩成一条，宽屏不抢主区）', () => {
    expect(defaultWidths(1232, BOTH).tree).toBe(200)
    expect(defaultWidths(1450, BOTH).tree).toBe(232)
    expect(defaultWidths(2512, BOTH).tree).toBe(300)
  })

  it('关掉文件树：余量重切，比例仍是 φ', () => {
    const w = defaultWidths(1450, { tree: false, ai: true })
    expect(w.tree).toBe(0)
    expect(ratio(w)).toBeCloseTo(GOLDEN_RATIO, 2)
    expect(w.editor + w.ai + SEPARATOR_PX).toBe(1450)
  })

  it('关掉 AI 面板：中间吃满', () => {
    const w = defaultWidths(1450, { tree: true, ai: false })
    expect(w.ai).toBe(0)
    expect(w.editor).toBe(1450 - w.tree - SEPARATOR_PX)
  })

  it('挤到极限时主区下限优先于右栏下限', () => {
    const w = defaultWidths(800, BOTH)
    expect(w.editor).toBe(EDITOR_MIN)
    expect(w.ai).toBeLessThan(EDITOR_MIN)
  })

  it('量具自检：宽度再小也不会算出负数', () => {
    const w = defaultWidths(240, BOTH)
    expect(w.editor).toBeGreaterThanOrEqual(0)
    expect(w.ai).toBeGreaterThanOrEqual(0)
  })
})

describe('sanitizeSavedLayout', () => {
  it('合法值留下，脏值整条丢掉', () => {
    expect(
      sanitizeSavedLayout({ 'wb-tree': 240, 'wb-ai': 0, 'wb-editor': -5, x: 'wide', y: NaN }),
    ).toEqual({ 'wb-tree': 240 })
  })

  it('非对象（旧版本残留 / 手改过）回空', () => {
    expect(sanitizeSavedLayout(null)).toEqual({})
    expect(sanitizeSavedLayout('[1,2]')).toEqual({})
    expect(sanitizeSavedLayout(42)).toEqual({})
  })
})
