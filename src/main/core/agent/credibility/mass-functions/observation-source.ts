/**
 * 直接观测证据 Mass 函数（新增档，补原设计的洞）
 *
 * 来源：命令真实执行后的退出码与输出、监控指标读数、配置文件读数。
 * 展示名与先验的唯一来源：@shared/credibility（observation → '直接观测证据' / 0.9）
 *
 * 为什么原来 6 源装不下它：
 * 六源里最接近的是 log（日志模板匹配度）和 history（历史案例），但
 * "df -h 跑完了、退出码 0、输出就摆在这"既不是模板匹配也不是案例复用，
 * 它是系统给的事实。旧映射把 command 说成 human（"命令通常由人工触发"）、
 * 把 metric 说成 ai-param（把系统读数当成模型自评），等于把最强的一类证据
 * 改名成最弱的一类，然后按弱证据的先验打折。
 *
 * Mass 函数设计（与其余各档同一口径：质量 × 先验）：
 *   strength   = successRate × sourcePrior       （sourcePrior 默认 SOURCE_PRIORS.observation）
 *   m({T})  = 0.8 × strength
 *   m({¬T}) = 0.15 × (1 - strength)   （观测失败是直接反证，反向系数高于日志档的 0.1）
 *   m(Θ)   = 1 - m({T}) - m({¬T})
 *
 * 无任何观测时返回完全无知 m(Θ) = 1，不给"没跑过"编信念。
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
const SOURCE_ID = 'observation' as const

/**
 * 直接观测证据输入
 */
export interface ObservationEvidenceInput {
  /** 是否真有观测（命令执行 / 指标读数 / 配置读数） */
  hasObservations: boolean
  /** 观测成功率 [0, 1]（退出码 0 或读到有效数值的比例）；不提供则按中性 0.5 */
  successRate?: number
  /** 来源先验 [0, 1]（不提供则用 SOURCE_PRIORS.observation） */
  sourcePrior?: number
}

/**
 * 创建直接观测证据 Mass 函数
 *
 * @param evidence - 观测证据输入
 * @returns 观测证据 Mass 函数
 */
export function createObservationMassFunction(
  evidence: ObservationEvidenceInput
): MassFunction {
  if (!evidence.hasObservations) {
    return createVacuousMassFunction(SOURCE_ID, FUSION_SOURCE_LABELS[SOURCE_ID])
  }

  const successRate = clamp01(evidence.successRate ?? 0.5)
  const strength = applySourcePrior(
    successRate,
    clamp01(evidence.sourcePrior ?? SOURCE_PRIORS[SOURCE_ID])
  )

  const mT = 0.8 * strength
  const mNotT = 0.15 * (1 - strength)
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
