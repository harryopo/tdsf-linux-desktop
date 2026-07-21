/**
 * @cmd 命令处理器（命令 + 预测结果注入）
 *
 * 职责：
 * - 接收命令原文（command）+ 可选预测输出（predictedOutput）+ 可选历史执行次数（useHistory）
 * - 格式化为 LLM 可读的注入文本（含命令、预测输出、历史次数）
 * - 返回 AtCommand 对象供 ChatPanel 拼装到 prompt
 *
 * 触发场景：
 * - 终端划选命令后拖拽到 ChatPanel
 * - ChatPanel 直接输入 `@cmd[ls -la]`
 * - 历史面板拖拽命令卡片
 *
 * 方案书依据：v0.9 §4.1（8 类 @命令 - cmd）
 */

import type { AtCommand, CmdCommandPayload } from '@shared/at-command-types'
import type { AtCommandHandler } from './base'

/**
 * @cmd 命令 handler 实现
 */
export class CmdCommandHandler implements AtCommandHandler {
  readonly type = 'cmd' as const
  readonly label = '命令'
  readonly icon = 'CodeOutlined'
  readonly description = '注入命令 + 预测结果'

  async resolve(
    args: Record<string, unknown>,
    ctx: import('./base').AtCommandContext
  ): Promise<AtCommand> {
    const payload = this.parseArgs(args)
    const injectedText = this.formatInject(payload)
    const displayText = this.formatDisplay(payload)

    return {
      type: 'cmd',
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
   * - command 必填，必须为 string，否则默认空字符串
   * - predictedOutput 可选，必须为 string
   * - useHistory 可选，必须为 number
   */
  private parseArgs(args: Record<string, unknown>): CmdCommandPayload {
    const command = typeof args.command === 'string' ? args.command : ''
    const predictedOutput =
      typeof args.predictedOutput === 'string' ? args.predictedOutput : undefined
    const useHistory =
      typeof args.useHistory === 'number' && Number.isFinite(args.useHistory)
        ? args.useHistory
        : undefined

    return { command, predictedOutput, useHistory }
  }

  /**
   * 格式化 LLM 注入文本
   *
   * 输出格式：
   * ```
   * --- 命令片段 ---
   * $ ls -la
   * 历史执行次数：5
   * 预测输出：
   * <output>
   * --- 命令结束 ---
   * ```
   */
  private formatInject(p: CmdCommandPayload): string {
    const lines: string[] = ['', '--- 命令片段 ---', `$ ${p.command}`]
    if (p.useHistory !== undefined) {
      lines.push(`历史执行次数：${p.useHistory}`)
    }
    if (p.predictedOutput !== undefined && p.predictedOutput.length > 0) {
      lines.push('预测输出：')
      lines.push(p.predictedOutput)
    }
    lines.push('--- 命令结束 ---', '')
    return lines.join('\n')
  }

  /**
   * 格式化 Chip 显示文本
   *
   * 截断到 30 字符避免 Chip 过长。
   */
  private formatDisplay(p: CmdCommandPayload): string {
    const preview =
      p.command.length > 30 ? `${p.command.slice(0, 30)}...` : p.command
    return `@cmd ${preview}`
  }
}
