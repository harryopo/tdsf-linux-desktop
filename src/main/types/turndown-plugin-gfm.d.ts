/**
 * turndown-plugin-gfm 的类型声明补全
 *
 * 该库官方未提供 @types/turndown-plugin-gfm，
 * 此处手动补全 .use(gfm) 的函数签名。
 *
 * 教学术语：
 * - .d.ts (Declaration File)：纯类型声明文件，无运行时代码
 * - Augmentation (类型扩展)：为已有模块补充类型
 */

declare module 'turndown-plugin-gfm' {
  import type { TurndownService } from 'turndown'

  /**
   * GFM (GitHub Flavored Markdown) 插件
   * - 支持表格、删除线、任务列表、自动链接
   * - 链式调用：turndownService.use(gfm)
   */
  export function gfm(service: TurndownService): TurndownService

  // 默认导出 = gfm 函数本身（兼容 esModuleInterop）
  export default gfm
}
