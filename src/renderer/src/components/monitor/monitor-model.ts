/**
 * 监控页的数据模型与常量
 *
 * 这里只有类型和"时间范围档位"。原先的 sample* 假 KPI / 假告警 / 假进程
 * 与写死的 00:00-24:00 时间轴都已删除：那些值在界面上会被当成真实监控数据，
 * 而监控页承诺的是"这台机器现在怎么样"。
 * 判据见 tests/unit/no-fabricated-data.test.ts。
 */

/** 风险等级 */
export type RiskLevel = 'critical' | 'high' | 'medium' | 'low'

/** 告警处理状态 */
export type AlertStatus = '未处理' | '处理中' | '已处理'

/** 单条告警记录 */
export interface AlertRecord {
  /** 时间（HH:MM:SS） */
  time: string
  /** 风险级别 */
  level: RiskLevel
  /** 服务器名 */
  server: string
  /** 告警描述 */
  desc: string
  /** 处理状态 */
  status: AlertStatus
  /** 告警来源（如 /var/log、/proc/cpuinfo） */
  source?: string
  /** 影响范围 */
  impact?: string
  /** 处置建议（多步） */
  suggestions?: string[]
}

/** KPI 卡片数据 */
export interface KpiStat {
  /** 标签（CPU / 内存 / 磁盘 / 网络 I/O） */
  label: string
  /** 主值（0-100 百分比，用于环形进度图） */
  value: number
  /** 单位（% 或 MB/s） */
  unit: string
  /** 副值（"8 核心" / "4.2 / 8 GB" / "156 / 200 GB" / "2.0 MB/s"） */
  sub: string
  /** 较昨日变化 */
  delta: number
  /** 变化方向 */
  trend: 'up' | 'down'
  /** 趋势颜色（disk 用 amber 警告色 #F59E0B，其他用 #387BFF） */
  ringColor: string
  /** 迷你折线数据点（保留兼容，新 KpiCard 不使用） */
  sparkline: number[]
}

/** 时间范围选项 */
export const timeRanges = ['1H', '6H', '24H'] as const
export type TimeRange = (typeof timeRanges)[number]

// ===== 设计稿示例数据 fallback =====

/** 4 个 KPI 示例数据（1:1 来自 monitor.html）
 *
 * ringColor 使用 trae token（禁止硬编码 hex）：
 * - CPU/内存/网络：var(--trae-bg-brand)（品牌蓝 #387BFF）
 * - 磁盘：var(--trae-status-warning-default)（警告色，对应设计稿 #F59E0B）
 */

/** 6 条告警示例数据（1:1 来自 monitor.html） */

/** 进程行类型 */
export interface ProcessRow {
  pid: number
  name: string
  cpu: number
  mem: number
  status: '运行中' | '睡眠' | '僵尸'
}

/** 5 个进程示例数据（1:1 来自 monitor.html） */

// ===== 24h 图表示例数据（1:1 来自 monitor.html） =====

/** CPU 面积图 24h 数据点（25 个点，0~24h，y 范围 0~140） */

/** 磁盘 IO 柱状图 24h 数据点（24 个柱子，高度 50~105） */

/** 网络流量双折线 24h 数据点（入站/出站） */

/** 图表 x 轴时间标签（5 个，0~24h） */
