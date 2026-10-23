/**
 * 决策历史统计的空态口径（2026-10-15 全维度审查 F4）
 *
 * 0 条记录时页面曾渲染出"成功率 0.0%"（成功绿）与"平均置信度 0.00"——
 * 把"从没测过"演成"测了，结果是零"。这条判据钉的就是这个区别。
 */
import { describe, it, expect } from 'vitest'
import { buildHistoryStats, deriveFromRecords, fromAggregate, durationLabel, NO_DATA } from '@renderer/lib/history-stats'

const cell = (label: string) => {
  const c = buildHistoryStats({ total: 0, successRate: 0, avgConfidence: 0, avgDurationMs: null }).find(
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
    expect(buildHistoryStats({ total: 0, successRate: 0, avgConfidence: 0, avgDurationMs: null })[0].value).toBe('0')
  })

  it('有记录时才给数字，并把百分比与两位小数如实算出来', () => {
    const s = buildHistoryStats({ total: 4, successRate: 0.75, avgConfidence: 0.8333, avgDurationMs: 12_000 })
    const by = (l: string) => s.find((x) => x.label === l)!
    expect(by('成功率').value).toBe('75.0%')
    expect(by('成功率').color).toBe('var(--status-success-text)')
    expect(by('平均置信度').value).toBe('0.83')
    expect(by('平均响应时间').value).toBe('12s')
  })

  it('总耗时这一路没有样本时，即使有记录也不许编一个 0s', () => {
    const s = buildHistoryStats({ total: 3, successRate: 1, avgConfidence: 0.5, avgDurationMs: null })
    expect(s.find((x) => x.label === '平均响应时间')!.value).toBe(NO_DATA)
  })

  it('派生来源与主进程来源同形：耗时没记录的条目不参与平均', () => {
    const src = deriveFromRecords([
      { status: '成功', confidence: 0.9, durationMs: null },
      { status: '失败', confidence: 0.5, durationMs: 10_000 },
      { status: '成功', confidence: 0.7, durationMs: 20_000 },
    ])
    expect(src.total).toBe(3)
    expect(src.successRate).toBeCloseTo(2 / 3, 6)
    expect(src.avgConfidence).toBeCloseTo(0.7, 6)
    expect(src.avgDurationMs).toBe(15000)
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

/**
 * 主进程聚合 → 统计卡形状这一路（#175-①）
 *
 * 上面几条测的是纯函数，缺陷却长在调用方：HistoryPage 把 `avgDurationMs` 直接
 * `Math.round(/1000)`，主进程对"一条耗时样本都没有"返回的是 **0**（类型是 number，装不下"没有"），
 * 于是聚合那一路算出 `avgDurationSec: 0`，绕过了 `!== null` 的判据——
 * 统计卡上就出现"平均响应时间 0s"。同一条文件头写着"两条分支各写一遍就是成因"的话，自己违反了。
 */
describe('主进程聚合的耗时读数（#175-①）', () => {
  const aggregate = (avgDurationMs: number | null) => ({
    total: 3,
    successRate: 1,
    avgConfidence: 0.7,
    avgDurationMs,
    servers: ['srv-1'],
  })

  it('没有耗时样本（主进程给 0）→ 毫秒数必须是 null，不是 0', () => {
    const src = fromAggregate(aggregate(0))
    expect(src.avgDurationMs, '0 个样本被当成"平均 0 毫秒"').toBeNull()
    const cell = buildHistoryStats(src).find((x) => x.label === '平均响应时间')
    expect(cell?.value).toBe(NO_DATA)
  })

  it('主进程改成如实给 null 时，同样落到"没有值"', () => {
    expect(fromAggregate(aggregate(null)).avgDurationMs).toBeNull()
  })

  it('有样本才换算：4200ms → 4s（真数，不是进位出来的）', () => {
    const src = fromAggregate(aggregate(4200))
    expect(src.avgDurationMs).toBe(4200)
    expect(buildHistoryStats(src).find((x) => x.label === '平均响应时间')?.value).toBe('4s')
  })
})

/**
 * 单条记录的耗时文案（#175-① 的另一半）
 *
 * 历史页列表行原先写 `Math.max(1, Math.round(ms/1000))`：一条 200ms 的命令显示"1s"，
 * 是拿进位把"不到一秒"演成"一秒"。
 */
describe('单条耗时不许进位（#175-①）', () => {
  it('没有记录就是没有：null → —', () => {
    expect(durationLabel(null)).toBe(NO_DATA)
  })

  it('200ms 显示 0.2s，不许被抬成 1s', () => {
    expect(durationLabel(200)).toBe('0.2s')
    expect(durationLabel(200)).not.toBe('1s')
  })

  it('亚秒级保留一位小数，秒级以上取整', () => {
    expect(durationLabel(840)).toBe('0.8s')
    expect(durationLabel(12_600)).toBe('13s')
    expect(durationLabel(1000)).toBe('1s')
    // 40ms 若四舍五入成 "0s" 就又造出一个假零
    expect(durationLabel(40)).toBe('<0.1s')
  })
})
