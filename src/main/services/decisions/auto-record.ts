/**
 * 命令执行的自动决策记录
 *
 * 背景（2026-10-29 用户实测）：历史决策页永远是空的。原来的唯一生产者是渲染层
 * 「用户点一下命令卡上的执行按钮」那条路径，AI 自己在对话里跑掉的诊断/修复命令
 * 一条都不进库——用户看到的就是"记录决策还得手动记录"。
 *
 * 这里把"已经在远端真实执行过的命令"当场记成一张决策卡：
 *   - 证据 = 这条命令的真实输出（verified=true，因为它是刚跑出来的现场数据）
 *   - 风险 = 命令闸对同一条命令的判定（与执行时的闸同一份规则）
 *   - 状态 = 退出码 0 → executed；非 0 → failed
 *
 * 三条硬约束：
 * 1. 绝不抛异常：记录失败只写日志，不能反过来让用户那条命令失败；
 * 2. 去重：同一会话里 60 秒内重复的同一条命令只记一次（模型重试/流式重放很常见）；
 * 3. block 级命令不记：它们没有真的执行，记成"已执行"就是撒谎。
 */
import { randomUUID } from 'node:crypto'
import type { DecisionCard, Evidence } from '@shared/models'
import { DatabaseManager } from '../db/database'
import { DecisionRepository } from '../db/decision-repo'
import { DecisionAuditRepository } from '../db/decision-audit'
import { buildAuditEvents, generateDecisionCard, validateDecision } from '../../core/decision-engine'
import { calculateEvidenceConfidence } from '../../core/confidence'
import { evaluateCommand } from '../../core/command-gate'
import { redactSecrets } from '../../core/agent/providers/redact'
import { logger } from '../log/logger'

/** 同一条命令在这段时间内重复出现只记一次 */
const DEDUPE_WINDOW_MS = 60_000
/** 证据正文上限：命令输出可能几十 KB，决策卡不是日志仓库 */
const EVIDENCE_TEXT_LIMIT = 2_000

export interface AutoDecisionInput {
  /** 实际执行的命令 */
  command: string
  /** 执行结果退出码；null/undefined = 没有拿到（例如连接异常） */
  exitCode?: number | null
  /** 命令输出（stdout+stderr）；会截断并脱敏后进证据 */
  output?: string
  /** 用户当时的诉求；缺省时用命令本身描述 */
  problem?: string
  /** 这条命令是谁跑的：对话里的只读/写工具，或 PAOR 循环 */
  source: 'chat_readonly' | 'chat_write' | 'paor'
  sessionId?: string | null
  serverId?: string | null
  /** 执行耗时（毫秒） */
  durationMs?: number
}

/** key = sessionId|command，value = 上次记录时刻 */
const lastRecordedAt = new Map<string, number>()

/** 仅测试用：清空去重表 */
export function resetAutoDecisionDedupe(): void {
  lastRecordedAt.clear()
}

function truncate(text: string): string {
  if (text.length <= EVIDENCE_TEXT_LIMIT) return text
  return `${text.slice(0, EVIDENCE_TEXT_LIMIT)}\n…（输出过长，已截断）`
}

function describeProblem(input: AutoDecisionInput): string {
  const asked = (input.problem ?? '').trim()
  if (asked) return asked.slice(0, 500)
  return input.source === 'paor' ? '自主循环执行运维任务' : '对话中执行运维命令'
}

/**
 * 记录一条自动决策
 *
 * @returns 写入成功返回卡片 id；被跳过（去重/block/校验不过/库不可用）返回 null
 */
export function recordAutoDecision(input: AutoDecisionInput): string | null {
  try {
    if (!input.command.trim()) return null

    const gate = evaluateCommand(input.command)
    if (gate.level === 'block') {
      // 没有真的执行过的东西不进决策账
      return null
    }

    const dedupeKey = `${input.sessionId ?? 'unknown'}|${input.command}`
    const now = Date.now()
    const prev = lastRecordedAt.get(dedupeKey)
    if (prev !== undefined && now - prev < DEDUPE_WINDOW_MS) return null
    lastRecordedAt.set(dedupeKey, now)
    // 去重表不能无限长：顺手清掉窗口外的旧键
    if (lastRecordedAt.size > 200) {
      for (const [key, ts] of lastRecordedAt) {
        if (now - ts >= DEDUPE_WINDOW_MS) lastRecordedAt.delete(key)
      }
    }

    const outputText = truncate(redactSecrets(input.output ?? '').trim())
    const evidence: Evidence = calculateEvidenceConfidence({
      id: randomUUID(),
      source: 'command',
      sourceDetail: input.serverId ? `远程执行 · 服务器 ${input.serverId}` : '远程执行 · 当前会话',
      content: outputText
        ? `$ ${input.command}\n${outputText}`
        : `$ ${input.command}\n（无输出）`,
      drainMatch: null,
      sourcePrior: 0,
      confidence: 0,
      timestamp: now,
      // 这条证据是刚跑出来的现场输出，不是从别处抄来的
      verified: true,
    })

    const card = generateDecisionCard(
      describeProblem(input),
      `执行「${input.command}」获取真实运行数据，以推进当前任务`,
      [evidence],
      input.command,
      input.source === 'chat_write' ? '写操作命令（用户已批准）' : '命令已在本机实际执行',
    )
    card.status = input.exitCode === 0 ? 'executed' : 'failed'
    card.timestamp = now
    if (input.sessionId) card.sessionId = input.sessionId
    if (input.serverId) card.serverId = input.serverId
    if (typeof input.durationMs === 'number') card.durationMs = input.durationMs

    return persist(card)
  } catch (err) {
    logger.warn('Decision', '自动决策记录失败（不影响命令执行）', {
      command: input.command.slice(0, 120),
      error: (err as Error).message,
    })
    return null
  }
}

/** 落库 + 写审计链；任何一步失败都只记日志 */
function persist(card: DecisionCard): string | null {
  const check = validateDecision(card)
  if (!check.valid) {
    logger.warn('Decision', '自动决策未通过落库校验', { id: card.id, issues: check.issues })
    return null
  }
  const db = DatabaseManager.getInstance()
  if (!new DecisionRepository(db).save(card)) {
    logger.warn('Decision', '自动决策落库失败', { id: card.id, command: card.fixCommand.slice(0, 120) })
    return null
  }
  const raw = db.getRawConnection()
  if (raw) {
    try {
      new DecisionAuditRepository(raw).append(card.id, buildAuditEvents(card))
    } catch (err) {
      logger.warn('Decision', '自动决策审计链写入失败', { id: card.id, error: (err as Error).message })
    }
  }
  logger.info('Decision', '自动决策已记录', {
    id: card.id,
    status: card.status,
    command: card.fixCommand.slice(0, 120),
  })
  return card.id
}
