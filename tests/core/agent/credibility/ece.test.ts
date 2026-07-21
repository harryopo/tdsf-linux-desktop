/**
 * ECE 评估器单元测试
 *
 * 论文支撑：
 * - Guo, Pleiss, Sun, Weinberger 2017, "On Calibration of Modern Neural Networks"
 *   ICML 2017, arXiv:1706.04599
 *
 * 调研文档：d:\ai\linux教学一体\idea-to-dev-output\22-可信度算法论文支撑调研.md §4
 *
 * 测试目标：
 * - 完美校准：ECE = 0
 * - 过度自信：ECE > 0（高 conf 但低 acc）
 * - 自信不足：ECE > 0（低 conf 但高 acc）
 * - 边界：空样本、单样本、极端值（conf=0/1）
 * - 桶数变化一致性
 * - Provider 过滤
 */
import { describe, it, expect } from 'vitest'
import { computeEce, computeGlobalEce, formatEceResult, DEFAULT_NUM_BUCKETS } from '../../../../src/main/core/agent/credibility/calibration/ece'
import type { CalibrationSample } from '../../../../src/main/core/agent/credibility/calibration/types'

/** 构造校准样本辅助函数（providerId 必填） */
function makeSample(
  conf: number,
  correct: boolean,
  providerId: string
): CalibrationSample {
  return {
    decisionId: `card-${Math.random()}`,
    reportedConfidence: conf,
    wasCorrect: correct,
    providerId,
    timestamp: Date.now(),
  }
}

