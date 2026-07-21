/**
 * @metric 命令处理器（监控指标注入）
 *
 * 职责：
 * - 接收指标名（metric）+ 当前值（value）+ 单位（unit）+ 可选历史序列（history）
 * - 格式化为 LLM 可读的注入文本（含当前值与趋势）
 * - 返回 AtCommand 对象供 ChatPanel 拼装到 prompt
 *
 * 触发场景：
 * - 监控面板拖拽指标卡片到 ChatPanel
 * - ChatPanel 直接输入 `@metric[cpu:85%]`（由调用方解析）
 *
 * 方案书依据：v0.9 §4.1（8 类 @命令 - metric）
 */

import type { AtCommand, MetricCommandPayload } from '@shared/at-command-types'
import type { AtCommandHandler } from './base'

/**
 * @metric 命令 handler 实现
 */
export class MetricCommandHandler implements AtCommandHandler {
  readonly type = 'metric' as const
  readonly label = '指标'
  readonly icon = 'LineChartOutlined'
  readonly description = '注入监控指标（监控面板拖拽）'

  async resolve(
    args: Record<string, unknown>,
    ctx: import('./base').AtCommandContext
  ): Promise<AtCommand> {
    const payload = this.parseArgs(args)
    const injectedText = this.formatInject(payload)
    const displayText = this.formatDisplay(payload)

    return {
      type: 'metric',
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
   * - metric 必填，必须为 string
   * - value 必填，必须为 number
   * - unit 必填，必须为 string
   * - history 可选，必须为 Array<{ timestamp: number, value: number }>
   */
  private parseArgs(args: Record<string, unknown>): MetricCommandPayload {
    const metric = typeof args.metric === 'string' ? args.metric : ''
    const value =
      typeof args.value === 'number' && Number.isFinite(args.value)
        ? args.value
        : 0
    const unit = typeof args.unit === 'string' ? args.unit : ''
    const history = this.parseHistory(args.history)

    return { metric, value, unit, history }
  }

  /**
   * 解析历史值序列
   *
   * 接受 Array<{ timestamp: number, value: number }>，过滤掉无效条目。
   */
  private parseHistory(
    raw: unknown
  ): Array<{ timestamp: number; value: number }> | undefined {
    if (!Array.isArray(raw)) return undefined
    const result: Array<{ timestamp: number; value: number }> = []
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>
      const ts = typeof obj.timestamp === 'number' ? obj.timestamp : undefined
      const v = typeof obj.value === 'number' ? obj.value : undefined
      if (ts !== undefined && v !== undefined) {
        result.push({ timestamp: ts, value: v })
      }
    }
    return result.length > 0 ? result : undefined
  }

  /**
   * 格式化 LLM 注入文本
   *
   * 输出格式：
   * ```
   * --- 监控指标：cpu ---
   * 当前值：85%
   * 历史趋势（5 个采样点）：
   *   - 2024-01-01T00:00:00Z: 80%
   *   - 2024-01-01T00:01:00Z: 82%
   *   ...
   * --- 指标结束 ---
   * ```
   */
  private formatInject(p: MetricCommandPayload): string {
    const lines: string[] = [
      '',
      `--- 监控指标：${p.metric} ---`,
      `当前值：${p.value}${p.unit}`,
    ]
    if (p.history && p.history.length > 0) {
      lines.push(`历史趋势（${p.history.length} 个采样点）：`)
      for (const h of p.history) {
        const ts = new Date(h.timestamp).toISOString()
        lines.push(`  - ${ts}: ${h.value}${p.unit}`)
      }
    }
    lines.push('--- 指标结束 ---', '')
    return lines.join('\n')
  }

  /**
   * 格式化 Chip 显示文本
   */
  private formatDisplay(p: MetricCommandPayload): string {
    return `@metric ${p.metric}=${p.value}${p.unit}`
  }
}
