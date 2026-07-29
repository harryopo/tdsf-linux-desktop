/**
 * alert-detector — 监控告警自动检测（v2.9）
 *
 * 背景：此前告警只在渲染层 MonitorPage 打开时才算横幅，关掉页面/切走就没有了，
 * 属于"看得见才有"的假监控。本模块把阈值检测下沉到主进程采集回调，
 * 每次采集都判定，超阈值触发系统通知（Electron Notification），
 * 做到"人不在监控页也能收到告警"。
 *
 * 纯函数 evaluateAlert 便于单测；副作用（通知/去抖状态）由 monitor.ts 侧持有。
 */
import type { MonitorData } from '@shared/models'

/** 告警级别 */
export type AlertLevel = 'warning' | 'critical'

/** 告警阈值配置（来自设置页 monitor.threshold.*，带默认值） */
export interface AlertThresholds {
  cpu: number
  memory: number
  disk: number
}

/** 默认阈值（与设置页 AlertsSettings ALERT_THRESHOLD_DEFAULTS 保持一致） */
export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = { cpu: 90, memory: 90, disk: 85 }

/** 单条告警 */
export interface AlertEvent {
  /** 触发指标 */
  metric: 'cpu' | 'memory' | 'disk'
  level: AlertLevel
  /** 当前值（%） */
  value: number
  /** 阈值（%） */
  threshold: number
  /** 通知标题 */
  title: string
  /** 通知正文 */
  body: string
  /** 去抖键（同一指标同一严重度共用，避免每 5 秒弹一次） */
  dedupeKey: string
}

/** 指标中文名 */
const METRIC_LABELS: Record<AlertEvent['metric'], string> = {
  cpu: 'CPU 使用率',
  memory: '内存使用率',
  disk: '磁盘使用率',
}

/**
 * 评估一条监控数据，返回需要触发的告警列表（可能多条：CPU/内存/磁盘同时超标）
 *
 * 分级：超过阈值 → warning；超过阈值且 ≥97% 或超阈值 10 个点 → critical。
 * dedupeKey 含级别，级别升级（warning→critical）会重新通知一次。
 *
 * @param data 本次采集数据
 * @param thresholds 阈值配置
 * @param hostname 主机名（通知里显示，缺省"服务器"）
 */
export function evaluateAlerts(
  data: MonitorData,
  thresholds: AlertThresholds,
  hostname = '服务器',
): AlertEvent[] {
  const out: AlertEvent[] = []
  const checks: Array<{ metric: AlertEvent['metric']; value: number; threshold: number }> = [
    { metric: 'cpu', value: data.cpuUsage, threshold: thresholds.cpu },
    { metric: 'memory', value: data.memoryUsage, threshold: thresholds.memory },
    { metric: 'disk', value: data.diskUsage, threshold: thresholds.disk },
  ]
  for (const c of checks) {
    if (typeof c.value !== 'number' || Number.isNaN(c.value)) continue
    if (c.value <= c.threshold) continue
    const level: AlertLevel = c.value >= 97 || c.value - c.threshold >= 10 ? 'critical' : 'warning'
    const label = METRIC_LABELS[c.metric]
    const rounded = Math.round(c.value)
    out.push({
      metric: c.metric,
      level,
      value: rounded,
      threshold: c.threshold,
      title: `${level === 'critical' ? '🔴 严重告警' : '⚠️ 告警'} · ${hostname}`,
      body: `${label} ${rounded}% 超过阈值 ${c.threshold}%`,
      dedupeKey: `${c.metric}:${level}`,
    })
  }
  return out
}

/**
 * 去抖判定：同一 dedupeKey 在冷却期内不重复通知
 *
 * @param dedupeKey 告警去抖键
 * @param now 当前时间戳
 * @param lastFired 上次触发时间表（外部持有，会被本函数写入）
 * @param cooldownMs 冷却毫秒（默认 5 分钟）
 * @returns true=应当通知；false=冷却期内跳过
 */
export function shouldNotify(
  dedupeKey: string,
  now: number,
  lastFired: Map<string, number>,
  cooldownMs = 5 * 60 * 1000,
): boolean {
  const prev = lastFired.get(dedupeKey)
  if (prev !== undefined && now - prev < cooldownMs) return false
  lastFired.set(dedupeKey, now)
  return true
}
