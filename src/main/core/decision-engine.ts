/**
 * 决策推荐引擎
 *
 * 整合置信度、风险评估、证据链 → 生成 DecisionCard
 *
 * DecisionCard 是 TDSF 可信决策框架的核心输出，
 * 包含问题、假设、证据、置信度、风险、修复方案等完整信息，
 * 供 UI 展示和人工审核。
 */

import type { DecisionCard, Evidence } from '../../shared/models'
import { calculateEvidenceConfidence } from './confidence'
import { assessRisk } from './risk-engine'

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

  return {
    id: generateId(),
    problem,
    hypothesis,
    evidences,
    confidence,
    risk,
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
 * 生成唯一 ID（基于时间戳 + 随机数）
 * @returns 唯一 ID 字符串
 */
function generateId(): string {
  return `dc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
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
