/**
 * 上下文用量徽章算据测试（#89）
 *
 * 钉住两件事：
 * 1. 分母必须是选中模型真实声明的窗口。旧实现把 200_000 写死在 Composer 里，
 *    于是 8K 的小模型和 1M 的长窗口模型显示同一个百分比，用户据此决定要不要压缩上下文。
 * 2. 窗口未知时不许演成一个百分比。旧实现在没数据时照样算出 0%，看起来像"还很空"，
 *    实际是"不知道"。
 */
import { describe, it, expect } from 'vitest'
import { formatTokens, resolveContextUsage } from '@renderer/components/workbench/context-usage'

describe('formatTokens', () => {
  it('千位用 K、百万用 M，不足千位保持原值', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(8_000)).toBe('8K')
    expect(formatTokens(200_000)).toBe('200K')
    expect(formatTokens(250_000)).toBe('250K')
    expect(formatTokens(1_000_000)).toBe('1M')
    expect(formatTokens(1_500_000)).toBe('1.5M')
    expect(formatTokens(0)).toBe('0')
  })

  it('负数按 0 处理（上游没数据时不该显示 -1K）', () => {
    expect(formatTokens(-5)).toBe('0')
  })
})

describe('resolveContextUsage', () => {
  it('窗口已知时按真实窗口算百分比', () => {
    expect(resolveContextUsage({ usedTokens: 125_000, windowTokens: 250_000 })).toEqual({
      pct: 50,
      usedLabel: '125K',
      totalLabel: '250K',
    })
  })

  it('同一个用量在不同窗口下给出不同百分比（分母不再写死）', () => {
    const used = 30_000
    expect(resolveContextUsage({ usedTokens: used, windowTokens: 8_000 }).pct).toBe(100)
    expect(resolveContextUsage({ usedTokens: used, windowTokens: 32_000 }).pct).toBe(94)
    expect(resolveContextUsage({ usedTokens: used, windowTokens: 1_000_000 }).pct).toBe(3)
  })

  it('用量为 0 时是 0%，窗口仍照实显示', () => {
    expect(resolveContextUsage({ usedTokens: 0, windowTokens: 200_000 })).toEqual({
      pct: 0,
      usedLabel: '0',
      totalLabel: '200K',
    })
  })

  it('超窗封顶 100，不出现 137%', () => {
    expect(resolveContextUsage({ usedTokens: 410_000, windowTokens: 200_000 }).pct).toBe(100)
  })

  it('窗口未知（0 或负）时不产出百分比，并标注未知', () => {
    const r = resolveContextUsage({ usedTokens: 12_000, windowTokens: 0 })
    expect(r.pct, '把"不知道"演成 0% 会诱导用户继续灌水').toBeNull()
    expect(r.totalLabel).toBe('未知')
    expect(r.usedLabel, '已用量仍要说得出，只是没有分母').toBe('12K')
  })
})
