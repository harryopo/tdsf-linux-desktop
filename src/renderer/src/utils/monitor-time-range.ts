/**
 * 监控数据时间范围切片工具
 *
 * Spec: M3 Task 2 · Step 2.1
 *
 * 设计依据：
 * - MonitorPage 的 TimeRangeSwitcher（1H/6H/24H）切换后需对监控数据时间序列切片
 * - 切片是纯函数，不修改原数组，返回新数组
 * - 切片以 Date.now() 为右边界，向前回溯 rangeMs 毫秒
 *
 * 用法：
 *   const sliced = sliceMonitorData(monitorData, '1H')
 *   const latest = sliced[sliced.length - 1]
 */
import type { MonitorData } from '@shared/models'

/** 时间范围选项（与 TimeRangeSwitcher 一致） */
export type TimeRange = '1H' | '6H' | '24H'

/**
 * 根据时间范围切片 MonitorData 数组
 *
 * @param data 完整的监控数据时间序列（按 timestamp 升序）
 * @param range 时间范围（1H/6H/24H）
 * @returns 切片后的数据（仅保留 range 时间窗口内的数据点）；空数组输入返回空数组
 */
export function sliceMonitorData(data: MonitorData[], range: TimeRange): MonitorData[] {
  if (data.length === 0) return []
  const now = Date.now()
  const rangeMs =
    range === '1H'
      ? 60 * 60 * 1000
      : range === '6H'
        ? 6 * 60 * 60 * 1000
        : 24 * 60 * 60 * 1000
  return data.filter((d) => now - d.timestamp <= rangeMs)
}
