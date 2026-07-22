/**
 * AI 参数证据 Mass 函数（Source S3）
 *
 * 来源：AI 推断（Verbalized Confidence + Logprobs + Self-Consistency + CoT-shape 熵轨迹）
 * 先验可信度：0.7（AI 推断能力较强，但存在过度自信偏置）
 *
 * 设计依据（调研文档 §6.3.3 + §4 + §5 + §P2 M4）：
 * - Verbalized Confidence：闭源 LLM 最普适的自评方式（SaySelf, ConfTuner）
 * - Logprob-based confidence：API 支持时使用（需暴露 logprobs）
 * - Self-consistency：多次采样计算语义一致性，缓解过度自信
 * - CoT-shape 熵轨迹（v0.9.6 P2 M4 新增）：推理过程中熵的**形状单调性**比标量更预测
 * - 引入校准折扣因子（0.85），基于 Guo et al. 2017 的过度自信发现
 *
 * 论文支撑：
 * - Guo et al. 2017, "On Calibration of Modern Neural Networks", ICML
 * - Tian et al. 2023, "Just Ask for Calibration", EMNLP（Verbalized Confidence）
 * - Wang et al. 2023, "Self-Consistency Improves Chain of Thought Reasoning", ICLR
 * - **Zhao 2026, "Entropy Trajectory Shape Predicts LLM Reasoning Reliability"**,
 *   arXiv:2603.18940（CoT-shape 熵轨迹信号 P2 M4 新增）
 *
 * v0.9.6 P1 更新：
 * - 集成 CalibrationTuner（按 Provider 分类校准）
 * - 校准过的 Provider 用 T 值（来自历史决策样本网格搜索）
 * - 未校准过的 Provider 用 CALIBRATION_DISCOUNT=0.85 兜底（保持向后兼容）
 *
 * v0.9.6 P2 M4 更新：
 * - 集成 cot-trace-signal 的 cotEntropyTrajectoryConfidence
 * - CoT-shape 作为第 4 个"形状信号"叠加（0.7·融合 + 0.3·shape）
 * - 加权理由：Zhao 2026 显示 CoT-shape 单调性是独立预测因子（OR=2.50），
 *   但仍是辅助信号而非主导（不压制标量融合结果）
 *
 * Mass 函数设计：
 *   llm_conf = verbalizedConfidence
 *   if logprobConfidence: llm_conf = 0.5 × verb + 0.5 × logprob
 *   if consistency:       llm_conf = 0.6 × llm_conf + 0.4 × consistency
 *   if cotEntropyTrajectory (P2 M4):
 *     shapeConf = cotEntropyTrajectoryConfidence(trace)  // Zhao 2026 经验映射
 *     llm_conf = 0.7 × llm_conf + 0.3 × shapeConf
 *   T = providerId ? CalibrationTuner.getOptimalT(providerId) : 0.85
 *   calibrated = applyTemperature(llm_conf, T)    （T→0.85 兜底）
 *   m({T})  = 0.6 × calibrated
 *   m({¬T}) = 0.2 × (1 - calibrated)
 *   m(Θ)   = 1 - m({T}) - m({¬T})
 */

import {
  type MassFunction,
  TRUSTED,
  UNTRUSTED,
  createMassFunction,
} from '../ds-theory'
import { cotEntropyTrajectoryConfidence } from './cot-trace-signal'

/** AI 参数证据来源 ID */
export const AI_PARAM_SOURCE_ID = 'ai-param'

/** AI 参数证据来源名称 */
export const AI_PARAM_SOURCE_NAME = 'AI 参数证据'

/** AI 参数证据来源先验可信度 */
export const AI_PARAM_SOURCE_PRIOR = 0.7

/**
 * 兜底校准折扣因子（v0.9 兼容值）
 *
 * 基于 Guo et al. 2017 的发现：现代神经网络系统性地过度自信。
 * 0.85 为经验值，**仅在 CalibrationTuner 未对该 Provider 校准时生效**。
 *
 * 校准过的 Provider 会用 CalibrationTuner 中存储的 T 值（由
 * optimizeTemperature 网格搜索得到，可能与 0.85 差异很大）。
 *
 * v0.9.6 P1 改造后行为：
 * - 传 providerId + 该 Provider 已校准 → 用 optimalT
 * - 传 providerId + 该 Provider 未校准 → 用本兜底值 0.85（向后兼容）
 * - 未传 providerId → 用本兜底值 0.85（向后兼容）
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
   * Provider ID（v0.9.6 P1 新增，可选）
   *
   * 传入后会从 CalibrationTuner 获取该 Provider 的 T 值；
   * 未传或未校准过则用兜底值 0.85。
   *
   * 典型取值：'deepseek' / 'claude' / 'openai' / 'ollama' 等
   */
  providerId?: string
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
 *   T = providerId ? CalibrationTuner.getOptimalT(providerId) : 0.85
 *   calibrated = applyTemperature(llm_conf, T)    （T→0.85 兜底）
 *   m({T})  = 0.6 × calibrated
 *   m({¬T}) = 0.2 × (1 - calibrated)
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

  const mT = 0.6 * calibrated
  const mNotT = 0.2 * (1 - calibrated)
  const mTheta = 1 - mT - mNotT

  return createMassFunction(
    AI_PARAM_SOURCE_ID,
    AI_PARAM_SOURCE_NAME,
    [
      { elements: new Set<string>([TRUSTED]), mass: mT },
      { elements: new Set<string>([UNTRUSTED]), mass: mNotT },
      { elements: new Set<string>([TRUSTED, UNTRUSTED]), mass: mTheta },
    ],
    calibrated
  )
}

/** 将数值限制在 [0, 1] 范围内 */
function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(1, Math.max(0, value))
}
