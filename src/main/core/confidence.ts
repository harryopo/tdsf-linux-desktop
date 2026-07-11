/**
 * 置信度计算模块
 *
 * 核心公式：confidence = 0.7 × drainMatch + 0.3 × sourcePrior
 *
 * 来源先验可信度表：
 *   - log:       0.6（日志来源，可能截断或缺失上下文）
 *   - metric:    0.8（监控指标，数据可靠）
 *   - command:   0.9（命令输出，最可靠）
 *   - config:    0.7（配置文件，可能过时）
 *   - knowledge: 0.5（知识库，需额外验证）
 */

import type { Evidence, EvidenceSource } from '../../shared/models'

/** Drain3 模板匹配度权重 */
const DRAIN_WEIGHT = 0.7

/** 来源先验权重 */
const SOURCE_WEIGHT = 0.3

/** 来源先验可信度表 */
const SOURCE_PRIOR_TABLE: Record<EvidenceSource, number> = {
  log: 0.6,
  metric: 0.8,
  command: 0.9,
  config: 0.7,
  knowledge: 0.5
}

/**
 * 获取指定来源类型的先验可信度
 * @param source - 证据来源类型
 * @returns 先验可信度值 [0, 1]
 */
export function getSourcePrior(source: EvidenceSource): number {
  return SOURCE_PRIOR_TABLE[source]
}

/**
 * 根据公式计算置信度
 * 公式：confidence = 0.7 × drainMatch + 0.3 × sourcePrior
 * @param drainMatch - Drain3 模板匹配度 [0, 1]
 * @param sourcePrior - 来源先验可信度 [0, 1]
 * @returns 综合置信度 [0, 1]
 */
export function calculateConfidence(drainMatch: number, sourcePrior: number): number {
  const clampedDrain = clamp(drainMatch)
  const clampedPrior = clamp(sourcePrior)
  return clamp(DRAIN_WEIGHT * clampedDrain + SOURCE_WEIGHT * clampedPrior)
}

/**
 * 为证据计算置信度并返回带置信度的证据副本
 * 会自动根据证据来源填充 sourcePrior，并重算 confidence
 * @param evidence - 原始证据（confidence 字段会被重算）
 * @returns 带有计算后置信度的新证据对象
 */
export function calculateEvidenceConfidence(evidence: Evidence): Evidence {
  const prior = getSourcePrior(evidence.source)
  const confidence = calculateConfidence(evidence.drainMatch, prior)
  return {
    ...evidence,
    sourcePrior: prior,
    confidence
  }
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
