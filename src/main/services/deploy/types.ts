/**
 * Web 部署助手 - 类型定义（兼容层）
 *
 * 实际定义在 src/shared/deploy-types.ts（本文件从 shared 重新导出）
 * 这样渲染端和主进程都能引用同一份类型定义，避免重复。
 *
 * 部署模板是只读教学资料：AI 工具 deploy_list_templates 列出它们。
 * 执行链与计划/结果类型已于 2026-10-24 整删（原因见 deploy-service.ts 文件头）。
 */

export * from '../../../shared/deploy-types'
