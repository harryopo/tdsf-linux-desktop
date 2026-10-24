/**
 * Web 部署模板 - 类型定义（主进程 + 渲染进程共享）
 *
 * 模板是只读教学资料：AI 工具 deploy_list_templates 通过 DeployService 列出它们。
 * 执行链（validate/build/execute）与计划/结果类型已于 2026-10-24 整删，
 * 原因见 src/main/services/deploy/deploy-service.ts 文件头。
 */

/** 部署命令风险等级 */
export type DeployRiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical'

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

/** 模板输入变量 */
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
