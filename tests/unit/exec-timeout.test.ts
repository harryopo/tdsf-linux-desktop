/**
 * tests/unit/exec-timeout.test.ts — 命令执行超时的取值规则
 *
 * 设置页「命令执行超时秒」现在真的决定 connection-manager 里 setTimeout 的时长，
 * 所以脏值行为必须有测试：掏空输入框得到 NaN 的话，
 * setTimeout(fn, NaN) 会**立刻**触发，等于所有命令一执行就超时。
 */
import { describe, it, expect } from 'vitest'
import {
  resolveExecTimeoutMs,
  EXEC_TIMEOUT_MIN_SEC,
  EXEC_TIMEOUT_MAX_SEC,
} from '../../src/main/services/ssh/connection-manager'

describe('resolveExecTimeoutMs', () => {
  it('没配过用默认 30 秒', () => {
    expect(resolveExecTimeoutMs(undefined)).toBe(30_000)
  })

  it('正常秒数换算成毫秒', () => {
    expect(resolveExecTimeoutMs(60)).toBe(60_000)
    expect(resolveExecTimeoutMs(12.4)).toBe(12_000)
    expect(resolveExecTimeoutMs(12.6)).toBe(13_000)
  })

  it('越界夹到 10–600 秒，绝不返回 0 或 NaN', () => {
    expect(resolveExecTimeoutMs(0)).toBe(EXEC_TIMEOUT_MIN_SEC * 1000)
    expect(resolveExecTimeoutMs(-1)).toBe(EXEC_TIMEOUT_MIN_SEC * 1000)
    expect(resolveExecTimeoutMs(99_999)).toBe(EXEC_TIMEOUT_MAX_SEC * 1000)
    for (const bad of ['60', Number.NaN, Number.POSITIVE_INFINITY, null, {}, []]) {
      const ms = resolveExecTimeoutMs(bad)
      expect(Number.isFinite(ms)).toBe(true)
      expect(ms).toBeGreaterThan(0)
    }
  })
})
