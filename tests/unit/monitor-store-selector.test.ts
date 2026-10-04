/**
 * monitor-store 选择器稳定性回归测试（阶段 B：React 19 + zustand 5）
 *
 * 起因：升 React 19 后监控页白屏报 "Maximum update depth exceeded"，
 * 栈顶是 Charts.tsx 的 CpuAreaChart。根因是 `getMonitorData` 在无数据时
 * 现造 `[]` —— zustand 5 走 React 原生 useSyncExternalStore，
 * 选择器返回新引用即被判成快照变化，于是无限重渲染。React 18 下不报。
 *
 * 这里钉住的是不变量本身（同一入参、状态未变时必须是同一个引用），
 * 而不是某一次的修法。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useMonitorStore } from '@renderer/stores/monitor-store'
import type { MonitorData } from '@shared/models'

/** 造一条最小可用的监控数据（字段严格对齐 @shared/models 的 MonitorData） */
function makeData(overrides: Partial<MonitorData> = {}): MonitorData {
  return {
    timestamp: Date.now(),
    cpuUsage: 12.5,
    memoryUsage: 34,
    diskUsage: 56,
    networkIn: 1024,
    networkOut: 2048,
    loadAverage: 0.4,
    uptime: 3600,
    processCount: 7,
    ...overrides,
  }
}

beforeEach(() => {
  useMonitorStore.getState().clearAllMonitorData()
})

describe('getMonitorData 引用稳定性', () => {
  it('无会话 id：两次调用返回同一个数组', () => {
    const { getMonitorData } = useMonitorStore.getState()
    expect(getMonitorData(null)).toBe(getMonitorData(null))
    expect(getMonitorData(undefined)).toBe(getMonitorData(undefined))
    expect(getMonitorData('')).toHaveLength(0)
  })

  it('会话没有数据：两次调用返回同一个数组', () => {
    const { getMonitorData } = useMonitorStore.getState()
    expect(getMonitorData('sess-missing')).toBe(getMonitorData('sess-missing'))
    expect(getMonitorData('sess-missing')).toHaveLength(0)
  })

  it('共享空数组是冻结的，防止有人就地 push 污染全局', () => {
    const { getMonitorData } = useMonitorStore.getState()
    expect(Object.isFrozen(getMonitorData(null))).toBe(true)
  })

  it('有数据时同样稳定，且新数据落进来才换引用', () => {
    const store = useMonitorStore.getState()
    const before = store.getMonitorData('sess-1')

    useMonitorStore.getState().addMonitorData('sess-1', makeData())
    const after = useMonitorStore.getState().getMonitorData('sess-1')

    expect(before).not.toBe(after)
    expect(after).toHaveLength(1)
    expect(useMonitorStore.getState().getMonitorData('sess-1')).toBe(after)
  })

  it('一个会话的数据不会串到另一个会话', () => {
    useMonitorStore.getState().addMonitorData('sess-1', makeData())
    expect(useMonitorStore.getState().getMonitorData('sess-2')).toHaveLength(0)
    expect(useMonitorStore.getState().getMonitorData('sess-1')).toHaveLength(1)
  })
})
