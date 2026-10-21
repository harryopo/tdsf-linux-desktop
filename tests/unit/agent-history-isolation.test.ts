/**
 * 对话历史按 SSH 会话隔离（2026-10-21 全维度审查 D2）
 *
 * 病根：发送时把 store 里所有消息都当历史，切到 B 机后仍带着 A 机的命令块；
 * 模型会拿着 A 的上下文在 B 上执行工具。这里钉住纯函数的过滤规则：
 * 同会话才发送；本机（undefined）只收本机；旧消息没有会话字段时对远程一律不发。
 */
import { describe, it, expect } from 'vitest'
import { historyForSession, type AgentMessage } from '@renderer/stores/agent-store'

function msg(role: 'user' | 'assistant' | 'system', sshSessionId?: string): AgentMessage {
  return { id: `${role}-${sshSessionId ?? 'local'}`, role, content: role, timestamp: 1, sshSessionId }
}

describe('historyForSession', () => {
  const messages = [
    msg('user', 'sA'),
    msg('assistant', 'sA'),
    msg('user', 'sB'),
    msg('assistant', 'sB'),
    msg('user'),
    msg('system', 'sA'),
  ]

  it('只取当前会话的 user/assistant', () => {
    const got = historyForSession(messages, 'sA')
    expect(got.map((m) => `${m.role}:${m.sshSessionId}`)).toEqual(['user:sA', 'assistant:sA'])
  })

  it('切到另一台机不会带上 A 的历史', () => {
    expect(historyForSession(messages, 'sB').every((m) => m.sshSessionId === 'sB')).toBe(true)
  })

  it('本机（undefined）只收本机消息', () => {
    const got = historyForSession(messages, undefined)
    expect(got).toHaveLength(1)
    expect(got[0].sshSessionId).toBeUndefined()
  })

  it('旧消息没有会话字段时，对远程会话一律不发（安全侧多排除）', () => {
    const legacy: AgentMessage = { id: 'old', role: 'user', content: 'x', timestamp: 1 }
    expect(historyForSession([legacy], 'sA')).toHaveLength(0)
  })
})
