/**
 * terminal-context.ts —— 把终端命令块摘要注入 system prompt
 *
 * 职责：渲染进程的块收集器（terminal/block-model.ts 的 toAiContext）已经把
 * 【命令 → 退出码】切成文本，但这份文本此前只进过状态栏的悬浮提示，模型一个字都没收到。
 * 这里补上消费的那半截：收到什么、截多长、脱敏，全在一个纯函数里，可单测。
 *
 * 为什么不注入输出正文：toAiContext 本身就只给命令与退出码（体积与脱敏都不合适），
 * 这里不越过那个决定。命令原文仍可能带口令（`mysql -p...`、`curl -H "Authorization: ..."`），
 * 所以进 prompt 前一律过 redactSecrets——与 supervisor 对 user 消息做的是同一件事。
 */
import { redactSecrets } from './providers/redact'

/** 注入预算：命令块再多也不该挤掉手册与长期记忆 */
export const TERMINAL_CONTEXT_CAP = 1600

export function buildTerminalContextBlock(raw?: string): string {
  const text = (raw ?? '').trim()
  if (!text) return ''
  const clipped =
    text.length > TERMINAL_CONTEXT_CAP
      ? `${text.slice(0, TERMINAL_CONTEXT_CAP)}\n...(命令块已截断)`
      : text
  return `\n\n[终端最近命令，只给命令与退出码，输出正文未附]\n${redactSecrets(clipped)}`
}
