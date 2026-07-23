/**
 * mock-data.ts — MonitorPage 类型 + 设计稿示例数据 fallback
 *
 * 设计稿：tdsf-linux-redesign/pages/monitor.html
 *
 * 内容：
 * - 类型：RiskLevel / AlertStatus / AlertRecord / KpiStat / TimeRange
 * - 常量：timeRanges
 * - 设计稿示例数据 fallback（IPC 不可用 / 未连接 SSH 时使用，保证页面可演示）：
 *   - sampleKpiStats：4 个 KPI（CPU 68% / 内存 52% / 磁盘 78% / 网络 2.0 MB/s）
 *   - sampleAlerts：6 条告警（critical/high/medium/low）
 *   - sampleProcesses：5 个进程（nginx/mysqld/sshd/systemd/docker）
 *   - sampleCpuArea / sampleMemLines / sampleDiskIo / sampleNetFlow：24h 图表数据
 *
 * Spec: build-runnable-tdsf-from-design · Task 2.4
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
export const sampleKpiStats: KpiStat[] = [
  {
    label: 'CPU',
    value: 68,
    unit: '%',
    sub: '8 核心',
    delta: 5,
    trend: 'up',
    ringColor: 'var(--trae-bg-brand)',
    sparkline: [],
  },
  {
    label: '内存',
    value: 52,
    unit: '%',
    sub: '4.2 / 8 GB',
    delta: 3,
    trend: 'up',
    ringColor: 'var(--trae-bg-brand)',
    sparkline: [],
  },
  {
    label: '磁盘',
    value: 78,
    unit: '%',
    sub: '156 / 200 GB',
    delta: 12,
    trend: 'up',
    ringColor: 'var(--trae-status-warning-default)',
    sparkline: [],
  },
  {
    label: '网络 I/O',
    value: 0,
    unit: 'MB/s',
    sub: '2.0 MB/s',
    delta: -0.3,
    trend: 'down',
    ringColor: 'var(--trae-bg-brand)',
    sparkline: [],
  },
]

/** 6 条告警示例数据（1:1 来自 monitor.html） */
export const sampleAlerts: AlertRecord[] = [
  {
    time: '14:32:08',
    level: 'critical',
    server: 'prod-web-01',
    desc: '磁盘使用率92%超过阈值85%',
    status: '未处理',
    source: '/dev/sda1 · /var/log',
    impact: '根分区空间不足可能导致日志写入失败、服务异常崩溃、数据库锁表',
    suggestions: [
      '清理 /var/log 旧日志：find /var/log -type f -name "*.log.*" -mtime +7 -delete',
      '归档并压缩：tar -czf /tmp/log-$(date +%F).tar.gz /var/log/*.log && rm /var/log/*.log',
      '配置 logrotate 自动轮转：编辑 /etc/logrotate.d/nginx，设置 daily + rotate 7 + compress',
    ],
  },
  {
    time: '14:28:51',
    level: 'high',
    server: 'prod-db-02',
    desc: 'MySQL 连接数达到 450/500',
    status: '处理中',
    source: 'MySQL process_list',
    impact: '连接池接近耗尽，新查询将被拒绝，业务接口可能超时',
    suggestions: [
      '检查慢查询：SHOW PROCESSLIST; 识别并 KILL 长时间运行的查询',
      '调整 max_connections：SET GLOBAL max_connections = 600; （需评估内存）',
      '优化连接池：业务端引入连接复用 + 限流 + 熔断',
    ],
  },
  {
    time: '14:15:33',
    level: 'high',
    server: 'prod-web-01',
    desc: 'CPU 负载持续5分钟超过80%',
    status: '未处理',
    source: '/proc/loadavg',
    impact: '响应延迟增加，可能引发雪崩',
    suggestions: [
      '定位高 CPU 进程：top -bn1 | head -20',
      '检查 nginx 配置：grep -r "limit_req" /etc/nginx/',
      '考虑横向扩容：增加 Web 节点 + 负载均衡',
    ],
  },
  {
    time: '13:58:12',
    level: 'medium',
    server: 'prod-cache-03',
    desc: 'Redis 内存使用率达75%',
    status: '已处理',
    source: 'redis-cli INFO memory',
    impact: '内存逼近 maxmemory 阈值，可能触发 LRU 淘汰',
    suggestions: [
      '检查大 Key：redis-cli --bigkeys',
      '设置过期策略：CONFIG SET maxmemory-policy allkeys-lru',
      '监控告警阈值：调整 Prometheus rule 为 80%',
    ],
  },
  {
    time: '13:42:07',
    level: 'medium',
    server: 'prod-web-01',
    desc: 'Swap 分区使用率达60%',
    status: '已处理',
    source: '/proc/swaps',
    impact: '系统开始使用 swap，性能下降',
    suggestions: [
      '检查内存泄漏：ps aux --sort=-%mem | head -10',
      '调整 swappiness：sysctl vm.swappiness=10',
      '评估扩容内存或重启服务',
    ],
  },
  {
    time: '13:20:45',
    level: 'low',
    server: 'prod-db-02',
    desc: '慢查询数量超过50条/分钟',
    status: '已处理',
    source: 'MySQL slow_query_log',
    impact: '响应时间变长，业务接口超时风险',
    suggestions: [
      '分析慢查询日志：mysqldumpslow -s t /var/log/mysql/slow.log | head -20',
      '添加索引：EXPLAIN 分析 + CREATE INDEX',
      '优化 SQL：避免 SELECT * / LIMIT 大偏移',
    ],
  },
]

