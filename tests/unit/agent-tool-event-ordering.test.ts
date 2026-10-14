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

type Listener = (payload: never) => void

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
    const { listeners, store } = await mount()
    seed(store)

    listeners.chunk({ correlationId: 'c-1', delta: '先看磁盘', kind: 'text' } as never)
    expect(store.getState().messages[0].content, '合并窗口没到，正文应还缓冲').toBe('')

    listeners.tool({
      correlationId: 'c-1',
      toolCallId: 't1',
      phase: 'call',
      toolName: 'ssh_readonly',
      input: 'df -h',
    } as never)

    const msg = store.getState().messages[0]
    expect(msg.content, '工具卡落地时在途 token 必须已写入').toBe('先看磁盘')
    expect(msg.toolEvents?.[0].anchorOffset, '锚点要等于已生成正文长度，否则卡抢到文字前面').toBe(4)

    vi.advanceTimersByTime(100)
    expect(store.getState().messages[0].content, '冲刷后不该再被同一个窗口写第二遍').toBe('先看磁盘')
  })

  it('done 之后迟到的 result 靠 correlationId 认领回自己那条', async () => {
    const { listeners, store } = await mount()
    seed(store)

    listeners.tool({ correlationId: 'c-1', toolCallId: 't1', phase: 'call', toolName: 'ssh_readonly' } as never)
    listeners.done({ correlationId: 'c-1', result: { content: 'FIN', providerId: 'p1', model: 'm1' } } as never)
    expect(store.getState().messages[0].isStreaming).toBe(false)

    listeners.tool({
      correlationId: 'c-1',
      toolCallId: 't1',
      phase: 'result',
      toolName: 'ssh_readonly',
      ok: true,
      output: '40G',
    } as never)

    const evt = store.getState().messages[0].toolEvents?.[0]
    expect(evt?.done, '订阅层没透传 correlationId 的话，这条就丢了').toBe(true)
    expect(evt?.output).toBe('40G')
  })
})
