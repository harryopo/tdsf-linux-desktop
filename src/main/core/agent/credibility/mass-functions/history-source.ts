/**
 * 历史证据 Mass 函数（Source S5）
 *
 * 来源：历史决策（历史对话成功案例 / 决策历史库匹配度）
 * 展示名与先验的唯一来源：@shared/credibility（history → '历史证据' / 0.75）
 *
 * 设计依据（调研文档 §6.3.5）：
 * - 基于与历史案例的相似度 + 历史成功率
 * - 加权成功率：相似度越高权重越大
 *
 * Mass 函数设计（#106 B：先验真的进计算）：
 *   strength = weightedSuccessRate × sourcePrior   （默认 SOURCE_PRIORS.history）
 *   m({T})  = 0.65 × strength
 *   m({¬T}) = 0.25 × (1 - strength)
 *   m(Θ)   = 1 - m({T}) - m({¬T})
 *
 * 无历史案例时返回完全无知 m(Θ) = 1。
 * 旧实现在这里给 m({T})=0.1 的"乐观偏置"：没有案例也凭空投一份可信信念，
 * 而 #82 之后调用方已经不会再送空源，所以这条偏置既没有存在理由、
 * 又会在任何直接调用它的地方（审计、设置页试算）重新变成假信念。
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
const SOURCE_ID = 'history' as const

/**
 * 历史证据输入
 */
export interface HistoryEvidenceInput {
  /** 是否有历史案例 */
  hasCases: boolean
  /** 加权成功率 [0, 1]（按相似度加权的历史案例成功率） */
  weightedSuccessRate?: number
  /** 来源先验 [0, 1]（不提供则用 SOURCE_PRIORS.history） */
  sourcePrior?: number
}

/**
 * 创建历史证据 Mass 函数
 *
 * @param evidence - 历史证据输入
 * @returns 历史证据 Mass 函数
 */
export function createHistoryMassFunction(evidence: HistoryEvidenceInput): MassFunction {
  // 无历史案例：完全无知（不再凭空给 0.1 乐观偏置）
  if (!evidence.hasCases) {
    return createVacuousMassFunction(SOURCE_ID, FUSION_SOURCE_LABELS[SOURCE_ID])
  }

  const quality = clamp01(evidence.weightedSuccessRate ?? 0.5)
  const strength = applySourcePrior(
    quality,
    clamp01(evidence.sourcePrior ?? SOURCE_PRIORS[SOURCE_ID])
  )

  const mT = 0.65 * strength
  const mNotT = 0.25 * (1 - strength)
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
