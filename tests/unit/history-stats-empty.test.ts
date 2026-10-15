/**
 * 决策历史统计的空态口径（2026-10-15 全维度审查 F4）
 *
 * 0 条记录时页面曾渲染出"成功率 0.0%"（成功绿）与"平均置信度 0.00"——
 * 把"从没测过"演成"测了，结果是零"。这条判据钉的就是这个区别。
 */
import { describe, it, expect } from 'vitest'
import { buildHistoryStats, deriveFromRecords, NO_DATA } from '@renderer/lib/history-stats'

const cell = (label: string) => {
  const c = buildHistoryStats({ total: 0, successRate: 0, avgConfidence: 0, avgDurationSec: null }).find(
    (x) => x.label === label
  )
  if (!c) throw new Error(`统计卡里没有「${label}」这一格，判据要跟着改`)
  return c
}

describe('决策历史统计', () => {
  it('0 条记录：三张派生卡全是"没有值"，且不许用成功绿', () => {
    for (const label of ['成功率', '平均置信度', '平均响应时间']) {
      const c = cell(label)
      expect(c.value, `${label} 在零分母下仍然给出数字`).toBe(NO_DATA)
      expect(c.color, `${label} 在零分母下还带语义色（绿色会被读成"结果是零"）`).toBe('var(--text-tertiary)')
    }
    expect(buildHistoryStats({ total: 0, successRate: 0, avgConfidence: 0, avgDurationSec: null })[0].value).toBe('0')
  })

  it('有记录时才给数字，并把百分比与两位小数如实算出来', () => {
    const s = buildHistoryStats({ total: 4, successRate: 0.75, avgConfidence: 0.8333, avgDurationSec: 12 })
    const by = (l: string) => s.find((x) => x.label === l)!
    expect(by('成功率').value).toBe('75.0%')
    expect(by('成功率').color).toBe('var(--status-success-text)')
    expect(by('平均置信度').value).toBe('0.83')
    expect(by('平均响应时间').value).toBe('12s')
  })

  it('总耗时这一路没有样本时，即使有记录也不许编一个 0s', () => {
    const s = buildHistoryStats({ total: 3, successRate: 1, avgConfidence: 0.5, avgDurationSec: null })
    expect(s.find((x) => x.label === '平均响应时间')!.value).toBe(NO_DATA)
  })

  it('派生来源与主进程来源同形：耗时没记录的条目不参与平均', () => {
    const src = deriveFromRecords([
      { status: '成功', confidence: 0.9, durationSec: null },
      { status: '失败', confidence: 0.5, durationSec: 10 },
      { status: '成功', confidence: 0.7, durationSec: 20 },
    ])
    expect(src.total).toBe(3)
    expect(src.successRate).toBeCloseTo(2 / 3, 6)
    expect(src.avgConfidence).toBeCloseTo(0.7, 6)
    expect(src.avgDurationSec).toBe(15)
  })

  it('空数组派生出来的也是零分母形状，不是 NaN', () => {
    const src = deriveFromRecords([])
    expect(src.total).toBe(0)
    const s = buildHistoryStats(src)
    for (const c of s) {
      expect(c.value, `${c.label} 出现 NaN 就是分母没守住`).not.toMatch(/NaN/)
      expect(c.value).not.toBe('')
    }
  })
})
