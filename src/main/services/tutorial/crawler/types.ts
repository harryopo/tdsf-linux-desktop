/**
 * 教程爬虫模块 - 类型定义（兼容层）
 *
 * 实际定义在 src/shared/crawler-types.ts（本文件从 shared 重新导出）
 * 这样渲染端和主进程都能引用同一份类型定义，避免重复。
 *
 * 爬虫是从官方权威源（Arch Wiki / LDP / Red Hat Docs ...）抓取教程内容的程序。
 */

export * from '../../../../shared/crawler-types'
