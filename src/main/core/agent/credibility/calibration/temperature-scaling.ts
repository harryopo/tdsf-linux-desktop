/**
 * Temperature Scaling 优化器
 *
 * 职责：在历史决策集上搜索最优温度参数 T，使 ECE 最小化。
 *
 * 核心思想（Guo et al. 2017, ICML, arXiv:1706.04599 §3.2）：
 *   Temperature Scaling 是一种单参数后处理校准方法：
 *     - 不改变模型预测的 argmax（不影响决策）
 *     - 只调整置信度数值
 *     - 在 NLL（负对数似然）上优化 T
 *
 *   公式：
 *     z = logit(conf) = log(conf / (1 - conf))
 *     z' = z / T
 *     conf_T = sigmoid(z') = 1 / (1 + exp(-z / T))
 *
 *   T = 1：    无校准（保持原值）
 *   T < 1：    锐化（conf → 0/1，变得更"自信"）
 *   T > 1：    平滑（conf → 0.5，变得更"谦逊"）
 *
 *   当 LLM 过度自信时，optimalT > 1（Guo 2017 发现现代神经网络系统性过度自信）
 *   当 LLM 自信不足时，optimalT < 1
 *
 * 论文支撑：
 *   - Guo, Pleiss, Sun, Weinberger 2017, "On Calibration of Modern Neural Networks"
 *     ICML 2017, arXiv:1706.04599
 *   - Tian et al. 2023, "Just Ask for Calibration", EMNLP（verbalized confidence 场景）
 *
 * 调研文档：d:\ai\linux教学一体\idea-to-dev-output\22-可信度算法论文支撑调研.md §4
 */

import { computeEce } from './ece'
import type {
  CalibrationSample,
  OptimizeTOptions,
  ProviderId,
  TemperatureScalingResult,
} from './types'

// ============================================================================
// 常量
// ============================================================================

/** 默认 T 范围下界 */
export const DEFAULT_T_MIN = 0.1

/** 默认 T 范围上界 */
export const DEFAULT_T_MAX = 5.0

/** 默认 T 网格搜索步数 */
export const DEFAULT_T_STEPS = 50

/** 默认最小样本数 */
export const DEFAULT_MIN_SAMPLES = 10

/** 数值边界（避免 log(0)） */
const EPSILON = 1e-7

// ============================================================================
// 核心函数
// ============================================================================

/**
 * 在 T 网格上搜索最优 T
 *
 * 目标：最小化 ECE（在应用 T 校准后的样本集上）
 *
 * 优化算法：网格搜索 + 平滑
 *   - 1 阶段：在 [tMin, tMax] 均匀采样 tSteps 个候选 T
 *   - 计算每个 T 的 ECE
 *   - 选择 ECE 最小的 T
 *
 * 为什么不直接优化 NLL？
 *   - 我们的目标是 ECE，不是 NLL
 *   - 两者高度相关但不完全一致
 *   - 直接优化 ECE 更贴合工程目标
 *
 * @param samples - 校准样本集
 * @param options - 优化选项
 * @returns Temperature Scaling 结果
 */
export function optimizeTemperature(
  samples: CalibrationSample[],
  options: OptimizeTOptions & { providerId: ProviderId }
): TemperatureScalingResult {
  const {
    tMin = DEFAULT_T_MIN,
    tMax = DEFAULT_T_MAX,
    tSteps = DEFAULT_T_STEPS,
    numBuckets,
    minSamples = DEFAULT_MIN_SAMPLES,
    providerId,
  } = options

  // 1) 过滤 Provider
  const providerSamples = samples.filter((s) => s.providerId === providerId)

  // 2) 边界：样本不足
  if (providerSamples.length < minSamples) {
    return {
      optimalT: 1.0,
      eceBefore: 0,
      eceAfter: 0,
      improvement: 0,
      sampleCount: providerSamples.length,
      searchTrace: [],
      providerId,
      calibratedAt: Date.now(),
    }
  }

  // 3) 校准前 ECE（T=1）
  const eceBefore = computeEce(providerSamples, { numBuckets, providerId }).ece

  // 4) 网格搜索
  const step = (tMax - tMin) / (tSteps - 1)
  let bestT = 1.0
  let bestEce = eceBefore
  const trace: Array<{ t: number; ece: number; nll: number }> = []

  for (let i = 0; i < tSteps; i++) {
    const t = tMin + step * i
    const scaled = providerSamples.map((s) => ({
      ...s,
      reportedConfidence: applyTemperature(s.reportedConfidence, t),
    }))
    const ece = computeEce(scaled, { numBuckets, providerId }).ece
    const nll = computeNll(providerSamples, t)

    trace.push({ t, ece, nll })

    if (ece < bestEce) {
      bestEce = ece
      bestT = t
    }
  }

  // 5) 应用最优 T 计算最终 ECE
  const scaledBest = providerSamples.map((s) => ({
    ...s,
    reportedConfidence: applyTemperature(s.reportedConfidence, bestT),
  }))
  const eceAfter = computeEce(scaledBest, { numBuckets, providerId }).ece

  return {
    optimalT: bestT,
    eceBefore,
    eceAfter,
    improvement: eceBefore > 0 ? (eceBefore - eceAfter) / eceBefore : 0,
    sampleCount: providerSamples.length,
    searchTrace: trace,
    providerId,
    calibratedAt: Date.now(),
  }
}

/**
 * 应用 Temperature Scaling 到单个 confidence 值
 *
 * 公式：
 *   z = logit(conf + epsilon)  // 避免 log(0)
 *   z' = z / T
 *   conf_T = sigmoid(z') = 1 / (1 + exp(-z / T))
 *
 * @param conf - 原始置信度 ∈ [0, 1]
 * @param t - 温度参数 T ∈ R+
 * @returns 校准后置信度 ∈ [0, 1]
 */
export function applyTemperature(conf: number, t: number): number {
  if (t === 1.0) return clamp01(conf)
  if (t <= 0) {
    throw new Error(`Temperature T must be > 0, got ${t}`)
  }

  // 1) 限制原始 conf 到 (epsilon, 1-epsilon) 避免 log(0)
  const c = Math.max(EPSILON, Math.min(1 - EPSILON, conf))

  // 2) logit 转换
  const z = Math.log(c / (1 - c))

  // 3) T 缩放
  const zScaled = z / t

  // 4) sigmoid 反转换
  const result = 1 / (1 + Math.exp(-zScaled))

  return clamp01(result)
}

/**
 * 计算 NLL（负对数似然）
 *
 * 用于评估校准后的概率分布质量：
 *   NLL = -Σ [y_i × log(p_i) + (1-y_i) × log(1-p_i)]
 *
 * @param samples - 校准样本集
 * @param t - 温度参数
 * @returns 平均 NLL（每样本）
 */
export function computeNll(samples: CalibrationSample[], t: number): number {
  if (samples.length === 0) return 0

  let totalNll = 0
  for (const s of samples) {
    const p = applyTemperature(s.reportedConfidence, t)
    const pc = Math.max(EPSILON, Math.min(1 - EPSILON, p))
    const y = s.wasCorrect ? 1 : 0
    totalNll += -(y * Math.log(pc) + (1 - y) * Math.log(1 - pc))
  }

  return totalNll / samples.length
}

// ============================================================================
// 辅助函数
// ============================================================================

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.max(0, Math.min(1, v))
}
