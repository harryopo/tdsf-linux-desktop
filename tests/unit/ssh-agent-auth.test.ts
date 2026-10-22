/**
 * ssh-agent 套接字解析（2026-10-21 开源对标补课）
 *
 * 这里只判"去哪儿找 agent"：Unix 认 SSH_AUTH_SOCK，Windows 认 OpenSSH 的命名管道。
 * 找不到就返回 null，让连接层给出可行动的报错，而不是拿着空字符串去连。
 */
import { describe, it, expect } from 'vitest'
import {
  resolveSshAgentSocket,
  WINDOWS_OPENSSH_AGENT_PIPE,
} from '@main/services/ssh/agent-auth'

describe('resolveSshAgentSocket', () => {
  it('Unix 上 SSH_AUTH_SOCK 优先，且忽略首尾空白', () => {
    expect(resolveSshAgentSocket({ SSH_AUTH_SOCK: ' /tmp/agent.sock ' }, 'linux')).toBe('/tmp/agent.sock')
    expect(resolveSshAgentSocket({ SSH_AUTH_SOCK: ' /tmp/agent.sock ' }, 'darwin')).toBe('/tmp/agent.sock')
  })

  it('Windows：OpenSSH 管道存在时优先于环境变量（MSYS 路径 ssh2 连不上）', () => {
    expect(
      resolveSshAgentSocket({ SSH_AUTH_SOCK: '/tmp/msys-agent.sock' }, 'win32', (p) => p === WINDOWS_OPENSSH_AGENT_PIPE)
    ).toBe(WINDOWS_OPENSSH_AGENT_PIPE)
    // 管道不在时才退回环境变量（Cygwin / 自带转发）
    expect(resolveSshAgentSocket({ SSH_AUTH_SOCK: 'C:/agent.sock' }, 'win32', () => false)).toBe('C:/agent.sock')
    expect(resolveSshAgentSocket({}, 'win32', () => false)).toBeNull()
  })

  it('Unix 没有 SSH_AUTH_SOCK 时返回 null（不猜默认路径）', () => {
    expect(resolveSshAgentSocket({}, 'linux')).toBeNull()
    expect(resolveSshAgentSocket({}, 'darwin')).toBeNull()
  })
})
