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
 * - scrollToBottom / followNow：点一下回到底部 / 用户刚发出消息时强制贴底
 *
 * 2026-10-28（#252，用户原话「流式输出不会定位到最新的对话结束」）改了两处：
 * 1. 上一版只在 `followKey` 变化时排一帧贴底，而那个 effect 的 cleanup 会
 *    cancel 掉上一帧——token 比一帧还密时，帧被一次次取消，跟底就停在原地。
 *    现在同一帧只排一次、**不取消**，并改成每次提交都量一次（见下方第三个 effect）。
 * 2. "答完了"之后才长出来的东西——操作按钮、用量行、可信度卡、命令卡——
 *    既不改变正文长度也不改变消息条数，`followKey` 一个字节都没变，
 *    于是最后一行的尾巴永远停在视口下面。高度变化现在会被每次提交量到。
 *
 * 判据：tests/components/workbench/use-stick-to-bottom.test.tsx
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 距底多少像素以内算"贴在底部"。
 * 48px ≈ 两行正文：滚轮一格（约 100px）就足以判成"用户在读历史"，
 * 而回底时差个把像素不该被当成离开。
 */
export const FOLLOW_THRESHOLD_PX = 48

/** 距底像素。算不出来（负数/NaN）时按 0 处理：宁可当成贴底，也不把用户判成"跑掉了" */
export function gapToBottom(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const gap = scrollHeight - clientHeight - scrollTop
  if (!Number.isFinite(gap) || gap < 0) return 0
  return gap
}

/**
 * 这一帧要不要贴底（纯函数，单测直接喂数）。
 *
 * - `force`：用户刚发出消息 → 无条件回到底部并恢复跟随
 * - `wasFollowing`：上一帧还在跟 → 粘住。**内容变长不是用户动作**，
 *   此刻量出来的距离必然已经变大，"距底 ≤ 48px 才跟"会把每一段新正文都判成"用户走了"
 * - 否则看现在离底多远：贴底附近（≤ 阈值）就继续跟，滚上去读历史就不许动他
 */
export function shouldFollow(input: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  wasFollowing: boolean
  force?: boolean
}): boolean {
  const { scrollTop, scrollHeight, clientHeight, wasFollowing, force } = input
  if (force === true) return true
  if (wasFollowing) return true
  return gapToBottom(scrollTop, scrollHeight, clientHeight) <= FOLLOW_THRESHOLD_PX
}

/** 元素版：滚动事件里直接用，省得每个调用点自己拆三个几何量 */
export function distanceToBottom(el: HTMLElement): number {
  return gapToBottom(el.scrollTop, el.scrollHeight, el.clientHeight)
}

/** 贴底附近（滚动事件用：这是"用户此刻在哪儿"，不做粘滞） */
export function isNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold: number = FOLLOW_THRESHOLD_PX,
): boolean {
  return gapToBottom(scrollTop, scrollHeight, clientHeight) <= threshold
}

export interface StickToBottomResult {
  atBottom: boolean
  hasNewBelow: boolean
  /** 点"回到底部"：这一下用平滑，是用户自己的动作 */
  scrollToBottom: () => void
  /** 用户刚发出消息：不管当时滚到哪儿，强制贴底并恢复跟随 */
  followNow: () => void
}

/**
 * @param getContainer 滚动容器取值函数（面板重排后节点可能换，别缓存节点）
 * @param followKey    内容"变长了"的信号：变了就判断要不要继续跟底
 * @param enabled      没有对话时不挂监听、不量高度
 */
export function useStickToBottom(
  getContainer: () => HTMLElement | null,
  followKey: string,
  enabled: boolean,
): StickToBottomResult {
  const [atBottom, setAtBottom] = useState(true)
  const [hasNewBelow, setHasNewBelow] = useState(false)
  // 上一次的内容信号：只有它真的变了才叫"底下又长出来了"，
  // 组件重渲染（followKey 没变）不该冒充成新内容
  const lastKeyRef = useRef(followKey)
  /** 是否正在跟底。用户上滚就关掉，滚回底部/点最新/自己发消息就打开 */
  const followingRef = useRef(true)
  /** 已排队的贴底帧（一帧最多一次；**不取消**——取消就是上一版跟不上的原因） */
  const frameRef = useRef<number | null>(null)
  /** 平滑动画的静默期：动画途中的 scroll 事件不算"用户上滚" */
  const smoothUntilRef = useRef(0)

  /**
   * 排一次贴底。
   *
   * 贴底一律 `scrollTop = scrollHeight`（等价于 behavior:'auto'）：
   * 流式期间每个 token 重启一次平滑动画会互相打断，观感是抖；
   * 平滑只留给用户点"最新"那一下（见 scrollToBottom）。
   */
  const requestStick = useCallback(
    (force = false) => {
      if (force) {
        followingRef.current = true
        setAtBottom(true)
        setHasNewBelow(false)
      }
      if (frameRef.current !== null) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        const el = getContainer()
        if (!el) return
        const follow = shouldFollow({
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          wasFollowing: followingRef.current,
        })
        if (!follow) return
        el.scrollTop = el.scrollHeight
        // 滚到底了就别再挂着"最新"角标
        setAtBottom(true)
        setHasNewBelow(false)
      })
    },
    [getContainer],
  )

  // 用户自己滚动时更新位置判断（回到底部就顺手清掉提示）
  useEffect(() => {
    if (!enabled) return
    const el = getContainer()
    if (!el) return
    const onScroll = () => {
      if (performance.now() < smoothUntilRef.current) return
      const near = isNearBottom(el.scrollTop, el.scrollHeight, el.clientHeight)
      followingRef.current = near
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
    const el = getContainer()
    if (!el) return
    const follow = shouldFollow({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      wasFollowing: followingRef.current,
    })
    if (!follow) {
      setHasNewBelow(true)
      return
    }
    requestStick()
  }, [followKey, enabled, getContainer, requestStick])

  /*
   * 每次提交都量一次高度：跟底这件事的输入是**布局**，不是 React 状态。
   * 正文变长会改 followKey，但"答完了"之后才出现的操作按钮、用量行、
   * 可信度卡、命令卡不会——只认 followKey 的那一版就是在这里漏掉最后一行的。
   * 一帧最多量一次（requestStick 里排队），代价是一次布局读取。
   */
  useEffect(() => {
    if (!enabled) return
    requestStick()
  })

  // 卸载时收掉排队的那一帧（不然回调会在组件没了之后读容器）
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    },
    [],
  )

  const scrollToBottom = useCallback(() => {
    const el = getContainer()
    if (!el) return
    // 动画期间的 scroll 事件不算用户上滚，否则点完"最新"会被自己判成离开底部
    smoothUntilRef.current = performance.now() + 500
    followingRef.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setAtBottom(true)
    setHasNewBelow(false)
  }, [getContainer])

  const followNow = useCallback(() => {
    requestStick(true)
  }, [requestStick])

  return { atBottom, hasNewBelow, scrollToBottom, followNow }
}
