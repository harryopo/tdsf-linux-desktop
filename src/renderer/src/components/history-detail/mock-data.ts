/**
 * mock-data.ts — HistoryDetailPage mock 数据与类型
 *
 * 来源：history-detail.html 设计稿
 * - 决策元信息（7 行 label-value）
 * - 7 步证据溯源链
 * - 4 项执行结果对比指标
 * - 1 条知识库更新
 * - 6 条操作日志
 *
 * 决策 ID：#DEC-2024-0718-001
 * 置信度：0.87
 * 执行命令：nginx -s reload
 */

/** 证据步骤状态 */
export type StepStatus = '已完成' | '进行中' | '待处理'

/** 证据步骤 */
export interface EvidenceStep {
  /** 步骤序号（1-7） */
  step: number
  /** 步骤标题（如"数据采集"） */
  title: string
  /** 完成状态 */
  status: StepStatus
  /** 描述 */
  desc: string
  /** 时间戳（HH:mm:ss） */
  time: string
}

/** 执行结果指标对比 */
export interface ResultMetric {
  /** 指标名 */
  name: string
  /** 执行前值 */
  before: string
  /** 执行后值 */
  after: string
  /** 变化百分比（带正负号字符串，例如 "-12%"） */
  delta: string
  /** 是否为正向变化（true → success 绿） */
  positive: boolean
}

/** 操作日志类型 */
export type LogIconType = 'sparkles' | 'shield' | 'check' | 'terminal' | 'activity' | 'check-circle'

/** 操作日志单条 */
export interface ActionLog {
  /** 时间戳（HH:mm:ss） */
  time: string
  /** 图标类型 */
  icon: LogIconType
  /** 图标颜色（CSS 变量） */
  iconColor: string
  /** 描述（支持 mono 高亮片段） */
  desc: string
  /** mono 片段（可选，渲染为命令样式） */
  mono?: string
}

/** 决策元信息行 */
export interface SummaryRow {
  /** 字段标签（如"问题"、"根因"） */
  label: string
  /** 字段值（React 节点或字符串） */
  value: string
}

/** 决策元信息（7 行 label-value） */
export const summaryRows: SummaryRow[] = [
  {
    label: '问题',
    value: 'Nginx 502 错误率激增至 12%',
  },
  {
    label: '根因',
    value: 'worker_connections 配置不足 (10240 < 实际并发 15360)',
  },
  {
    label: '决策',
    value: '将 worker_connections 从 10240 提升至 20480',
  },
  {
    label: '执行命令',
    value: 'nginx -s reload',
  },
  {
    label: '置信度',
    value: '0.87',
  },
  {
    label: '执行人',
    value: 'AI Agent',
  },
  {
    label: '审核人',
    value: 'Engineer Zhang',
  },
]

/** 7 步证据溯源链（与设计稿 1:1） */
export const evidenceSteps: EvidenceStep[] = [
  {
    step: 1,
    title: '数据采集',
    status: '已完成',
    desc: '采集 32 项指标：CPU 68%、内存 4.2G、worker_connections 达上限 10240、P99 延迟 1.2s。Nginx access.log 显示 502 错误率 12%。',
    time: '14:32:15',
  },
  {
    step: 2,
    title: '异常分析',
    status: '已完成',
    desc: '连接数耗尽 + 502 激增。根因定位：worker_connections 设为 10240，但实际并发达 15360，超出上限 50%。',
    time: '14:32:16',
  },
  {
    step: 3,
    title: '推理归因',
    status: '已完成',
    desc: 'worker_connections 低于实际并发需求。建议提升至 20480 并热加载 nginx，预计可消除 502 错误。',
    time: '14:32:17',
  },
  {
    step: 4,
    title: '交叉校验',
    status: '已完成',
    desc: '沙箱环境验证通过，知识库 KB-021 匹配一致。历史 7 天内 3 次相似事件均通过此方案解决。',
    time: '14:32:18',
  },
  {
    step: 5,
    title: '人工确认',
    status: '已完成',
    desc: '工程师审核通过命令。已拦截 8 项高危命令（rm -rf、dd、mkfs 等），仅保留 nginx -s reload 安全命令。',
    time: '14:32:20',
  },
  {
    step: 6,
    title: '执行变更',
    status: '已完成',
    desc: '热加载 nginx 配置：worker_connections 10240 → 20480。零停机，2 秒完成。',
    time: '14:32:22',
  },
  {
    step: 7,
    title: '效果验证',
    status: '已完成',
    desc: '60 秒后回采指标，确认 502 错误率降至 0%、P99 延迟恢复正常。',
    time: '14:33:24',
  },
]

/** 4 项执行结果指标对比（与设计稿 1:1） */
export const resultMetrics: ResultMetric[] = [
  {
    name: '502错误率',
    before: '12%',
    after: '0%',
    delta: '-12%',
    positive: true,
  },
  {
    name: 'P99延迟',
    before: '1.2s',
    after: '180ms',
    delta: '-85%',
    positive: true,
  },
  {
    name: '并发连接数',
    before: '15360',
    after: '8200',
    delta: '-47%',
    positive: true,
  },
  {
    name: 'CPU使用率',
    before: '68%',
    after: '45%',
    delta: '-23%',
    positive: true,
  },
]

/** 6 条操作日志（与设计稿 1:1） */
export const actionLogs: ActionLog[] = [
  {
    time: '14:32:15',
    icon: 'sparkles',
    iconColor: 'var(--trae-text-brand)',
    desc: 'AI 提出决策建议',
  },
  {
    time: '14:32:18',
    icon: 'shield',
    iconColor: 'var(--trae-icon-secondary)',
    desc: '系统自动校验安全性',
  },
  {
    time: '14:32:20',
    icon: 'check',
    iconColor: 'var(--trae-status-success-default)',
    desc: '工程师审核通过',
  },
  {
    time: '14:32:22',
    icon: 'terminal',
    iconColor: 'var(--trae-text-brand)',
    desc: '执行',
    mono: 'nginx -s reload',
  },
  {
    time: '14:32:24',
    icon: 'activity',
    iconColor: 'var(--trae-icon-secondary)',
    desc: '开始效果监控',
  },
  {
    time: '14:33:24',
    icon: 'check-circle',
    iconColor: 'var(--trae-status-success-default)',
    desc: '验证通过，决策完成',
  },
]

/** 决策元信息常量（header 显示） */
export const decisionMeta = {
  /** 决策 ID */
  id: 'DEC-2024-0718-001',
  /** 决策时间戳 */
  timestamp: '2024-07-18 14:32:15',
  /** 知识库 ID */
  knowledgeId: 'KB-021',
  /** 知识库描述 */
  knowledgeDesc: '本次决策已更新至知识库',
  /** 置信度（0-1） */
  confidence: 0.87,
  /** 执行命令高亮片段 */
  command: 'nginx -s reload',
  /** 命令注释 */
  commandComment: '# 热加载 nginx 配置',
}
