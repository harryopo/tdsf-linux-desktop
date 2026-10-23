/**
 * 监控时间档位取真数据（#183）
 *
 * 现场：store 只留 60 条（3 秒/条 ≈ 3 分钟），页面却有 1H/6H/24H 三档，
 * 图表再 `.slice(-60)` 一次——三档切来切去画的是同一段，"24H"是标签假的。
 *
 * 新口径：store 每分钟只留最后一个采样（≈24 小时），选择器按档位取窗口再降采样。
 * 判据要回答两件事：
 *   1. 三档取到的时间窗**不一样**（这是原来的病）；
 *   2. 降采样后每个点仍然是一次真实采集（不插值、不造点）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { selectMonitorSeries, SERIES_MAX_POINTS } from '../../src/renderer/src/utils/monitor-time-range'
import {
  appendMonitorSample,
  MAX_HISTORY_COUNT,
  SAMPLE_BUCKET_MS,
  useMonitorStore,
} from '../../src/renderer/src/stores/monitor-store'
import type { MonitorData } from '../../src/shared/models'

const MIN = 60_000

function sample(ts: number, cpu = 10): MonitorData {
  return {
    timestamp: ts,
    cpuUsage: cpu,
    memoryUsage: 20,
    diskUsage: 30,
    networkIn: 1,
    networkOut: 1,
    loadAverage: 0.1,
    uptime: 1000,
    processCount: 100,
  }
}

/** 造一份"每分钟一条、覆盖 24 小时"的历史 */
function dayOfMinutes(now: number): MonitorData[] {
  const out: MonitorData[] = []
  for (let i = 24 * 60; i >= 0; i--) out.push(sample(now - i * MIN, i % 100))
  return out
}

const NOW = 1_700_000_000_000

describe('按档位取窗口', () => {
  it('1H / 6H / 24H 取到的时间窗与点数各不相同（原病：三档一模一样）', () => {
    const history = dayOfMinutes(NOW)
    const h1 = selectMonitorSeries(history, '1H', NOW)
    const h6 = selectMonitorSeries(history, '6H', NOW)
    const h24 = selectMonitorSeries(history, '24H', NOW)

    expect(h1.length).toBeLessThanOrEqual(SERIES_MAX_POINTS)
    expect(h6.length).toBeLessThanOrEqual(SERIES_MAX_POINTS)
    expect(h24.length).toBeLessThanOrEqual(SERIES_MAX_POINTS)

    // 起点依次更早
    expect(h1[0].timestamp).toBeGreaterThan(h6[0].timestamp)
    expect(h6[0].timestamp).toBeGreaterThan(h24[0].timestamp)
    // 跨度真的对得上档位（24H 至少覆盖 20 小时）
    expect(h1[h1.length - 1].timestamp - h1[0].timestamp).toBeLessThanOrEqual(60 * MIN)
    expect(h24[h24.length - 1].timestamp - h24[0].timestamp).toBeGreaterThanOrEqual(20 * 60 * MIN)
  })

  it('数据不足档位时如实只给已有那段，不补点', () => {
    const history = [sample(NOW - 10 * MIN), sample(NOW - 5 * MIN), sample(NOW)]
    const out = selectMonitorSeries(history, '24H', NOW)
    expect(out).toHaveLength(3)
    expect(out[0].timestamp).toBe(NOW - 10 * MIN)
  })

  it('降采样后的每个点都来自真实采样（时间戳集合是子集）', () => {
    const history = dayOfMinutes(NOW)
    const originals = new Set(history.map((d) => d.timestamp))
    for (const point of selectMonitorSeries(history, '24H', NOW)) {
      expect(originals.has(point.timestamp)).toBe(true)
    }
  })

  it('空历史返回空数组', () => {
    expect(selectMonitorSeries([], '1H', NOW)).toEqual([])
  })
})

describe('store 的保留口径', () => {
  beforeEach(() => {
    useMonitorStore.getState().clearAllMonitorData()
  })

  it('同一分钟内只保留最后一个采样', () => {
    const base = NOW - (NOW % SAMPLE_BUCKET_MS)
    let history: MonitorData[] = []
    history = appendMonitorSample(history, sample(base + 3_000, 10))
    history = appendMonitorSample(history, sample(base + 30_000, 55))
    expect(history).toHaveLength(1)
    expect(history[0].cpuUsage).toBe(55)
  })

  it('跨分钟新增一条', () => {
    const base = NOW - (NOW % SAMPLE_BUCKET_MS)
    let history: MonitorData[] = []
    history = appendMonitorSample(history, sample(base + 59_000))
    history = appendMonitorSample(history, sample(base + 61_000))
    expect(history).toHaveLength(2)
  })

  it('最多留 24 小时（超出从最早的开始丢）', () => {
    let history: MonitorData[] = []
    for (let i = 0; i < MAX_HISTORY_COUNT + 10; i++) history = appendMonitorSample(history, sample(i * MIN))
    expect(history).toHaveLength(MAX_HISTORY_COUNT)
    expect(history[0].timestamp).toBe(10 * MIN)
  })

  it('store 走的是同一套追加口径（不是另外写一份）', () => {
    useMonitorStore.getState().addMonitorData('s1', sample(NOW))
    useMonitorStore.getState().addMonitorData('s1', sample(NOW + 1_000, 77))
    const got = useMonitorStore.getState().getMonitorData('s1')
    expect(got).toHaveLength(1)
    expect(got[0].cpuUsage).toBe(77)
  })
})
