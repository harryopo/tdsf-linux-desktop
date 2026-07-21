/**
 * ECE (Expected Calibration Error) 评估器
 *
 * 职责：评估 LLM 可信度的校准度。校准度衡量 LLM 报告的 confidence
 *       与实际准确率的一致程度。
 *
 * 核心公式（Guo et al. 2017, ICML, arXiv:1706.04599）：
 *   把 [0, 1] 区间分成 M 个等宽桶（默认 10）：
 *   B_m = {i : conf(i) ∈ (m/M, (m+1)/M]}
 *   acc(B_m)  = (1/|B_m|) × Σ_i∈B_m I(correct(i))
 *   conf(B_m) = (1/|B_m|) × Σ_i∈B_m conf(i)
 *   ECE = Σ_m (|B_m|/n) × |acc(B_m) - conf(B_m)|
 *   MCE = max_m |acc(B_m) - conf(B_m)|
 *
 * 直观解释：
 *   - 完美校准的模型：ECE = 0（每桶 acc = conf）
 *   - 过度自信：bucket 中 conf > acc（高估自己）
 *   - 自信不足：bucket 中 conf < acc（低估自己）
 *
 * 论文支撑：
 *   - Guo, Pleiss, Sun, Weinberger 2017, "On Calibration of Modern Neural Networks"
 *     ICML 2017, arXiv:1706.04599 §3.1
 *   - Kadavath et al. 2022 (Anthropic), "Language Models (Mostly) Know What They Know"
 *     arXiv:2207.05221 §3.2
 *   - Shrivastava et al. 2023 (Stanford), arXiv:2311.08877
 *
 * 调研文档：d:\ai\linux教学一体\idea-to-dev-output\22-可信度算法论文支撑调研.md §4
 */

import type { BucketStats, CalibrationSample, EceResult, ProviderId } from './types'

// ============================================================================
// 常量
// ============================================================================

/** 默认桶数（Guo 2017 实验用 10-15） */
export const DEFAULT_NUM_BUCKETS = 10

/** 最小样本数（少于该值不计算） */
export const MIN_SAMPLES = 1

// ============================================================================
// 核心函数
// ============================================================================

/**
 * 计算 ECE（按 Provider 过滤）
 *
 * @param samples - 校准样本集
 * @param options - 桶数（默认 10）
 * @returns ECE 评估结果
 */
export function computeEce(
  samples: CalibrationSample[],
  options: {
    numBuckets?: number
    providerId?: ProviderId | null
  } = {}
): EceResult {
  const numBuckets = options.numBuckets ?? DEFAULT_NUM_BUCKETS
  const targetProvider = options.providerId ?? null

  // 1) 按 Provider 过滤
  const filtered = targetProvider
    ? samples.filter((s) => s.providerId === targetProvider)
    : samples

  // 2) 边界：空样本
  if (filtered.length === 0) {
    return emptyEceResult(numBuckets, targetProvider)
  }

  // 3) 分桶（半开半闭 [m/M, (m+1)/M)，避免边界样本重复）
  const buckets: CalibrationSample[][] = Array.from({ length: numBuckets }, () => [])

  for (const sample of filtered) {
    const conf = clamp01(sample.reportedConfidence)
    // 计算桶索引：conf=0 → bucket 0；conf=1 → bucket numBuckets-1
    // 用 Math.min 避免 conf=1 越界
    let bucketIdx = Math.floor(conf * numBuckets)
    if (bucketIdx >= numBuckets) bucketIdx = numBuckets - 1
    if (bucketIdx < 0) bucketIdx = 0
    buckets[bucketIdx].push(sample)
  }

  // 4) 统计每桶
  const n = filtered.length
  let ece = 0
  let mce = 0
  const bucketStats: BucketStats[] = []

  for (let m = 0; m < numBuckets; m++) {
    const bucket = buckets[m]
    const count = bucket.length
    const bucketLower = m / numBuckets
    const bucketUpper = (m + 1) / numBuckets

    if (count === 0) {
      bucketStats.push({
        bucketLower,
        bucketUpper,
        avgConfidence: 0,
        accuracy: 0,
        calibrationGap: 0,
        count: 0,
      })
      continue
    }

    const sumConf = bucket.reduce((acc, s) => acc + clamp01(s.reportedConfidence), 0)
    const sumCorrect = bucket.reduce((acc, s) => acc + (s.wasCorrect ? 1 : 0), 0)
    const avgConf = sumConf / count
    const accuracy = sumCorrect / count
    const gap = Math.abs(accuracy - avgConf)

    ece += (count / n) * gap
    if (gap > mce) mce = gap

    bucketStats.push({
      bucketLower,
      bucketUpper,
      avgConfidence: avgConf,
      accuracy,
      calibrationGap: gap,
      count,
    })
  }

  return {
    ece: clamp01(ece),
    mce: clamp01(mce),
    numBuckets,
    bucketStats,
    totalSamples: n,
    providerId: targetProvider,
  }
}

/**
 * 全局 ECE（不按 Provider 过滤）
 */
export function computeGlobalEce(samples: CalibrationSample[], numBuckets?: number): EceResult {
  return computeEce(samples, { numBuckets, providerId: null })
}

/**
 * 格式化 ECE 结果为可读字符串（用于日志和 UI 展示）
 */
export function formatEceResult(result: EceResult): string {
  const lines: string[] = []
  const providerLabel = result.providerId ?? 'global'
  lines.push(
    `ECE (${providerLabel}): ${result.ece.toFixed(4)} (n=${result.totalSamples}, buckets=${result.numBuckets})`
  )
  lines.push(
    `MCE: ${result.mce.toFixed(4)}`
  )

  // 打印每个非空桶
  const nonEmpty = result.bucketStats.filter((b) => b.count > 0)
  for (const b of nonEmpty) {
    lines.push(
      `  [${b.bucketLower.toFixed(2)}-${b.bucketUpper.toFixed(2)}] ` +
        `acc=${(b.accuracy * 100).toFixed(1)}% ` +
        `conf=${(b.avgConfidence * 100).toFixed(1)}% ` +
        `gap=${(b.calibrationGap * 100).toFixed(1)}% ` +
        `n=${b.count}`
    )
  }

  return lines.join('\n')
}

// ============================================================================
// 辅助函数
// ============================================================================

/** 限制 [0, 1] */
function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.max(0, Math.min(1, v))
}

/** 空样本时的返回 */
function emptyEceResult(numBuckets: number, providerId: ProviderId | null): EceResult {
  return {
    ece: 0,
    mce: 0,
    numBuckets,
    bucketStats: Array.from({ length: numBuckets }, (_, m) => ({
      bucketLower: m / numBuckets,
      bucketUpper: (m + 1) / numBuckets,
      avgConfidence: 0,
      accuracy: 0,
      calibrationGap: 0,
      count: 0,
    })),
    totalSamples: 0,
    providerId,
  }
}
