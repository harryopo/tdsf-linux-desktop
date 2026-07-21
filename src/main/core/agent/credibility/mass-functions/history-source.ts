/**
 * 历史证据 Mass 函数（Source S5）
 *
 * 来源：历史决策（历史对话成功案例 / 决策历史库匹配度）
 * 先验可信度：0.75（历史案例有参考价值，但场景可能不完全一致）
 *
 * 设计依据（调研文档 §6.3.5）：
 * - 基于与历史案例的相似度 + 历史成功率
 * - 加权成功率：相似度越高权重越大
 * - 无历史案例时返回高无知 m(Θ) = 0.9, m({T}) = 0.1
 *
 * Mass 函数设计：
 *   strength = weightedSuccessRate
 *   m({T})  = 0.65 × strength
 *   m({¬T}) = 0.25 × (1 - strength)
 *   m(Θ)   = 1 - m({T}) - m({¬T})
 */

import {
  type MassFunction,
  TRUSTED,
  UNTRUSTED,
  createMassFunction,
} from '../ds-theory'

/** 历史证据来源 ID */
export const HISTORY_SOURCE_ID = 'history'

/** 历史证据来源名称 */
export const HISTORY_SOURCE_NAME = '历史证据'

/** 历史证据来源先验可信度 */
export const HISTORY_SOURCE_PRIOR = 0.75

/**
 * 历史证据输入
 */
export interface HistoryEvidenceInput {
  /** 是否有历史案例 */
  hasCases: boolean
  /** 加权成功率 [0, 1]（按相似度加权的历史案例成功率） */
  weightedSuccessRate?: number
}

/**
 * 创建历史证据 Mass 函数
 *
 * 公式：
 *   无案例时：m(Θ) = 0.9, m({T}) = 0.1（高度无知，但保留少量乐观偏置）
 *   有案例时：
 *     strength = weightedSuccessRate
 *     m({T})  = 0.65 × strength
 *     m({¬T}) = 0.25 × (1 - strength)
 *     m(Θ)   = 1 - m({T}) - m({¬T})
 *
 * @param evidence - 历史证据输入
 * @returns 历史证据 Mass 函数
 */
export function createHistoryMassFunction(evidence: HistoryEvidenceInput): MassFunction {
  // 无历史案例：高度无知 + 少量乐观偏置
  if (!evidence.hasCases) {
    return createMassFunction(
      HISTORY_SOURCE_ID,
      HISTORY_SOURCE_NAME,
      [
        { elements: new Set<string>([TRUSTED]), mass: 0.1 },
        { elements: new Set<string>([TRUSTED, UNTRUSTED]), mass: 0.9 },
      ],
      0.1
    )
  }

  const strength = clamp01(evidence.weightedSuccessRate ?? 0.5)

  const mT = 0.65 * strength
  const mNotT = 0.25 * (1 - strength)
  const mTheta = 1 - mT - mNotT

  return createMassFunction(
    HISTORY_SOURCE_ID,
    HISTORY_SOURCE_NAME,
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
