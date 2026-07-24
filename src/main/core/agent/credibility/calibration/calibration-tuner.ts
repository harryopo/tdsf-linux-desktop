/**
 * CalibrationTuner - Provider 分类校准管理器
 *
 * 职责：
 * - 维护历史决策样本库（按 Provider 分类）
 * - 为每个 Provider 计算最优 Temperature Scaling 参数 T
 * - 应用 T 校准到 raw confidence
 * - 持久化校准状态（避免每次启动重新校准）
 *
 * 核心价值：
 * - 解决 ai-param-source.ts 中 CALIBRATION_DISCOUNT=0.85 硬编码的问题
 * - 不同 LLM（DeepSeek / Claude / GPT / Ollama）应使用不同 T
 * - 校准状态可持久化，避免冷启动问题
 *
 * 论文支撑：
 * - Guo et al. 2017, "On Calibration of Modern Neural Networks", ICML
 *   arXiv:1706.04599 §3.2
 * - Kadavath et al. 2022, arXiv:2207.05221（Anthropic 验证 LLM 自我评估能力）
 * - Shrivastava et al. 2023, arXiv:2311.08877（医学 LLM 领域校准）
 *
 * 调研文档：d:\ai\linux教学一体\idea-to-dev-output\22-可信度算法论文支撑调研.md §4
 * 方案书依据：v0.9.6 P1 §ECE 校准器
 */

import { computeEce, formatEceResult } from './ece'
import { applyTemperature, optimizeTemperature } from './temperature-scaling'
import type {
  CalibrationSample,
  CalibrationState,
  EceResult,
  OptimizeTOptions,
  ProviderCalibration,
  ProviderId,
  TemperatureScalingResult,
} from './types'

// ============================================================================
// 常量
// ============================================================================

/** 状态文件 schema 版本 */
export const CALIBRATION_STATE_VERSION = 1

/** 默认 T（未校准过的 Provider 用此值，相当于无校准） */
export const DEFAULT_OPTIMAL_T = 1.0

/** 持久化文件路径（默认） */
export const DEFAULT_STATE_FILEPATH = 'calibration-state.json'

/** 触发重新校准的最小新样本数（增量校准阈值） */
export const RETUNE_THRESHOLD = 20

// ============================================================================
// CalibrationTuner 主类
// ============================================================================

/**
 * Provider 分类校准管理器
 *
 * 使用方式：
 * ```typescript
 * const tuner = new CalibrationTuner()
 *
 * // 1) 加载历史状态
 * await tuner.load('./calibration-state.json')
 *
 * // 2) 添加新的校准样本
 * tuner.addSample({
 *   decisionId: 'card-001',
 *   reportedConfidence: 0.85,
 *   wasCorrect: true,
 *   providerId: 'deepseek',
 *   timestamp: Date.now(),
 * })
 *
 * // 3) 应用校准到 raw confidence
 * const calibrated = tuner.applyCalibration(0.85, 'deepseek')
 *
 * // 4) 触发重新校准（积累足够样本后）
 * if (tuner.shouldRetune('deepseek')) {
 *   const result = tuner.tuneProvider('deepseek')
 *   await tuner.save('./calibration-state.json')
 * }
 * ```
 */
export class CalibrationTuner {
  /** 所有样本（按 Provider 索引） */
  private samples: Map<ProviderId, CalibrationSample[]> = new Map()

  /** 校准状态（持久化） */
  private state: CalibrationState

  constructor(initialState?: Partial<CalibrationState>) {
    this.state = {
      version: CALIBRATION_STATE_VERSION,
      providers: {},
      defaultT: DEFAULT_OPTIMAL_T,
      updatedAt: Date.now(),
      ...initialState,
    }
  }

  // ==========================================================================
  // 样本管理
  // ==========================================================================

  /**
   * 添加单个校准样本
   */
  addSample(sample: CalibrationSample): void {
    if (!this.samples.has(sample.providerId)) {
      this.samples.set(sample.providerId, [])
    }
    this.samples.get(sample.providerId)!.push(sample)
  }

