/**
 * 知识库证据 Mass 函数（Source S2）
 *
 * 来源：知识库检索（ChromaDB 向量检索相似度）
 * 展示名与先验的唯一来源：@shared/credibility（knowledge → '知识库匹配' / 0.5）
 *
 * 设计依据（调研文档 §6.3.2）：
 * - 基于 ChromaDB top-k 相似度分数
 * - 高相似度 + 高一致性 → 支持可信
 * - 无匹配结果时返回完全无知 m(Θ) = 1
 *
 * Mass 函数设计（#106 B：先验真的进计算）：
 *   quality    = 0.6 × topScore + 0.4 × consistency
 *   strength   = quality × sourcePrior        （sourcePrior 默认 SOURCE_PRIORS.knowledge）
 *   m({T})  = 0.7 × strength
 *   m({¬T}) = 0.2 × (1 - strength)
 *   m(Θ)   = 1 - m({T}) - m({¬T})
 *
 * 改名说明：这一档原来叫 'kb'，与业务侧证据类别 'knowledge'、审计侧 'S2-knowledge'
 * 是三套名字指同一个源；本仓现在只用一个 id（knowledge）。
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
const SOURCE_ID = 'knowledge' as const

/**
 * 知识库证据输入
 */
export interface KnowledgeEvidenceInput {
  /** 是否有检索结果 */
  hasResults: boolean
  /** top-1 相似度分数 [0, 1]（无结果时忽略） */
  topScore?: number
  /** top-3 平均相似度 [0, 1]（无结果时忽略） */
  avgScore?: number
  /** 来源先验 [0, 1]（不提供则用 SOURCE_PRIORS.knowledge） */
  sourcePrior?: number
}

/**
 * 创建知识库证据 Mass 函数
 *
 * 公式：
 *   无结果时：m(Θ) = 1（完全无知）
 *   有结果时：
 *     consistency = 1 - |topScore - avgScore|
 *     quality  = 0.6 × topScore + 0.4 × consistency
 *     strength = quality × sourcePrior（默认 0.5）
 *     m({T})  = 0.7 × strength
 *     m({¬T}) = 0.2 × (1 - strength)
 *     m(Θ)   = 1 - m({T}) - m({¬T})
 *
 * @param evidence - 知识库证据输入
 * @returns 知识库证据 Mass 函数
 */
export function createKnowledgeMassFunction(evidence: KnowledgeEvidenceInput): MassFunction {
  // 无检索结果：完全无知
  if (!evidence.hasResults) {
    return createVacuousMassFunction(SOURCE_ID, FUSION_SOURCE_LABELS[SOURCE_ID])
  }

  const topScore = clamp01(evidence.topScore ?? 0)
  const avgScore = clamp01(evidence.avgScore ?? topScore)

  // top-3 一致性：top 与 avg 差距越小，一致性越高
  const consistency = clamp01(1 - Math.abs(topScore - avgScore))

  // 检索自身给出的质量，再按"知识库这个源本来值多少"折一道
  const quality = 0.6 * topScore + 0.4 * consistency
  const strength = applySourcePrior(
    quality,
    clamp01(evidence.sourcePrior ?? SOURCE_PRIORS[SOURCE_ID])
  )

  const mT = 0.7 * strength
  const mNotT = 0.2 * (1 - strength)
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
