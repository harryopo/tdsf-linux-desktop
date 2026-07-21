/**
 * Web 部署助手 - 类型定义（兼容层）
 *
 * 实际定义在 src/shared/deploy-types.ts（本文件从 shared 重新导出）
 * 这样渲染端和主进程都能引用同一份类型定义，避免重复。
 *
 * 部署助手把"官方教程"转化为"可执行的部署流水线"，
 * 集成 SSH 远程执行、风险评估、人机协同（二次确认）。
 *
 * 数据流：
 *   DeployTemplate（内置）→ 用户填变量 → DeployPlan → SSH 执行 → DeployResult
 */

export * from '../../../shared/deploy-types'