  /**
   * 批量添加校准样本
   */
  addSamples(samples: CalibrationSample[]): void {
    for (const s of samples) {
      this.addSample(s)
    }
  }

  /**
   * 获取指定 Provider 的样本数
   */
  getSampleCount(providerId: ProviderId): number {
    return this.samples.get(providerId)?.length ?? 0
  }

  /**
   * 获取总样本数
   */
  getTotalSampleCount(): number {
    let total = 0
    for (const arr of this.samples.values()) {
      total += arr.length
    }
    return total
  }

  /**
   * 清空所有样本（保留校准状态）
   */
  clearSamples(): void {
    this.samples.clear()
  }

  /**
   * 清空指定 Provider 的样本
   */
  clearProviderSamples(providerId: ProviderId): void {
    this.samples.delete(providerId)
  }

  // ==========================================================================
  // 校准查询
  // ==========================================================================

  /**
   * 获取指定 Provider 的最优 T
   *
   * 优先级：
   * 1. 该 Provider 已校准 → optimalT
   * 2. 未校准 → defaultT（默认 1.0，无校准）
   */
  getOptimalT(providerId: ProviderId): number {
    const provider = this.state.providers[providerId]
    if (provider) {
      return provider.optimalT
    }
    return this.state.defaultT
  }

  /**
   * 获取指定 Provider 的校准状态
   */
  getProviderCalibration(providerId: ProviderId): ProviderCalibration {
    const existing = this.state.providers[providerId]
    if (existing) return existing

    return {
      providerId,
      optimalT: this.state.defaultT,
      lastCalibratedAt: 0,
      sampleCount: 0,
      eceBefore: 0,
      eceAfter: 0,
      totalSamplesEver: this.getSampleCount(providerId),
    }
  }

  /**
   * 获取全局校准状态
   */
  getState(): CalibrationState {
    return { ...this.state, updatedAt: Date.now() }
  }

  // ==========================================================================
  // 校准应用
  // ==========================================================================

  /**
   * 应用校准到 raw confidence
   *
   * 这是 ai-param-source.ts 应该调用的核心函数，
   * 替代之前的硬编码 `× 0.85` 折扣。
   *
   * @param rawConfidence - LLM 原始 verbalized confidence
   * @param providerId - Provider ID
   * @returns 校准后 confidence
   */
  applyCalibration(rawConfidence: number, providerId: ProviderId): number {
    const t = this.getOptimalT(providerId)
    return applyTemperature(rawConfidence, t)
  }

  /**
   * 批量应用校准
   */
  applyCalibrationBatch(
    confidences: Array<{ value: number; providerId: ProviderId }>
  ): number[] {
    return confidences.map((c) => this.applyCalibration(c.value, c.providerId))
  }

  // ==========================================================================
  // 重新校准
  // ==========================================================================

  /**
   * 判断是否应该触发重新校准
   *
   * 触发条件：自上次校准以来新增了 ≥ RETUNE_THRESHOLD 个样本
   */
  shouldRetune(providerId: ProviderId): boolean {
    const current = this.getSampleCount(providerId)
    const existing = this.state.providers[providerId]
    if (!existing) {
      // 从未校准：超过默认阈值才校准
      return current >= RETUNE_THRESHOLD
    }
    // 已校准：新增样本数 ≥ 阈值
    return current - existing.sampleCount >= RETUNE_THRESHOLD
  }

  /**
   * 触发指定 Provider 的重新校准
   *
   * 基于当前样本库计算最优 T，更新内部状态。
   *
   * @param providerId - Provider ID
   * @param options - 优化选项
   * @returns 校准结果
   */
  tuneProvider(
    providerId: ProviderId,
    options: OptimizeTOptions = {}
  ): TemperatureScalingResult {
    const result = optimizeTemperature(this.allSamplesArray(), {
      ...options,
      providerId,
    })

    // 更新状态
    this.state.providers[providerId] = {
      providerId,
      optimalT: result.optimalT,
      lastCalibratedAt: result.calibratedAt,
      sampleCount: result.sampleCount,
      eceBefore: result.eceBefore,
      eceAfter: result.eceAfter,
      totalSamplesEver: this.getSampleCount(providerId),
    }
    this.state.updatedAt = Date.now()

    return result
  }

