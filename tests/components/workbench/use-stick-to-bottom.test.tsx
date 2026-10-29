/**
 * 流式跟底状态机判据（useStickToBottom）
 *
 * 钉的是用户在屏幕上的五种真实处境：
 *   1. 一直看着最新内容 → 每来一段就跟着贴底（含"答完了"之后才长出来的按钮行）
 *   2. 上滚回去读历史 → 底下再长也不许把他拽下去（这条是 canary：
 *      只要实现里少了一个"不滚"的分支，scrollTop 就会被改，当场红）
 *   3. 读完了自己滚回底部 → "最新"提示要自己消失，且恢复跟随
 *   4. 自己发出消息 → 不管当时滚到哪儿都强制贴底
 *   5. 离底多远算"跟"：阈值边上成对判（只测一边等于没测）
 *
 * jsdom 不做布局，scrollHeight/clientHeight 全是 0——这里用可写的假几何量具，
 * 并把 scrollTop 的 setter 做成"和浏览器一样夹在上限内"，让"贴底"这个结论
 * 走的是和浏览器一样的因果，而不是把数值写死在断言里。
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  FOLLOW_THRESHOLD_PX,
  distanceToBottom,
  gapToBottom,
  isNearBottom,
  shouldFollow,
  useStickToBottom,
} from '@renderer/components/workbench/useStickToBottom'

/** 可写几何量具：真 HTMLElement，只是把三个只读几何量换成读得到、写得进的假值 */
interface FakeBox extends HTMLElement {
  /** 模拟"底下又长出来一段"（流式新增 token、收尾后又出现的按钮行都走这一条） */
  growBy(px: number): void
}

function makeBox(scrollHeight: number, clientHeight: number): FakeBox {
  const geo = { scrollHeight, clientHeight, top: scrollHeight - clientHeight }
  const el = document.createElement('div') as unknown as FakeBox
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => geo.scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => geo.clientHeight })
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => geo.top,
    // 浏览器把越界的 scrollTop 夹回 [0, max]；量具不夹，断言会拿一个不存在的数值当"贴底了"
    set: (v: number) => {
      geo.top = Math.max(0, Math.min(v, geo.scrollHeight - geo.clientHeight))
    },
  })
  // 签名照 DOM 的两个重载来（(options?) 与 (x, y)），否则赋给 el.scrollTo 类型对不上
  el.scrollTo = vi.fn((opts?: ScrollToOptions | number, y?: number) => {
    const target = typeof opts === 'number' ? opts : typeof opts === 'object' ? opts.top : undefined
    const next = target ?? (typeof y === 'number' ? y : undefined)
    if (typeof next === 'number') el.scrollTop = next
  })
  el.growBy = (px: number) => {
    geo.scrollHeight += px
  }
  return el
}

/**
 * 把 rAF 排队的贴底动作真的跑一遍。
 *
 * 只 await 一个 setTimeout(0) 时，jsdom 的 rAF 回调（约 16ms 一帧）还没跑，
 * "该滚的"会被判成"没滚"——正向断言全红、负向断言全绿，是量具在骗人。
 */
