/**
 * 置信度计算模块
 *
 * 两条口径（同一条证据只走其中一条，见 calculateEvidenceConfidence）：
 *   - 有模板匹配度：confidence = 0.7 × drainMatch + 0.3 × sourcePrior
 *   - drainMatch = null（命令/指标这类结构化事实没有"像不像模板"这一维）：confidence = sourcePrior
 * 第二行不是"少算一维就更不确定"，而是"那一维不存在就别编一个数填进去"。
 *
 * 来源先验可信度表：唯一一份在 @shared/credibility 的 EVIDENCE_CATEGORY_PRIORS
 *   - log:       0.6（日志来源，可能截断或缺失上下文）
 *   - metric:    0.8（监控指标，数据可靠）
 *   - command:   0.9（命令输出，最可靠）
 *   - config:    0.7（配置文件，可能过时）
 *   - knowledge: 0.5（知识库，需额外验证）
 * 本模块不再自己抄一份——渲染层以前抄过，两份数从此各说各话（#106）。
 */

import type { Evidence, EvidenceSource } from '../../shared/models'
import { evidencePriorOf } from '@shared/credibility'

/** Drain3 模板匹配度权重 */
const DRAIN_WEIGHT = 0.7

/** 来源先验权重 */
const SOURCE_WEIGHT = 0.3

/**
 * 获取指定来源类型的先验可信度
 * @param source - 证据来源类型
 * @returns 先验可信度值 [0, 1]
 */
export function getSourcePrior(source: EvidenceSource): number {
  return evidencePriorOf(source)
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
 *
 * 两条口径，取决于"模板匹配"这一维存不存在：
 *   - 有匹配度（日志类）：confidence = 0.7 × drainMatch + 0.3 × sourcePrior
 *   - 没有这一维（drainMatch = null，命令/指标这类结构化事实）：confidence = sourcePrior
 *
 * 为什么第二行不是"补个默认匹配度"：补出来的那个数（以前是写死的 0.8）会占掉公式里 70% 的权重，
 * 于是界面上那条置信度大部分来自一个没人测过的常数。宁可少一维，不要假一维。
 *
 * @param evidence - 原始证据（confidence 字段会被重算）
 * @returns 带有计算后置信度的新证据对象
 */
export function calculateEvidenceConfidence(evidence: Evidence): Evidence {
  const prior = getSourcePrior(evidence.source)
  const confidence =
    evidence.drainMatch === null ? clamp(prior) : calculateConfidence(evidence.drainMatch, prior)
  return {
    ...evidence,
    sourcePrior: prior,
    confidence
  }
}

/** 这条证据的置信度是按哪条口径算出来的（判据与界面文案都用它，别各处自己拼一套说法） */
export type ConfidenceBasis = 'template-match' | 'source-prior'

export function getConfidenceBasis(evidence: Evidence): ConfidenceBasis {
  return evidence.drainMatch === null ? 'source-prior' : 'template-match'
}

export const CONFIDENCE_BASIS_TEXT: Record<ConfidenceBasis, string> = {
  'template-match': '按日志模板匹配度算',
  'source-prior': '这类证据没有模板维度，按来源先验算'
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
