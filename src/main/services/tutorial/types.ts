/**
 * 教程模块 - 类型定义（兼容层）
 *
 * 实际定义在 src/shared/tutorial-types.ts（本文件从 shared 重新导出）
 * 这样渲染端和主进程都能引用同一份类型定义，避免重复。
 *
 * 教程是从官方权威源爬取/整理的结构化知识，
 * 与命令技能（command_skill）和故障案例（incident_case）共同构成知识库三轨制。
 */

export * from '../../../shared/tutorial-types'
