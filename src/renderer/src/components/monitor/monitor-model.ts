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

/**
 * 一条持续违规的稳定身份：`会话|种类`。
 *
 * 种类只有 disk / cpu / memory 三种，指标恢复后再越线仍算同一种类，
 * 所以这个键在一场会话里不会漂。以前告警没有键，抽屉自己按
 * `time|server|desc` 拼一个"稳定 ID"，而 time 每秒都在变、desc 里带着百分比
 * ——每来一条数据就是一个新键，主进程那张确认表于是只进不出。
 */
export type AlertKind = 'disk' | 'cpu' | 'memory'

export function alertKey(sessionId: string, kind: AlertKind): string {
  return `${sessionId}|${kind}`
}

/** 这条键属不属于某个会话（清理该会话的确认状态时按它判别） */
export function alertKeyBelongsToSession(key: string, sessionId: string): boolean {
  return key.startsWith(`${sessionId}|`)
}

/**
 * 一条告警显示成什么状态：只有"确认过没有"这一个依据。
 *
 * 横幅（MonitorPage）与告警列表（AlertTable）两个生产者共用它，
 * 否则会出现同一场会话里列表说已处理、横幅还照常红着。
 */
export function alertStatusOf(key: string, ackedKeys: ReadonlySet<string>): AlertStatus {
  return ackedKeys.has(key) ? '已处理' : '未处理'
}

/** 单条告警记录 */
export interface AlertRecord {
  /** 稳定身份（见 alertKey）：已处理状态、抽屉的 ack 都以它为键 */
  id: string
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
  /**
   * 与上一次采样的差值；null = 只有一个采样点，没有可比的"上一次"。
   *
   * 这里以前叫"较昨日"，而算的是 data[length-2] 与 data[length-1] 之差——
   * 采样间隔 3 秒，所以界面上那句"较昨日 +0%"其实是"较 3 秒前"。
   * 本机也没有跨重启的 24 小时历史（monitor-store 只留 60 个点），
   * 所以"昨日"这个口径根本不存在，不许再写。
   */
  delta: number | null
  /** 变化方向；null = 没有可信的变化（无对比基准，或差值四舍五入后为 0） */
  trend: 'up' | 'down' | null
  /** 趋势颜色（disk 用 amber 警告色 #F59E0B，其他用 #387BFF） */
  ringColor: string
  /**
   * 网络卡的真实收发序列（最近若干拍）；只有网络这一张卡有
   *
   * 以前这里是一个叫 sparkline 的字段、四张卡都填、没人读——而卡片上那条
   * 双向折线和 ↑1.2 / ↓0.8 两个标签是写死在 SVG 里的字符串。
   * 现在换成收发两条独立序列，由 KpiCard 按真实值画（用户 2026-10-16："假的UI都检查一下，做成真功能"）。
   */
  netSeries?: { in: number[]; out: number[] }
}

/**
 * 迷你折线的 SVG 点串：把一串真实采样映射到一条折线
 *
 * @param values 按时间正序的采样值
 * @param max 两条线共用的满刻度（各自归一化会让收发看着"一样忙"，那是假比较）
 * @param box baseY 是中线，spanY 带符号（正=往上线，负=往下线）
 * @returns 少于 2 个点或没有正刻度时返回 null：一个点画不出趋势，宁可什么都不画
 */
