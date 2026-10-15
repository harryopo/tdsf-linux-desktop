/**
 * 时间预算的判据（2026-10-15 全维度审查 D1）
 *
 * 关键是"绝对上限"这条：以前主链路只有一个"相邻两个 part 的间隔"计时，
 * 慢速提供方每 89 秒滴一个字节就永远不违约，工具期又整体暂停计时。
 * 所以判据不测"有没有超时"，测"最坏多久必然结束"。
 */
import { describe, it, expect } from 'vitest'
import {
  APPROVAL_BUDGET_MS,
  isLlmTimeout,
  resolveLlmBudget,
} from '@main/core/agent/llm-budget'

describe('LLM 时间预算', () => {
  it('没配过用 30 秒一步，并给一个能读懂的总上限', () => {
    const b = resolveLlmBudget({ settingTimeoutMs: undefined, hasTools: false })
    expect(b.timeout.stepMs).toBe(30_000)
    expect(b.timeout.chunkMs).toBe(30_000)
    expect(b.timeout.totalMs).toBeGreaterThanOrEqual(90_000)
    expect(b.maxRetries, '只留一层重试栈（SDK 层 1 次，不再叠第二层）').toBe(1)
  })

  it('脏值一律回默认，绝不产生 NaN（setTimeout(NaN) 会立刻触发＝所有请求一发出就超时）', () => {
    for (const bad of [NaN, Infinity, 0, -5, 'abc', null, undefined, {}]) {
      const b = resolveLlmBudget({ settingTimeoutMs: bad, execTimeoutMs: bad, approvalMs: bad })
      for (const v of [b.timeout.totalMs, b.timeout.stepMs, b.timeout.chunkMs, b.timeout.toolMs, b.approvalMs]) {
        expect(Number.isFinite(v as number), `${String(bad)} 让预算变成了 ${v}`).toBe(true)
        expect(v as number).toBeGreaterThan(0)
      }
    }
  })

  it('挂工具时预算里含"一次审批 + 一次命令 + 余量"，没挂工具时不许白给', () => {
    const withTools = resolveLlmBudget({ settingTimeoutMs: 30_000, execTimeoutMs: 30_000, approvalMs: 60_000 })
    const noTools = resolveLlmBudget({ settingTimeoutMs: 30_000, hasTools: false })
    expect(withTools.timeout.toolMs).toBe(60_000 + 30_000 + 30_000)
    expect(noTools.timeout.toolMs, '无工具的调用不该带工具预算（会把总时长顶高一倍）').toBeUndefined()
    expect(withTools.timeout.totalMs).toBeGreaterThan(noTools.timeout.totalMs)
  })

  it('总预算有绝对上限：把设置拉到极大也不会变成"永远不结束"', () => {
    const b = resolveLlmBudget({
      settingTimeoutMs: 999_999,
      execTimeoutMs: 600_000,
      approvalMs: 600_000,
      stepCount: 12,
    })
    expect(b.timeout.totalMs).toBeLessThanOrEqual(15 * 60_000)
    // 单步仍然夹在可配范围内，不会被极大值顶穿
    expect(b.timeout.stepMs).toBeLessThanOrEqual(300_000)
  })

  it('12 步工具链的最坏耗时是算得出来的（这条就是原来的缺陷）', () => {
    const b = resolveLlmBudget({ settingTimeoutMs: 30_000, execTimeoutMs: 30_000, approvalMs: 60_000, stepCount: 12 })
    // 曾经：12×审批 + 12×命令 ≈ 1080s+ 且计时暂停，点停止也无效
    expect(b.timeout.totalMs).toBeLessThanOrEqual(15 * 60_000)
    expect(b.timeout.stepMs * (b.stepCount + 1)).toBeLessThanOrEqual(b.timeout.totalMs)
  })

  it('步数下限：0 或负数回 1，不能因为 stopWhen 传 0 变成"一步都不许跑"', () => {
    expect(resolveLlmBudget({ stepCount: 0, hasTools: false }).stepCount).toBe(1)
    expect(resolveLlmBudget({ stepCount: -3, hasTools: false }).stepCount).toBe(1)
    expect(resolveLlmBudget({ stepCount: 12, hasTools: false }).stepCount).toBe(12)
  })

  it('审批时长沿用历史值（稳定性修复不顺手改变用户可感知行为）', () => {
    expect(APPROVAL_BUDGET_MS.chatWrite).toBe(60_000)
    expect(APPROVAL_BUDGET_MS.toolCall).toBe(30_000)
    expect(APPROVAL_BUDGET_MS.sandboxCommand).toBe(30_000)
    expect(APPROVAL_BUDGET_MS.taskPermission).toBe(30_000)
    expect(APPROVAL_BUDGET_MS.subagentBatch).toBe(300_000)
  })

  it('命令超时夹在 10–600 秒之间（与设置页那格的口径一致）', () => {
    const huge = resolveLlmBudget({ execTimeoutMs: 99_999_999, approvalMs: 60_000 })
    expect(huge.timeout.toolMs).toBe(60_000 + 600_000 + 30_000)
    const tiny = resolveLlmBudget({ execTimeoutMs: 1, approvalMs: 60_000 })
    expect(tiny.timeout.toolMs).toBe(60_000 + 10_000 + 30_000)
  })
})

/**
 * AI SDK v7 的 timeout 靠一个内部合并 AbortSignal 实现，到期时用
 * DOMException('<label> timeout of Nms exceeded', 'TimeoutError') 去 abort。
 * 自制看门狗拆掉之后，"超时"与"用户点停止"的区分就全靠这个判定——它错了，
 * 界面上要么是"已取消"其实是卡死，要么是把用户的停止报成故障。
 */
describe('isLlmTimeout', () => {
  it('认得 SDK 抛出的超时形状', () => {
    expect(isLlmTimeout(new DOMException('chunk timeout of 45000ms exceeded', 'TimeoutError'))).toBe(true)
    const e = new Error('total timeout of 900000ms exceeded')
    e.name = 'TimeoutError'
    expect(isLlmTimeout(e)).toBe(true)
    expect(isLlmTimeout(new Error('step timeout of 30000ms exceeded'))).toBe(true)
  })

  it('也认得挂在 signal.reason 上的超时', () => {
    const c = new AbortController()
    c.abort(new DOMException('tool timeout of 120000ms exceeded', 'TimeoutError'))
    expect(isLlmTimeout(new Error('aborted'), c.signal)).toBe(true)
  })

  it('用户点停止不算超时（反向对照，否则界面会把取消报成故障）', () => {
    const c = new AbortController()
    c.abort()
    expect(isLlmTimeout(new Error('AbortError: signal aborted'), c.signal)).toBe(false)
    expect(isLlmTimeout(new Error('user cancelled'))).toBe(false)
  })

  it('真实提供方错误不许被误判成超时', () => {
    expect(isLlmTimeout(new Error('429 Too Many Requests'))).toBe(false)
    expect(isLlmTimeout(undefined)).toBe(false)
    expect(isLlmTimeout(null, undefined)).toBe(false)
  })
})
