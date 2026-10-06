/**
 * tests/core/confirm-timeout.test.ts — 决策超时的取值规则
 *
 * 这条链是设置页 decision.decisionTimeout → 主进程 resolveConfirmTimeoutMs → 确认步 setTimeout。
 * 设置页那个输入框现在真的管用了，所以脏值行为必须有测试：
 * 用户在 Electron 的 number input 里能掏出空值、负数、超大值，
 * 解析器不能抛异常（会把整条工作流带崩），也不能把超时算成 0（等于立刻自动拒绝）。
 */
import { describe, it, expect } from 'vitest'
import {
  resolveConfirmTimeoutMs,
  CONFIRM_TIMEOUT_DEFAULT_SEC,
  CONFIRM_TIMEOUT_MIN_SEC,
  CONFIRM_TIMEOUT_MAX_SEC,
} from '../../src/main/core/agent-workflow'

describe('resolveConfirmTimeoutMs', () => {
  it('没配过就用默认 5 分钟（和接线前的硬编码一致）', () => {
    expect(resolveConfirmTimeoutMs(undefined)).toBe(CONFIRM_TIMEOUT_DEFAULT_SEC * 1000)
    expect(CONFIRM_TIMEOUT_DEFAULT_SEC).toBe(300)
  })

  it('正常值按秒换算成毫秒', () => {
    expect(resolveConfirmTimeoutMs(60)).toBe(60_000)
    expect(resolveConfirmTimeoutMs(90.6)).toBe(91_000) // 四舍五入到整秒
  })

  it('越界夹到区间内，不返回 0 也不返回负数', () => {
    expect(resolveConfirmTimeoutMs(0)).toBe(CONFIRM_TIMEOUT_MIN_SEC * 1000)
    expect(resolveConfirmTimeoutMs(-500)).toBe(CONFIRM_TIMEOUT_MIN_SEC * 1000)
    expect(resolveConfirmTimeoutMs(999_999)).toBe(CONFIRM_TIMEOUT_MAX_SEC * 1000)
  })

  it('脏值（字符串/NaN/Infinity/null/对象）一律回默认，且不抛', () => {
    for (const bad of ['120', Number.NaN, Number.POSITIVE_INFINITY, null, {}, []]) {
      expect(resolveConfirmTimeoutMs(bad)).toBe(CONFIRM_TIMEOUT_DEFAULT_SEC * 1000)
    }
  })
})
