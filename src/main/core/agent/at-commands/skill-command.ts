/**
 * @skill 命令处理器（skill 调用注入）
 *
 * 职责：
 * - 接收 skill 名称（skillName）+ 可选参数（args）+ 可选来源（source）
 * - 格式化为 LLM 可读的注入文本（含 skill 名、参数、来源）
 * - 返回 AtCommand 对象供 ChatPanel 拼装到 prompt
 *
 * 触发场景：
 * - ChatPanel 输入 `@skill[skill-name]` 触发 skill 调用
 * - 通过 MCP 协议由外部 Agent 调用 TDSF skill
 *
 * 设计要点：
 * - skill 调用本身是异步的，但 @skill 命令的 resolve 只生成"调用提示文本"
 *   实际的 skill 执行由 Agent Runtime 在收到 prompt 后通过 MCP/Tool Calling 完成
 * - 这样设计是为了把 @skill 与其他 @命令统一为"注入文本"模式，便于 ChatPanel 统一处理
 *
 * 方案书依据：v0.9 §4.1（8 类 @命令 - skill）+ §7（Skill 包仓库）
 */

import type { AtCommand, SkillCommandPayload } from '@shared/at-command-types'
import type { AtCommandHandler } from './base'

/**
 * @skill 命令 handler 实现
 */
export class SkillCommandHandler implements AtCommandHandler {
  readonly type = 'skill' as const
  readonly label = 'Skill'
  readonly icon = 'ToolOutlined'
  readonly description = '调用 skill（MCP 协议）'

  async resolve(
    args: Record<string, unknown>,
    ctx: import('./base').AtCommandContext
  ): Promise<AtCommand> {
    const payload = this.parseArgs(args)
    const injectedText = this.formatInject(payload)
    const displayText = this.formatDisplay(payload)

    return {
      type: 'skill',
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
   * - skillName 必填，必须为 string
   * - args 可选，必须为 object（Record<string, unknown>）
   * - source 可选，必须为 'trae' / 'claude' / 'custom'
   */
  private parseArgs(args: Record<string, unknown>): SkillCommandPayload {
    const skillName =
      typeof args.skillName === 'string' ? args.skillName : ''
    const skillArgs = this.parseArgsObject(args.args)
    const source = this.parseSource(args.source)

    return { skillName, args: skillArgs, source }
  }

  /**
   * 解析 args 对象字段
   *
   * 接受 Record<string, unknown>（普通 object），其他类型返回 undefined。
   */
  private parseArgsObject(
    raw: unknown
  ): Record<string, unknown> | undefined {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, unknown>
    }
    return undefined
  }

  /**
   * 解析 skill 来源字段
   *
   * 接受 'trae' / 'claude' / 'custom'，其他值返回 undefined。
   */
  private parseSource(raw: unknown): SkillCommandPayload['source'] {
    if (raw === 'trae' || raw === 'claude' || raw === 'custom') {
      return raw
    }
    return undefined
  }

  /**
   * 格式化 LLM 注入文本
   *
   * 输出格式：
   * ```
   * --- Skill 调用 ---
   * Skill 名称：<skillName>
   * 来源：trae
   * 参数：
   * {
   *   "key": "value"
   * }
   * --- Skill 调用结束 ---
   * ```
   */
  private formatInject(p: SkillCommandPayload): string {
    const lines: string[] = [
      '',
      '--- Skill 调用 ---',
      `Skill 名称：${p.skillName}`,
    ]
    if (p.source) {
      lines.push(`来源：${p.source}`)
    }
    if (p.args && Object.keys(p.args).length > 0) {
      lines.push('参数：')
      try {
        lines.push(JSON.stringify(p.args, null, 2))
      } catch {
        lines.push(String(p.args))
      }
    }
    lines.push('--- Skill 调用结束 ---', '')
    return lines.join('\n')
  }

  /**
   * 格式化 Chip 显示文本
   *
   * 截断 skillName 到 30 字符。
   */
  private formatDisplay(p: SkillCommandPayload): string {
    const preview =
      p.skillName.length > 30 ? `${p.skillName.slice(0, 30)}...` : p.skillName
    return `@skill ${preview}`
  }
}
