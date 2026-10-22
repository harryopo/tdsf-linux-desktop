/**
 * 决策推荐引擎
 *
 * 整合置信度、风险评估、证据链 → 生成 DecisionCard
 *
 * DecisionCard 是 TDSF 可信决策框架的核心输出，
 * 包含问题、假设、证据、置信度、风险、修复方案等完整信息，
 * 供 UI 展示和人工审核。
 */

import { randomUUID } from 'node:crypto'
import type { DecisionAuditEvent, DecisionCard, Evidence, EvidenceSource } from '../../shared/models'
import { calculateEvidenceConfidence } from './confidence'
import { assessRisk } from './risk-engine'
import { computeTrident, inferTridentSource } from './agent/trident-decision'

/**
 * 生成决策卡片
 *
 * 整合证据链置信度 + 修复命令风险评估，生成完整的决策卡片。
 * 卡片初始状态为 pending，等待人工审核。
 *
 * @param problem - 问题描述
 * @param hypothesis - 根因假设
 * @param evidences - 证据链
 * @param fixCommand - 修复命令
 * @param fixDescription - 修复说明（可选，不传则自动生成）
 * @param rollbackCommand - 回滚命令（可选）
 * @returns 决策卡片
 */
export function generateDecisionCard(
  problem: string,
  hypothesis: string,
  evidences: Evidence[],
  fixCommand: string,
  fixDescription?: string,
  rollbackCommand?: string
): DecisionCard {
  const confidence = calculateOverallConfidence(evidences)
  const risk = assessRisk(fixCommand)

  // Trident 三叉决策评分（借鉴 claw-code §3.1）
  const trident = computeTrident({ risk, evidences, fixCommand })

  return {
    id: generateId(),
    problem,
    hypothesis,
    evidences,
    confidence,
    risk,
    // Trident 三叉评分（可空，旧决策卡无此字段时 UI 优雅降级）
    trident: {
      ...trident,
      source: inferTridentSource(),
    },
    fixCommand,
    fixDescription: fixDescription || `执行命令：${fixCommand}`,
    rollbackCommand,
    status: 'pending',
    timestamp: Date.now()
  }
}

/**
 * 计算证据链的综合置信度
 *
 * 使用加权平均：每条证据的置信度 × 该证据的验证权重
 *   - 通过溯源验证的证据权重为 1.0
 *   - 未通过验证的证据权重为 0.3（降低但不完全排除）
 *
 * @param evidences - 证据列表
 * @returns 综合置信度 [0, 1]
 */
export function calculateOverallConfidence(evidences: Evidence[]): number {
  if (evidences.length === 0) return 0

  let totalWeight = 0
  let weightedSum = 0

  for (const evidence of evidences) {
    const computed = calculateEvidenceConfidence(evidence)
    // 通过验证的证据权重为 1，未通过验证的权重为 0.3
    const weight = computed.verified ? 1 : 0.3
    totalWeight += weight
    weightedSum += computed.confidence * weight
  }

  if (totalWeight === 0) return 0
  return clamp(weightedSum / totalWeight)
}

/**
 * 验证决策卡片的完整性和合理性
 *
 * 检查项：
 *   - 必填字段是否为空（问题、假设、修复命令、证据）
 *   - 证据是否全部未通过验证
 *   - 置信度是否在有效范围
 *   - CRITICAL 风险命令是否应被阻止
 *   - 低置信度警告
 *
 * @param card - 决策卡片
 * @returns 验证结果，包含是否有效和问题列表
 */
export function validateDecision(card: DecisionCard): { valid: boolean; issues: string[] } {
  const issues: string[] = []

  if (!card.problem.trim()) issues.push('问题描述为空')
  if (!card.hypothesis.trim()) issues.push('根因假设为空')
  if (!card.fixCommand.trim()) issues.push('修复命令为空')
  if (card.evidences.length === 0) issues.push('无证据支持')

  // 检查证据是否全部未通过验证
  const unverifiedCount = card.evidences.filter((e) => !e.verified).length
  if (card.evidences.length > 0 && unverifiedCount === card.evidences.length) {
    issues.push('所有证据均未通过溯源验证')
  }

  // 检查置信度范围
  if (card.confidence < 0 || card.confidence > 1) {
    issues.push('置信度超出有效范围 [0, 1]')
  }

  // CRITICAL 风险应阻止执行
  if (card.risk.level === 'CRITICAL') {
    issues.push('修复命令为 CRITICAL 风险，应阻止执行')
  }

  // 低置信度警告
  if (card.confidence < 0.5 && card.evidences.length > 0) {
    issues.push('置信度过低，建议补充证据')
  }

  return { valid: issues.length === 0, issues }
}

