/**
 * 工具事件落点测试（#86 P2 流式观感）
 *
 * 钉住的缺陷：appendToolEvent 过去只往 isStreaming 的那条消息里写，写不进去就静默 return。
 * 工具结果（result）经常晚于 agent:done 到达 —— 那时消息已收尾，事件被丢掉，
 * 界面上那条命令卡永远停在"运行中"，展开也没有输出，可信度分析还拿不到工具结果。
 *
 * 现在的规则：按 correlationId 认领自己那条（done 之后迟到的 result 照样落地），
 * 但绝不写进别的会话那条，也不凭空造一条消息。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useAgentStore } from '@renderer/stores/agent-store'
import type { AgentMessage } from '@renderer/stores/agent-store'

const store = () => useAgentStore.getState()

function assistant(overrides: Partial<AgentMessage>): AgentMessage {
  return {
    id: 'a1',
    role: 'assistant',
    content: '',
    timestamp: 2,
    isStreaming: true,
    correlationId: 'c-1',
    ...overrides,
  }
}

/** 一条正在流的 + 一条上一轮已收尾的，用来验"迟到"和"串台"两种情形 */
function seedTwoTurns(): void {
  useAgentStore.setState({
    messages: [
      assistant({ id: 'a-old', correlationId: 'c-1', isStreaming: false, content: '上一轮答案' }),
      assistant({ id: 'a-new', correlationId: 'c-2', isStreaming: true, content: '' }),
    ],
    isStreaming: true,
    currentCorrelationId: 'c-2',
  })
}

const byId = (id: string): AgentMessage => store().messages.find((m) => m.id === id)!

beforeEach(() => {
  store().clearMessages()
})

describe('appendToolEvent：call / output / result 配对', () => {
  it('流式中三段合并成一条记录，done+ok+output 回填', () => {
    useAgentStore.setState({
      messages: [assistant({ content: '先看' })],
      isStreaming: true,
      currentCorrelationId: 'c-1',
    })
    store().appendToolEvent({ correlationId: 'c-1', toolCallId: 't1', phase: 'call', toolName: 'ssh_readonly', input: 'df -h' })
    store().appendToolEvent({ correlationId: 'c-1', toolCallId: 't1', phase: 'output', toolName: 'ssh_readonly', output: '/dev/sda1 40G' })
    store().appendToolEvent({ correlationId: 'c-1', toolCallId: 't1', phase: 'result', toolName: 'ssh_readonly', ok: true, output: '摘要' })

    const events = byId('a1').toolEvents ?? []
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ toolCallId: 't1', toolName: 'ssh_readonly', input: 'df -h', done: true, ok: true })
    // 成功时保留更完整的流式累积输出（result 只是摘要）
    expect(events[0].output).toBe('/dev/sda1 40G')
  })

  it('output 早于 call 到达时先建记录，call 补入参不重复建', () => {
    useAgentStore.setState({
      messages: [assistant({ content: '' })],
      isStreaming: true,
      currentCorrelationId: 'c-1',
    })
    store().appendToolEvent({ correlationId: 'c-1', toolCallId: 't9', phase: 'output', toolName: 'kb_search', output: '块' })
    store().appendToolEvent({ correlationId: 'c-1', toolCallId: 't9', phase: 'call', toolName: 'kb_search', input: '内存' })
    const events = byId('a1').toolEvents ?? []
    expect(events).toHaveLength(1)
    expect(events[0].input).toBe('内存')
    expect(events[0].done).toBe(false)
  })
})

describe('appendToolEvent：迟到事件按 correlationId 认领', () => {
  it('result 晚于 done 到达，仍落回它自己那条（不再卡在"运行中"）', () => {
    seedTwoTurns()
    // 上一轮：call 已经落过，卡片当时是"运行中"
    store().appendToolEvent({ correlationId: 'c-1', toolCallId: 't1', phase: 'call', toolName: 'ssh_readonly', input: 'df -h' })
    expect(byId('a-old').toolEvents?.[0].done).toBe(false)

    // 迟到的终态
    store().appendToolEvent({ correlationId: 'c-1', toolCallId: 't1', phase: 'result', toolName: 'ssh_readonly', ok: true, output: '40G 用了 12G' })

    const evt = byId('a-old').toolEvents?.[0]
    expect(evt?.done, '迟到 result 被丢掉 = 卡片永远转圈').toBe(true)
    expect(evt?.ok).toBe(true)
    expect(evt?.output).toBe('40G 用了 12G')
  })

  it('迟到的 result 不写进当前正在流的另一条（串台）', () => {
    seedTwoTurns()
    store().appendToolEvent({ correlationId: 'c-1', toolCallId: 't1', phase: 'result', toolName: 'ssh_readonly', ok: true, output: 'x' })
    expect(byId('a-new').toolEvents ?? [], '新流没收到过 call，不该凭空长出一张卡').toHaveLength(0)
  })

  it('消息已清空时丢弃，不凭空造一条 assistant', () => {
    useAgentStore.setState({ messages: [], isStreaming: false, currentCorrelationId: null })
    store().appendToolEvent({ correlationId: 'c-gone', toolCallId: 't1', phase: 'result', toolName: 'ssh_readonly', ok: true })
    expect(store().messages).toHaveLength(0)
  })

  it('带 id 但列表里没人认领时丢弃，也不写到无关消息上', () => {
    useAgentStore.setState({
      messages: [
        { id: 'u1', role: 'user', content: '帮我看磁盘', timestamp: 1 },
        assistant({ id: 'a-x', correlationId: 'c-77', isStreaming: false, content: '无关的旧回答' }),
      ],
      isStreaming: false,
      currentCorrelationId: null,
    })
    store().appendToolEvent({ correlationId: 'c-1', toolCallId: 't1', phase: 'result', toolName: 'ssh_readonly', ok: true })
    expect(byId('a-x').toolEvents ?? []).toHaveLength(0)
    expect(store().messages).toHaveLength(2)
  })

  it('事件没带 correlationId（旧数据）时仍写进正在流的那条', () => {
    useAgentStore.setState({
      messages: [assistant({ content: '正文' })],
      isStreaming: true,
      currentCorrelationId: 'c-1',
    })
    store().appendToolEvent({ toolCallId: 't1', phase: 'call', toolName: 'ssh_readonly', input: 'uptime' })
    expect(byId('a1').toolEvents).toHaveLength(1)
  })

  it('占位消息还没拿到 correlationId 时不丢事件', () => {
    // useAgentChat 先建 isStreaming 占位消息，agentChat IPC 回来后才补 correlationId
    useAgentStore.setState({
      messages: [assistant({ correlationId: undefined })],
      isStreaming: true,
      currentCorrelationId: 'c-1',
    })
    store().appendToolEvent({ correlationId: 'c-1', toolCallId: 't1', phase: 'call', toolName: 'ssh_readonly', input: 'uptime' })
    expect(byId('a1').toolEvents).toHaveLength(1)
  })
})
