/**
 * mock-data.ts — MonitorPage mock 类型与筛选选项
 *
 * 保留：KpiStat/AlertRecord/AlertStatus/RiskLevel 类型 + timeRanges 常量
 * 移除：所有死数据常量（kpiStats、cpuAreaPath、memLines、diskIo、netLines、alerts、processes、
 *        criticalAlertBanner、xLabels）及关联死类型（ProcessStatus、ProcessRecord）
 *
 * R16 清理：24 → 8 导出，组件已迁移至 useMonitorStore 获取实时数据。
 */

/** 风险等级 */
export type RiskLevel = 'critical' | 'high' | 'medium' | 'low'

/** 告警处理状态 */
export type AlertStatus = '未处理' | '处理中' | '已处理'

/** 单条告警记录 */
export interface AlertRecord {
  time: string
  level: RiskLevel
  server: string
  desc: string
  status: AlertStatus
}

/** KPI 卡片数据 */
export interface KpiStat {
  /** 标签（CPU / 内存 / 磁盘 / 网络 I/O） */
  label: string
  /** 主值（大数字） */
  value: number
  /** 单位（% 或 MB/s） */
  unit: string
  /** 副值（核心数 / 容量 / 速率） */
  sub: string
  /** 较昨日变化百分比 */
  delta: number
  /** 变化方向 */
  trend: 'up' | 'down'
  /** 趋势颜色（disk 用 amber 警告色） */
  ringColor: string
  /** 迷你折线数据点（0-100 范围） */
  sparkline: number[]
}

/** 时间范围选项 */
export const timeRanges = ['1H', '6H', '24H'] as const
export type TimeRange = (typeof timeRanges)[number]
