/**
 * @命令文本解析器
 *
 * 职责：
 * - 解析 ChatPanel 输入框文本，提取所有 @命令片段
 * - 对每个匹配的 @命令，调用对应 handler.resolve() 构造 AtCommand 对象
 * - 返回去除 @命令后的纯文本 + 解析出的 AtCommand 列表
 *
 * 支持的语法：
 * - `@log[<内容>]`  - 内容可以是日志原文 或 JSON 字符串
 * - `@cmd[<命令>]`  - 内容可以是命令原文 或 JSON 字符串
 * - `@file[<路径>]` - 内容可以是文件路径 或 JSON 字符串
 * - `@metric[...]` `@decision[...]` `@kb[...]` `@skill[...]` `@server[...]`
 *
 * JSON 形式（推荐用于复杂参数）：
 *   @log[{"rawText":"error...","category":"syslog"}]
 *   @file[{"remotePath":"/etc/hosts","content":"127.0.0.1 ...","size":100}]
 *
 * 纯文本形式（适用于单字段场景，默认字段映射见 PRIMARY_FIELD）：
 *   @log[some error message]
 *   @cmd[ls -la]
 *   @file[/etc/hosts]
 *
 * 方案书依据：v0.9 §4.1（8 类 @命令）+ §4.3（@命令接口契约）
 */

import type {
  AtCommand,
  AtCommandParseResult,
  AtCommandType,
} from '@shared/at-command-types'
import type { AtCommandContext } from './base'
import type { AtCommandRegistry } from './base'

/**
 * @命令文本解析器
 *
 * 持有 AtCommandRegistry 引用，对输入文本做模式匹配后调用对应 handler。
 *
 * 使用方式：
 * ```ts
 * const parser = new AtCommandParser(registry)
 * const result = await parser.parse(
 *   '请分析这段日志 @log[error: connection refused]',
 *   { timestamp: Date.now(), source: 'chat-input' }
 * )
 * // result.text === '请分析这段日志 '
 * // result.commands[0].type === 'log'
 * ```
 */
export class AtCommandParser {
  /**
   * 8 类 @命令的正则匹配模式
   *
   * 匹配格式：`@<type>[<内容>]`
   * - 内容不能包含 `]` 字符（避免贪婪匹配跨段落）
   * - `\s*` 允许 @ 与 `[` 之间有空格（如 `@log [...]`）
   * - 全局匹配（g 标志），用于 findall
   *
   * 注意：使用 [^\]]* 而非 .*? 是为了避免跨行匹配导致误吞。
   */
  private static readonly PATTERNS: Record<AtCommandType, RegExp> = {
    log: /@log\s*\[([^\]]*)\]/g,
    cmd: /@cmd\s*\[([^\]]*)\]/g,
    file: /@file\s*\[([^\]]*)\]/g,
    metric: /@metric\s*\[([^\]]*)\]/g,
    decision: /@decision\s*\[([^\]]*)\]/g,
    kb: /@kb\s*\[([^\]]*)\]/g,
    skill: /@skill\s*\[([^\]]*)\]/g,
    server: /@server\s*\[([^\]]*)\]/g,
  }

  /**
   * 纯文本形式时的主字段映射
   *
   * 当 @命令内容不是 JSON 时，使用此映射决定内容填入哪个字段：
   * - @log → rawText
   * - @cmd → command
   * - @file → remotePath
   * - @metric → metric
   * - @decision → decisionId
   * - @kb → entryId
   * - @skill → skillName
   * - @server → serverId
   */
  private static readonly PRIMARY_FIELD: Record<AtCommandType, string> = {
    log: 'rawText',
    cmd: 'command',
    file: 'remotePath',
    metric: 'metric',
    decision: 'decisionId',
    kb: 'entryId',
    skill: 'skillName',
    server: 'serverId',
  }

  /**
   * 构造解析器
   *
   * @param registry 已注册 8 类 handler 的注册器
   */
  constructor(private readonly registry: AtCommandRegistry) {}

  /**
   * 解析文本中的所有 @命令
   *
   * 步骤：
   * 1. 遍历 8 类 @命令 pattern，找出所有匹配位置
   * 2. 按 match.index 升序合并所有匹配
   * 3. 从后向前删除匹配的文本（避免索引偏移）
   * 4. 对每个匹配调用 handler.resolve() 构造 AtCommand
   *
   * @param text ChatPanel 输入框原始文本
   * @param ctx IPC 派发上下文
   * @returns 解析结果（纯文本 + AtCommand 列表）
   */
  async parse(
    text: string,
    ctx: AtCommandContext
  ): Promise<AtCommandParseResult> {
    // 收集所有匹配（type + match + rawContent）
    const matches: Array<{
      type: AtCommandType
      index: number
      fullMatch: string
      rawContent: string
    }> = []

    for (const type of Object.keys(
      AtCommandParser.PATTERNS
    ) as AtCommandType[]) {
      const pattern = AtCommandParser.PATTERNS[type]
      // 重置 regex 状态（全局匹配需要重置 lastIndex）
      pattern.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = pattern.exec(text)) !== null) {
        matches.push({
          type,
          index: m.index,
          fullMatch: m[0],
          rawContent: m[1] ?? '',
        })
      }
    }

    // 无匹配直接返回
    if (matches.length === 0) {
      return { text, commands: [] }
    }

    // 按位置升序排序（保证去重时索引计算正确）
    matches.sort((a, b) => a.index - b.index)

    // 从后向前删除匹配的文本（避免索引偏移）
    let cleanedText = text
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i]
      cleanedText =
        cleanedText.slice(0, m.index) +
        cleanedText.slice(m.index + m.fullMatch.length)
    }

    // 对每个匹配调用 handler.resolve() 构造 AtCommand
    const commands: AtCommand[] = []
    for (const m of matches) {
      try {
        const args = this.parseContent(m.type, m.rawContent)
        const cmd = await this.registry.resolve(m.type, args, ctx)
        commands.push(cmd)
      } catch (err) {
        // 解析失败的 @命令跳过（不影响其他命令），由调用方决定是否提示用户
        // 这里不抛错，避免一条命令失败导致整段解析失败
        // 后续可加 logger 输出（暂时保持纯净，不引入 logger 依赖）
        void err
      }
    }

    return {
      text: cleanedText,
      commands,
    }
  }

  /**
   * 解析 @命令内容（中括号内的字符串）为 args 对象
   *
   * 解析规则：
   * 1. 内容以 `{` 开头且能 JSON.parse → 使用 JSON 对象
   * 2. 否则视为纯文本，填入对应 type 的 PRIMARY_FIELD
   *
   * @param type 命令类型
   * @param rawContent 中括号内的原始字符串（已 trim）
   */
  private parseContent(
    type: AtCommandType,
    rawContent: string
  ): Record<string, unknown> {
    const trimmed = rawContent.trim()
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>
        }
      } catch {
        // JSON 解析失败，回退到纯文本模式
      }
    }
    // 纯文本模式：填入对应 type 的主字段
    const fieldName = AtCommandParser.PRIMARY_FIELD[type]
    return { [fieldName]: rawContent }
  }
}
