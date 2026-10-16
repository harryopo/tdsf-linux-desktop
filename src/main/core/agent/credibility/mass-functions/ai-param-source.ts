/**
 * AI 参数证据 Mass 函数（Source S3）
 *
 * 来源：AI 推断（Verbalized Confidence + Logprobs + Self-Consistency + CoT-shape 熵轨迹）
 * 展示名与先验的唯一来源：@shared/credibility（ai-param → 'AI 参数证据' / 0.7）
 *
 * 设计依据（调研文档 §6.3.3 + §4 + §5 + §P2 M4）：
 * - Verbalized Confidence：闭源 LLM 最普适的自评方式（SaySelf, ConfTuner）
 * - Logprob-based confidence：API 支持时使用（需暴露 logprobs）
 * - Self-consistency：多次采样计算语义一致性，缓解过度自信
 * - CoT-shape 熵轨迹（v0.9.6 P2 M4 新增）：推理过程中熵的**形状单调性**比标量更预测
 * - 校准折扣因子 0.85（Guo et al. 2017 的过度自信发现）是**本档内的固定折扣**；
 *   按 Provider 分类的 Temperature Scaling 不在这条公式里，而在融合出口
 *   （fusion-engine.fuseAndAssess 的 options.applyCalibration + providerId）。
 *   原先这里写着"传 providerId 则取 CalibrationTuner 的 T"，代码里既没读该字段
 *   也没调 tuner，属于文档承诺、代码没做，现已删掉该字段。
 *
 * 论文支撑：
 * - Guo et al. 2017, "On Calibration of Modern Neural Networks", ICML
 * - Tian et al. 2023, "Just Ask for Calibration", EMNLP（Verbalized Confidence）
 * - Wang et al. 2023, "Self-Consistency Improves Chain of Thought Reasoning", ICLR
 * - **Zhao 2026, "Entropy Trajectory Shape Predicts LLM Reasoning Reliability"**,
 *   arXiv:2603.18940（CoT-shape 熵轨迹信号 P2 M4 新增）
 *
 * v0.9.6 P2 M4 更新：
 * - 集成 cot-trace-signal 的 cotEntropyTrajectoryConfidence
 * - CoT-shape 作为第 4 个"形状信号"叠加（0.7·融合 + 0.3·shape）
 * - 加权理由：Zhao 2026 显示 CoT-shape 单调性是独立预测因子（OR=2.50），
 *   但仍是辅助信号而非主导（不压制标量融合结果）
 *
 * Mass 函数设计（#106 B：先验真的进计算）：
 *   llm_conf = verbalizedConfidence
 *   if logprobConfidence: llm_conf = 0.5 × verb + 0.5 × logprob
 *   if consistency:       llm_conf = 0.6 × llm_conf + 0.4 × consistency
 *   if cotEntropyTrajectory:
 *     shapeConf = cotEntropyTrajectoryConfidence(trace)
 *     llm_conf = 0.7 × llm_conf + 0.3 × shapeConf
 *   calibrated = llm_conf × 0.85                       （过度自信折扣）
 *   strength   = calibrated × sourcePrior              （模型自评这个源本来值多少）
 *   m({T})  = 0.6 × strength
 *   m({¬T}) = 0.2 × (1 - strength)
 *   m(Θ)   = 1 - m({T}) - m({¬T})
 */

import {
  type MassFunction,
  TRUSTED,
  UNTRUSTED,
  createMassFunction,
} from '../ds-theory'
import { FUSION_SOURCE_LABELS, SOURCE_PRIORS, applySourcePrior } from '@shared/credibility'
import { cotEntropyTrajectoryConfidence } from './cot-trace-signal'

/** 本档源 ID */
const SOURCE_ID = 'ai-param' as const

/**
 * 兜底校准折扣因子（v0.9 兼容值）
 *
 * 基于 Guo et al. 2017 的发现：现代神经网络系统性地过度自信。
 * 0.85 为经验值，本档固定按它打折；按 Provider 分类的 Temperature Scaling
 * 在融合出口另有一道（见文件头说明），两者不是同一件事。
 */
const CALIBRATION_DISCOUNT = 0.85

/**
 * AI 参数证据输入
 */
