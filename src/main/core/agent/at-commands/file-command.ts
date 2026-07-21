/**
 * @file 命令处理器（远程文件内容注入）
 *
 * 职责：
 * - 接收远程文件路径（remotePath）+ 文件内容（content）+ 文件大小（size）+ 可选 MIME 类型
 * - 格式化为 LLM 可读的注入文本（含路径、大小、内容）
 * - 返回 AtCommand 对象供 ChatPanel 拼装到 prompt
 *
 * 触发场景：
 * - IDE 文件树拖拽文件到 ChatPanel
 * - ChatPanel 直接输入 `@file[/etc/hosts]`（由 SFTP 读取内容）
 *
 * 注意：
 * - 大文件（>10MB）应由调用方提前拦截（IPC 层 sftp:readFile 已限制）
 * - 此 handler 只负责格式化，不做文件读取
 *
 * 方案书依据：v0.9 §4.1（8 类 @命令 - file）
 */

import type { AtCommand, FileCommandPayload } from '@shared/at-command-types'
import type { AtCommandHandler } from './base'

/**
 * @file 命令 handler 实现
 */
export class FileCommandHandler implements AtCommandHandler {
  readonly type = 'file' as const
  readonly label = '文件'
  readonly icon = 'FileOutlined'
  readonly description = '注入远程文件内容（IDE 拖拽）'

  async resolve(
    args: Record<string, unknown>,
    ctx: import('./base').AtCommandContext
  ): Promise<AtCommand> {
    const payload = this.parseArgs(args)
    const injectedText = this.formatInject(payload)
    const displayText = this.formatDisplay(payload)

    return {
      type: 'file',
      payload,
      source: ctx.source,
      timestamp: ctx.timestamp,
      displayText,
      injectedText,
    }
  }

  /**
   * 解析并校验 args
   *
   * 校验规则：
   * - remotePath 必填，必须为 string
   * - content 必填，必须为 string
   * - size 必填，必须为 number
   * - mimeType 可选，必须为 string
   */
  private parseArgs(args: Record<string, unknown>): FileCommandPayload {
    const remotePath = typeof args.remotePath === 'string' ? args.remotePath : ''
    const content = typeof args.content === 'string' ? args.content : ''
    const size =
      typeof args.size === 'number' && Number.isFinite(args.size)
        ? args.size
        : content.length
    const mimeType =
      typeof args.mimeType === 'string' ? args.mimeType : undefined

    return { remotePath, content, size, mimeType }
  }

  /**
   * 格式化 LLM 注入文本
   *
   * 输出格式：
   * ```
   * --- 文件：/etc/hosts（1234 字节，text/plain）---
   * <content>
   * --- 文件结束 ---
   * ```
   */
  private formatInject(p: FileCommandPayload): string {
    const meta = [
      `${p.size} 字节`,
      p.mimeType ? `MIME: ${p.mimeType}` : null,
    ]
      .filter(Boolean)
      .join('，')
    return [
      '',
      `--- 文件：${p.remotePath}（${meta}）---`,
      p.content,
      '--- 文件结束 ---',
      '',
    ].join('\n')
  }

  /**
   * 格式化 Chip 显示文本
   *
   * 显示完整路径（路径本身已足够辨识，截断到 50 字符）。
   */
  private formatDisplay(p: FileCommandPayload): string {
    const path =
      p.remotePath.length > 50
        ? `...${p.remotePath.slice(-47)}`
        : p.remotePath
    return `@file ${path}`
  }
}
