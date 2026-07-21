/**
 * @server 命令处理器（服务器信息注入）
 *
 * 职责：
 * - 接收服务器 ID（serverId）+ 名称（name）+ 主机（host）+ 端口（port）+ 可选 OS / 内核
 * - 格式化为 LLM 可读的注入文本（含完整服务器元信息）
 * - 返回 AtCommand 对象供 ChatPanel 拼装到 prompt
 *
 * 触发场景：
 * - 服务器列表拖拽服务器到 ChatPanel
 * - ChatPanel 直接输入 `@server[<id>]`（由调用方查询列表）
 *
 * 方案书依据：v0.9 §4.1（8 类 @命令 - server）
 */

import type {
  AtCommand,
  ServerCommandPayload,
} from '@shared/at-command-types'
import type { AtCommandHandler } from './base'

/**
 * @server 命令 handler 实现
 */
export class ServerCommandHandler implements AtCommandHandler {
  readonly type = 'server' as const
  readonly label = '服务器'
  readonly icon = 'CloudServerOutlined'
  readonly description = '注入服务器信息（服务器列表拖拽）'

  async resolve(
    args: Record<string, unknown>,
    ctx: import('./base').AtCommandContext
  ): Promise<AtCommand> {
    const payload = this.parseArgs(args)
    const injectedText = this.formatInject(payload)
    const displayText = this.formatDisplay(payload)

    return {
      type: 'server',
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
   * - serverId 必填，必须为 string
   * - name 必填，必须为 string
   * - host 必填，必须为 string
   * - port 必填，必须为 number（1-65535）
   * - os 可选，必须为 string
   * - kernel 可选，必须为 string
   */
  private parseArgs(args: Record<string, unknown>): ServerCommandPayload {
    const serverId =
      typeof args.serverId === 'string' ? args.serverId : ''
    const name = typeof args.name === 'string' ? args.name : ''
    const host = typeof args.host === 'string' ? args.host : ''
    const port =
      typeof args.port === 'number' &&
      Number.isFinite(args.port) &&
      args.port > 0 &&
      args.port < 65536
        ? Math.floor(args.port)
        : 22
    const os = typeof args.os === 'string' ? args.os : undefined
    const kernel =
      typeof args.kernel === 'string' ? args.kernel : undefined

    return { serverId, name, host, port, os, kernel }
  }

  /**
   * 格式化 LLM 注入文本
   *
   * 输出格式：
   * ```
   * --- 服务器信息 ---
   * 名称：<name>
   * 主机：<host>:<port>
   * 操作系统：<os>
   * 内核版本：<kernel>
   * --- 服务器信息结束 ---
   * ```
   */
  private formatInject(p: ServerCommandPayload): string {
    const lines: string[] = [
      '',
      '--- 服务器信息 ---',
      `名称：${p.name}`,
      `主机：${p.host}:${p.port}`,
    ]
    if (p.os) {
      lines.push(`操作系统：${p.os}`)
    }
    if (p.kernel) {
      lines.push(`内核版本：${p.kernel}`)
    }
    lines.push('--- 服务器信息结束 ---', '')
    return lines.join('\n')
  }

  /**
   * 格式化 Chip 显示文本
   *
   * 显示服务器名称，截断到 30 字符。
   */
  private formatDisplay(p: ServerCommandPayload): string {
    const preview =
      p.name.length > 30 ? `${p.name.slice(0, 30)}...` : p.name
    return `@server ${preview}`
  }
}
