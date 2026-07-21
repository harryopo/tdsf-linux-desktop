/**
 * @decision 命令处理器（历史决策注入）
 *
 * 职责：
 * - 接收决策卡片 ID（decisionId）+ 摘要（summary）+ 可选完整卡片（fullCard JSON 字符串）
 * - 格式化为 LLM 可读的注入文本（含摘要与完整卡片）
 * - 返回 AtCommand 对象供 ChatPanel 拼装到 prompt
 *
 * 触发场景：
 * - 历史面板拖拽决策卡片到 ChatPanel
 * - ChatPanel 直接输入 `@decision[<id>]`（由调用方查询数据库）
 *
 * 方案书依据：v0.9 §4.1（8 类 @命令 - decision）
 */

import type {
  AtCommand,
  DecisionCommandPayload,
} from '@shared/at-command-types'
import type { AtCommandHandler } from './base'

/**
 * @decision 命令 handler 实现
 */
export class DecisionCommandHandler implements AtCommandHandler {
  readonly type = 'decision' as const
  readonly label = '决策'
  readonly icon = 'HistoryOutlined'
  readonly description = '注入历史决策（历史面板拖拽）'

  async resolve(
    args: Record<string, unknown>,
    ctx: import('./base').AtCommandContext
  ): Promise<AtCommand> {
    const payload = this.parseArgs(args)
    const injectedText = this.formatInject(payload)
    const displayText = this.formatDisplay(payload)

    return {
      type: 'decision',
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
   * - decisionId 必填，必须为 string
   * - summary 必填，必须为 string
   * - fullCard 可选，必须为 string（JSON 字符串，由调用方序列化）
   */
  private parseArgs(args: Record<string, unknown>): DecisionCommandPayload {
    const decisionId =
      typeof args.decisionId === 'string' ? args.decisionId : ''
    const summary = typeof args.summary === 'string' ? args.summary : ''
    const fullCard =
      typeof args.fullCard === 'string' ? args.fullCard : undefined

    return { decisionId, summary, fullCard }
  }

  /**
   * 格式化 LLM 注入文本
   *
   * 输出格式：
   * ```
   * --- 历史决策（ID: <decisionId>）---
   * 摘要：<summary>
   * 完整卡片：
   * <fullCard JSON pretty>
   * --- 决策结束 ---
   * ```
   */
  private formatInject(p: DecisionCommandPayload): string {
    const lines: string[] = [
      '',
      `--- 历史决策（ID: ${p.decisionId}）---`,
      `摘要：${p.summary}`,
    ]
    if (p.fullCard) {
      lines.push('完整卡片：')
      // 尝试 pretty print，失败则原样输出
      try {
        const obj = JSON.parse(p.fullCard)
        lines.push(JSON.stringify(obj, null, 2))
      } catch {
        lines.push(p.fullCard)
      }
    }
    lines.push('--- 决策结束 ---', '')
    return lines.join('\n')
  }

  /**
   * 格式化 Chip 显示文本
   *
   * 截断 summary 到 30 字符。
   */
  private formatDisplay(p: DecisionCommandPayload): string {
    const preview =
      p.summary.length > 30 ? `${p.summary.slice(0, 30)}...` : p.summary
    return `@decision ${preview}`
  }
}