describe('ece — Expected Calibration Error 评估', () => {
  // ────────── 完美校准 ──────────
  describe('完美校准', () => {
    it('conf=0.5 + 50% 正确 50% 错误时 ECE = 0', () => {
      // 完美校准：所有样本都在同一桶 [0.4, 0.6]，acc=0.5=conf
      const samples: CalibrationSample[] = []
      for (let i = 0; i < 50; i++) samples.push(makeSample(0.5, true, 'p'))
      for (let i = 0; i < 50; i++) samples.push(makeSample(0.5, false, 'p'))
      const result = computeEce(samples)
      expect(result.ece).toBeCloseTo(0, 4)
      expect(result.mce).toBeCloseTo(0, 4)
      expect(result.totalSamples).toBe(100)
    })

    it('conf=1.0 全部正确时 ECE = 0', () => {
      const samples: CalibrationSample[] = []
      for (let i = 0; i < 10; i++) samples.push(makeSample(1.0, true, 'p'))
      const result = computeEce(samples)
      expect(result.ece).toBeCloseTo(0, 4)
    })

    it('conf=0.0 全部错误时 ECE = 0', () => {
      const samples: CalibrationSample[] = []
      for (let i = 0; i < 10; i++) samples.push(makeSample(0.0, false, 'p'))
      const result = computeEce(samples)
      expect(result.ece).toBeCloseTo(0, 4)
    })
  })

  // ────────── 过度自信 ──────────
  describe('过度自信（conf > acc）', () => {
    it('全部 conf=0.9 但 50% 错误时 ECE ≈ 0.4', () => {
      const samples: CalibrationSample[] = []
      for (let i = 0; i < 50; i++) samples.push(makeSample(0.9, true, 'p'))
      for (let i = 0; i < 50; i++) samples.push(makeSample(0.9, false, 'p'))

      const result = computeEce(samples)
      // 落入 bucket [0.9, 1.0]，acc=0.5, conf=0.9, gap=0.4, ECE=0.4
      expect(result.ece).toBeCloseTo(0.4, 2)
    })

    it('全 conf=1.0 但全错时 ECE ≈ 1.0', () => {
      const samples: CalibrationSample[] = []
      for (let i = 0; i < 10; i++) samples.push(makeSample(1.0, false, 'p'))
      const result = computeEce(samples)
      expect(result.ece).toBeCloseTo(1.0, 4)
    })
  })

  // ────────── 自信不足 ──────────
  describe('自信不足（conf < acc）', () => {
    it('低 conf 但 100% 正确时 ECE ≈ 0.8', () => {
      const samples: CalibrationSample[] = []
      for (let i = 0; i < 10; i++) samples.push(makeSample(0.2, true, 'p'))
      const result = computeEce(samples)
      // 落入 bucket [0.2, 0.3]，acc=1.0, conf=0.2, gap=0.8
      expect(result.ece).toBeCloseTo(0.8, 2)
    })
  })

  // ────────── 边界情况 ──────────
  describe('边界情况', () => {
    it('空样本返回 ECE=0', () => {
      const result = computeEce([])
      expect(result.ece).toBe(0)
      expect(result.mce).toBe(0)
      expect(result.totalSamples).toBe(0)
      expect(result.bucketStats).toHaveLength(DEFAULT_NUM_BUCKETS)
      expect(result.bucketStats.every((b) => b.count === 0)).toBe(true)
    })

    it('单样本正常计算', () => {
      const samples = [makeSample(0.8, true, 'p')]
      const result = computeEce(samples)
      expect(result.totalSamples).toBe(1)
      expect(result.ece).toBeCloseTo(0.2, 4) // |1.0 - 0.8|
    })

    it('conf=1 不越界（Math.min 保护）', () => {
      const samples = [makeSample(1.0, true, 'p')]
      const result = computeEce(samples, { numBuckets: 5 })
      // 样本应进最后一桶 [0.8, 1.0]
      const lastBucket = result.bucketStats[4]
      expect(lastBucket.count).toBe(1)
    })

    it('conf=0 正常入第一桶', () => {
      const samples = [makeSample(0.0, false, 'p')]
      const result = computeEce(samples, { numBuckets: 5 })
      const firstBucket = result.bucketStats[0]
      expect(firstBucket.count).toBe(1)
      expect(result.ece).toBeCloseTo(0, 4) // |0.0 - 0.0| = 0
    })

    it('NaN 输入视为 0', () => {
      const samples = [
        { ...makeSample(0.5, true, 'p'), reportedConfidence: NaN },
        makeSample(0.5, true, 'p'),
      ]
      const result = computeEce(samples)
      expect(result.totalSamples).toBe(2)
    })
  })

  // ────────── 桶数 ──────────
  describe('桶数配置', () => {
    it('自定义 numBuckets 影响分桶粒度', () => {
      // 完美校准：50 正确 50 错误，conf=0.5
      const samples: CalibrationSample[] = []
      for (let i = 0; i < 10; i++) samples.push(makeSample(0.5, true, 'p'))
      for (let i = 0; i < 10; i++) samples.push(makeSample(0.5, false, 'p'))

      const r5 = computeEce(samples, { numBuckets: 5 })
      const r20 = computeEce(samples, { numBuckets: 20 })

      expect(r5.numBuckets).toBe(5)
      expect(r20.numBuckets).toBe(20)
      // 5 桶时所有样本都在 [0.4, 0.6] 桶，acc=0.5=conf，ECE=0
      expect(r5.ece).toBeCloseTo(0, 4)
    })

    it('默认桶数为 10', () => {
      const result = computeEce([makeSample(0.5, true, 'p')])
      expect(result.numBuckets).toBe(10)
    })
  })

  // ────────── Provider 过滤 ──────────
  describe('Provider 过滤', () => {
    it('按 providerId 过滤样本', () => {
      const samples = [
        makeSample(0.9, true, 'deepseek'),
        makeSample(0.9, true, 'deepseek'),
        makeSample(0.9, false, 'claude'),
      ]

      // 只看 deepseek：conf=0.9, acc=1.0, gap=0.1
      const dsEce = computeEce(samples, { providerId: 'deepseek' })
      expect(dsEce.totalSamples).toBe(2)
      expect(dsEce.ece).toBeCloseTo(0.1, 4)

      const claudeEce = computeEce(samples, { providerId: 'claude' })
      expect(claudeEce.totalSamples).toBe(1)
    })

    it('computeGlobalEce 包含所有 Provider', () => {
      const samples = [
        makeSample(0.5, true, 'a'),
        makeSample(0.5, true, 'b'),
      ]
      const result = computeGlobalEce(samples)
      expect(result.totalSamples).toBe(2)
      expect(result.providerId).toBeNull()
    })
  })

  // ────────── 浮点容差 ──────────
  describe('浮点容差', () => {
    it('大量样本 ECE 在 1e-9 容差内稳定', () => {
      const samples: CalibrationSample[] = []
      for (let i = 0; i < 1000; i++) {
        const conf = Math.random()
        const correct = Math.random() < conf // 模拟完美校准
        samples.push(makeSample(conf, correct, 'p'))
      }
      const r1 = computeEce(samples)
      const r2 = computeEce(samples)
      expect(r1.ece).toBeCloseTo(r2.ece, 9)
    })
  })

  // ────────── 格式化输出 ──────────
  describe('formatEceResult', () => {
    it('输出包含 ECE 数值和桶统计', () => {
      const samples = [makeSample(0.5, true, 'p'), makeSample(0.5, true, 'p')]
      const result = computeEce(samples)
      const formatted = formatEceResult(result)
      expect(formatted).toContain('ECE')
      expect(formatted).toContain('global')
      expect(formatted).toContain('n=2')
    })
  })
})
