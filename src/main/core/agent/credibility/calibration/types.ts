/**
 * 校准模块共享类型定义
 *
 * 职责：定义 ECE 评估、Temperature Scaling、Provider 分类校准所需的数据结构。
 *
 * 论文支撑：
 * - Guo, Pleiss, Sun, Weinberger 2017 (ICML) "On Calibration of Modern Neural Networks"
 *   arXiv:1706.04599
 * - Kadavath et al. 2022 (Anthropic) "Language Models (Mostly) Know What They Know"
 *   arXiv:2207.05221
 * - Shrivastava et al. 2023 (Stanford) "Reliable, Adaptable, and Economical Language Models for Radiology"
 *   arXiv:2311.08877
 *
 * 核心概念：
 * - ECE (Expected Calibration Error)：分桶计算 |accuracy - confidence| 加权平均
 * - MCE (Maximum Calibration Error)：最大单桶校准误差
 * - Temperature Scaling：T ∈ R+ 调整 logits，目标是 NLL 最小化
 * - Provider-aware Calibration：不同 LLM（DeepSeek / Claude / GPT / Ollama）应使用不同 T
 *
 * 调研文档：d:\ai\linux教学一体\idea-to-dev-output\22-可信度算法论文支撑调研.md §4
 * 方案书依据：v0.9.6 P1 §ECE 校准器（CalibrationTuner）
 */

// ============================================================================
// 样本类型
// ============================================================================

/**
 * Provider 标识
 *
 * 用于按 LLM 类型分类校准。常见取值：
 * - 'deepseek' / 'deepseek-chat' / 'deepseek-reasoner'
 * - 'claude' / 'claude-sonnet-4' / 'claude-opus-4'
 * - 'openai' / 'gpt-4' / 'gpt-5'
 * - 'ollama' / 'qwen' / 'llama' 等本地模型
 */
export type ProviderId = string

/**
 * 校准样本（一条历史决策记录）
 *
 * 来源：决策历史（DecisionCard.status === 'verified' 时的 ground truth）
 */
export interface CalibrationSample {
  /** 决策 ID（与 DecisionCard.id 对应） */
  decisionId: string
  /** LLM 报告的 verbalized confidence [0, 1]（即 card.confidence） */
  reportedConfidence: number
  /** 决策是否被采纳为正确（0/1 ground truth） */
  wasCorrect: boolean
  /** Provider ID（用于分类校准） */
  providerId: ProviderId
  /** 决策时间戳 */
  timestamp: number
  /** 可选：LLM 输出的 logprob confidence [0, 1]（API 支持时） */
  logprobConfidence?: number
  /** 可选：self-consistency [0, 1] */
  consistency?: number
}

// ============================================================================
// ECE 评估结果
// ============================================================================

/** 单个分桶的统计信息 */
export interface BucketStats {
  /** 桶下界 [0, 1] */
  bucketLower: number
  /** 桶上界 [0, 1] */
  bucketUpper: number
  /** 该桶样本的平均置信度 */
  avgConfidence: number
  /** 该桶样本的实际准确率（0/1 平均） */
  accuracy: number
  /** 校准误差 |acc - conf| */
  calibrationGap: number
  /** 桶内样本数 */
  count: number
}

/** ECE 评估结果 */
export interface EceResult {
  /** Expected Calibration Error ∈ [0, 1]，越小越好 */
  ece: number
  /** Maximum Calibration Error ∈ [0, 1] */
  mce: number
  /** 桶数（默认 10） */
  numBuckets: number
  /** 各桶统计 */
  bucketStats: BucketStats[]
  /** 总样本数 */
  totalSamples: number
  /** Provider ID（空表示全局） */
  providerId: ProviderId | null
}

// ============================================================================
// Temperature Scaling 结果
// ============================================================================

/** Temperature Scaling 优化结果 */
export interface TemperatureScalingResult {
  /** 最优温度参数 T ∈ R+ */
  optimalT: number
  /** 优化前 ECE */
  eceBefore: number
  /** 优化后 ECE */
  eceAfter: number
  /** 改善百分比：(before - after) / before ∈ [0, 1] */
  improvement: number
  /** 优化所用样本数 */
  sampleCount: number
  /** 搜索过程中尝试的所有 T 值（用于可视化） */
  searchTrace: Array<{ t: number; ece: number; nll: number }>
  /** Provider ID */
  providerId: ProviderId
  /** 校准时间戳 */
  calibratedAt: number
}

// ============================================================================
// Provider 校准状态
// ============================================================================

/** 单个 Provider 的校准状态 */
export interface ProviderCalibration {
  /** Provider ID */
  providerId: ProviderId
  /** 最优 T 值（默认 1.0 表示无校准） */
  optimalT: number
  /** 上次校准时间戳（0 表示未校准） */
  lastCalibratedAt: number
  /** 校准时样本数 */
  sampleCount: number
  /** 校准前 ECE */
  eceBefore: number
  /** 校准后 ECE */
  eceAfter: number
  /** 累计样本数（用于判断是否需要重新校准） */
  totalSamplesEver: number
}

/** 全局校准状态（持久化到磁盘） */
export interface CalibrationState {
  /** schema 版本 */
  version: number
  /** Provider 分类校准表 */
  providers: Record<ProviderId, ProviderCalibration>
  /** 全局默认 T（用于未校准过的 Provider） */
  defaultT: number
  /** 上次整体更新 */
  updatedAt: number
}

// ============================================================================
// 优化选项
// ============================================================================

/** Temperature Scaling 优化选项 */
export interface OptimizeTOptions {
  /** T 搜索范围下界（默认 0.1） */
  tMin?: number
  /** T 搜索范围上界（默认 5.0） */
  tMax?: number
  /** T 搜索步数（默认 50） */
  tSteps?: number
  /** ECE 桶数（默认 10） */
  numBuckets?: number
  /** 最小样本数（少于该值不优化，返回 T=1.0） */
  minSamples?: number
}

// ============================================================================
// IPC 通道类型
// ============================================================================

/** 校准 IPC 通道入参和返回 */
export interface CalibrationChannelMap {
  /** 校准指定 Provider（基于历史样本） */
  'credibility:calibrate': {
    args: [ProviderId, OptimizeTOptions?]
    return: TemperatureScalingResult
  }
  /** 获取指定 Provider 的当前 T 值（无则返回 defaultT） */
  'credibility:get-calibration': {
    args: [ProviderId]
    return: ProviderCalibration
  }
  /** 获取全局校准状态 */
  'credibility:get-calibration-state': {
    args: []
    return: CalibrationState
  }
  /** 重置指定 Provider 的校准（T 回到 1.0） */
  'credibility:reset-calibration': {
    args: [ProviderId]
    return: boolean
  }
  /** 计算指定 Provider 的当前 ECE（不修改 T） */
  'credibility:compute-ece': {
    args: [ProviderId, number?]
    return: EceResult
  }
  /** 记录新的校准样本（自动入库） */
  'credibility:add-calibration-sample': {
    args: [CalibrationSample]
    return: boolean
  }
}
