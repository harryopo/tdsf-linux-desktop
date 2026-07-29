/**
 * alert-detector.test.ts — 监控告警自动检测单测（v2.9）
 */
import { describe, it, expect } from 'vitest'
import {
  evaluateAlerts,
  shouldNotify,
  DEFAULT_ALERT_THRESHOLDS,
  type AlertThresholds,
} from '../../src/main/services/ssh/alert-detector'
import type { MonitorData } from '../../src/shared/models'

function mkData(partial: Partial<MonitorData>): MonitorData {
  return {
    timestamp: Date.now(),
    cpuUsage: 10,
    memoryUsage: 20,
    diskUsage: 30,
    networkIn: 0,
    networkOut: 0,
    loadAverage: 0.1,
    uptime: 1000,
    processCount: 100,
    ...partial,
  }
}

describe('evaluateAlerts — 阈值评估', () => {
  const th: AlertThresholds = { cpu: 90, memory: 90, disk: 85 }

  it('全部低于阈值 → 无告警', () => {
    expect(evaluateAlerts(mkData({}), th)).toHaveLength(0)
  })

  it('磁盘超阈值 → 触发一条 warning', () => {
    const alerts = evaluateAlerts(mkData({ diskUsage: 88 }), th)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].metric).toBe('disk')
    expect(alerts[0].level).toBe('warning')
    expect(alerts[0].body).toContain('88%')
    expect(alerts[0].body).toContain('85%')
  })

  it('超阈值 10 个点 → critical', () => {
    const alerts = evaluateAlerts(mkData({ cpuUsage: 100 }), th)
    expect(alerts[0].level).toBe('critical')
  })

  it('≥97% → critical（即使未超阈值 10 点）', () => {
    const alerts = evaluateAlerts(mkData({ memoryUsage: 97 }), { ...th, memory: 90 })
    expect(alerts[0].level).toBe('critical')
  })

  it('CPU/内存/磁盘同时超标 → 三条告警', () => {
    const alerts = evaluateAlerts(mkData({ cpuUsage: 95, memoryUsage: 95, diskUsage: 95 }), th)
    expect(alerts).toHaveLength(3)
    expect(new Set(alerts.map((a) => a.metric))).toEqual(new Set(['cpu', 'memory', 'disk']))
  })

  it('主机名注入通知标题；critical 用红色标记', () => {
    const alerts = evaluateAlerts(mkData({ diskUsage: 99 }), th, 'prod-db-01')
    expect(alerts[0].title).toContain('prod-db-01')
    expect(alerts[0].title).toContain('🔴')
  })

  it('NaN/非数值指标被跳过', () => {
    const alerts = evaluateAlerts(mkData({ cpuUsage: NaN, diskUsage: 88 }), th)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].metric).toBe('disk')
  })

  it('默认阈值导出值正确', () => {
    expect(DEFAULT_ALERT_THRESHOLDS).toEqual({ cpu: 90, memory: 90, disk: 85 })
  })
})

describe('shouldNotify — 去抖', () => {
  it('同一 key 冷却期内只通知一次', () => {
    const last = new Map<string, number>()
    const t0 = 1_000_000
    expect(shouldNotify('disk:warning', t0, last)).toBe(true)
    // 冷却期内（默认 5 分钟）再次判定 → 跳过
    expect(shouldNotify('disk:warning', t0 + 60_000, last)).toBe(false)
    // 超过冷却期 → 再次允许
    expect(shouldNotify('disk:warning', t0 + 6 * 60_000, last)).toBe(true)
  })

  it('不同 key 互不影响（级别升级会重新通知）', () => {
    const last = new Map<string, number>()
    const t0 = 2_000_000
    expect(shouldNotify('cpu:warning', t0, last)).toBe(true)
    // warning→critical 是不同 dedupeKey，立即允许通知
    expect(shouldNotify('cpu:critical', t0, last)).toBe(true)
  })
})
