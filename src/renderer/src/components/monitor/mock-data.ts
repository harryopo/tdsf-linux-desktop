/**
 * mock-data.ts — MonitorPage mock 数据与类型
 *
 * 来源：monitor.html 设计稿
 * - 4 项 KPI（CPU/内存/磁盘/网络）
 * - 4 个 24h 图表数据点
 * - 6 条告警记录
 * - 5 条 TOP CPU 进程
 *
 * 设计稿 token 命名：注意密度覆盖后的字号差异
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

/** 进程运行状态 */
export type ProcessStatus = '运行中' | '睡眠' | '僵尸'

/** 单条进程记录 */
export interface ProcessRecord {
  pid: number
  name: string
  cpu: number
  mem: number
  status: ProcessStatus
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

/** KPI 4 列数据（设计稿：大数字 + 迷你 Sparkline） */
export const kpiStats: KpiStat[] = [
  {
    label: 'CPU',
    value: 68,
    unit: '%',
    sub: '8 核心',
    delta: 5,
    trend: 'up',
    ringColor: '#387BFF',
    sparkline: [35, 42, 38, 55, 48, 62, 58, 68, 64, 72, 68, 75],
  },
  {
    label: '内存',
    value: 52,
    unit: '%',
    sub: '4.2 / 8 GB',
    delta: 3,
    trend: 'up',
    ringColor: '#387BFF',
    sparkline: [40, 42, 45, 44, 47, 49, 48, 50, 52, 51, 53, 52],
  },
  {
    label: '磁盘',
    value: 78,
    unit: '%',
    sub: '156 / 200 GB',
    delta: 12,
    trend: 'up',
    ringColor: '#F59E0B',
    sparkline: [60, 62, 65, 66, 68, 70, 72, 74, 75, 76, 77, 78],
  },
  {
    label: '网络 I/O',
    value: 2.0,
    unit: 'MB/s',
    sub: '↑1.2 ↓0.8',
    delta: -0.3,
    trend: 'down',
    ringColor: '#387BFF',
    sparkline: [80, 75, 82, 78, 70, 68, 72, 65, 60, 58, 55, 52],
  },
]

/** CPU 24h 面积图数据点（与设计稿一致） */
export const cpuAreaPath =
  'M 0,105 L 25,95 L 50,100 L 75,82 L 100,88 L 125,74 L 150,80 L 175,66 L 200,72 L 225,58 L 250,64 L 275,50 L 300,56 L 325,46 L 350,52 L 375,42 L 400,48 L 425,38 L 450,44 L 475,34 L 500,40 L 525,30 L 550,36 L 575,26 L 600,32'

/** 内存 24h 三折线 */
export const memUsedLine =
  '0,80 50,75 100,70 150,68 200,60 250,55 300,50 350,48 400,42 450,38 500,35 550,32 600,30'
export const memBufferLine =
  '0,100 50,98 100,95 150,92 200,88 250,85 300,82 350,80 400,78 450,75 500,72 550,70 600,68'
export const memCacheLine =
  '0,115 50,112 100,110 150,108 200,105 250,102 300,100 350,98 400,95 450,93 500,90 550,88 600,86'

/** 磁盘 IO 24h 柱状图（x / y / height 三元组数组） */
export const diskIoBars: Array<{ x: number; y: number; h: number }> = [
  { x: 2, y: 100, h: 40 }, { x: 27, y: 85, h: 55 }, { x: 52, y: 95, h: 45 },
  { x: 77, y: 75, h: 65 }, { x: 102, y: 80, h: 60 }, { x: 127, y: 70, h: 70 },
  { x: 152, y: 90, h: 50 }, { x: 177, y: 65, h: 75 }, { x: 202, y: 55, h: 85 },
  { x: 227, y: 60, h: 80 }, { x: 252, y: 50, h: 90 }, { x: 277, y: 45, h: 95 },
  { x: 302, y: 55, h: 85 }, { x: 327, y: 40, h: 100 }, { x: 352, y: 50, h: 90 },
  { x: 377, y: 35, h: 105 }, { x: 402, y: 45, h: 95 }, { x: 427, y: 60, h: 80 },
  { x: 452, y: 55, h: 85 }, { x: 477, y: 70, h: 70 }, { x: 502, y: 65, h: 75 },
  { x: 527, y: 80, h: 60 }, { x: 552, y: 75, h: 65 }, { x: 577, y: 90, h: 50 },
]

/** 网络流量 24h 双折线（入站 / 出站） */
export const netInboundLine =
  '0,90 50,85 100,75 150,80 200,65 250,70 300,55 350,60 400,45 450,50 500,40 550,45 600,35'
export const netOutboundLine =
  '0,110 50,105 100,100 150,95 200,90 250,85 300,80 350,75 400,70 450,68 500,65 550,62 600,58'

/** 6 条告警记录（与设计稿 1:1 对齐） */
export const alerts: AlertRecord[] = [
  {
    time: '14:32:08',
    level: 'critical',
    server: 'prod-web-01',
    desc: '磁盘使用率92%超过阈值85%',
    status: '未处理',
  },
  {
    time: '14:28:51',
    level: 'high',
    server: 'prod-db-02',
    desc: 'MySQL 连接数达到 450/500',
    status: '处理中',
  },
  {
    time: '14:15:33',
    level: 'high',
    server: 'prod-web-01',
    desc: 'CPU 负载持续5分钟超过80%',
    status: '未处理',
  },
  {
    time: '13:58:12',
    level: 'medium',
    server: 'prod-cache-03',
    desc: 'Redis 内存使用率达75%',
    status: '已处理',
  },
  {
    time: '13:42:07',
    level: 'medium',
    server: 'prod-web-01',
    desc: 'Swap 分区使用率达60%',
    status: '已处理',
  },
  {
    time: '13:20:45',
    level: 'low',
    server: 'prod-db-02',
    desc: '慢查询数量超过50条/分钟',
    status: '已处理',
  },
]

/** TOP 5 CPU 进程（与设计稿 1:1 对齐） */
export const processes: ProcessRecord[] = [
  { pid: 1234, name: 'nginx', cpu: 32.5, mem: 4.2, status: '运行中' },
  { pid: 1256, name: 'mysqld', cpu: 18.2, mem: 12.1, status: '运行中' },
  { pid: 1789, name: 'sshd', cpu: 2.1, mem: 0.8, status: '运行中' },
  { pid: 1890, name: 'systemd', cpu: 1.5, mem: 1.2, status: '运行中' },
  { pid: 2103, name: 'docker', cpu: 15.8, mem: 8.5, status: '运行中' },
]

/** 顶部告警横幅内容（critical 磁盘告警） */
export const criticalAlertBanner = {
  message: '磁盘使用率92%超过阈值85%，建议清理 /var/log 旧日志',
  time: '2分钟前',
}

/** 时间范围选项 */
export const timeRanges = ['1H', '6H', '24H'] as const
export type TimeRange = (typeof timeRanges)[number]

/** 图表 x 轴时间刻度 */
export const xLabels = ['00:00', '06:00', '12:00', '18:00', '24:00']
