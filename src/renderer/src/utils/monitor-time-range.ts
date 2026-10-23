/**
 * 监控时间档位的数据选择（#183）
 *
 * 病根有两处：
 *   1. store 只留 60 条（3 秒/条 ≈ 3 分钟），而页面提供 1H/6H/24H 三档——
 *      三档筛的是同一批点，切了图形纹丝不动（本身也不算错，但"24H"是假的）；
 *   2. 图表又把结果 `.slice(-60)`，即便数据够长也只画最后 60 个点。
 *
 * 现在的口径：
 *   - store 每分钟只留最后一个采样（24 小时 ≈ 1440 条），既够 24H 又不爆内存；
 *   - 这里按档位取窗口，再用等宽分桶降到最多 60 个点（桶内取**真实采样**，不插值）；
 *   - 标题上的"实际跨度"来自这批点的首尾时间戳（monitor-model.spanLabel），
 *     数据不够一天就如实写"实际跨度 2 小时"，不假装 24H。
 */
import type { MonitorData } from '@shared/models'

export type TimeRange = '1H' | '6H' | '24H'

/** 一条曲线最多画多少个点（再多就看不清了） */
export const SERIES_MAX_POINTS = 60

/** 档位对应的窗口长度 */
export function rangeMs(range: TimeRange): number {
  if (range === '1H') return 60 * 60 * 1000
  if (range === '6H') return 6 * 60 * 60 * 1000
  return 24 * 60 * 60 * 1000
}

/**
 * 取某档位下要画的点
 *
 * @param data 按时间升序的采样（store 里已是每分钟一个）
 * @param now 当前时间（注入以便单测）
 */
export function selectMonitorSeries(
  data: readonly MonitorData[],
  range: TimeRange,
  now: number = Date.now()
): MonitorData[] {
  if (data.length === 0) return []
  const span = rangeMs(range)
  const windowed = data.filter((d) => now - d.timestamp <= span && d.timestamp <= now + 1000)
  if (windowed.length <= SERIES_MAX_POINTS) return [...windowed]

  // 等宽分桶，桶内保留时间上最后一个真实采样（不插值：画出来的每个点都对应一次真实采集）
  const bucketWidth = span / SERIES_MAX_POINTS
  const start = now - span
  const out: MonitorData[] = []
  let lastBucket = Number.NEGATIVE_INFINITY
  for (const point of windowed) {
    const bucket = Math.floor((point.timestamp - start) / bucketWidth)
    if (bucket === lastBucket && out.length > 0) {
      out[out.length - 1] = point
    } else {
      out.push(point)
      lastBucket = bucket
    }
  }
  // 边界正好落在桶分界时可能多出一个点（例如 1H 的 0..60 分钟），从最早的裁掉
  return out.length > SERIES_MAX_POINTS ? out.slice(-SERIES_MAX_POINTS) : out
}
