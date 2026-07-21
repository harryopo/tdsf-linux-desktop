/**
 * Web 部署助手 - 类型定义（主进程 + 渲染进程共享）
 *
 * 部署助手把"官方教程"转化为"可执行的部署流水线"，
 * 集成 SSH 远程执行、风险评估、人机协同（二次确认）。
 *
 * 数据流：
 *   DeployTemplate（内置）→ 用户填变量 → DeployPlan → SSH 执行 → DeployResult
 */

/** 部署命令风险等级 */
export type DeployRiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical'

/** 中文风险标签 */
export const DEPLOY_RISK_LABELS: Record<DeployRiskLevel, string> = {
  safe: '安全',
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重'
}

/** 风险等级颜色（与 Profiler 保持视觉一致） */
export const DEPLOY_RISK_COLORS: Record<DeployRiskLevel, string> = {
  safe: '#52c41a',
  low: '#1890ff',
  medium: '#faad14',
  high: '#fa8c16',
  critical: '#f5222d'
}

/**
 * 风险等级图标（v0.7.0 规范）
 * 使用语义化的 Ant Design 图标名（渲染层根据 name 选择对应组件）
 * - 替代之前的 emoji 映射，避免在严肃运维 UI 中出现杂糅字符
 */
export const DEPLOY_RISK_ICON_NAMES: Record<DeployRiskLevel, string> = {
  safe: 'check-circle',
  low: 'minus-circle',
  medium: 'exclamation-circle',
  high: 'warning',
  critical: 'close-circle'
}

/** 部署步骤定义（模板中的静态项） */
export interface DeployStep {
  /** 步骤唯一 ID（模板内唯一） */
  id: string
  /** 步骤描述（中文） */
  description: string
  /** 待执行命令（支持 ${var} 插值） */
  command: string
  /** 风险等级 */
  risk: DeployRiskLevel
  /** 回滚命令（可为空） */
  rollback: string | null
  /** 预估耗时（秒） */
  estimatedSeconds: number
  /** 是否需要用户二次确认（high/critical 自动为 true） */
  requiresConfirm?: boolean
  /** 依赖的步骤 ID（被依赖步骤必须先成功） */
  dependsOn?: string[]
}

/** 模板输入变量（用户在 UI 中填写） */
export interface DeployVariable {
  /** 变量名（与 ${} 中的名称一致） */
  name: string
  /** 中文标签 */
  label: string
  /** 默认值 */
  defaultValue: string
  /** 占位提示 */
  placeholder?: string
  /** 是否必填 */
  required: boolean
  /** 输入类型 */
  type: 'text' | 'number' | 'password' | 'domain' | 'port'
  /** 校验正则（可选） */
  pattern?: string
  /** 帮助文本 */
  helpText?: string
}

/** 部署模板 */
export interface DeployTemplate {
  /** 模板 ID */
  id: string
  /** 模板名称 */
  name: string
  /** 简短描述 */
  summary: string
  /** 分类（web-server/containers/database/proxy） */
  category: string
  /** 难度（1-3 颗星） */
  difficulty: 1 | 2 | 3
  /** 关联教程 ID */
  tutorialId?: string
  /** 关联官方源（红帽/Ubuntu/Nginx/Docker） */
  source: string
  /** 步骤列表 */
  steps: DeployStep[]
  /** 输入变量 */
  variables: DeployVariable[]
  /** 预计总耗时（分钟） */
  estimatedMinutes: number
  /** 适用的 Linux 发行版 */
  supportedDistros: string[]
}

/** 部署计划（模板 + 用户填入的变量 → 可执行计划） */
export interface DeployPlan {
  /** 计划唯一 ID */
  id: string
  /** 模板 ID */
  templateId: string
  /** 模板名称（冗余，方便 UI 展示） */
  templateName: string
  /** 目标主机（host:port 格式） */
  targetHost: string
  /** 填入的变量 */
  variables: Record<string, string>
  /** 展开后的步骤（含插值后的命令） */
  steps: DeployStep[]
  /** 创建时间戳 */
  createdAt: number
  /** 当前状态 */
  status: DeployPlanStatus
}

export type DeployPlanStatus =
  | 'pending'      // 待执行
  | 'running'      // 执行中
  | 'paused'       // 暂停（等待用户确认）
  | 'success'      // 全部成功
  | 'failed'       // 失败
  | 'rolled_back'  // 已回滚
  | 'cancelled'    // 用户取消

/** 步骤执行结果（运行时） */
export interface DeployStepResult {
  /** 步骤 ID */
  stepId: string
  /** 步骤描述 */
  description: string
  /** 实际执行的命令（已插值） */
  command: string
  /** 风险等级 */
  risk: DeployRiskLevel
  /** 退出码 */
  exitCode: number | null
  /** 标准输出 */
  stdout: string
  /** 标准错误 */
  stderr: string
  /** 实际耗时（毫秒） */
  durationMs: number
  /** 状态 */
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  /** 错误信息 */
  error?: string
  /** 时间戳 */
  startedAt: number
  /** 结束时间戳 */
  finishedAt: number | null
}

/** 部署最终结果 */
export interface DeployResult {
  /** 计划 ID */
  planId: string
  /** 模板名称 */
  templateName: string
  /** 目标主机 */
  targetHost: string
  /** 总耗时（毫秒） */
  totalDurationMs: number
  /** 步骤结果列表 */
  steps: DeployStepResult[]
  /** 整体状态 */
  status: DeployPlanStatus
  /** 成功步骤数 */
  successCount: number
  /** 失败步骤数 */
  failedCount: number
  /** 失败时的错误信息 */
  error?: string
  /** 完成时间戳 */
  finishedAt: number
}

/** 实时日志事件 */
export interface DeployLogEvent {
  /** 计划 ID */
  planId: string
  /** 步骤 ID */
  stepId: string
  /** 数据流类型 */
  stream: 'stdout' | 'stderr' | 'system'
  /** 日志内容（单行或多行） */
  data: string
  /** 时间戳 */
  timestamp: number
}