  /**
   * 批量校准所有已有足够样本的 Provider
   */
  tuneAll(options: OptimizeTOptions = {}): TemperatureScalingResult[] {
    const results: TemperatureScalingResult[] = []
    for (const providerId of this.samples.keys()) {
      if (this.shouldRetune(providerId)) {
        results.push(this.tuneProvider(providerId, options))
      }
    }
    return results
  }

  /**
   * 重置指定 Provider 的校准（T 回到 defaultT）
   */
  resetProvider(providerId: ProviderId): boolean {
    if (this.state.providers[providerId]) {
      delete this.state.providers[providerId]
      this.state.updatedAt = Date.now()
      return true
    }
    return false
  }

  // ==========================================================================
  // ECE 查询
  // ==========================================================================

  /**
   * 计算指定 Provider 的当前 ECE（不修改 T）
   */
  computeEce(providerId: ProviderId | null = null, numBuckets?: number): EceResult {
    return computeEce(this.allSamplesArray(), { providerId, numBuckets })
  }

  // ==========================================================================
  // 持久化
  // ==========================================================================

  /**
   * 导出状态为 JSON
   */
  toJSON(): CalibrationState {
    return this.getState()
  }

  /**
   * 导出样本为 JSON（用于外部持久化）
   */
  samplesToJSON(): CalibrationSample[] {
    return this.allSamplesArray()
  }

  /**
   * 从 JSON 恢复状态
   */
  fromJSON(state: CalibrationState): void {
    this.state = {
      version: state.version || CALIBRATION_STATE_VERSION,
      providers: state.providers || {},
      defaultT: state.defaultT ?? DEFAULT_OPTIMAL_T,
      updatedAt: state.updatedAt || Date.now(),
    }
  }

  /**
   * 从 JSON 恢复样本
   */
  samplesFromJSON(samples: CalibrationSample[]): void {
    this.clearSamples()
    this.addSamples(samples)
  }

  // ==========================================================================
  // 内部辅助
  // ==========================================================================

  /** 获取所有样本的扁平数组 */
  private allSamplesArray(): CalibrationSample[] {
    const all: CalibrationSample[] = []
    for (const arr of this.samples.values()) {
      all.push(...arr)
    }
    return all
  }

  // ==========================================================================
  // 诊断输出
  // ==========================================================================

  /**
   * 打印所有 Provider 的校准状态摘要（用于日志）
   */
  summary(): string {
    const lines: string[] = []
    lines.push(`CalibrationTuner Summary (${new Date().toISOString()})`)
    lines.push(`  Default T: ${this.state.defaultT}`)
    lines.push(`  Total Providers: ${Object.keys(this.state.providers).length}`)
    lines.push(`  Total Samples: ${this.getTotalSampleCount()}`)
    lines.push('')

    for (const [providerId, calibration] of Object.entries(this.state.providers)) {
      lines.push(
        `  [${providerId}] T=${calibration.optimalT.toFixed(3)} ` +
          `(${calibration.sampleCount} samples, ` +
          `ECE: ${calibration.eceBefore.toFixed(4)} → ${calibration.eceAfter.toFixed(4)}, ` +
          `last: ${new Date(calibration.lastCalibratedAt).toISOString()})`
      )
    }

    // 当前 ECE（所有样本）
    const globalEce = this.computeEce(null)
    lines.push('')
    lines.push(formatEceResult(globalEce))

    return lines.join('\n')
  }
}

// ============================================================================
// 全局单例（按需懒加载）
// ============================================================================

let globalTuner: CalibrationTuner | null = null

/**
 * 获取全局 CalibrationTuner 单例
 */
export function getCalibrationTuner(): CalibrationTuner {
  if (!globalTuner) {
    globalTuner = new CalibrationTuner()
  }
  return globalTuner
}

/**
 * 重置全局单例（用于测试）
 */
export function resetCalibrationTuner(): void {
  globalTuner = null
}
