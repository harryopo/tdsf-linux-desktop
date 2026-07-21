/**
 * 知识库证据 Mass 函数（Source S2）
 *
 * 来源：知识库检索（ChromaDB 向量检索相似度）
 * 先验可信度：0.5（知识库需额外验证，可能过时或不完全匹配）
 *
 * 设计依据（调研文档 §6.3.2）：
 * - 基于 ChromaDB top-k 相似度分数
 * - 高相似度 + 高一致性 → 支持可信
 * - 无匹配结果时返回完全无知 m(Θ) = 1
 *
 * Mass 函数设计：
 *   consistency = 1 - |topScore - avgScore|    （top-3 一致性）
 *   strength = 0.6 × topScore + 0.4 × consistency
 *   m({T})  = 0.7 × strength
 *   m({¬T}) = 0.2 × (1 - strength)
 *   m(Θ)   = 1 - m({T}) - m({¬T})
 */

import {
  type MassFunction,
  TRUSTED,
  UNTRUSTED,
  createMassFunction,
  createVacuousMassFunction,
} from '../ds-theory'

/** 知识库证据来源 ID */
export const KB_SOURCE_ID = 'kb'

/** 知识库证据来源名称 */
export const KB_SOURCE_NAME = '知识库匹配'

/** 知识库证据来源先验可信度 */
export const KB_SOURCE_PRIOR = 0.5

/**
 * 知识库证据输入
 */
export interface KbEvidenceInput {
  /** 是否有检索结果 */
  hasResults: boolean
  /** top-1 相似度分数 [0, 1]（无结果时忽略） */
  topScore?: number
  /** top-3 平均相似度 [0, 1]（无结果时忽略） */
  avgScore?: number
}

/**
 * 创建知识库证据 Mass 函数
 *
 * 公式：
 *   无结果时：m(Θ) = 1（完全无知）
 *   有结果时：
 *     consistency = 1 - |topScore - avgScore|
 *     strength = 0.6 × topScore + 0.4 × consistency
 *     m({T})  = 0.7 × strength
 *     m({¬T}) = 0.2 × (1 - strength)
 *     m(Θ)   = 1 - m({T}) - m({¬T})
 *
 * @param evidence - 知识库证据输入
 * @returns 知识库证据 Mass 函数
 */
export function createKbMassFunction(evidence: KbEvidenceInput): MassFunction {
  // 无检索结果：完全无知
  if (!evidence.hasResults) {
    return createVacuousMassFunction(KB_SOURCE_ID, KB_SOURCE_NAME)
  }

  const topScore = clamp01(evidence.topScore ?? 0)
  const avgScore = clamp01(evidence.avgScore ?? topScore)

  // top-3 一致性：top 与 avg 差距越小，一致性越高
  const consistency = clamp01(1 - Math.abs(topScore - avgScore))

  // 综合知识库证据强度
  const strength = 0.6 * topScore + 0.4 * consistency

  const mT = 0.7 * strength
  const mNotT = 0.2 * (1 - strength)
  const mTheta = 1 - mT - mNotT

  return createMassFunction(
    KB_SOURCE_ID,
    KB_SOURCE_NAME,
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
