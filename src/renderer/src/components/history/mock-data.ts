/**
 * mock-data.ts — HistoryPage mock 类型与筛选选项
 *
 * 保留：DecisionStatus/RiskLevel/ActorType/StatOverview/DecisionRecord 类型
 *       + timeRangeOptions/serverOptions/statusOptions 筛选常量
 * 移除：statOverviews/decisionRecords/pagination 死数据常量
 *
 * R16 清理：11 → 8 导出，HistoryPage 已使用本地状态计算替代 mock 数据。
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
