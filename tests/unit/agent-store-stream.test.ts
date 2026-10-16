/**
 * Agent Store 流式归属测试（阶段 C）
 *
 * 钉住这次改动的核心行为：
 *   - 在途事件只认当前会话（切走的旧流不再往新回答里写字）
 *   - done/error 按 correlationId 认领自己那条，不代关别人的
 * 这两条以前都靠"从尾巴反向扫 + 悄悄回退到最后一条 assistant"实现，
 * 回退分支就是写错消息的入口。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useAgentStore } from '@renderer/stores/agent-store'
import type { AgentMessage } from '@renderer/stores/agent-store'
import type { AgentDonePayload, AgentErrorPayload } from '@shared/agent-types'

const store = () => useAgentStore.getState()

/** 往列表里塞一条流式中的 assistant 消息 */
function seedStreaming(overrides: Partial<AgentMessage> = {}): void {
  useAgentStore.setState({
    messages: [
      { id: 'u1', role: 'user', content: '帮我看磁盘', timestamp: 1 },
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        timestamp: 2,
        isStreaming: true,
        correlationId: 'c-1',
        ...overrides,
      },
    ],
    isStreaming: true,
    currentCorrelationId: overrides.correlationId === undefined ? 'c-1' : (overrides.correlationId ?? null),
  })
}

function donePayload(correlationId: string, extra: Record<string, unknown> = {}): AgentDonePayload {
  return {
    correlationId,
    result: { content: 'done', providerId: 'p1', model: 'm1', ...extra } as unknown as AgentDonePayload['result'],
  }
}

beforeEach(() => {
  store().clearMessages()
})

describe('appendToken 的会话归属', () => {
  it('对上当前 correlationId 才写字', () => {
    seedStreaming()
    store().appendToken({ correlationId: 'c-1', delta: '你好' })
    expect(store().messages[1].content).toBe('你好')
  })

  it('当前没有流在跑时整条丢弃', () => {
    seedStreaming()
    useAgentStore.setState({ currentCorrelationId: null })
    store().appendToken({ correlationId: 'c-1', delta: 'X' })
    expect(store().messages[1].content).toBe('')
  })

  it('切到新流后，旧流在途的 chunk 不再落进列表', () => {
    seedStreaming()
    useAgentStore.setState({ currentCorrelationId: 'c-2' })
    store().appendToken({ correlationId: 'c-1', delta: '旧流的尾巴' })
    expect(store().messages[1].content).toBe('')
  })

  it('不会回退去写更早一条已完成的 assistant 消息', () => {
    useAgentStore.setState({
      messages: [
        { id: 'a-old', role: 'assistant', content: '上一轮答案', timestamp: 1, correlationId: 'c-9' },
        { id: 'a-new', role: 'assistant', content: '', timestamp: 2, isStreaming: true, correlationId: 'c-1' },
      ],
      isStreaming: true,
      currentCorrelationId: 'c-1',
    })
    store().appendToken({ correlationId: 'c-9', delta: '串台了' })
    expect(store().messages.find((m) => m.id === 'a-old')!.content).toBe('上一轮答案')
    expect(store().messages.find((m) => m.id === 'a-new')!.content).toBe('')
  })

  it('正文与思考链各写各的字段', () => {
    seedStreaming()
    store().appendToken({ correlationId: 'c-1', delta: 'A' })
    store().appendToken({ correlationId: 'c-1', delta: 'R', kind: 'reasoning' })
    const msg = store().messages[1]
    expect(msg.content).toBe('A')
    expect(msg.reasoning).toBe('R')
  })
})

describe('finalizeMessage / markError 的认领规则', () => {
  it('done 关掉自己那条并清空当前会话', () => {
    seedStreaming()
    store().finalizeMessage(donePayload('c-1'))
    expect(store().messages[1].isStreaming).toBe(false)
    expect(store().messages[1].model).toBe('m1')
    expect(store().currentCorrelationId).toBeNull()
    expect(store().isStreaming).toBe(false)
  })

  it('迟到的 done 只关自己那条，不动当前新流', () => {
    seedStreaming()
    // 用户已切到新一轮
    useAgentStore.setState({ currentCorrelationId: 'c-2' })
    store().finalizeMessage(donePayload('c-1'))
    expect(store().messages[1].isStreaming).toBe(false)
    expect(store().currentCorrelationId).toBe('c-2')
  })

  it('done 找不到归属消息时不新增也不清空当前会话', () => {
    seedStreaming()
    useAgentStore.setState({ currentCorrelationId: 'c-2' })
    store().finalizeMessage(donePayload('c-404'))
    expect(store().messages).toHaveLength(2)
    expect(store().currentCorrelationId).toBe('c-2')
  })

  it('error 单独记在 errorMessage，不污染已经流出来的正文', () => {
    seedStreaming()
    store().appendToken({ correlationId: 'c-1', delta: '写了一半' })
    store().markError({ correlationId: 'c-1', message: '网络断了' } as AgentErrorPayload)
    const msg = store().messages[1]
    expect(msg.isStreaming).toBe(false)
    expect(msg.isError).toBe(true)
    expect(msg.content).toBe('写了一半')
    expect(msg.errorMessage).toBe('网络断了')
    // 旧实现把 "[错误] …" 拼进 content：那块内容会被当错误整片渲染成红字，
    // 还会作为历史再喂给模型一次。现在正文只装真说过的话。
    expect(msg.content).not.toContain('[错误]')
    expect(store().lastError).toBe('网络断了')
  })
})
