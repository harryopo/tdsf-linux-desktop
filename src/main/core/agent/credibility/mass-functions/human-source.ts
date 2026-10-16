/**
 * 人工证据 Mass 函数（Source S4）
 *
 * 来源：用户输入（人工决策标注 / 用户反馈 / Decision Card 标签）
 * 展示名与先验的唯一来源：@shared/credibility（human → '人工证据' / 0.9）
 *
 * 设计依据（调研文档 §6.3.4）：
 * - 人工标注通常最可信，但需考虑标注者间一致性
 * - 高一致性 + 高正比率 → 强支持可信
 * - 无标注时返回完全无知 m(Θ) = 1
 * - 使用 Fleiss' κ 衡量标注者一致性
 *
 * Mass 函数设计（#106 B：先验真的进计算）：
 *   quality  = 0.7 × positiveRate + 0.3 × agreement
 *   strength = quality × sourcePrior       （sourcePrior 默认 SOURCE_PRIORS.human）
 *   m({T})  = 0.85 × strength     （人工证据权重最高）
 *   m({¬T}) = 0.10 × (1 - strength)
 *   m(Θ)   = 1 - m({T}) - m({¬T})
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
const SOURCE_ID = 'human' as const

/**
 * 人工证据输入
 */
export interface HumanEvidenceInput {
  /** 是否有标注数据 */
  hasAnnotations: boolean
  /** 正标注比率 [0, 1]（正标注数 / 总标注数） */
  positiveRate?: number
  /** 标注者间一致性（Fleiss' κ）[0, 1] */
  agreement?: number
  /** 来源先验 [0, 1]（不提供则用 SOURCE_PRIORS.human） */
  sourcePrior?: number
}

/**
 * 创建人工证据 Mass 函数
 *
 * @param evidence - 人工证据输入
 * @returns 人工证据 Mass 函数
 */
export function createHumanMassFunction(evidence: HumanEvidenceInput): MassFunction {
  // 无标注数据：完全无知
  if (!evidence.hasAnnotations) {
    return createVacuousMassFunction(SOURCE_ID, FUSION_SOURCE_LABELS[SOURCE_ID])
  }

  const positiveRate = clamp01(evidence.positiveRate ?? 0.5)
  const agreement = clamp01(evidence.agreement ?? 0.5)

  // 标注自身给出的质量，再按"人工标注这个源本来值多少"折一道（标注者偏差）
  const quality = 0.7 * positiveRate + 0.3 * agreement
  const strength = applySourcePrior(
    quality,
    clamp01(evidence.sourcePrior ?? SOURCE_PRIORS[SOURCE_ID])
  )

  const mT = 0.85 * strength
  const mNotT = 0.1 * (1 - strength)
  const mTheta = 1 - mT - mNotT

  return createMassFunction(
    SOURCE_ID,
    FUSION_SOURCE_LABELS[SOURCE_ID],
    [
      { elements: new Set<string>([TRUSTED]), mass: mT },
      { elements: new Set<string>([UNTRUSTED]), mass: mNotT },
      { elements: new Set<string>([TRUSTED, UNTRUSTED]), mass: mTheta },
    ],
    strength
  )
}

/** 将数值限制在 [0, 1] 范围内 */
function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(1, Math.max(0, value))
}
