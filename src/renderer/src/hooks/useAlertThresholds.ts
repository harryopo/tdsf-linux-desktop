/**
 * useAlertThresholds — 告警阈值的唯一读取入口
 *
 * 为什么单独一个 hook：横幅与告警列表以前各写一份判定，
 * 列表把 85/90 写死、横幅读设置页的 monitor.threshold.*。
 * 阈值口径不一样时，"这条告警此刻到底成不成立"就有两个答案，
 * 于是列表按自己那份键集合清理已处理状态，会把横幅刚标记的那条抹掉。
 * 两侧都从这里读，键名也只在这里出现一次。
 */
import { useMemo } from 'react'
import { usePersistentState } from './usePersistentState'
import type { AlertThresholds } from '@/components/monitor/monitor-model'

export function useAlertThresholds(): AlertThresholds {
  const [cpu] = usePersistentState('monitor.threshold.cpu', 90)
  const [memory] = usePersistentState('monitor.threshold.memory', 90)
  const [disk] = usePersistentState('monitor.threshold.disk', 85)
  // 稳定引用：这个对象会进 useMemo 依赖，每次现造会让告警每帧重算一遍
  return useMemo(() => ({ cpu, memory, disk }), [cpu, memory, disk])
}
