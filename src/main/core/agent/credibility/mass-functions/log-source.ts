/**
 * 日志证据 Mass 函数（Source S1）
 *
 * 来源：日志分析（Drain3 模板匹配 + 来源先验）
 * 先验可信度：0.6（日志来源可能截断或缺失上下文）
 *
 * 设计依据（调研文档 §6.3.1）：
 * - Drain3 匹配度高 → 强证据支持可信
 * - 来源先验（如 /var/log/messages 比 /tmp/test.log 更可信）
 * - 保留基础无知 m(Θ)，避免过度自信
 *
 * Mass 函数设计：
 *   strength = 0.7 × drainMatch + 0.3 × sourcePrior
 *   m({T})  = 0.8 × strength
 *   m({¬T}) = 0.1 × (1 - strength)
 *   m(Θ)   = 1 - m({T}) - m({¬T})
 */

import {
  type MassFunction,
  TRUSTED,
  UNTRUSTED,
  createMassFunction,
} from '../ds-theory'

/** 日志证据来源 ID */
export const LOG_SOURCE_ID = 'log'

/** 日志证据来源名称 */
export const LOG_SOURCE_NAME = '日志证据'

/** 日志证据来源先验可信度 */
export const LOG_SOURCE_PRIOR = 0.6

/**
 * 日志证据输入
 */
export interface LogEvidenceInput {
  /** Drain3 模板匹配度 [0, 1] */
  drainMatch: number
  /** 来源先验可信度 [0, 1]（如不提供则使用默认 0.6） */
  sourcePrior?: number
}

/**
 * 创建日志证据 Mass 函数
 *
 * 公式：
 *   strength = 0.7 × drainMatch + 0.3 × sourcePrior
 *   m({T})  = 0.8 × strength           （支持可信的质量）
 *   m({¬T}) = 0.1 × (1 - strength)     （支持不可信的质量，日志很少直接证明不可信）
 *   m(Θ)   = 1 - m({T}) - m({¬T})     （无知部分，随 strength 降低而增大）
 *
 * @param evidence - 日志证据输入
 * @returns 日志证据 Mass 函数
 */
export function createLogMassFunction(evidence: LogEvidenceInput): MassFunction {
  const drainMatch = clamp01(evidence.drainMatch)
  const sourcePrior = clamp01(evidence.sourcePrior ?? LOG_SOURCE_PRIOR)

  // 综合日志证据强度
  const strength = 0.7 * drainMatch + 0.3 * sourcePrior

  // Mass 函数赋值
  const mT = 0.8 * strength
  const mNotT = 0.1 * (1 - strength)
  const mTheta = 1 - mT - mNotT

  return createMassFunction(
    LOG_SOURCE_ID,
    LOG_SOURCE_NAME,
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
