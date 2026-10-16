/**
 * 三栏默认宽度判据（终端优先 + 下限优先级）
 *
 * 2026-10-16 用户改口径："终端优先，默认终端最大化"。此前钉的是"中间∶右栏 = φ"，
 * 那条已作废——右侧 AI 格改成按像素给默认宽，余量全给中间。这里钉四件事：
 *   1) 宽屏下右栏就是那个默认像素宽（不随窗口变大而变胖），中间至少是它的 2 倍
 *   2) 三栏加起来等于容器宽度（含分隔条），不许凭空多出或少掉像素
 *   3) 窄屏下右栏按占比收敛，但主区下限优先——终端不能先没
 *   4) 关掉某一栏时余量重分，不会算出负数
 * 另有一条量具自检：sanitise 掉的必须是真脏值，合法值不许被顺手丢。
 */
import { describe, it, expect } from 'vitest'
import {
  AI_DEFAULT_PX,
  AI_MAX_SHARE,
  AI_MIN,
  EDITOR_MIN,
  SEPARATOR_PX,
  defaultWidths,
  sanitizeSavedLayout,
} from '@/shell/workbench-metrics'

const BOTH = { tree: true, ai: true }

describe('defaultWidths', () => {
  it.each([[1450], [1920], [2512]])('%ipx 宽时右栏按默认像素、中间吃满余量', (width) => {
    const w = defaultWidths(width, BOTH)
    expect(w.ai, '右侧停靠格不该随窗口变大一起撑宽').toBe(AI_DEFAULT_PX)
    expect(w.editor, '终端优先：主区至少是右栏的两倍').toBeGreaterThanOrEqual(w.ai * 2)
  })

  it('窄屏（1232）右栏按占比收敛，主区仍守住下限', () => {
    const w = defaultWidths(1232, BOTH)
    const separators = 2 * SEPARATOR_PX
    const available = 1232 - w.tree - separators
    expect(w.ai, '右栏不许超过可用宽度的这个比例').toBeLessThanOrEqual(
      Math.round(available * AI_MAX_SHARE),
    )
    expect(w.ai).toBeGreaterThanOrEqual(AI_MIN)
    expect(w.editor).toBeGreaterThanOrEqual(EDITOR_MIN)
    expect(w.editor / w.ai, '窄屏也要看得出终端是主角').toBeGreaterThanOrEqual(1.9)
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

  it('关掉文件树：右栏仍是那个像素宽，余量给中间', () => {
    const w = defaultWidths(1450, { tree: false, ai: true })
    expect(w.tree).toBe(0)
    expect(w.ai).toBe(AI_DEFAULT_PX)
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
