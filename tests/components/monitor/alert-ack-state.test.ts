/**
 * 「标记已处理」真的改变状态，并且会过期（#133）
 *
 * 病根：alert:ack 的键以前由抽屉按 `time|server|desc` 现拼，而 time 每秒都在变、
 * desc 里带着百分比——每条新数据都是一个新键。结果：
 * - 主进程那张 Map 只进不出（500 条上限全靠刷时间戳刷掉）；
 * - 用户点完"标记已处理"，下一拍算出来的告警换了键，状态又回到未处理，
 *   看上去就像按钮没反应。
 *
 * 现在键是 `会话|种类`（alertKey），已处理状态存在 monitor-store，
 * 列表与横幅都从同一个 alertStatusOf 取，指标回落后这份确认被 pruneSessionAcks 作废。
 *
 * 判据驱动的是算告警的那个函数（不是界面文本）：状态到底变没变，只有它能回答。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { computeAlertsFromMonitorData } from '@/components/monitor/AlertTable'
import {
  alertKey,
  alertKeyBelongsToSession,
  alertStatusOf,
  deriveAlerts,
  type AlertKind,
  type AlertRecord,
} from '@/components/monitor/monitor-model'
import { useMonitorStore } from '@/stores/monitor-store'
import type { MonitorData } from '@shared/models'

const SESSION = 'sess-a'
const HOST = 'web-01'
/** 默认阈值（与 useAlertThresholds 的默认值一致） */
const T = { disk: 85, cpu: 90, memory: 90 }

function sample(over: Partial<MonitorData> = {}): MonitorData {
  return {
    timestamp: 1_700_000_000_000,
    cpuUsage: 10,
    memoryUsage: 20,
    diskUsage: 30,
    networkIn: 0,
    networkOut: 0,
    loadAverage: 0.1,
    uptime: 1,
    processCount: 10,
    ...over,
  } as MonitorData
}

function push(...samples: MonitorData[]): void {
  const store = useMonitorStore.getState()
  samples.forEach((s) => store.addMonitorData(SESSION, s))
}

function byKind(alerts: AlertRecord[], kind: AlertKind): AlertRecord | undefined {
  return alerts.find((a) => a.id === alertKey(SESSION, kind))
}

beforeEach(() => {
  useMonitorStore.getState().clearAllMonitorData()
})

afterEach(() => {
  useMonitorStore.getState().clearAllMonitorData()
})

describe('已处理状态跟着告警走', () => {
  it('超阈值时是未处理，标记后同一条变成已处理（键不变，所以状态留得住）', () => {
    push(sample({ diskUsage: 92 }))

    const first = computeAlertsFromMonitorData(SESSION, HOST, T)
    expect(byKind(first, 'disk')?.status).toBe('未处理')

    useMonitorStore.getState().ackAlert(alertKey(SESSION, 'disk'))

    const second = computeAlertsFromMonitorData(SESSION, HOST, T)
    expect(second.length, '告警本身不许因为标记过就消失').toBe(first.length)
    expect(byKind(second, 'disk')?.id).toBe(byKind(first, 'disk')?.id)
    expect(byKind(second, 'disk')?.status).toBe('已处理')
  })

  it('每秒推一条也不会把状态冲掉（旧键里时间戳会造成这个后果）', () => {
    push(sample({ cpuUsage: 95 }))
    useMonitorStore.getState().ackAlert(alertKey(SESSION, 'cpu'))

    for (let i = 1; i <= 5; i++) {
      push(sample({ cpuUsage: 95 + i * 0.1, timestamp: 1_700_000_000_000 + i * 1000 }))
      expect(byKind(computeAlertsFromMonitorData(SESSION, HOST, T), 'cpu')?.status).toBe('已处理')
    }
  })

  it('指标回落后确认作废：再越线重新算未处理（不许拿旧账压制新问题）', () => {
    push(sample({ diskUsage: 92 }))
    useMonitorStore.getState().ackAlert(alertKey(SESSION, 'disk'))
    expect(byKind(computeAlertsFromMonitorData(SESSION, HOST, T), 'disk')?.status).toBe('已处理')

    // 回落：这一轮结束
    push(sample({ diskUsage: 40, timestamp: 1_700_000_001_000 }))
    expect(computeAlertsFromMonitorData(SESSION, HOST, T)).toEqual([])
    expect(useMonitorStore.getState().ackedAlerts.size, '回落了还留着确认＝下一轮被静默压制').toBe(0)

    // 再越线：重新提醒
    push(sample({ diskUsage: 95, timestamp: 1_700_000_002_000 }))
    expect(byKind(computeAlertsFromMonitorData(SESSION, HOST, T), 'disk')?.status).toBe('未处理')
  })

  it('只作废本会话的确认，别的会话标记过的事不跟着丢', () => {
    const other = alertKey('sess-b', 'disk')
    push(sample({ diskUsage: 92 }))
    useMonitorStore.getState().ackAlert(other)
    useMonitorStore.getState().ackAlert(alertKey(SESSION, 'disk'))

    push(sample({ diskUsage: 40, timestamp: 1_700_000_001_000 }))
    computeAlertsFromMonitorData(SESSION, HOST, T)

    expect(useMonitorStore.getState().ackedAlerts.has(other)).toBe(true)
    expect(useMonitorStore.getState().ackedAlerts.has(alertKey(SESSION, 'disk'))).toBe(false)
  })
})

