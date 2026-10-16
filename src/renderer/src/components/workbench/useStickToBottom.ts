/**
 * 流式跟底 / 上滚阅读 / "回到底部" 的状态机
 *
 * 为什么单独一个文件：这段逻辑原先内联在 AIPanel 的 useEffect 里，
 * 只能靠"打开应用、发一条长回答、手动上滚"才能验，等于没有判据。
 * 抽出来之后，"用户上滚看历史时不许把他拽下去"这种结论可以当场跑红。
 *
 * 三个状态：
 * - atBottom：此刻是否贴在底部（阈值内）
 * - hasNewBelow：不在底部时，底下还在长——界面要给出"回到底部"的入口，
 *   否则用户只知道屏幕不动了，不知道是答完了还是被自己挡住了
 * - scrollToBottom：点一下回到底部（同时清掉 hasNewBelow）
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** 距底多少像素以内算"贴在底部"（一行多高留一点余量，避免差 1px 就判成上滚） */
export const FOLLOW_THRESHOLD_PX = 160

/** 距底距离（滚动容器算不出来时返回 Infinity，宁可当成"不在底部"也不强行拽人滚动） */
export function distanceToBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

export interface StickToBottomResult {
  atBottom: boolean
  hasNewBelow: boolean
  scrollToBottom: () => void
}

/**
 * @param getContainer 滚动容器取值函数（面板重排后节点可能换，别缓存节点）
 * @param followKey    内容"变长了"的信号：变了就触发一次跟底判断
 * @param smooth       这一轮用平滑还是即时贴底（流式期间即时，收尾那一次平滑）
 * @param enabled      没有对话时不挂监听
 */
export function useStickToBottom(
  getContainer: () => HTMLElement | null,
  followKey: string,
  smooth: boolean,
  enabled: boolean,
): StickToBottomResult {
  const [atBottom, setAtBottom] = useState(true)
  const [hasNewBelow, setHasNewBelow] = useState(false)
  // 上一次的内容信号：只有它真的变了才叫"底下又长出来了"，
  // 组件重渲染（followKey 没变）不该冒充成新内容
  const lastKeyRef = useRef(followKey)
  const atBottomRef = useRef(atBottom)
  atBottomRef.current = atBottom

  const measure = useCallback((): number | null => {
    const el = getContainer()
    return el ? distanceToBottom(el) : null
  }, [getContainer])

  const scrollToBottom = useCallback(() => {
    const el = getContainer()
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setHasNewBelow(false)
    setAtBottom(true)
  }, [getContainer])

  // 用户自己滚动时更新位置判断（回到底部就顺手清掉提示）
  useEffect(() => {
    if (!enabled) return
    const el = getContainer()
    if (!el) return
    const onScroll = () => {
      const near = distanceToBottom(el) <= FOLLOW_THRESHOLD_PX
      setAtBottom(near)
      if (near) setHasNewBelow(false)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [enabled, getContainer])

  // 内容变长时：贴着底就跟着贴底，正往上读历史就只亮提示、不动他的位置
  useEffect(() => {
    if (!enabled) return
    const grew = followKey !== lastKeyRef.current
    lastKeyRef.current = followKey
    if (!grew) return
    if (atBottomRef.current) {
      const raf = requestAnimationFrame(() => {
        const target = getContainer()
        if (!target) return
        target.scrollTo({ top: target.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
      })
      return () => cancelAnimationFrame(raf)
    }
    setHasNewBelow(true)
  }, [followKey, enabled, smooth, getContainer])

  // 初次挂载时按真实位置校正一次（measure 的引用也在这里用上，避免"定义了没人调"）
  useEffect(() => {
    if (!enabled) return
    const d = measure()
    if (d !== null) setAtBottom(d <= FOLLOW_THRESHOLD_PX)
  }, [enabled, measure])

  return { atBottom, hasNewBelow, scrollToBottom }
}
