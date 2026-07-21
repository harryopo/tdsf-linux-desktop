/**
 * mock-data.ts — HistoryPage mock 数据与类型
 *
 * 来源：history.html 设计稿
 * - 4 项统计概览（总决策数 / 成功率 / 平均置信度 / 平均响应时间）
 * - 6 条决策时间线记录
 * - 3 组筛选下拉选项
 * - 5 项分页信息
 *
 * 与设计稿 1:1 对齐，不修改任何业务数据
 */

/** 决策状态 */
export type DecisionStatus = '成功' | '失败' | '已拦截'

/** 风险等级 */
export type RiskLevel = '低风险' | '中风险' | '高风险'

/** 操作人类型 */
export type ActorType = 'root' | 'ai-agent'

/** 统计概览单项 */
export interface StatOverview {
  /** 标签（总决策数 / 成功率 / 平均置信度 / 平均响应时间） */
  label: string
  /** 主数值（字符串以保留精度与单位） */
  value: string
  /** 颜色（hex 或 CSS 变量） */
  color: string
  /** 迷你折线 points（svg polyline 字符串） */
  sparkline: string
  /** 折线颜色 */
  sparkColor: string
}

/** 单条决策记录 */
export interface DecisionRecord {
  /** 唯一 id（路由跳转用） */
  id: string
  /** 时间显示（HH:mm） */
  time: string
  /** 决策标题 */
  title: string
  /** 状态徽章 */
  status: DecisionStatus
  /** 风险徽章 */
  risk: RiskLevel
  /** 服务器名 */
  server: string
  /** 操作人（root / ai-agent） */
  actor: ActorType
  /** 置信度（0-1） */
  confidence: number
  /** 执行命令 */
  command: string
  /** 命令是否为高危（true → 红色背景） */
  isDanger?: boolean
  /** 简要描述 */
  desc: string
  /** 耗时（秒） */
  durationSec: number
  /** 时间线圆点颜色（依据状态） */
  dotColor: string
}

/** 4 项统计概览（与设计稿 1:1） */
export const statOverviews: StatOverview[] = [
  {
    label: '总决策数',
    value: '247',
    color: 'var(--trae-bg-brand)',
    sparkline: '0,18 14,14 28,16 42,10 56,12 70,7 84,9 100,5',
    sparkColor: 'var(--trae-bg-brand)',
  },
  {
    label: '成功率',
    value: '94.3%',
    color: 'var(--trae-status-success-default)',
    sparkline: '0,16 14,18 28,12 42,14 56,9 70,11 84,6 100,8',
    sparkColor: 'var(--trae-status-success-default)',
  },
  {
    label: '平均置信度',
    value: '0.82',
    color: 'var(--trae-bg-brand)',
    sparkline: '0,14 14,12 28,15 42,9 56,11 70,8 84,10 100,6',
    sparkColor: 'var(--trae-bg-brand)',
  },
  {
    label: '平均响应时间',
    value: '12s',
    color: 'var(--trae-text-secondary)',
    sparkline: '0,8 14,12 28,10 42,14 56,11 70,16 84,13 100,15',
    sparkColor: 'var(--trae-text-secondary)',
  },
]

/** 时间范围筛选选项 */
export const timeRangeOptions = ['近7天', '近30天', '全部'] as const
/** 服务器筛选选项 */
export const serverOptions = [
  '全部服务器',
  'prod-web-01',
  'prod-db-02',
  'backup-01',
  'staging-web',
] as const
/** 状态筛选选项 */
export const statusOptions = ['全部状态', '成功', '失败', '已拦截'] as const

/** 6 条决策时间线记录（与设计稿 1:1） */
export const decisionRecords: DecisionRecord[] = [
  {
    id: 'DEC-2024-0718-001',
    time: '14:23',
    title: '重启 nginx 服务',
    status: '成功',
    risk: '低风险',
    server: 'prod-web-01',
    actor: 'root',
    confidence: 0.87,
    command: 'sudo systemctl restart nginx',
    desc: 'nginx P99延迟升高，重启后恢复',
    durationSec: 8,
    dotColor: 'var(--trae-status-success-default)',
  },
  {
    id: 'DEC-2024-0718-002',
    time: '13:45',
    title: '清理 MySQL 长查询',
    status: '成功',
    risk: '中风险',
    server: 'prod-db-02',
    actor: 'root',
    confidence: 0.91,
    command: "mysql -e 'KILL 9800'",
    desc: 'MySQL连接数过多，清理长查询',
    durationSec: 3,
    dotColor: 'var(--trae-status-success-default)',
  },
  {
    id: 'DEC-2024-0718-003',
    time: '12:30',
    title: '高危命令拦截',
    status: '已拦截',
    risk: '高风险',
    server: 'backup-01',
    actor: 'ai-agent',
    confidence: 0.45,
    command: 'rm -rf /var/log/*',
    isDanger: true,
    desc: '高危命令被四层风险控制拦截',
    durationSec: 1,
    dotColor: 'var(--trae-status-warning-default)',
  },
  {
    id: 'DEC-2024-0718-004',
    time: '11:15',
    title: '平滑重载 nginx 配置',
    status: '成功',
    risk: '低风险',
    server: 'prod-web-01',
    actor: 'root',
    confidence: 0.93,
    command: 'nginx -s reload',
    desc: '配置变更后平滑重载',
    durationSec: 2,
    dotColor: 'var(--trae-status-success-default)',
  },
  {
    id: 'DEC-2024-0718-005',
    time: '10:08',
    title: '重启 Docker 服务',
    status: '失败',
    risk: '中风险',
    server: 'staging-web',
    actor: 'root',
    confidence: 0.62,
    command: 'systemctl restart docker',
    desc: 'Docker重启失败，容器异常退出',
    durationSec: 15,
    dotColor: 'var(--trae-status-error-default)',
  },
  {
    id: 'DEC-2024-0718-006',
    time: '09:30',
    title: '调整 swap 倾向参数',
    status: '成功',
    risk: '低风险',
    server: 'prod-db-02',
    actor: 'root',
    confidence: 0.88,
    command: 'sysctl -w vm.swappiness=10',
    desc: '调整swap倾向参数优化内存',
    durationSec: 1,
    dotColor: 'var(--trae-status-success-default)',
  },
]

/** 分页信息 */
export const pagination = {
  total: 247,
  currentPage: 1,
  pages: [1, 2, 3, 25],
  showEllipsis: true,
}
