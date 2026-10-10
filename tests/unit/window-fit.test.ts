/**
 * 窗口几何收口判据
 *
 * 钉的是"窗口整框必须落在工作区内"。数据全部来自 175% 缩放、工作区 1463×867 的实测：
 * 收口前第二窗口外框 (36,36,1466,870) → 底边超工作区 39px、内容底边超 32px，
 * 正好吃掉 24px 状态栏和 AI 输入框下沿（用户报"放大后下面的内容就看不见了"）。
 * 最后一条是量具自检：不收口的输入确实超界，否则前面的"inside"断言等于没测。
 */
import { describe, it, expect } from 'vitest'
import { fitRectToWorkArea, type Rect } from '@main/windows/window-fit'

/** 实测工作区（1920 物理宽、175% 缩放、底部任务栏） */
const WA: Rect = { x: 0, y: 0, width: 1463, height: 867 }

function inside(r: Rect, wa: Rect = WA): boolean {
  return r.x >= wa.x && r.y >= wa.y && r.x + r.width <= wa.x + wa.width && r.y + r.height <= wa.y + wa.height
}

function bottomOver(r: Rect, wa: Rect = WA): number {
  return r.y + r.height - (wa.y + wa.height)
}

describe('fitRectToWorkArea', () => {
  it('主窗口：外框按工作区给足时收进工作区（原来超 1px 是外框含标题栏）', () => {
    const fitted = fitRectToWorkArea(WA, { x: 0, y: 0, width: 1464, height: 868 })
    expect(inside(fitted)).toBe(true)
    expect(bottomOver(fitted)).toBeLessThanOrEqual(0)
  })

  it('级联第二窗口：底边不再顶出屏幕，同时保住错位可见', () => {
    const fitted = fitRectToWorkArea(WA, { x: 36, y: 36, width: 1466, height: 870 })
    expect(inside(fitted)).toBe(true)
    // 收口不能等于"贴回 (0,0)"——完全重叠会让人以为按钮没生效
    expect(fitted.x).toBe(36)
    expect(fitted.y).toBe(36)
    expect(fitted.width).toBe(WA.width - 36)
    expect(fitted.height).toBe(WA.height - 36)
  })

  it('锚点最大化时开第二窗口：偏移后仍整框可见', () => {
    const fitted = fitRectToWorkArea(WA, { x: 29, y: 29, width: 1477, height: 881 })
    expect(inside(fitted)).toBe(true)
    expect(fitted.x).toBe(29)
    expect(fitted.y).toBe(29)
  })

  it('小屏 + 最小尺寸兜底：尺寸被下限挡住时位置回拉，而不是把窗口顶出屏幕', () => {
    const small: Rect = { x: 0, y: 0, width: 1366, height: 728 }
    const fitted = fitRectToWorkArea(small, { x: 36, y: 36, width: 1366, height: 728 }, {
      width: 1280,
      height: 720,
    })
    expect(fitted.height).toBe(720)
    expect(inside(fitted, small)).toBe(true)
  })

  it('窗口比工作区还大且下限更大（极端外接屏缩到最小）：贴左上，不出现负区间', () => {
    const tiny: Rect = { x: 0, y: 0, width: 800, height: 500 }
    const fitted = fitRectToWorkArea(tiny, { x: 120, y: 90, width: 1400, height: 900 }, {
      width: 1280,
      height: 720,
    })
    expect(fitted.x).toBe(0)
    expect(fitted.y).toBe(0)
  })

  it('已经在工作区内：原样返回，不做无谓挪动', () => {
    const ok: Rect = { x: 100, y: 60, width: 900, height: 600 }
    expect(fitRectToWorkArea(WA, ok)).toEqual(ok)
  })

  it('量具自检：不收口的原始输入确实超界', () => {
    expect(bottomOver({ x: 36, y: 36, width: 1466, height: 870 })).toBe(39)
  })
})
