/**
 * 流式跟底状态机判据（useStickToBottom）
 *
 * 钉的是用户在屏幕上的四种真实处境：
 *   1. 一直看着最新内容 → 每来一段就跟着贴底
 *   2. 上滚回去读历史 → 底下再长也不许把他拽下去（这条是 canary：
 *      只要实现里少了一个"不滚"的分支，scrollTo 就会被调用，当场红）
 *   3. 读完了自己滚回底部 → "最新"提示要自己消失，不然就是个假角标
 *   4. 点"最新" → 真的回到底部
 * 另加一条：组件重渲染但内容没变（followKey 相同）不许滚动，
 * 否则一次无关的父级刷新就会把用户的位置改掉。
 *
 * jsdom 不做布局，scrollHeight/clientHeight 全是 0——这里用可写的假几何量具，
 * 并把 scrollTo 做成"真的改 scrollTop"的替身，让"回到底部后提示消失"这条
 * 走的是和浏览器一样的因果，而不是把结论写死在断言里。
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { FOLLOW_THRESHOLD_PX, distanceToBottom, useStickToBottom } from '@renderer/components/workbench/useStickToBottom'

/**
 * 可写几何量具：一个真 HTMLElement，只是把 scrollHeight / clientHeight / scrollTop
 * 换成读得到、写得进的假值。不另开接口去覆盖那三个字段——它们是只读 getter，
 * 覆盖了 TS 会按"可写属性"放行、运行时当场报错，量具自己先得是真的。
 */
type FakeBox = HTMLElement

function makeBox(scrollHeight: number, clientHeight: number): FakeBox {
  const el = document.createElement('div')
  let top = scrollHeight - clientHeight // 初始贴在底部
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight })
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = v
    },
  })
  // 签名照 DOM 的两个重载来（(options?) 与 (x, y)），否则赋给 el.scrollTo 类型对不上
  el.scrollTo = vi.fn((opts?: ScrollToOptions | number, y?: number) => {
    const target = typeof opts === 'number' ? opts : typeof opts === 'object' ? opts.top : undefined
    const next = target ?? (typeof y === 'number' ? y : undefined)
    if (typeof next === 'number') el.scrollTop = Math.min(next, scrollHeight - clientHeight)
  })
  return el
}

/**
 * 把 rAF 排队的贴底动作真的跑一遍。
 *
 * 第一版只 await 一个 setTimeout(0)，结果 jsdom 的 rAF 回调（约 16ms 一帧）还没跑，
 * "该滚的"被判成"没滚"——正向断言全红、负向断言全绿，是量具在骗人不是产品坏了。
 * 这里等一个真正的帧，再补一个宏任务收尾。
 */
async function flushRaf(): Promise<void> {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('useStickToBottom', () => {
  let box: FakeBox
  beforeEach(() => {
    box = makeBox(2000, 600)
    document.body.appendChild(box)
  })
  afterEach(() => {
    box.remove()
  })

  const setup = (key0 = '1:10') => ({
    ...renderHook((key: string) =>
      useStickToBottom(() => box, key, false, true),
      { initialProps: key0 },
    ),
  })

  it('距底算得对：贴底 0、上滚一页就是那一页的高度', () => {
    expect(distanceToBottom(box)).toBe(0)
    box.scrollTop = 0
    expect(distanceToBottom(box)).toBe(2000 - 600)
  })

  it('贴着底时内容变长 → 跟着贴到底', async () => {
    const { result, rerender } = setup('1:10')
    rerender('1:80')
    await flushRaf()
    expect(box.scrollTo).toHaveBeenCalled()
    expect(box.scrollTop).toBe(box.scrollHeight - box.clientHeight)
    expect(result.current.hasNewBelow, '一直在跟着看，不该亮"最新"').toBe(false)
  })

  it('上滚读历史 → 底下再长也不许动他的位置，只亮"最新"', async () => {
    const { result, rerender } = setup('1:10')
    // 用户往上翻了一页多
    box.scrollTop = 200
    act(() => {
      box.dispatchEvent(new Event('scroll'))
    })
    vi.mocked(box.scrollTo).mockClear()

    rerender('1:200')
    await flushRaf()
    expect(box.scrollTo, '把正在读历史的人拽回底部 = 界面不尊重用户位置').not.toHaveBeenCalled()
    expect(box.scrollTop).toBe(200)
    expect(result.current.hasNewBelow, '看不见底下还在长，总得有个提示').toBe(true)
  })

  it('自己滚回底部 → "最新"提示自己消失', () => {
    const { result, rerender } = setup('1:10')
    box.scrollTop = 100
    act(() => {
      box.dispatchEvent(new Event('scroll'))
    })
    rerender('1:300')
    expect(result.current.hasNewBelow).toBe(true)

    // 滚回底部（阈值内即可，不要求正好 0）
    box.scrollTop = box.scrollHeight - box.clientHeight - (FOLLOW_THRESHOLD_PX - 20)
    act(() => {
      box.dispatchEvent(new Event('scroll'))
    })
    expect(result.current.hasNewBelow, '已经看到了最新内容，角标还挂着就是假角标').toBe(false)
  })

  it('点"最新" → 真的回到底部并清掉提示', () => {
    const { result, rerender } = setup('1:10')
    box.scrollTop = 120
    act(() => {
      box.dispatchEvent(new Event('scroll'))
    })
    rerender('1:400')
    expect(result.current.hasNewBelow).toBe(true)

    act(() => result.current.scrollToBottom())
    expect(box.scrollTop).toBe(box.scrollHeight - box.clientHeight)
    expect(result.current.hasNewBelow).toBe(false)
  })

  it('内容没变的重渲染不许滚动（无关的父级刷新不该改掉用户位置）', async () => {
    const { rerender } = setup('1:10')
    await flushRaf()
    vi.mocked(box.scrollTo).mockClear()
    rerender('1:10')
    await flushRaf()
    expect(box.scrollTo).not.toHaveBeenCalled()
  })

  it('阈值边界成对：差 20px 仍跟底，超过 160px 才停止跟底', async () => {
    // 这条是"上滚不拽"的阳性对照：只测一边等于没测——
    // 阈值写死成 0 也能让"上滚不拽"那条通过，边界这一对会当场抓住它。
    const { result, rerender } = setup('1:10')

    // ① 只往上挪 20px（阈值内）→ 仍然跟底，不亮提示
    box.scrollTop = box.scrollHeight - box.clientHeight - 20
    act(() => {
      box.dispatchEvent(new Event('scroll'))
    })
    vi.mocked(box.scrollTo).mockClear()
    rerender('1:200')
    await flushRaf()
    expect(box.scrollTo, '稍微一动就断跟，观感比拽回去更差').toHaveBeenCalled()
    expect(result.current.hasNewBelow).toBe(false)

    // ② 往上翻过阈值 → 停止跟底，亮"最新"
    box.scrollTop = box.scrollHeight - box.clientHeight - FOLLOW_THRESHOLD_PX - 1
    act(() => {
      box.dispatchEvent(new Event('scroll'))
    })
    vi.mocked(box.scrollTo).mockClear()
    rerender('1:900')
    await flushRaf()
    expect(box.scrollTo).not.toHaveBeenCalled()
    expect(result.current.hasNewBelow).toBe(true)
  })
})
