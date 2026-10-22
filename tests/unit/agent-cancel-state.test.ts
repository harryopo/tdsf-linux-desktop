/**
 * 取消（点"停止"）之后的收尾状态（调研 P0-2）
 *
 * 缺陷形状：主进程在取消分支已经发了 `finishReason:'cancelled'`
 * （`src/main/core/agent/supervisor.ts` 的取消分支），但渲染层从来没有读过这个字段
 * ——它只把 `isStreaming` 置 false。于是用户点了"停止"之后，屏幕上那半截回答
 * 与"模型说完了"长得一模一样；同时取消分支把 usage 写成全 0，
 * 消息尾部的徽章就理直气壮地报"0 tokens"。
 *
 * 这里钉三条：
 * 1. cancelled 要留下可读的痕迹（`cancelled` 为真），UI 才有东西可渲染；
 * 2. 取消时"没拿到账"不许写成 0——0 是一个事实陈述，而它并不是事实；
 * 3. 真拿到了账（后续主进程改完会走到这条）要原样保留，不许因为"取消"就丢。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useAgentStore } from '@renderer/stores/agent-store'
import type { AgentDonePayload } from '@shared/agent-types'

const store = () => useAgentStore.getState()

function seedStreaming(): void {
  useAgentStore.setState({
    messages: [
      { id: 'u1', role: 'user', content: '帮我看磁盘', timestamp: 1 },
      {
        id: 'a1',
        role: 'assistant',
        content: '先看一下 df',
        timestamp: 2,
        isStreaming: true,
        correlationId: 'c-1',
      },
    ],
    isStreaming: true,
    currentCorrelationId: 'c-1',
  })
}

const zeroUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }

function done(result: Record<string, unknown>): AgentDonePayload {
  return {
    correlationId: 'c-1',
    result: { content: '先看一下 df', providerId: 'p1', model: 'm1', ...result } as unknown as AgentDonePayload['result'],
  }
}

beforeEach(() => {
  store().clearMessages()
})

describe('取消后的消息状态', () => {
  it('cancelled 的 done 要把消息标成"被停止"，并停掉流动态', () => {
    seedStreaming()
    store().finalizeMessage(done({ finishReason: 'cancelled', usage: zeroUsage }))
    const msg = store().messages[1]
    expect(msg.cancelled).toBe(true)
    expect(msg.isStreaming).toBe(false)
  })

  it('取消时没拿到账就不写 0（0 是事实陈述，而这里并不是事实）', () => {
    seedStreaming()
    store().finalizeMessage(done({ finishReason: 'cancelled', usage: zeroUsage }))
    expect(store().messages[1].usage).toBeUndefined()
  })

  it('取消但真拿到的用量要保留，不能因为"取消"就丢掉', () => {
    seedStreaming()
    const partial = { inputTokens: 1200, outputTokens: 34, totalTokens: 1234 }
    store().finalizeMessage(done({ finishReason: 'cancelled', usage: partial }))
    expect(store().messages[1].usage).toEqual(partial)
  })

  it('正常说完（stop）不算取消：不标 cancelled，用量照常写', () => {
    seedStreaming()
    const usage = { inputTokens: 800, outputTokens: 200, totalTokens: 1000 }
    store().finalizeMessage(done({ finishReason: 'stop', usage }))
    const msg = store().messages[1]
    expect(msg.cancelled).toBeUndefined()
    expect(msg.usage).toEqual(usage)
  })
})
