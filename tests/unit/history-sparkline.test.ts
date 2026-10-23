/**
 * 决策历史统计卡的 sparkline 曲线（任务 #175-① 同族）
 *
 * 曲线没有坐标轴、只看相对高低，所以唯一的诚实要求是"同值必须同高"。
 * avgDuration 原先把 durationMs===null 记成 0 塞进平均值：一条"没测到耗时"的记录
 * 会把那一桶拉低，画出来像"那阵子响应极快"。缺席不是零——这一条钉的就是这个区别。
 */
import { describe, it, expect } from 'vitest'
import { baselineSparkline, buildSparklinePoints, type SparklineRecord } from '@renderer/utils/history-sparkline'

const rec = (partial: Partial<SparklineRecord> & { timestamp: number }): SparklineRecord => ({
  status: '成功',
  confidence: 0.8,
  durationMs: 1000,
  ...partial,
})

/** 取出每个点的 y 坐标（24 = 最低，0 = 最高） */
function ys(points: string): number[] {
  return points.split(' ').map((p) => Number(p.split(',')[1]))
}

describe('决策历史 sparkline 的 avgDuration', () => {
  it('没测到耗时的记录不参与平均：两个桶都只有一条 1000ms，曲线必须是平的', () => {
    const points = buildSparklinePoints(
      [
        rec({ timestamp: 0, durationMs: 1000 }),
        rec({ timestamp: 1000, durationMs: 1000 }),
        // 同处第二桶：这条没有耗时样本，按缺席处理
        rec({ timestamp: 1001, durationMs: null }),
      ],
      'avgDuration',
      { buckets: 2 }
    )
    const [a, b] = ys(points)
    expect(b, `缺席被当成 0ms 会把第二桶压下去：${points}`).toBe(a)
  })

  it('真有快慢差别时曲线仍然反映出来（证明上一条不是因为整条尺子坏了才平）', () => {
    const points = buildSparklinePoints(
      [
        rec({ timestamp: 0, durationMs: 2000 }),
        rec({ timestamp: 1000, durationMs: 1000 }),
        rec({ timestamp: 1001, durationMs: 1000 }),
      ],
      'avgDuration',
      { buckets: 2 }
    )
    const [a, b] = ys(points)
    expect(a).toBe(0)
    expect(b, '一半的耗时应当画在中间高度').toBe(12)
  })

  it('整页都没耗时样本：画基线占位，具体读数由卡片给「—」', () => {
    expect(
      buildSparklinePoints(
        [rec({ timestamp: 0, durationMs: null }), rec({ timestamp: 1000, durationMs: null })],
        'avgDuration',
        { buckets: 2 }
      )
    ).toBe(baselineSparkline)
  })
})
