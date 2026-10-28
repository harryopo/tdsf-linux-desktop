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

/** 告警阈值（来自设置页 monitor.threshold.*，默认与采集侧一致） */
export interface AlertThresholds {
  disk: number
  cpu: number
  memory: number
}

/**
 * 从一条采样算出当前成立的告警（监控页唯一的告警生产者）
 *
 * 为什么必须有这一个函数：以前横幅（MonitorPage）和列表（AlertTable）各写一份判定，
 * 两份都不一样——列表只认 disk/cpu 且阈值写死 85/90，横幅认 disk/cpu/memory 且读设置页阈值。
 * 后果是"标记已处理"会被对面抹掉：横幅能点出 `会话|memory` 这条 ack，
 * 列表下一拍按自己那份键集合 prune，刚标记的就又变回未处理；用户把阈值调成 70 也同理。
 * 现在两侧都走这里，prune 用的也必须是这里产出的键。
 *
 * 顺序即优先级：磁盘 > CPU > 内存（横幅取第一条）。
 */
export function deriveAlerts(args: {
  sessionId: string
  hostname: string
  latest: MonitorData
  thresholds: AlertThresholds
  acked: ReadonlySet<string>
}): AlertRecord[] {
  const { sessionId, hostname, latest, thresholds, acked } = args
  const time = new Date(latest.timestamp).toLocaleTimeString('zh-CN', { hour12: false })
  const alerts: AlertRecord[] = []
  const push = (kind: AlertKind, level: RiskLevel, rest: Omit<AlertRecord, 'id' | 'time' | 'server' | 'level' | 'status'>): void => {
    const id = alertKey(sessionId, kind)
    alerts.push({ id, time, server: hostname, level, status: alertStatusOf(id, acked), ...rest })
  }

  if (latest.diskUsage > thresholds.disk) {
    push('disk', 'critical', {
      desc: `磁盘使用率过高：${latest.diskUsage.toFixed(1)}% 超过阈值 ${thresholds.disk}%`,
      // 采集侧真实跑的是 df -h /（见 services/ssh/monitor.ts），设备名与 /var/log 都没读过
      source: 'df -h /（根分区）',
      impact: '根分区空间不足可能导致日志写入失败、服务异常崩溃、数据库锁表',
      suggestions: [
        '清理 /var/log 旧日志：find /var/log -type f -name "*.log.*" -mtime +7 -delete',
        '归档并压缩：tar -czf /tmp/log-$(date +%F).tar.gz /var/log/*.log && rm /var/log/*.log',
        '配置 logrotate 自动轮转：编辑 /etc/logrotate.d/nginx',
      ],
    })
  }

  if (latest.cpuUsage > thresholds.cpu) {
    push('cpu', 'high', {
      desc: `CPU 使用率过高：${latest.cpuUsage.toFixed(1)}% 超过阈值 ${thresholds.cpu}%`,
      // CPU 使用率来自 top -bn1（/proc/loadavg 是另一个字段 loadAverage，不是这条告警的依据）
      source: 'top -bn1',
      impact: '响应延迟增加，可能引发雪崩',
      suggestions: [
        '定位高 CPU 进程：top -o %CPU 或 ps aux --sort=-%cpu | head',
        '查看负载趋势：uptime（对比 CPU 核数）',
        '必要时限流或扩容：systemctl 重启异常服务 / 增加实例',
      ],
    })
  }

  if (latest.memoryUsage > thresholds.memory) {
    push('memory', 'high', {
      desc: `内存使用率过高：${latest.memoryUsage.toFixed(1)}% 超过阈值 ${thresholds.memory}%`,
      // 采集侧用 free 取内存总量与占用（不是 RSS/Cache 拆分，那条口径没有依据）
      source: 'free',
      impact: '内存耗尽时内核 OOM Killer 会强杀进程，可能误杀数据库/关键服务',
      suggestions: [
        '定位内存大户：ps aux --sort=-%mem | head',
        '查看可回收缓存：free -m（buff/cache 可被回收）',
        '检查 OOM 历史：dmesg | grep -i "out of memory"',
      ],
    })
  }

  return alerts
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

import type { MonitorData, SshConnectionState } from '@shared/models'

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

// ============================================================================
// 数据新鲜度（#257）
// ============================================================================

/**
 * 多久没有新采样就认定"停更"
 *
 * 采样间隔是 3 秒（server-store 的 MONITOR_INTERVAL_MS），连续 5 个周期没来
 * 才算停——单次 SSH exec 偶尔慢一拍是常态，阈值贴着 3 秒会天天误报。
 */
export const MONITOR_STALE_AFTER_MS = 15_000

/**
 * 这份监控数据"还活着吗"
 *
 * - `no-session`：没有活跃会话（历史数据仍在，但它不是"现在"）
 * - `connecting`：心跳在重连，数据必然断流
 * - `disconnected`：连接已断
 * - `waiting`：连着，但还没采到第一条
 * - `stalled`：连着，但超过阈值没有新采样（采集空转 / 远端不响应）
 * - `live`：有新数据
 */
export type MonitorFreshness =
  | 'no-session'
  | 'connecting'
  | 'disconnected'
  | 'waiting'
  | 'stalled'
  | 'live'

/**
 * 判定顺序即优先级：连接状态先说话，状态未知时才用数据年龄兜底。
 *
 * 时钟回拨（lastSampleAt 比 now 还晚）按"没过期"处理——负数年龄不该触发假警报。
 */
export function deriveMonitorFreshness(args: {
  hasSession: boolean
  connectionState?: SshConnectionState
  lastSampleAt: number | null
  now: number
  staleAfterMs: number
}): MonitorFreshness {
  const { hasSession, connectionState, lastSampleAt, now, staleAfterMs } = args
  if (!hasSession) return 'no-session'
  if (connectionState === 'connecting') return 'connecting'
  if (connectionState === 'error' || connectionState === 'disconnected') return 'disconnected'
  if (lastSampleAt == null) return 'waiting'
  return now - lastSampleAt > staleAfterMs ? 'stalled' : 'live'
}