describe('横幅与列表必须是同一个生产者', () => {
  /**
   * 这条是审查逼出来的（原来两处各写一份判定）：
   * 列表只认 disk/cpu 且阈值写死，横幅还会认 memory 且读设置页阈值。
   * 于是横幅能点出 `会话|memory` 的已处理，列表下一拍按自己那份键集合 prune，刚标记的又没了。
   */
  it('内存告警标记后不会在下一拍被列表清掉', () => {
    push(sample({ memoryUsage: 97 }))

    const first = computeAlertsFromMonitorData(SESSION, HOST, T)
    expect(byKind(first, 'memory')?.status).toBe('未处理')

    useMonitorStore.getState().ackAlert(alertKey(SESSION, 'memory'))
    const second = computeAlertsFromMonitorData(SESSION, HOST, T)
    expect(byKind(second, 'memory')?.status, '列表把横幅那条键当"不存在的告警"prune 掉了').toBe('已处理')
  })

  it('用户把阈值调到 70 后，磁盘告警的已处理同样留得住', () => {
    push(sample({ diskUsage: 75 }))

    // 默认阈值下这条不成立；用户设成 70 才成立——键集合必须由同一份阈值算出
    const alerts = computeAlertsFromMonitorData(SESSION, HOST, { ...T, disk: 70 })
    expect(byKind(alerts, 'disk')).toBeTruthy()
    useMonitorStore.getState().ackAlert(alertKey(SESSION, 'disk'))

    const again = computeAlertsFromMonitorData(SESSION, HOST, { ...T, disk: 70 })
    expect(byKind(again, 'disk')?.status).toBe('已处理')
  })

  it('横幅取的那一条，就是列表里同 id 的那一条（deriveAlerts 单一产出）', () => {
    push(sample({ diskUsage: 92, cpuUsage: 95, memoryUsage: 97 }))
    const alerts = deriveAlerts({
      sessionId: SESSION,
      hostname: HOST,
      latest: sample({ diskUsage: 92, cpuUsage: 95, memoryUsage: 97 }),
      thresholds: T,
      acked: new Set<string>(),
    })

    expect(alerts.map((a) => a.id)).toEqual([
      alertKey(SESSION, 'disk'),
      alertKey(SESSION, 'cpu'),
      alertKey(SESSION, 'memory'),
    ])
    // 优先级：磁盘 > CPU > 内存（横幅取第一条）
    expect(alerts[0].level).toBe('critical')
    expect(alerts.every((a) => a.source && a.suggestions && a.suggestions.length >= 2)).toBe(true)
  })
})

describe('键与状态口径只有一个来源', () => {
  it('alertKey 生成的键带会话前缀，belongs-to 判据与它一致', () => {
    const key = alertKey(SESSION, 'memory')
    expect(key).toBe('sess-a|memory')
    expect(alertKeyBelongsToSession(key, SESSION)).toBe(true)
    expect(alertKeyBelongsToSession(key, 'sess-b')).toBe(false)
  })

  it('alertStatusOf 只认"确认过没有"这一个依据', () => {
    expect(alertStatusOf('k', new Set(['k']))).toBe('已处理')
    expect(alertStatusOf('k', new Set())).toBe('未处理')
  })

  it('同一会话同一指标两次计算的键相同（这是"状态留得住"的前提）', () => {
    push(sample({ diskUsage: 92, timestamp: 1_700_000_000_000 }))
    const a = byKind(computeAlertsFromMonitorData(SESSION, HOST, T), 'disk')?.id
    push(sample({ diskUsage: 93, timestamp: 1_700_000_001_000 }))
    const b = byKind(computeAlertsFromMonitorData(SESSION, HOST, T), 'disk')?.id
    expect(b).toBe(a)
  })
})
