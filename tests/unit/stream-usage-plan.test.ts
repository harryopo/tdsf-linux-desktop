/**
 * 取消/失败那一轮的"要不要入账"必须是一个能算的决策，不是代码里顺手写的 0
 *
 * 病根（2026-10-22 拿 ai@7.0.29 实测，见 tests/unit/ai-sdk-abort-shape.test.ts）：
 * 用户点停止时 result.stream 的 for await **干净收尾**（不抛），而 result.usage /
 * finishReason / steps 三个 promise 全部 reject，流里也**不会**出现 finish-step。
 * 也就是说"这一轮烧了多少 token"在 SDK 层面根本拿不到。
 * 拿不到就不能写成 0：一串 0 是一条**假账**（它宣称"这一轮一个 token 没烧"），
 * 而真值是"没拿到账"——界面与统计都只能报后者。
 */
import { describe, it, expect } from 'vitest'
import {
  createUsageAccumulator,
  observeStreamPart,
  planUsageRecord,
  type UsageNumbers
} from '@main/core/agent/stream-stats'

const usage = (i: number, o: number): UsageNumbers => ({
  inputTokens: i,
  outputTokens: o,
  totalTokens: i + o
})

/** 造一条"某一步跑完"的流事件，与 SDK 的 finish-step part 同形 */
const finishStep = (i: number, o: number): unknown => ({
  type: 'finish-step',
  usage: { inputTokens: i, outputTokens: o, totalTokens: i + o }
})

describe('planUsageRecord（这一轮到底该不该入账）', () => {
  it('SDK 给了用量就按 SDK 的记（正常路径行为不变）', () => {
    const acc = createUsageAccumulator()
    expect(planUsageRecord({ sdkUsage: usage(100, 20), accumulated: acc })).toEqual(usage(100, 20))
  })

  it('SDK 没给用量、但流里已经攒到步数 → 记攒到的那份', () => {
    let acc = createUsageAccumulator()
    acc = observeStreamPart(finishStep(70, 9), acc)
    expect(planUsageRecord({ sdkUsage: undefined, accumulated: acc })).toEqual(usage(70, 9))
  })

  it('两边都拿不到 → null（不许记一串 0 的假账）', () => {
    const acc = createUsageAccumulator()
    expect(planUsageRecord({ sdkUsage: undefined, accumulated: acc })).toBeNull()
  })

  it('SDK 回来的是全 0 也不算拿到账', () => {
    const acc = createUsageAccumulator()
    expect(planUsageRecord({ sdkUsage: usage(0, 0), accumulated: acc })).toBeNull()
  })

  it('取消那一轮最常见的形状：一个 finish-step 都没来过 → 不入账', () => {
    // 与实测的 abort 流一致：只有 start / start-step / text-delta / abort
    let acc = createUsageAccumulator()
    for (const p of [
      { type: 'start' },
      { type: 'start-step' },
      { type: 'text-delta', text: '半截' },
      { type: 'abort' }
    ]) {
      acc = observeStreamPart(p, acc)
    }
    expect(planUsageRecord({ sdkUsage: undefined, accumulated: acc })).toBeNull()
  })

  it('SDK 用量与攒到的用量同时在场时以 SDK 为准（它是各步之和的正本）', () => {
    let acc = createUsageAccumulator()
    acc = observeStreamPart(finishStep(10, 1), acc)
    expect(planUsageRecord({ sdkUsage: usage(30, 3), accumulated: acc })).toEqual(usage(30, 3))
  })
})
