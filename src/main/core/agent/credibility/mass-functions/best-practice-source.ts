/**
 * 最佳实践证据 Mass 函数（Source S6）
 *
 * 来源：最佳实践库（YAML 规则库匹配 / 运维规范校验）
 * 展示名与先验的唯一来源：@shared/credibility（best-practice → '最佳实践证据' / 0.8）
 *
 * 设计依据（调研文档 §6.3.6）：
 * - 基于 YAML 规则库的匹配结果
 * - 规则匹配度：approve / reject / 未覆盖
 * - 允许规则同时支持可信和不可信（双方向证据）
 *
 * Mass 函数设计（#106 B：先验真的进计算）：
 *   m({T})  = 0.7 × (positiveRate × sourcePrior)     （approve 规则支持可信）
 *   m({¬T}) = 0.7 × (negativeRate × sourcePrior)     （reject 规则支持不可信）
 *   m(Θ)   = 1 - m({T}) - m({¬T})                    （未覆盖部分归为无知）
 *
 * 注：positiveRate + negativeRate ≤ 1，剩余部分为未覆盖规则，体现为 m(Θ) 的无知质量。
 * 先验对两个方向同比例折扣，所以"approve 占比"这个 confidence 读数不受影响。
 *
 * 无匹配规则时返回完全无知 m(Θ) = 1（旧实现给 m({T})=0.2 的凭空乐观偏置，
 * 与 history 档同一个毛病，一并去掉）。
 */

import {
  type MassFunction,
  TRUSTED,
  UNTRUSTED,
  createMassFunction,
  createVacuousMassFunction,
} from '../ds-theory'
import { FUSION_SOURCE_LABELS, SOURCE_PRIORS, applySourcePrior } from '@shared/credibility'

/** 本档源 ID */
const SOURCE_ID = 'best-practice' as const

/**
 * 最佳实践证据输入
 */
export interface BestPracticeEvidenceInput {
  /** 是否有规则匹配 */
  hasMatches: boolean
  /** approve 规则比率 [0, 1]（approve 数 / 总匹配数） */
  positiveRate?: number
  /** reject 规则比率 [0, 1]（reject 数 / 总匹配数） */
  negativeRate?: number
  /** 来源先验 [0, 1]（不提供则用 SOURCE_PRIORS[best-practice]） */
  sourcePrior?: number
}

/**
 * 创建最佳实践证据 Mass 函数
 *
 * @param evidence - 最佳实践证据输入
 * @returns 最佳实践证据 Mass 函数
 */
export function createBestPracticeMassFunction(
  evidence: BestPracticeEvidenceInput
): MassFunction {
  const prior = clamp01(evidence.sourcePrior ?? SOURCE_PRIORS[SOURCE_ID])

  // 无规则匹配：完全无知（不再凭空给 0.2 乐观偏置）
  if (!evidence.hasMatches) {
    return createVacuousMassFunction(SOURCE_ID, FUSION_SOURCE_LABELS[SOURCE_ID])
  }

  // 两个方向都按该源先验折一道，折扣比例一致
  const mT = 0.7 * applySourcePrior(clamp01(evidence.positiveRate ?? 0), prior)
  const mNotT = 0.7 * applySourcePrior(clamp01(evidence.negativeRate ?? 0), prior)
  // 未覆盖部分归为无知（确保 positiveRate + negativeRate ≤ 1，mTheta ≥ 0.3）
  const mTheta = Math.max(0, 1 - mT - mNotT)

  // 综合置信度：approve 占比（先验同比例折扣两个方向，不影响这个比值）
  const posRate = clamp01(evidence.positiveRate ?? 0)
  const negRate = clamp01(evidence.negativeRate ?? 0)
  const total = posRate + negRate
  const confidence = total > 0 ? posRate / total : 0.5

  return createMassFunction(
    SOURCE_ID,
    FUSION_SOURCE_LABELS[SOURCE_ID],
    [
      { elements: new Set<string>([TRUSTED]), mass: mT },
      { elements: new Set<string>([UNTRUSTED]), mass: mNotT },
      { elements: new Set<string>([TRUSTED, UNTRUSTED]), mass: mTheta },
    ],
    confidence
  )
}

/** 将数值限制在 [0, 1] 范围内 */
function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(1, Math.max(0, value))
}