async function flushFrame(): Promise<void> {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('贴底判据（纯函数）', () => {
  // 容器 600 高、内容 2000 高：贴底 scrollTop=1400，离底 400px 就是 scrollTop=1000
  const box = { scrollHeight: 2000, clientHeight: 600 }

  it('距底算得对：贴底 0，上滚一页就是那一页的高度', () => {
    expect(gapToBottom(1400, box.scrollHeight, box.clientHeight)).toBe(0)
    expect(gapToBottom(0, box.scrollHeight, box.clientHeight)).toBe(1400)
    // 内容比视口还短（没有溢出）：距底按 0，别算出负数把人判成"不在底部"
    expect(gapToBottom(0, 300, 600)).toBe(0)
  })

  it('贴底时跟随', () => {
    expect(
      shouldFollow({ scrollTop: 1400, ...box, wasFollowing: false }),
    ).toBe(true)
  })

  it('离底时不跟随（用户正在读历史）', () => {
    expect(
      shouldFollow({ scrollTop: 200, ...box, wasFollowing: false }),
    ).toBe(false)
  })

  it('回底后恢复跟随', () => {
    // 上一帧不跟，但此刻已经回到贴底——这一帧就该重新跟
    expect(
      shouldFollow({ scrollTop: 1400, ...box, wasFollowing: false }),
    ).toBe(true)
  })

  it('发送消息强制跟随：离底三屏也回到底部', () => {
    expect(
      shouldFollow({ scrollTop: 0, ...box, wasFollowing: false, force: true }),
    ).toBe(true)
  })

  it('内容变长不是用户动作：上一帧在跟就粘住，哪怕此刻已经离底很远', () => {
    // 新到的一段正文把高度顶出去 800px——量出来的距离当然变大了，
    // 这时按"距底 ≤ 48px"判就会把每一段新正文都判成"用户走了"
    expect(
      shouldFollow({ scrollTop: 1400, scrollHeight: 2800, clientHeight: 600, wasFollowing: true }),
    ).toBe(true)
  })

  it('阈值边界成对：差 48px 算贴底，49px 算离开', () => {
    expect(isNearBottom(1400 - FOLLOW_THRESHOLD_PX, box.scrollHeight, box.clientHeight)).toBe(true)
    expect(isNearBottom(1400 - FOLLOW_THRESHOLD_PX - 1, box.scrollHeight, box.clientHeight)).toBe(
      false,
    )
  })

  it('元素版与纯数值版同源', () => {
    const el = makeBox(2000, 600)
    el.scrollTop = 0
    expect(distanceToBottom(el)).toBe(1400)
    el.scrollTop = 1400
    expect(distanceToBottom(el)).toBe(0)
  })
})

describe('useStickToBottom', () => {
  let box: FakeBox

  beforeEach(() => {
    box = makeBox(2000, 600)
    document.body.appendChild(box)
  })

  afterEach(() => {
    box.remove()
  })

  const setup = () => {
    const view = renderHook(
      ({ key }: { key: string }) => useStickToBottom(() => box, key, true),
      { initialProps: { key: '1:10' } },
    )
    const atEnd = () => box.scrollHeight - box.clientHeight
    return { ...view, atEnd }
  }

  it('贴着底时内容变长 → 跟着贴到底', async () => {
    const { result, rerender, atEnd } = setup()
    await flushFrame()

    box.growBy(400)
    rerender({ key: '1:80' })
    await flushFrame()

    expect(box.scrollTop, '流式新增的正文没跟到位').toBe(atEnd())
    expect(result.current.hasNewBelow, '一直在跟着看，不该亮"最新"').toBe(false)
  })

  it('答完了才长出来的东西（按钮行 / 用量行）也会被跟到', async () => {
    const { rerender, atEnd } = setup()
    await flushFrame()

    // 这一条不改 followKey：正文长度、消息条数都没变，只是布局高了一点
    rerender({ key: '1:10' })
    box.growBy(60)
    await flushFrame()

    expect(box.scrollTop, '收尾后才出现的行把最后一段挤出视口了').toBe(atEnd())
  })

  it('上滚读历史 → 底下再长也不许动他的位置，只亮"最新"', async () => {
    const { result, rerender } = setup()
    await flushFrame()

    // 用户往上翻了一页多
    box.scrollTop = 200
    act(() => {
      box.dispatchEvent(new Event('scroll'))
    })
    vi.mocked(box.scrollTo).mockClear()

    box.growBy(600)
    rerender({ key: '1:200' })
    await flushFrame()

    expect(box.scrollTop, '把正在读历史的人拽回底部 = 界面不尊重用户位置').toBe(200)
    expect(box.scrollTo, '流式期间不许用平滑滚动（每帧重启一次动画，观感是抖）').not.toHaveBeenCalled()
    expect(result.current.hasNewBelow, '看不见底下还在长，总得有个提示').toBe(true)
  })

  it('自己滚回底部 → "最新"消失，并且恢复跟随', async () => {
    const { result, rerender, atEnd } = setup()
    await flushFrame()

    box.scrollTop = 100
    act(() => {
      box.dispatchEvent(new Event('scroll'))
    })
    box.growBy(300)
    rerender({ key: '1:300' })
    await flushFrame()
    expect(result.current.hasNewBelow).toBe(true)

    // 滚回底部（阈值内即可，不要求正好 0）
    box.scrollTop = atEnd() - (FOLLOW_THRESHOLD_PX - 8)
    act(() => {
      box.dispatchEvent(new Event('scroll'))
    })
    expect(result.current.hasNewBelow, '已经看到了最新内容，角标还挂着就是假角标').toBe(false)

    // 恢复跟随：再来一段新正文，这次要跟到底
    box.growBy(200)
    rerender({ key: '1:600' })
    await flushFrame()
    expect(box.scrollTop, '回到底部之后没恢复跟随').toBe(atEnd())
  })

  it('自己发出消息 → 离底三屏也强制贴底', async () => {
    const { result, atEnd } = setup()
    await flushFrame()

    box.scrollTop = 0
    act(() => {
      box.dispatchEvent(new Event('scroll'))
    })
    expect(box.scrollTop).toBe(0)

    act(() => result.current.followNow())
    await flushFrame()

    expect(box.scrollTop, '用户刚发出的那句必须看得见').toBe(atEnd())
  })

  it('点"最新" → 真的回到底部并清掉提示', async () => {
    const { result, rerender, atEnd } = setup()
    await flushFrame()

    box.scrollTop = 120
    act(() => {
      box.dispatchEvent(new Event('scroll'))
    })
    box.growBy(400)
    rerender({ key: '1:400' })
    await flushFrame()
    expect(result.current.hasNewBelow).toBe(true)

    act(() => result.current.scrollToBottom())
    await flushFrame()
    expect(box.scrollTop).toBe(atEnd())
    expect(result.current.hasNewBelow).toBe(false)
  })

  it('阈值边上：差 40px 仍跟底，越过 48px 才停止跟底', async () => {
    const { result, rerender, atEnd } = setup()
    await flushFrame()

    // ① 只往上挪 40px（阈值内）→ 仍然跟底，不亮提示
    box.scrollTop = atEnd() - 40
    act(() => {
      box.dispatchEvent(new Event('scroll'))
    })
    box.growBy(500)
    rerender({ key: '1:200' })
    await flushFrame()
    expect(box.scrollTop, '稍微一动就断跟，观感比拽回去更差').toBe(atEnd())
    expect(result.current.hasNewBelow).toBe(false)

    // ② 往上翻过阈值 → 停止跟底，亮"最新"
    box.scrollTop = atEnd() - FOLLOW_THRESHOLD_PX - 1
    act(() => {
      box.dispatchEvent(new Event('scroll'))
    })
    box.growBy(500)
    rerender({ key: '1:900' })
    await flushFrame()
    expect(box.scrollTop).toBe(atEnd() - 500 - FOLLOW_THRESHOLD_PX - 1)
    expect(result.current.hasNewBelow).toBe(true)
  })

  it('不在底部时，无关的重渲染不许改动位置', async () => {
    const { rerender } = setup()
    await flushFrame()

    box.scrollTop = 300
    act(() => {
      box.dispatchEvent(new Event('scroll'))
    })
    const parked = box.scrollTop

    rerender({ key: '1:10' }) // 内容没变，只是组件重画
    await flushFrame()

    expect(box.scrollTop, '一次无关的父级刷新不该改掉用户的位置').toBe(parked)
  })
})