/**
 * 证据来源 → 审计行里的"谁做的"
 *
 * 名字来自卡片里那条证据自己的 source 字段（采集器写进去的），不是这里猜的。
 * 表外的来源就照原样落，宁可写得不好看也不编一个像样的名字。
 */
const EVIDENCE_ACTOR: Record<EvidenceSource, string> = {
  command: 'SSH Executor',
  log: 'Log Collector',
  metric: 'Monitor',
  config: 'Config Reader',
  knowledge: 'Knowledge Base',
}

/**
 * 把一张决策卡拆成审计事件（任务 #174）
 *
 * 时间口径是关键：证据那几行用的是**证据自己的采集时刻**（可能是几分钟前），
 * 风险评估与批准/执行那几行用的是**卡片落库这一刻**——因为它们在主进程就是这一刻发生的。
 * 界面上"事件当场落库"指的是行里的时间戳来自事件本身，不是"每一行都在事件发生的当刻写入"；
 * 唯一在写库之后才发生的事（人工确认之后的执行结果）等它自己那条链路补行。
 *
 * status 六个值都要有对应行：`history:save` 只写 pending / executed，
 * 其余状态一旦出现（回滚、验证、拒绝）也必须留下话，而不是静默少一行。
 */
export function buildAuditEvents(card: DecisionCard): DecisionAuditEvent[] {
  const events: DecisionAuditEvent[] = []

  for (const ev of [...card.evidences].sort((a, b) => a.timestamp - b.timestamp)) {
    events.push({
      actor: EVIDENCE_ACTOR[ev.source] ?? String(ev.source),
      action: `证据落定 · ${(ev.sourceDetail || ev.source).slice(0, 60)}`,
      result: ev.verified ? 'passed' : 'completed',
      timestamp: ev.timestamp,
    })
  }

  events.push({
    actor: 'Risk Engine',
    action: `风险评估 · ${card.risk.level} · ${card.risk.score} 分`,
    result: card.risk.blocked ? 'blocked' : 'completed',
    timestamp: card.timestamp,
  })

  switch (card.status) {
    case 'rejected':
      events.push({
        actor: 'Engineer',
        action: '人工拒绝 · 命令未执行',
        result: 'blocked',
        timestamp: card.timestamp,
      })
      break
    case 'pending':
      events.push({
        actor: 'Engineer',
        action: card.risk.requireConfirmation ? '等待人工确认 · 命令未发出' : '待触发 · 命令未发出',
        result: 'waiting',
        timestamp: card.timestamp,
      })
      break
    case 'approved':
      events.push({
        actor: 'Engineer',
        action: '人工批准 · 命令尚未发出',
        result: 'completed',
        timestamp: card.timestamp,
      })
      break
    case 'executed':
    case 'verified':
    case 'failed':
      events.push({
        actor: 'Engineer',
        action: '人工批准 · 确认执行',
        result: 'completed',
        timestamp: card.timestamp,
      })
      events.push({
        actor: 'Executor',
        action: `发送终端 · ${card.fixCommand.slice(0, 60)}`,
        result: card.status === 'failed' ? 'failed' : 'completed',
        timestamp: card.timestamp,
      })
      break
  }

  return events
}

/**
 * 生成唯一 ID（基于时间戳 + 随机数）
 * @returns 唯一 ID 字符串
 */
function generateId(): string {
  return `dc_${Date.now()}_${randomUUID().slice(0, 8)}`
}

/**
 * 将数值限制在 [0, 1] 范围内
 * @param value - 输入值
 * @returns 限制后的值，NaN 视为 0
 */
function clamp(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(1, Math.max(0, value))
}
