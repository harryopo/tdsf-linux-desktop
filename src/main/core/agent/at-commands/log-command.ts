/**
 * @log 命令处理器（日志片段注入）
 *
 * 职责：
 * - 接收用户输入的日志片段（rawText + 可选 category + 可选 timeRange）
 * - 格式化为 LLM 可读的注入文本（含来源、时间范围、原文）
 * - 返回 AtCommand 对象供 ChatPanel 拼装到 prompt
 *
 * 触发场景：
 * - IDE 终端划选日志后拖拽到 ChatPanel
 * - 监控面板 / 历史面板拖拽日志卡片
 * - ChatPanel 直接输入 `@log[内容]`
 *
 * 方案书依据：v0.9 §4.1（8 类 @命令 - log）
 */

import type {
  AtCommand,
  AtCommandSource,
  LogCommandPayload,
} from '@shared/at-command-types'
import type { AtCommandContext, AtCommandHandler } from './base'

/**
 * @log 命令 handler 实现
 *
 * 实现要点：
 * - `type` 字面量为 `'log'`，用于注册器校验
 * - resolve() 接收 `Record<string, unknown>`，由 parseArgs 内部校验并转换为 LogCommandPayload
 */
export class LogCommandHandler implements AtCommandHandler {
  readonly type = 'log' as const
  readonly label = '日志'
  readonly icon = 'FileTextOutlined'
  readonly description = '注入日志片段（鼠标划选 + 拖拽）'

  async resolve(
    args: Record<string, unknown>,
    ctx: AtCommandContext
  ): Promise<AtCommand> {
    const payload = this.parseArgs(args)
    const injectedText = this.formatInject(payload)
    const displayText = this.formatDisplay(payload)

    return {
      type: 'log',
      payload,
      source: ctx.source,
      timestamp: ctx.timestamp,
      displayText,
      injectedText,
    }
  }

  /**
   * 解析并校验 args，转换为 LogCommandPayload
   *
   * 校验规则：
   * - rawText 必填，必须为 string，否则默认空字符串
   * - category 可选，必须为 string
   * - timeRange 可选，必须为 { start: string, end: string }
   */
  private parseArgs(args: Record<string, unknown>): LogCommandPayload {
    const rawText = typeof args.rawText === 'string' ? args.rawText : ''
    const category =
      typeof args.category === 'string' ? args.category : undefined
    const timeRange = this.parseTimeRange(args.timeRange)

    return { rawText, category, timeRange }
  }

  /**
   * 解析 timeRange 字段
   *
   * 接受格式：{ start: string, end: string }，任一字段缺失或类型错误则返回 undefined
   */
  private parseTimeRange(
    raw: unknown
  ): { start: string; end: string } | undefined {
    if (!raw || typeof raw !== 'object') return undefined
    const obj = raw as Record<string, unknown>
    const start = typeof obj.start === 'string' ? obj.start : undefined
    const end = typeof obj.end === 'string' ? obj.end : undefined
    if (start && end) return { start, end }
    return undefined
  }

  /**
   * 格式化 LLM 注入文本
   *
   * 输出格式（保持与方案书示例一致）：
   * ```
   * --- 日志片段（来源：syslog）---
   * 时间范围：2024-01-01T00:00:00Z 至 2024-01-01T01:00:00Z
   * <原文>
   * --- 日志结束 ---
   * ```
   */
  private formatInject(args: LogCommandPayload): string {
    const categoryLine = `来源：${args.category ?? '未知'}`
    const timeLine = args.timeRange
      ? `时间范围：${args.timeRange.start} 至 ${args.timeRange.end}`
      : '时间范围：未指定'
    return [
      '',
      '--- 日志片段（' + categoryLine + '）---',
      timeLine,
      args.rawText,
      '--- 日志结束 ---',
      '',
    ].join('\n')
  }

  /**
   * 格式化 Chip 显示文本
   *
   * 截断到 30 字符避免 Chip 过长。
   */
  private formatDisplay(args: LogCommandPayload): string {
    const prefix = args.category ? `@log ${args.category}` : '@log'
    const preview =
      args.rawText.length > 30
        ? `${args.rawText.slice(0, 30)}...`
        : args.rawText
    return `${prefix} ${preview}`
  }
}

/**
 * 显式标注 AtCommandSource 用于此 handler 的来源类型
 *
 * 注意：handler 本身不限制 source，由调用方在 ctx.source 中传入。
 * 此类型别名仅用于类型推导工具（IDE 提示），不参与运行时。
 */
export type LogCommandSource = AtCommandSource
