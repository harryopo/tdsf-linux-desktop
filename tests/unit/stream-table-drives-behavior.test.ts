/**
 * 分类表必须真的管得到行为（阶段 C §C-4）
 *
 * 2026-10-08 复核查出：这张表当时**没有任何运行时消费者**——`ruleOf` 只在 messageSync 里被自己调用，
 * 订阅层各写各的（chunk 走不走合并、边界前冲不冲刷都是硬编码）。
 * 表写得再齐、测试钉得再死，运行时照样不按表走，等于一份带绿灯的装饰（同 D4 那种"自己跟自己对照"）。
 *
 * 现在 agent-stream-subscription 的两处判据取自表：
 *   1. 通道是不是 DELTA 且允许合并 → 决定 chunk 进不进合并窗口；
 *   2. 通道是不是 CRITICAL/RESET_BOUNDARY → 决定它到达前要不要先冲刷缓冲。
 * 这两条测试量的就是这两个决定，改表就会红（手动变异验过：把 agent:chunk 从 DELTA 改掉，第一条当场红）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

type Listener = (payload: never) => void

/**
 * 起一份干净的订阅模块 + 假 electronAPI
 *
 * store 必须和订阅层**同一批 import** 拿：先 resetModules 再动态 import，
 * 否则订阅层写的是一张新实例化出来的 store，测试断言的是旧的，时间线永远空（踩过）。
 */
async function mount() {
  vi.resetModules()
  const listeners: Record<string, Listener> = {}
  const on = (name: string) => (cb: Listener) => {
    listeners[name] = cb
  }
  Object.defineProperty(globalThis, 'window', {
    value: {
      electronAPI: {
        onAgentChunk: on('chunk'),
        onAgentDone: on('done'),
        onAgentError: on('error'),
        onAgentStep: on('step'),
        onAgentToolEvent: on('tool'),
        onMonitorData: on('monitor'),
        onMonitorSystemInfo: on('sysinfo'),
        tokenStats: async () => ({}),
        tokenCostStats: async () => ({}),
      },
    },
    configurable: true,
    writable: true,
  })
  const [{ initAgentStreamSubscription }, { useAgentStore }] = await Promise.all([
    import('@renderer/stores/agent-stream-subscription'),
    import('@renderer/stores/agent-store'),
  ])
  initAgentStreamSubscription()
  return { listeners, store: useAgentStore }
}

/** 摆好一条流式中的 assistant 消息，并把每次 store 写入记成 [正文长度, 是否仍在流式] */
function seedStream(store: Awaited<ReturnType<typeof mount>>['store']): Array<[number, boolean]> {
  store.setState({
    messages: [
      { id: 'a1', role: 'assistant', content: '', timestamp: 1, isStreaming: true, correlationId: 'c-1' },
    ] as never,
    isStreaming: true,
    currentCorrelationId: 'c-1',
  })
  const timeline: Array<[number, boolean]> = []
  store.subscribe((s) => {
    const m = s.messages[s.messages.length - 1]
    timeline.push([m ? m.content.length : -1, m ? !!m.isStreaming : false])
  })
  return timeline
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('分类表 → 订阅行为', () => {
  it('agent:chunk 是 DELTA 且允许合并 ⇒ 窗口内 5 条只写 store 一次', async () => {
    const { listeners, store } = await mount()
    const timeline = seedStream(store)

    for (const d of ['你', '好', '，', '同', '学']) {
      listeners.chunk({ correlationId: 'c-1', delta: d, kind: 'text' } as never)
    }
    expect(store.getState().messages[0].content, '窗口没到就该一个字都没写').toBe('')
    expect(timeline, '高频 token 不该每条都写 store').toHaveLength(0)

    vi.advanceTimersByTime(60)
    expect(store.getState().messages[0].content).toBe('你好，同学')
    expect(timeline, '一次合并写就该只有 1 次 store 写入').toEqual([[5, true]])
  })

  it('agent:done 是 CRITICAL ⇒ 它落地前先把缓冲吐干净（尾部不丢）', async () => {
    const { listeners, store } = await mount()
    const timeline = seedStream(store)

    listeners.chunk({ correlationId: 'c-1', delta: '尾', kind: 'text' } as never)
    listeners.done({
      correlationId: 'c-1',
      result: { content: 'FIN', providerId: 'p1', model: 'm1' },
    } as never)

    // 有冲刷：第一条写入就是"在途那半个字已经落进正文"（[1, true]）；
    // 没冲刷：第一条就是 finalize，正文还是空的 —— 那条 chunk 之后要么被会话闸门丢掉、要么迟到
    expect(timeline[0], 'done 之前必须已把在途 chunk 写进 store').toEqual([1, true])
    expect(
      timeline.filter((e) => e[0] === 0),
      '不该出现"finalize 时正文仍是空的"这种写入'
    ).toHaveLength(0)
    expect(store.getState().messages[0].isStreaming, 'done 应把这条标记为不再流式').toBe(false)

    const writtenAtDone = timeline.length
    vi.advanceTimersByTime(100)
    expect(timeline.length, 'done 之后不该再有迟到的写入（缓冲已在边界前冲刷）').toBe(writtenAtDone)
  })
})
