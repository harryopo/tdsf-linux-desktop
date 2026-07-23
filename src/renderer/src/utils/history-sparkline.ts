/**
 * history-sparkline — sparkline 数据点生成工具
 *
 * 从 HistoryPage.tsx 提取，用于统计概览卡片的 SVG polyline points 生成。
 */

/** sparkline 指标类型 */
export type SparklineMetric = 'count' | 'successRate' | 'avgConfidence' | 'avgDuration'

/** sparkline 计算所需的最小记录结构（HistoryPage.DecisionRecord 满足此接口） */
export interface SparklineRecord {
  timestamp: number
  status: string
  confidence: number
  durationSec: number
}

/** 基线 sparkline（records 为空时的视觉占位，对应水平线在底部） */
export const baselineSparkline = '0,24 100,24'

/**
 * 基于决策记录数组按时间序列派生 sparkline 数据点。
 *
 * x 坐标范围 0-100，y 坐标范围 0-24（SVG viewBox="0 0 100 24"）。
 * 默认分桶数 8（与原硬编码数据点数量一致）。
 *
 * 边界：
 * - records 为空时返回空字符串 ''
 * - 仅有 1 条记录时返回水平线 '0,12 100,12'
 * - 所有桶值都为 0 时返回基线 '0,24 100,24'
 *
 * metric 计算：
 * - count：每个时间桶内的记录数（归一化到 0-24，max 为所有桶最大值）
 * - successRate：每个桶内 status==='成功' 的比例（0-1 映射到 0-24）
 * - avgConfidence：每个桶内 confidence 平均值（0-1 映射到 0-24）
 * - avgDuration：每个桶内 durationSec 平均值（归一化到 0-24）
 */
export function buildSparklinePoints(
  records: SparklineRecord[],
  metric: SparklineMetric,
  options?: { buckets?: number },
): string {
  if (records.length === 0) return ''
  if (records.length === 1) return '0,12 100,12'

  const buckets = options?.buckets ?? 8

  // 按时间排序，计算时间范围
  const sorted = [...records].sort((a, b) => a.timestamp - b.timestamp)
  const minTime = sorted[0].timestamp
  const maxTime = sorted[sorted.length - 1].timestamp
  const timeRange = maxTime - minTime

  // 所有记录时间相同 → 水平线
  if (timeRange === 0) return '0,12 100,12'

  const bucketSize = timeRange / buckets

  // 累加每个桶的值与计数
  const sums = new Array<number>(buckets).fill(0)
  const counts = new Array<number>(buckets).fill(0)

  for (const r of sorted) {
    const idx = Math.min(buckets - 1, Math.floor((r.timestamp - minTime) / bucketSize))
    let v = 0
    if (metric === 'count') {
      v = 1
    } else if (metric === 'successRate') {
      v = r.status === '成功' ? 1 : 0
    } else if (metric === 'avgConfidence') {
      v = r.confidence
    } else {
      // avgDuration
      v = r.durationSec
    }
    sums[idx] += v
    counts[idx] += 1
  }

  // 计算每个桶的最终值
  const values: number[] = new Array(buckets)
  let maxVal = 0
  for (let i = 0; i < buckets; i++) {
    let v: number
    if (metric === 'count') {
      v = sums[i]
    } else if (counts[i] === 0) {
      v = 0
    } else {
      // successRate: 0-1；avgConfidence: 0-1；avgDuration: 秒
      v = sums[i] / counts[i]
    }
    values[i] = v
    if (v > maxVal) maxVal = v
  }

  // 所有桶值为 0 → 基线
  if (maxVal === 0) return baselineSparkline

  // 归一化到 0-24 范围，生成 points 字符串
  const points: string[] = []
  for (let i = 0; i < buckets; i++) {
    const x = (i / (buckets - 1)) * 100
    const y = 24 - (values[i] / maxVal) * 24
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`)
  }
  return points.join(' ')
}
