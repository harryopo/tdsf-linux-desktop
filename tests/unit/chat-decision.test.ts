/**
 * tests/unit/chat-decision.test.ts — 聊天决策构建工具单测（v2.5 接线修复）
 *
 * 覆盖范围：
 * 1. toolEventsToEvidences：各工具类型映射 + 未完成调用过滤 + 无结果检索降权
 * 2. buildHistorySaveIntent：只交事实的落库意图（P0-5 之后渲染层不再产出
 *    risk / confidence / id / timestamp —— 那些由主进程判）
 */
import { describe, it, expect } from 'vitest'
import { toolEventsToEvidences, buildHistorySaveIntent } from '../../src/renderer/src/utils/chat-decision'
import type { AgentMessage, AgentToolCall } from '../../src/renderer/src/stores/agent-store'

/** 构造工具调用记录 */
function makeEvent(overrides: Partial<AgentToolCall> = {}): AgentToolCall {
  return {
    toolCallId: 't1',
    toolName: 'ssh_readonly',
    input: 'df -h',
    done: true,
    ok: true,
    output: 'Use% 45%',
    ...overrides,
  }
}

describe('toolEventsToEvidences', () => {
  it('ssh_readonly 成功 → command 证据，verified=true，先验 0.9', () => {
    const [ev] = toolEventsToEvidences([makeEvent()])
    expect(ev.source).toBe('command')
    expect(ev.sourceDetail).toBe('df -h')
    expect(ev.verified).toBe(true)
    expect(ev.sourcePrior).toBe(0.9)
    expect(ev.confidence).toBe(0.9)
  })

  it('kb_search 命中 → knowledge 证据 verified=true；无结果（"未"开头）降权', () => {
    const [hit, miss] = toolEventsToEvidences([
      makeEvent({ toolCallId: 'k1', toolName: 'kb_search', input: 'nginx', output: '1. [KB-1] x' }),
      makeEvent({ toolCallId: 'k2', toolName: 'kb_search', input: '磁盘', output: '未在知识库找到相关条目' }),
    ])
    expect(hit.source).toBe('knowledge')
    expect(hit.verified).toBe(true)
    expect(miss.verified).toBe(false)
    expect(miss.confidence).toBeLessThan(hit.confidence)
  })

  it('未完成（done=false）的调用不产生证据', () => {
    expect(toolEventsToEvidences([makeEvent({ done: false })])).toHaveLength(0)
  })

  it('monitor_get → metric 证据', () => {
    const [ev] = toolEventsToEvidences([makeEvent({ toolName: 'monitor_get' })])
    expect(ev.source).toBe('metric')
  })
})

describe('buildHistorySaveIntent', () => {
  const user: AgentMessage = { id: 'u1', role: 'user', content: '查一下磁盘', timestamp: 1 }
  const assistant: AgentMessage = {
    id: 'a1',
    role: 'assistant',
    content: '磁盘 45%，建议清理日志',
    timestamp: 2,
    toolEvents: [makeEvent()],
  }

  it('只交事实：命令 + 上下文 + 证据 + 已执行，不含风险/置信度/时间戳', () => {
    const intent = buildHistorySaveIntent({
      command: 'journalctl --vacuum-size=200M',
      userMessage: user,
      assistantMessage: assistant,
      sessionId: 'sess-1',
    })
    expect(intent.command).toBe('journalctl --vacuum-size=200M')
    expect(intent.problem).toBe('查一下磁盘')
    expect(intent.hypothesis).toContain('磁盘 45%')
    expect(intent.evidences).toHaveLength(1)
    expect(intent.executed).toBe(true)
    expect(intent.sessionId).toBe('sess-1')
  })

  it('P0-5 的结构保证：意图里根本没有 risk / confidence / id / timestamp 这些字段', () => {
    const intent = buildHistorySaveIntent({
      command: 'uptime',
      userMessage: user,
      assistantMessage: assistant,
    })
    expect(Object.keys(intent).sort()).toEqual(
      ['command', 'evidences', 'executed', 'fixDescription', 'hypothesis', 'problem', 'sessionId'].sort(),
    )
    // 渲染层想改也改不动：这些键不在类型上，落库值由主进程计算
    // （主进程侧的实测判据在 tests/unit/ipc-history-decision-gate.test.ts）
  })

  it('无上下文消息时用占位文案且不抛错', () => {
    const intent = buildHistorySaveIntent({ command: 'uptime', userMessage: null, assistantMessage: null })
    expect(intent.problem).toContain('无用户问题上下文')
    expect(intent.evidences).toHaveLength(0)
    expect(intent.sessionId).toBeUndefined()
  })
})
