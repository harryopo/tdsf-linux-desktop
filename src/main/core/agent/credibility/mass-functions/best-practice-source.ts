/**
 * 最佳实践证据 Mass 函数（Source S6）
 *
 * 来源：最佳实践库（YAML 规则库匹配 / 运维规范校验）
 * 先验可信度：0.8（最佳实践规则权威性较高，但可能未覆盖所有场景）
 *
 * 设计依据（调研文档 §6.3.6）：
 * - 基于 YAML 规则库的匹配结果
 * - 规则匹配度：approve / reject / 未覆盖
 * - 允许规则同时支持可信和不可信（双方向证据）
 * - 无匹配规则时 m(Θ) = 0.8, m({T}) = 0.2（高度无知 + 少量乐观偏置）
 *
 * Mass 函数设计：
 *   m({T})  = 0.7 × positiveRate     （approve 规则支持可信）
 *   m({¬T}) = 0.7 × negativeRate     （reject 规则支持不可信）
 *   m(Θ)   = 1 - m({T}) - m({¬T})   （未覆盖部分归为无知）
 *
 * 注：positiveRate + negativeRate ≤ 1，剩余部分为未覆盖规则，
 * 体现为 m(Θ) 的无知质量。
 */

import {
  type MassFunction,
  TRUSTED,
  UNTRUSTED,
  createMassFunction,
} from '../ds-theory'

/** 最佳实践证据来源 ID */
export const BEST_PRACTICE_SOURCE_ID = 'best-practice'

/** 最佳实践证据来源名称 */
export const BEST_PRACTICE_SOURCE_NAME = '最佳实践证据'

/** 最佳实践证据来源先验可信度 */
export const BEST_PRACTICE_SOURCE_PRIOR = 0.8

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
}

/**
 * 创建最佳实践证据 Mass 函数
 *
 * 公式：
 *   无匹配时：m(Θ) = 0.8, m({T}) = 0.2（高度无知 + 少量乐观偏置）
 *   有匹配时：
 *     m({T})  = 0.7 × positiveRate     （approve 规则支持可信）
 *     m({¬T}) = 0.7 × negativeRate     （reject 规则支持不可信）
 *     m(Θ)   = 1 - m({T}) - m({¬T})   （未覆盖部分归为无知）
 *
 * 特点：与其他源不同，最佳实践规则可同时产生 m({T}) 和 m({¬T})，
 * 即规则库可以既包含 approve 规则又包含 reject 规则。
 *
 * @param evidence - 最佳实践证据输入
 * @returns 最佳实践证据 Mass 函数
 */
export function createBestPracticeMassFunction(evidence: BestPracticeEvidenceInput): MassFunction {
  // 无规则匹配：高度无知 + 少量乐观偏置
  if (!evidence.hasMatches) {
    return createMassFunction(
      BEST_PRACTICE_SOURCE_ID,
      BEST_PRACTICE_SOURCE_NAME,
      [
        { elements: new Set<string>([TRUSTED]), mass: 0.2 },
        { elements: new Set<string>([TRUSTED, UNTRUSTED]), mass: 0.8 },
      ],
      0.2
    )
  }

  const posRate = clamp01(evidence.positiveRate ?? 0)
  const negRate = clamp01(evidence.negativeRate ?? 0)

  // 规则匹配度：approve 和 reject 规则各按 0.7 系数分配质量
  const mT = 0.7 * posRate
  const mNotT = 0.7 * negRate
  // 未覆盖部分归为无知（确保 positiveRate + negativeRate ≤ 1，mTheta ≥ 0.3）
  const mTheta = Math.max(0, 1 - mT - mNotT)

  // 综合置信度：approve 占比
  const total = posRate + negRate
  const confidence = total > 0 ? posRate / total : 0.5

  return createMassFunction(
    BEST_PRACTICE_SOURCE_ID,
    BEST_PRACTICE_SOURCE_NAME,
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
