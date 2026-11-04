/**
 * Run 生命周期三条回归（TDD 先红）
 *
 * 三个病各一条：
 * 1. 终态丢失：终态推送时没有订阅者（窗口重建 / broadcast 失败）后，迟到订阅者必须能拿到补发；
 *    且 finish 幂等，终态恰好推一次。
 * 2. 首包竞态：agent:chat 返回 correlationId 之前到达的第一个增量不得被丢弃。
 * 3. 并发无互锁：同一 SSH 会话上不得同时存在两条会向外下发命令的 Run。
 *
 * 第 1、3 条测主进程的单一 Run 真相源（run-registry）。
 * 第 2 条测渲染层 store 的认领时序（现有代码在 correlationId 回填前整条丢弃）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { RunRegistry } from '@main/core/agent/run-registry'
import { useAgentStore } from '@renderer/stores/agent-store'

describe('病 1 · 终态丢失（界面永久卡 streaming）', () => {
  it('终态推送时订阅者未挂上，迟到订阅者也要收到补发；finish 幂等只推一次', () => {
    const reg = new RunRegistry()
    const begun = reg.begin({ id: 'chat_terminal_1', kind: 'chat', sshSessionId: 's1' })
    expect(begun.ok).toBe(true)
    if (!begun.ok) return

    // 订阅者未挂上 = 窗口重建 / broadcastToWindows 没有可投递窗口。
    const delivered: string[] = []

    // 第一次收尾必须成功，并且终态先落在 Run 上（不是"发出去了才算收尾"）。
    expect(reg.finish('chat_terminal_1', { ok: true, result: {} })).toBe(true)
    expect(begun.run.state).toBe('completed')

    // 迟到的订阅者：挂上就应立刻拿到终态（补发），否则界面永远没有终态。
    reg.subscribe('chat_terminal_1', (evt) => delivered.push(evt.type))
    expect(delivered).toEqual(['terminal'])

    // 幂等：重复 finish 不得再推第二次。
    expect(reg.finish('chat_terminal_1', { ok: true, result: {} })).toBe(false)
    expect(delivered).toEqual(['terminal'])
  })
})

describe('病 2 · 首包竞态（correlationId 回填前丢字）', () => {
  beforeEach(() => {
    useAgentStore.setState({
      messages: [],
      isStreaming: false,
      currentCorrelationId: null,
      lastStreamActivityAt: null,
      lastError: null,
    })
  })

  it('correlationId 回填前到达的首个增量不得丢', () => {
    // 严格按现有顺序：useAgentChat 先建 assistant 占位并 setStreaming，
    // 然后 await agentChat，返回后才回填 correlationId。
    useAgentStore.setState({
      isStreaming: true,
      messages: [
        {
          id: 'assistant_placeholder',
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          isStreaming: true,
        },
      ],
    })

    // 主进程已经开始推流：首包比 invoke 的返回值先到。
    useAgentStore.getState().appendToken({ correlationId: 'chat_first_1', delta: '首' })

    // invoke 返回，渲染层才认领这条流。
    useAgentStore.getState().setCurrentCorrelationId('chat_first_1')

    const msg = useAgentStore.getState().messages[0]
    expect(msg.content).toBe('首')
  })

  it('终态先于 correlationId 回填时，迟到的认领不得把缓冲重放进已收尾的流', () => {
    useAgentStore.setState({
      isStreaming: true,
      currentCorrelationId: null,
      messages: [
        {
          id: 'assistant_late_terminal',
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          isStreaming: true,
        },
      ],
    })
    useAgentStore.getState().appendToken({ correlationId: 'chat_late_1', delta: '首' })

    // done 早于 invoke 的返回值到达：走真实的 finalizeMessage，不手工摆状态。
    useAgentStore.getState().finalizeMessage({
      correlationId: 'chat_late_1',
      result: {
        text: '',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
        providerId: 'p1',
        model: 'm1',
        strength: 'standard',
        durationMs: 1,
        compactionLevel: 'none',
      },
    })

    // invoke 的返回值这时才回来（迟到的认领）。
    useAgentStore.getState().setCurrentCorrelationId('chat_late_1')

    expect(useAgentStore.getState().isStreaming).toBe(false)
    expect(useAgentStore.getState().currentCorrelationId).toBeNull()
    expect(useAgentStore.getState().messages[0].content).toBe('')
    expect(useAgentStore.getState().messages[0].isStreaming).toBe(false)
  })
})

describe('病 3 · 同会话并发无互锁', () => {
  it('同一 SSH 会话已有 PAOR 时，chat 必须被拒绝，不能两条同时向外发命令', () => {
    const reg = new RunRegistry()
    const paor = reg.begin({ id: 'paor:s1', kind: 'paor', sshSessionId: 's1' })
    expect(paor.ok).toBe(true)

    const chat = reg.begin({ id: 'chat_after_paor', kind: 'chat', sshSessionId: 's1' })
    expect(chat.ok).toBe(false)
    if (!chat.ok) expect(chat.reason).toBe('busy')
  })

  it('反向顺序同样互锁：chat 在跑时 PAOR 必须被拒绝', () => {
    const reg = new RunRegistry()
    const chat = reg.begin({ id: 'chat_first', kind: 'chat', sshSessionId: 's1' })
    expect(chat.ok).toBe(true)

    const paor = reg.begin({ id: 'paor:s1', kind: 'paor', sshSessionId: 's1' })
    expect(paor.ok).toBe(false)
    if (!paor.ok) expect(paor.reason).toBe('busy')
  })
})
