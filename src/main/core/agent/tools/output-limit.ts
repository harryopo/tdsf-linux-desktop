/**
 * 工具输出的截断上限与"截断必须留痕"
 *
 * 症状（2026-10-15 全维度审查 D9）：ssh 工具的 stdout 一律 `.slice(0, 12000)`，
 * 截没截、截掉多少，模型和用户都不知道。模型看到的是一段**看起来完整**的输出，
 * 于是它会说"日志里只有这 20 行"——而真实日志有 500 行。这不是观感问题，
 * 是让它拿残缺证据下确定结论，正是本产品要避免的那类错误。
 *
 * 规则：任何截断都要在**文本本身**里写明，因为模型只读文本；
 * 结构化字段（truncated/droppedChars）给人和 UI 用，两者都要有。
 */

/** stdout 上限（字符）：与既有工具实现保持一致，改动要有理由 */
export const TOOL_STDOUT_CHAR_LIMIT = 12_000

/** stderr 上限（字符） */
export const TOOL_STDERR_CHAR_LIMIT = 4_000

/** 工具入参在界面上的预览上限（卡片里显示命令原文用） */
export const TOOL_INPUT_PREVIEW_CHAR_LIMIT = 2_000

/** 工具结果在界面上的预览上限（卡片显示的是摘要，全文进模型的那份用 STDOUT 上限） */
export const TOOL_EVENT_PREVIEW_CHAR_LIMIT = 4_000

/** 注入提示词的第三方文本（记忆内容等）上限 */
export const PROMPT_SNIPPET_CHAR_LIMIT = 2_000

export interface LimitedText {
  /** 交给模型的文本（截断时已把"截了多少"写进正文） */
  text: string
  /** 是否发生截断 */
  truncated: boolean
  /** 原始长度 */
  originalChars: number
  /** 被丢掉的字符数 */
  droppedChars: number
}

/**
 * 截断一段工具输出，并在截断时追加提示行
 *
 * 提示行刻意用方括号包起来写进正文：模型不会把它当成命令输出的一部分，
 * 但会据此知道"下面的内容不完整，不能据'没出现'断定'不存在'"。
 */
export function limitToolText(
  raw: string | undefined | null,
  limit: number = TOOL_STDOUT_CHAR_LIMIT,
  label: string = '输出',
): LimitedText {
  const original = raw ?? ''
  if (original.length <= limit) {
    return { text: original, truncated: false, originalChars: original.length, droppedChars: 0 }
  }
  const kept = original.slice(0, limit)
  const dropped = original.length - kept.length
  return {
    text: `${kept}\n\n[${label}已截断：原 ${original.length} 字符，此处只保留前 ${limit} 字符，还有 ${dropped} 字符未提供；不能据此判断"后面没有"。]`,
    truncated: true,
    originalChars: original.length,
    droppedChars: dropped,
  }
}

/** 只要文本的快捷版（给不关心元数据的路径用） */
export function limitToolTextOnly(
  raw: string | undefined | null,
  limit?: number,
  label?: string,
): string {
  return limitToolText(raw, limit, label).text
}