export interface AiParamEvidenceInput {
  /** Verbalized Confidence（LLM 自评置信度）[0, 1]，始终可用 */
  verbalizedConfidence: number
  /** Logprob-based confidence [0, 1]，API 支持时提供 */
  logprobConfidence?: number
  /** Self-consistency 置信度 [0, 1]，多次采样时提供 */
  consistency?: number
  /**
   * 来源先验 [0, 1]（不提供则用 SOURCE_PRIORS['ai-param']）
   *
   * #106 B：模型自报置信度有系统性过度自信偏置，这一档的质量必须先乘先验再进融合。
   * 它与 CALIBRATION_DISCOUNT 不是重复折扣——0.85 折的是"自评这个数字本身偏高"，
   * 先验折的是"自评这一类证据在决策里值多少权重"。
   */
  sourcePrior?: number
  /**
   * CoT 熵轨迹（v0.9.6 P2 M4 新增，可选）
   *
   * LLM 在 Chain-of-Thought 推理过程中每步的 Shannon 熵 ∈ [0, 1]。
   * 长度通常 5-50 步（reasoning model 显式、CoT prompting 隐式）。
   *
   * 论文依据：Zhao 2026, arXiv:2603.18940
   * - 熵轨迹**形状单调性**比标量总熵更具预测力（OR=2.50）
   * - 单调链 68.8% vs 非单调链 46.8% 准确率
   * - 数组合法值 ∈ [0, 1]；非法值由 analyzeCotEntropyTrajectory 兜底
   *
   * 注意：
   * - 不传时（undefined）不参与融合（保持 v0.9.6 P1 行为）
   * - 传空数组 → 中性默认 0.5（与 calibration 阶段无关）
   * - 在 3 路标量融合**之后**叠加，权重 0.3（不压制标量信号）
   */
  cotEntropyTrajectory?: number[]
}

/**
 * 创建 AI 参数证据 Mass 函数
 *
 * 公式：
 *   llm_conf = verbalizedConfidence
 *   if logprobConfidence 存在:
 *     llm_conf = 0.5 × verbalizedConfidence + 0.5 × logprobConfidence
 *   if consistency 存在:
 *     llm_conf = 0.6 × llm_conf + 0.4 × consistency
 *   if cotEntropyTrajectory 存在 (v0.9.6 P2 M4):
 *     shapeConf = cotEntropyTrajectoryConfidence(trace)
 *     llm_conf = 0.7 × llm_conf + 0.3 × shapeConf
 *   calibrated = llm_conf × 0.85                （CALIBRATION_DISCOUNT，见文件头）
 *   strength   = calibrated × sourcePrior        （默认 SOURCE_PRIORS.ai-param）
 *   m({T})  = 0.6 × strength
 *   m({¬T}) = 0.2 × (1 - strength)
 *   m(Θ)   = 1 - m({T}) - m({¬T})
 *
 * @param evidence - AI 参数证据输入
 * @returns AI 参数证据 Mass 函数
 */
export function createAiParamMassFunction(evidence: AiParamEvidenceInput): MassFunction {
  const verbConf = clamp01(evidence.verbalizedConfidence)

  // 步骤 1：融合 verbalized confidence（始终可用）
  let llmConf = verbConf

  // 步骤 2：融合 logprob confidence（API 支持时）
  if (evidence.logprobConfidence !== undefined) {
    const logprobConf = clamp01(evidence.logprobConfidence)
    llmConf = 0.5 * verbConf + 0.5 * logprobConf
  }

  // 步骤 3：融合 self-consistency（多次采样时）
  if (evidence.consistency !== undefined) {
    const consistency = clamp01(evidence.consistency)
    llmConf = 0.6 * llmConf + 0.4 * consistency
  }

  // 步骤 3.5：融合 CoT-shape 熵轨迹（v0.9.6 P2 M4 新增）
  //
  // 论文依据（Zhao 2026, arXiv:2603.18940）：
  // - 熵轨迹**形状单调性**是独立预测因子（OR=2.50, p=0.0005）
  // - 单调链 68.8% 准确率 vs 非单调链 46.8%
  // - 在 3 路标量融合后叠加，权重 0.3（不压制标量信号）
  //
  // 实现细节：
  // - cotEntropyTrajectoryConfidence 返回 null 当 trace 为 undefined
  // - 传空数组或非数组时返回 0.5（中性默认）— 不应放大或缩小 llmConf
  // - 传合法 trace 时返回 0.10/0.30/0.55/0.85 之一
  if (evidence.cotEntropyTrajectory !== undefined) {
    const shapeConf = cotEntropyTrajectoryConfidence(evidence.cotEntropyTrajectory)
    if (shapeConf !== null) {
      llmConf = 0.7 * llmConf + 0.3 * shapeConf
    }
    // shapeConf === null 时（如 trace=undefined），跳过（保持 P1 行为）
    // 但本分支 cotEntropyTrajectory 已 !== undefined，正常应得数值
  }

  // 步骤 4：校准折扣（基于 Guo et al. 2017 过度自信发现）
  //   使用固定折扣因子 0.85，缓解 LLM 系统性过度自信
  const calibrated = clamp01(llmConf * CALIBRATION_DISCOUNT)

  // 步骤 5：源先验折扣（#106 B）——自评这一类证据在决策里值多少权重
  const strength = applySourcePrior(
    calibrated,
    clamp01(evidence.sourcePrior ?? SOURCE_PRIORS[SOURCE_ID])
  )

  const mT = 0.6 * strength
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
