/**
 * terminal-context.ts —— 把终端命令块摘要注入 system prompt
 *
 * 职责：渲染进程的块收集器（terminal/block-model.ts 的 toAiContext）已经把
 * 【命令 → 退出码】切成文本，但这份文本此前只进过状态栏的悬浮提示，模型一个字都没收到。
 * 这里补上计划要求的两个消费端：给 AI 注入 system prompt、给审计落一条"这次带了几条命令"。
 * 两者都只碰命令，不碰输出正文；两者都不抛异常挡住对话。
 *
 * 为什么不注入输出正文：toAiContext 本身就只给命令与退出码（体积与脱敏都不合适），
 * 这里不越过那个决定。命令原文仍可能带口令（`mysql -p...`、`curl -H "Authorization: ..."`），
 * 所以进 prompt 前一律过 redactSecrets——与 supervisor 对 user 消息做的是同一件事。
 */
import { redactSecrets } from './providers/redact'
import type { AuditRepo } from '../../services/db/audit-repo'

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

/**
 * 审计消费端：记一条"这次对话把几条命令交给了模型"。
 * 只记条数与字符数，不记命令原文——审计表是给人翻的，而命令里可能带口令。
 * 开关（risk.auditAiDecision）与库可用性都由 AuditRepo.log 自己判，这里不重复决定；
 * 落不了库也不该挡住对话，所以只报结果、不抛异常。
 */
export function recordTerminalContextAudit(
  repo: AuditRepo,
  opts: { raw?: string; correlationId: string; sessionId?: string }
): { blocks: number; written: boolean } {
  const blocks = (opts.raw ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean).length
  if (blocks === 0) return { blocks: 0, written: false }
  const written = repo.log({
    category: 'ai_decision',
    action: 'AI 对话附带终端命令块',
    sessionId: opts.sessionId,
    details: { blocks, chars: (opts.raw ?? '').length, correlationId: opts.correlationId },
  })
  return { blocks, written }
}