/** 进程行类型 */
export interface ProcessRow {
  pid: number
  name: string
  cpu: number
  mem: number
  status: '运行中' | '睡眠' | '僵尸'
}

/** 5 个进程示例数据（1:1 来自 monitor.html） */
export const sampleProcesses: ProcessRow[] = [
  { pid: 1234, name: 'nginx', cpu: 32.5, mem: 4.2, status: '运行中' },
  { pid: 1256, name: 'mysqld', cpu: 18.2, mem: 12.1, status: '运行中' },
  { pid: 1789, name: 'sshd', cpu: 2.1, mem: 0.8, status: '运行中' },
  { pid: 1890, name: 'systemd', cpu: 1.5, mem: 1.2, status: '运行中' },
  { pid: 2103, name: 'docker', cpu: 15.8, mem: 8.5, status: '运行中' },
]

// ===== 24h 图表示例数据（1:1 来自 monitor.html） =====

/** CPU 面积图 24h 数据点（25 个点，0~24h，y 范围 0~140） */
export const sampleCpuAreaPath =
  'M 0,105 L 25,95 L 50,100 L 75,82 L 100,88 L 125,74 L 150,80 L 175,66 L 200,72 L 225,58 L 250,64 L 275,50 L 300,56 L 325,46 L 350,52 L 375,42 L 400,48 L 425,38 L 450,44 L 475,34 L 500,40 L 525,30 L 550,36 L 575,26 L 600,32'

/** 内存折线图 24h 数据点（3 条线：used/buffer/cache） */
export const sampleMemLines = {
  used: '0,80 50,75 100,70 150,68 200,60 250,55 300,50 350,48 400,42 450,38 500,35 550,32 600,30',
  buffer: '0,100 50,98 100,95 150,92 200,88 250,85 300,82 350,80 400,78 450,75 500,72 550,70 600,68',
  cache: '0,115 50,112 100,110 150,108 200,105 250,102 300,100 350,98 400,95 450,93 500,90 550,88 600,86',
}

/** 磁盘 IO 柱状图 24h 数据点（24 个柱子，高度 50~105） */
export const sampleDiskIo: Array<{ x: number; y: number; w: number; h: number }> = [
  { x: 2, y: 100, w: 20, h: 40 },
  { x: 27, y: 85, w: 20, h: 55 },
  { x: 52, y: 95, w: 20, h: 45 },
  { x: 77, y: 75, w: 20, h: 65 },
  { x: 102, y: 80, w: 20, h: 60 },
  { x: 127, y: 70, w: 20, h: 70 },
  { x: 152, y: 90, w: 20, h: 50 },
  { x: 177, y: 65, w: 20, h: 75 },
  { x: 202, y: 55, w: 20, h: 85 },
  { x: 227, y: 60, w: 20, h: 80 },
  { x: 252, y: 50, w: 20, h: 90 },
  { x: 277, y: 45, w: 20, h: 95 },
  { x: 302, y: 55, w: 20, h: 85 },
  { x: 327, y: 40, w: 20, h: 100 },
  { x: 352, y: 50, w: 20, h: 90 },
  { x: 377, y: 35, w: 20, h: 105 },
  { x: 402, y: 45, w: 20, h: 95 },
  { x: 427, y: 60, w: 20, h: 80 },
  { x: 452, y: 55, w: 20, h: 85 },
  { x: 477, y: 70, w: 20, h: 70 },
  { x: 502, y: 65, w: 20, h: 75 },
  { x: 527, y: 80, w: 20, h: 60 },
  { x: 552, y: 75, w: 20, h: 65 },
  { x: 577, y: 90, w: 20, h: 50 },
]

/** 网络流量双折线 24h 数据点（入站/出站） */
export const sampleNetFlow = {
  inbound: '0,90 50,85 100,75 150,80 200,65 250,70 300,55 350,60 400,45 450,50 500,40 550,45 600,35',
  outbound: '0,110 50,105 100,100 150,95 200,90 250,85 300,80 350,75 400,70 450,68 500,65 550,62 600,58',
}

/** 图表 x 轴时间标签（5 个，0~24h） */
export const chartXLabels = ['00:00', '06:00', '12:00', '18:00', '24:00']
