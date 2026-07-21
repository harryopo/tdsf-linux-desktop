/**
 * @kb 命令处理器（知识库条目注入）
 *
 * 职责：
 * - 接收知识条目 ID（entryId）+ 类型（type）+ 标题（title）+ 内容摘要（content）
 * - 格式化为 LLM 可读的注入文本（含类型、标题、内容）
 * - 返回 AtCommand 对象供 ChatPanel 拼装到 prompt
 *
 * 触发场景：
 * - 知识库面板拖拽条目到 ChatPanel
 * - ChatPanel 输入 `@kb` 触发知识库搜索后选择条目
 *
 * 方案书依据：v0.9 §4.1（8 类 @命令 - kb）+ §6（知识双轨制）
 */

import type { AtCommand, KbCommandPayload } from '@shared/at-command-types'
import type { AtCommandHandler } from './base'

/**
 * @kb 命令 handler 实现
 */
export class KbCommandHandler implements AtCommandHandler {
  readonly type = 'kb' as const
  readonly label = '知识库'
  readonly icon = 'BookOutlined'
  readonly description = '注入知识库条目（@ 触发搜索）'

  async resolve(
    args: Record<string, unknown>,
    ctx: import('./base').AtCommandContext
  ): Promise<AtCommand> {
    const payload = this.parseArgs(args)
    const injectedText = this.formatInject(payload)
    const displayText = this.formatDisplay(payload)

    return {
      type: 'kb',
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
   * - entryId 必填，必须为 string
   * - type 必填，必须为 'command_skill' / 'incident_case' / 'tutorial'
   * - title 必填，必须为 string
   * - content 必填，必须为 string
   */
  private parseArgs(args: Record<string, unknown>): KbCommandPayload {
    const entryId = typeof args.entryId === 'string' ? args.entryId : ''
    const type = this.parseType(args.type)
    const title = typeof args.title === 'string' ? args.title : ''
    const content = typeof args.content === 'string' ? args.content : ''

    return { entryId, type, title, content }
  }

  /**
   * 解析知识类型字段
   *
   * 接受 'command_skill' / 'incident_case' / 'tutorial'，其他值默认为 'tutorial'。
   */
  private parseType(raw: unknown): KbCommandPayload['type'] {
    if (
      raw === 'command_skill' ||
      raw === 'incident_case' ||
      raw === 'tutorial'
    ) {
      return raw
    }
    return 'tutorial'
  }

  /**
   * 格式化 LLM 注入文本
   *
   * 输出格式：
   * ```
   * --- 知识库条目（类型：command_skill）---
   * 标题：<title>
   * 内容：
   * <content>
   * --- 条目结束 ---
   * ```
   */
  private formatInject(p: KbCommandPayload): string {
    const typeLabel = this.typeToLabel(p.type)
    return [
      '',
      `--- 知识库条目（类型：${typeLabel}）---`,
      `标题：${p.title}`,
      '内容：',
      p.content,
      '--- 条目结束 ---',
      '',
    ].join('\n')
  }

  /**
   * 类型枚举转中文标签（用于注入文本的可读性）
   */
  private typeToLabel(type: KbCommandPayload['type']): string {
    switch (type) {
      case 'command_skill':
        return '操作技能'
      case 'incident_case':
        return '故障案例'
      case 'tutorial':
        return '教程'
      default: {
        // 穷尽性检查
        const exhaustive: never = type
        return String(exhaustive)
      }
    }
  }

  /**
   * 格式化 Chip 显示文本
   *
   * 截断 title 到 30 字符。
   */
  private formatDisplay(p: KbCommandPayload): string {
    const preview =
      p.title.length > 30 ? `${p.title.slice(0, 30)}...` : p.title
    return `@kb ${preview}`
  }
}
