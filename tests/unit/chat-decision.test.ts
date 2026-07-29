/**
 * tests/unit/chat-decision.test.ts — 聊天决策构建工具单测（v2.5 接线修复）
 *
 * 覆盖范围：
 * 1. toolEventsToEvidences：各工具类型映射 + 未完成调用过滤 + 无结果检索降权
 * 2. riskCheckToAssessment：三级 → 五级模型映射
 * 3. buildChatDecisionCard：完整决策卡构建（status=executed、置信度兜底）
 */
import { describe, it, expect } from 'vitest'
import {
  toolEventsToEvidences,
  riskCheckToAssessment,
  buildChatDecisionCard,
} from '../../src/renderer/src/utils/chat-decision'
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

describe('riskCheckToAssessment', () => {
  it('low → LOW 不需确认；high → HIGH 需确认，规则透传', () => {
    const low = riskCheckToAssessment('low', [])
    expect(low.level).toBe('LOW')
    expect(low.requireConfirmation).toBe(false)
    expect(low.description).toBe('未命中风险规则')

    const high = riskCheckToAssessment('high', ['rm 递归删除'])
    expect(high.level).toBe('HIGH')
    expect(high.requireConfirmation).toBe(true)
    expect(high.matchedRules).toEqual(['rm 递归删除'])
  })
})

describe('buildChatDecisionCard', () => {
  const user: AgentMessage = { id: 'u1', role: 'user', content: '查一下磁盘', timestamp: 1 }
  const assistant: AgentMessage = {
    id: 'a1',
    role: 'assistant',
    content: '磁盘 45%，建议清理日志',
    timestamp: 2,
    toolEvents: [makeEvent()],
  }

  it('构建完整决策卡：executed 状态 + 真实上下文 + 证据链', () => {
    const card = buildChatDecisionCard({
      command: 'journalctl --vacuum-size=200M',
      userMessage: user,
      assistantMessage: assistant,
      risk: riskCheckToAssessment('medium', ['清理日志']),
      sessionId: 'sess-1',
    })
    expect(card.status).toBe('executed')
    expect(card.problem).toBe('查一下磁盘')
    expect(card.hypothesis).toContain('磁盘 45%')
    expect(card.fixCommand).toBe('journalctl --vacuum-size=200M')
    expect(card.evidences).toHaveLength(1)
    expect(card.sessionId).toBe('sess-1')
    // 置信度兜底：无评估值时用证据均值（单条 ssh 成功 = 0.9）
    expect(card.confidence).toBeCloseTo(0.9)
  })

  it('无上下文消息时使用占位文案且不抛错', () => {
    const card = buildChatDecisionCard({
      command: 'uptime',
      userMessage: null,
      assistantMessage: null,
      risk: riskCheckToAssessment('low', []),
    })
    expect(card.problem).toContain('无用户问题上下文')
    expect(card.evidences).toHaveLength(0)
    expect(card.confidence).toBe(0.5)
  })
})
