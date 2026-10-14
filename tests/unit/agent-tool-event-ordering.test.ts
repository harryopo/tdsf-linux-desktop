/**
 * 工具事件订阅层测试（#86 P2 流式观感）
 *
 * 两条都在量"订阅层有没有把信息交给 store"，而不是 store 自己：
 *   1. 工具卡要插在正文真实发生的位置 —— 在途未冲刷的 token 必须先进 store，
 *      否则 anchorOffset 量到的是半个窗口前的长度，卡片会抢到已生成文字的前面
 *      （用户看到的"运行比思考先出现"）。
 *   2. payload.correlationId 必须透传 —— 不传的话迟到的 result 就没法认领自己那条
 *      （done 已把 isStreaming 关掉，没有 id 就找不到落点，事件被丢）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ElectronAPI } from '@renderer/types/electron'
import type { ChatResult } from '@shared/agent-types'

// 替身的回调类型从 ElectronAPI 反推，不手抄、也不许再写成 never。
// 原先是 `type Listener = (payload: never) => void` + 五处 as never：payload 长成什么
// 形状都不会红，于是这份夹具把 done 的结果写成 { content: 'FIN' } —— 真 ChatResult 根本没有
// content 这个字段（正文叫 text）—— 类型层完全看不见，只有那五处 as never 替它兜着。
type EventName = 'onAgentChunk' | 'onAgentDone' | 'onAgentError' | 'onAgentToolEvent'
type Listener<K extends EventName> = Parameters<ElectronAPI[K]>[0]
type ChunkPayload = Parameters<Listener<'onAgentChunk'>>[0]
type DonePayload = Parameters<Listener<'onAgentDone'>>[0]
type ToolPayload = Parameters<Listener<'onAgentToolEvent'>>[0]

/** 订阅函数按契约要返回退订器；本测试不验退订，给个空的 */
function noopDispose(): () => void {
  return () => {}
}

/** 回调没挂上＝订阅层没订这个通道（改名/删订阅都会这样），那是缺陷，不能静默跳过 */
function need<K extends EventName>(name: K, cb: Listener<K> | undefined): Listener<K> {
  if (!cb) throw new Error(`订阅层没挂上 ${name} —— initAgentStreamSubscription 漏订或通道改名`)
  return cb
}

async function mount() {
  vi.resetModules()
  let chunkCb: Listener<'onAgentChunk'> | undefined
  let doneCb: Listener<'onAgentDone'> | undefined
  let errorCb: Listener<'onAgentError'> | undefined
  let toolCb: Listener<'onAgentToolEvent'> | undefined

  // 只替这四个通道：monitor/step 那两条走 ?. 调用、本测试也不触发，
  // 不提供就等于产品哪天把它们改成必调，这里当场炸出来。
  const api: Pick<ElectronAPI, EventName> = {
    onAgentChunk: (cb) => {
      chunkCb = cb
      return noopDispose()
    },
    onAgentDone: (cb) => {
      doneCb = cb
      return noopDispose()
    },
    onAgentError: (cb) => {
      errorCb = cb
      return noopDispose()
    },
    onAgentToolEvent: (cb) => {
      toolCb = cb
      return noopDispose()
    },
  }

  Object.defineProperty(globalThis, 'window', {
    value: {
      electronAPI: {
        ...api,
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
  return {
    store: useAgentStore,
    fire: {
      chunk: (payload: ChunkPayload) => need('onAgentChunk', chunkCb)(payload),
      done: (payload: DonePayload) => need('onAgentDone', doneCb)(payload),
      tool: (payload: ToolPayload) => need('onAgentToolEvent', toolCb)(payload),
    },
  }
}

/** done 的 result 按真 ChatResult 造：少一个必填字段、错一个字段名都过不了 typecheck */
function chatResult(overrides: Partial<ChatResult> = {}): ChatResult {
  return {
    text: 'FIN',
    usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
    finishReason: 'stop',
    providerId: 'p1',
    model: 'm1',
    strength: 'standard',
    durationMs: 120,
    compactionLevel: 'none',
    ...overrides,
  }
}

// overrides 按 store 里消息的真实类型收：原先是 Record<string, unknown>，
// 于是 isStreaming 传成什么都行、消息字段改名也不会红，结尾还得靠 as never 摊进去。
type Msg = import('@renderer/stores/agent-store').AgentMessage

function seed(store: Awaited<ReturnType<typeof mount>>['store'], overrides: Partial<Msg> = {}) {
  store.setState({
    messages: [
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        timestamp: 1,
        isStreaming: true,
        correlationId: 'c-1',
        ...overrides,
      },
    ] satisfies Msg[],
    isStreaming: overrides.isStreaming ?? true,
    currentCorrelationId: 'c-1',
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('agent:tool-event 落到 store 之前', () => {
  it('先把在途 chunk 冲进 store，锚点才是文字真实发生的位置', async () => {
    const { fire, store } = await mount()
    seed(store)

    fire.chunk({ correlationId: 'c-1', delta: '先看磁盘', kind: 'text' })
    expect(store.getState().messages[0].content, '合并窗口没到，正文应还缓冲').toBe('')

    fire.tool({
      correlationId: 'c-1',
      toolCallId: 't1',
      phase: 'call',
      toolName: 'ssh_readonly',
      input: 'df -h',
    })

    const msg = store.getState().messages[0]
    expect(msg.content, '工具卡落地时在途 token 必须已写入').toBe('先看磁盘')
    expect(msg.toolEvents?.[0].anchorOffset, '锚点要等于已生成正文长度，否则卡抢到文字前面').toBe(4)

    vi.advanceTimersByTime(100)
    expect(store.getState().messages[0].content, '冲刷后不该再被同一个窗口写第二遍').toBe('先看磁盘')
  })

  it('done 之后迟到的 result 靠 correlationId 认领回自己那条', async () => {
    const { fire, store } = await mount()
    seed(store)

    fire.tool({ correlationId: 'c-1', toolCallId: 't1', phase: 'call', toolName: 'ssh_readonly' })
    fire.done({ correlationId: 'c-1', result: chatResult() })

    const finalized = store.getState().messages[0]
    expect(finalized.isStreaming).toBe(false)
    // done 回填的是 providerId/model/usage；正文由 chunk 增量拼，done 不许再整份写一遍
    // （那样会把已经流式显示的文字翻倍）。这条同时把夹具钉在真 ChatResult 的形状上。
    expect(finalized.providerId, 'done 的 providerId 没落地＝result 形状不对').toBe('p1')
    expect(finalized.model, 'done 的 model 没落地＝result 形状不对').toBe('m1')
    expect(finalized.usage?.totalTokens, 'done 的 usage 没落地＝result 形状不对').toBe(18)
    expect(finalized.content, 'done 不该把 result.text 再写进正文').toBe('')

    fire.tool({
      correlationId: 'c-1',
      toolCallId: 't1',
      phase: 'result',
      toolName: 'ssh_readonly',
      ok: true,
      output: '40G',
    })

    const evt = store.getState().messages[0].toolEvents?.[0]
    expect(evt?.done, '订阅层没透传 correlationId 的话，这条就丢了').toBe(true)
    expect(evt?.output).toBe('40G')
  })
})
