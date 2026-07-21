/**
 * CommandProbe 单元测试
 *
 * 覆盖：
 * - 正常返回：ok=true，stdout/stderr/exitCode 正确
 * - 超时：返回 ok=false，error 包含 "timeout"
 * - 重试：失败后自动重试一次（用 mock 控制）
 * - 错误捕获：连接失败返回 ok=false，error 包含错误信息
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock SshConnectionManager
const { mockExec } = vi.hoisted(() => ({ mockExec: vi.fn() }))

vi.mock('../../../src/main/services/ssh/connection-manager', () => ({
  SshConnectionManager: {
    getInstance: () => ({
      exec: mockExec
    })
  }
}))

import { commandProbe } from '../../../src/main/services/profiler/command-probe'

describe('commandProbe', () => {
  beforeEach(() => {
    mockExec.mockReset()
  })

  it('正常返回：stdout / stderr / exitCode 正确', async () => {
    mockExec.mockResolvedValueOnce({
      stdout: 'hello world\n',
      stderr: '',
      exitCode: 0,
      durationMs: 50
    })

    const result = await commandProbe('sess-1', 'system', '系统标识', 'echo hello')

    expect(result.ok).toBe(true)
    expect(result.stdout).toBe('hello world\n')
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(result.cmd).toBe('echo hello')
    expect(result.group).toBe('system')
    expect(result.groupLabel).toBe('系统标识')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('exec 抛出错误时返回 ok=false', async () => {
    mockExec.mockRejectedValue(new Error('connection lost'))

    const result = await commandProbe('sess-1', 'system', '系统标识', 'echo hi', {
      retries: 0  // 关闭重试快速失败
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('connection lost')
  })

  it('超时返回 ok=false 且 error 包含 timeout', async () => {
    // 让 exec 永远不 resolve
    mockExec.mockReturnValueOnce(new Promise(() => {}))

    const result = await commandProbe('sess-1', 'system', '系统标识', 'sleep 999', {
      timeoutMs: 100,
      retries: 0
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('timeout')
  })

  it('重试机制：首次失败后重试一次', async () => {
    mockExec
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValueOnce({
        stdout: 'retry ok',
        stderr: '',
        exitCode: 0,
        durationMs: 30
      })

    const result = await commandProbe('sess-1', 'system', '系统标识', 'echo retry', {
      retries: 1,
      retryDelayMs: 10
    })

    expect(result.ok).toBe(true)
    expect(result.stdout).toBe('retry ok')
    expect(mockExec).toHaveBeenCalledTimes(2)
  })

  it('重试全部失败：返回最后一次的错误', async () => {
    mockExec
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockRejectedValueOnce(new Error('fail 3'))

    const result = await commandProbe('sess-1', 'system', '系统标识', 'echo all-fail', {
      retries: 2,
      retryDelayMs: 10
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('fail 3')  // 最后一次错误
    expect(mockExec).toHaveBeenCalledTimes(3)  // 1 + 2 retries
  })

  it('非零 exitCode 仍算 ok=true（命令本身能跑）', async () => {
    mockExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'command not found',
      exitCode: 127,
      durationMs: 20
    })

    const result = await commandProbe('sess-1', 'tools', '开发工具', 'notacommand')

    expect(result.ok).toBe(true)
    expect(result.exitCode).toBe(127)
    expect(result.stderr).toBe('command not found')
  })
})