export function miniLinePoints(
  values: number[],
  max: number,
  box: { x0: number; x1: number; baseY: number; spanY: number },
): string | null {
  if (values.length < 2 || !(max > 0)) return null
  const last = values.length - 1
  return values
    .map((v, i) => {
      const x = box.x0 + ((box.x1 - box.x0) * i) / last
      const y = box.baseY - (Math.max(0, v) / max) * box.spanY
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
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

// 设计稿的 5 条示例进程与 24h 示例曲线（CPU/磁盘 IO/网络/x 轴标签）已于阶段 F4 删除：
// 这些数值一旦留在模块里就会被当成正经数据引用回来，而监控图表现在只吃 monitor-store 的真实采样。

// ============================================================================
// 纯计算（#102 真机验收后挪到这里，判据：tests/unit/monitor-honest-numbers.test.ts）
//
// 放在模型模块而不是页面组件里，是为了让"数字口径"能被 node 环境的单测直接量到：
// 页面组件要起 React，而这几条恰恰是"界面上那个数能不能信"的判据本体。
// ============================================================================

import type { MonitorData } from '@shared/models'

/**
 * 差值与方向。
 *
 * 只有一个采样点时没有可比基准；差值四舍五入后为 0 时也不给方向——
 * 画一个箭头本身就是一种主张，而"3 秒内内存从 45.4% 掉到 45.2%"配一个向下箭头
 * 加"0%"是在骗人（2026-10-14 真机实测到 "0% 较昨日" 与 "-6% 较昨日" 并存）。
 */
export function trendOf(
  latest: number,
  prev: number | undefined
): { delta: number | null; trend: 'up' | 'down' | null } {
  if (prev === undefined) return { delta: null, trend: null }
  const d = Math.round(latest - prev)
  if (d === 0) return { delta: null, trend: null }
  return { delta: d, trend: d > 0 ? 'up' : 'down' }
}

/** 把毫秒说成人话（图表标题里的实际跨度） */
export function humanSpan(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  const rest = s % 60
  return rest ? `${m} 分 ${rest} 秒` : `${m} 分钟`
}

/**
 * 图表标题里的时间窗，按**真实数据跨度**写。
 *
 * 四张图原来固定写 "(24h)"，而 monitor-store 只保留 60 个采样（约 3 分钟），
 * 也没有跨重启的历史——写着 24h 等于给一个根本没有数据的窗口签字。
 * 顶部 1H/6H/24H 三档仍按各自窗口切片，只是不再谎称手里有多少。
 */
export function spanLabel(points: Array<{ timestamp: number }>): string {
  if (points.length === 0) return '（暂无数据）'
  if (points.length === 1) return '（1 个采样点）'
  const ms = points[points.length - 1].timestamp - points[0].timestamp
  return `（实际跨度 ${humanSpan(ms)} · ${points.length} 点）`
}

/** 采样点 → KPI 卡片；空数组返回 null 让页面走空态 */
export function computeKpiStats(data: MonitorData[]): KpiStat[] | null {
  if (data.length === 0) return null
  const latest = data[data.length - 1]
  // 上一拍（默认 3 秒前）；只有一拍时 undefined，trendOf 因此不给方向
  const prev = data.length > 1 ? data[data.length - 2] : undefined

  return [
    {
      label: 'CPU',
      value: Math.round(latest.cpuUsage),
      unit: '%',
      sub: `${latest.loadAverage?.toFixed(2) ?? '--'} load`,
      ...trendOf(latest.cpuUsage, prev?.cpuUsage),
      ringColor: 'var(--accent-text)',
    },
    {
      label: '内存',
      value: Math.round(latest.memoryUsage),
      unit: '%',
      sub: `${latest.processCount ?? '--'} 进程`,
      ...trendOf(latest.memoryUsage, prev?.memoryUsage),
      ringColor: 'var(--accent-text)',
    },
    {
      label: '磁盘',
      value: Math.round(latest.diskUsage),
      unit: '%',
      sub: `uptime ${Math.floor(latest.uptime / 3600)}h`,
      ...trendOf(latest.diskUsage, prev?.diskUsage),
      ringColor: 'var(--status-warning-text)',
    },
    {
      label: '网络 I/O',
      value: Math.round(latest.networkIn + latest.networkOut),
      unit: 'KB/s',
      sub: `↓${Math.round(latest.networkIn)} ↑${Math.round(latest.networkOut)}`,
      ...trendOf(
        latest.networkIn + latest.networkOut,
        prev ? prev.networkIn + prev.networkOut : undefined
      ),
      ringColor: 'var(--accent-text)',
      netSeries: {
        in: data.slice(-20).map((d) => d.networkIn),
        out: data.slice(-20).map((d) => d.networkOut),
      },
    },
  ]
}
