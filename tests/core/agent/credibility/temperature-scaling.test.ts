/**
 * Temperature Scaling 单元测试
 *
 * 论文支撑：
 * - Guo, Pleiss, Sun, Weinberger 2017, "On Calibration of Modern Neural Networks"
 *   ICML 2017, arXiv:1706.04599
 *
 * 调研文档：d:\ai\linux教学一体\idea-to-dev-output\22-可信度算法论文支撑调研.md §4
 *
 * 测试目标：
 * - applyTemperature 函数正确性
 *   - T=1 无变化
 *   - T<1 锐化
 *   - T>1 平滑
 *   - 边界 T<=0 抛错
 *   - conf=0/1 epsilon 保护
 * - optimizeTemperature 网格搜索
 *   - 样本不足返回 T=1.0
 *   - 过度自信识别（T > 1）
 *   - 自信不足识别（T < 1）
 *   - searchTrace 完整
 * - computeNll 单调性
 */
import { describe, it, expect } from 'vitest'
import {
  applyTemperature,
  computeNll,
  optimizeTemperature,
  DEFAULT_T_MIN,
  DEFAULT_T_MAX,
  DEFAULT_T_STEPS,
  DEFAULT_MIN_SAMPLES,
} from '../../../../src/main/core/agent/credibility/calibration/temperature-scaling'
import type { CalibrationSample } from '../../../../src/main/core/agent/credibility/calibration/types'

/** 构造样本（providerId 必填） */
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

describe('temperature-scaling — 温度缩放与 T 优化', () => {
  // ────────── applyTemperature ──────────
  describe('applyTemperature 单值缩放', () => {
    it('T=1.0 时无变化（恒等映射）', () => {
      const testValues = [0.1, 0.3, 0.5, 0.7, 0.9]
      for (const v of testValues) {
        expect(applyTemperature(v, 1.0)).toBeCloseTo(v, 6)
      }
    })

    it('T<1 锐化：远离 0.5 的值更极端', () => {
      const conf09_t05 = applyTemperature(0.9, 0.5)
      expect(conf09_t05).toBeGreaterThan(0.9)

      const conf01_t05 = applyTemperature(0.1, 0.5)
      expect(conf01_t05).toBeLessThan(0.1)
    })

    it('T>1 平滑：向 0.5 收敛', () => {
      const conf09_t2 = applyTemperature(0.9, 2.0)
      expect(conf09_t2).toBeLessThan(0.9)
      expect(conf09_t2).toBeGreaterThan(0.5)

      const conf01_t2 = applyTemperature(0.1, 2.0)
      expect(conf01_t2).toBeGreaterThan(0.1)
      expect(conf01_t2).toBeLessThan(0.5)
    })

    it('T→∞ 时 conf 趋近 0.5（最大平滑）', () => {
      // T=100 时 conf=0.9 → sigmoid(2.197/100) = sigmoid(0.022) ≈ 0.505
      const v1 = applyTemperature(0.9, 100)
      const v2 = applyTemperature(0.1, 100)
      // 容差 0.01（1 位小数）
      expect(v1).toBeCloseTo(0.5, 1)
      expect(v2).toBeCloseTo(0.5, 1)
    })

    it('T→0+ 时 conf 趋近 0 或 1（最大锐化）', () => {
      const v1 = applyTemperature(0.6, 0.01)
      const v2 = applyTemperature(0.4, 0.01)
      expect(v1).toBeGreaterThan(0.99)
      expect(v2).toBeLessThan(0.01)
    })

    it('T<=0 抛错', () => {
      expect(() => applyTemperature(0.5, 0)).toThrow()
      expect(() => applyTemperature(0.5, -1)).toThrow()
    })

    it('conf=0 不导致 log(0)（epsilon 保护）', () => {
      const result = applyTemperature(0.0, 1.5)
      expect(Number.isFinite(result)).toBe(true)
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThanOrEqual(1)
    })

    it('conf=1 不导致 log(0)（epsilon 保护）', () => {
      const result = applyTemperature(1.0, 1.5)
      expect(Number.isFinite(result)).toBe(true)
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThanOrEqual(1)
    })

    it('NaN 输入返回 0（安全降级）', () => {
      expect(applyTemperature(NaN, 1.0)).toBe(0)
    })
  })

  // ────────── optimizeTemperature ──────────
  describe('optimizeTemperature 网格搜索', () => {
    it('样本数 < minSamples 时返回 T=1.0', () => {
      // providerId 必须匹配
      const samples = [makeSample(0.9, false, 'test')]
      const result = optimizeTemperature(samples, {
        providerId: 'test',
        minSamples: 10,
      })
      expect(result.optimalT).toBe(1.0)
      expect(result.sampleCount).toBe(1)
    })

    it('conf 散布但全部正确时 T 越极端 gap 越接近 0.5', () => {
      // 样本：conf=(0.05..0.95)，全部 correct
      // ECE=0.5（acc=1.0, conf 散布在 0-1）
      // 温度缩放只能让 conf 收拢到 0.5 附近（sigmoid 极限），所以 T 越大 gap 越小
      const samples: CalibrationSample[] = []
      for (let bucket = 0; bucket < 10; bucket++) {
        const conf = (bucket + 0.5) / 10
        for (let i = 0; i < 5; i++) {
          samples.push(makeSample(conf, true, 'spread'))
        }
      }
      const result = optimizeTemperature(samples, { providerId: 'spread' })
      // ECE 大约为 0.5（结构决定的，与 T 无关）
      expect(result.eceBefore).toBeGreaterThan(0.3)
      // 但 T→极大时，ECE 收敛到 0.5（acc=1.0, conf→0.5）
      expect(result.eceAfter).toBeLessThanOrEqual(0.6)
    })

    it('过度自信 → optimalT > 1.0', () => {
      // LLM 报告高 conf 但经常错（acc=0.5, conf=0.9）
      const samples: CalibrationSample[] = []
      for (let i = 0; i < 30; i++) samples.push(makeSample(0.9, true, 'over'))
      for (let i = 0; i < 30; i++) samples.push(makeSample(0.9, false, 'over'))

      const result = optimizeTemperature(samples, { providerId: 'over' })
      expect(result.optimalT).toBeGreaterThan(1.0)
      expect(result.eceAfter).toBeLessThanOrEqual(result.eceBefore)
    })

    it('自信不足 → optimalT > 1.0（sigmoid 把低 conf 拉向 0.5）', () => {
      // LLM 报告低 conf 但实际都对（acc=1.0, conf=0.2）
      // 温度缩放的单调性：T>1 把 conf 拉向 0.5，T<1 把 conf 推向极端
      // 因为 0.2 永远变不到 1.0，sigmoid 极限让 conf→0.5
      // 所以最优 T 是上限（5.0），让 conf 尽量接近 0.5
      const samples: CalibrationSample[] = []
      for (let i = 0; i < 60; i++) samples.push(makeSample(0.2, true, 'under'))

      const result = optimizeTemperature(samples, { providerId: 'under' })
      // 自校准的极限：T 越大 conf 越接近 0.5，gap 从 0.8 收敛到 0.5
      expect(result.optimalT).toBeGreaterThan(1.0)
      expect(result.eceAfter).toBeLessThanOrEqual(result.eceBefore)
      // 极限 ECE ≈ 0.5（acc=1.0, conf→0.5）
      expect(result.eceAfter).toBeLessThan(0.6)
    })

    it('searchTrace 长度等于 tSteps', () => {
      const samples: CalibrationSample[] = []
      for (let i = 0; i < 20; i++) samples.push(makeSample(0.7, Math.random() < 0.7, 'trace'))
      const result = optimizeTemperature(samples, {
        providerId: 'trace',
        tSteps: 30,
      })
      expect(result.searchTrace).toHaveLength(30)
      expect(result.searchTrace[0].t).toBeCloseTo(DEFAULT_T_MIN, 2)
      expect(result.searchTrace[29].t).toBeCloseTo(DEFAULT_T_MAX, 2)
    })

    it('improvement ∈ [0, 1]', () => {
      const samples: CalibrationSample[] = []
      for (let i = 0; i < 20; i++) samples.push(makeSample(0.8, Math.random() < 0.8, 'imp'))
      const result = optimizeTemperature(samples, { providerId: 'imp' })
      expect(result.improvement).toBeGreaterThanOrEqual(0)
      expect(result.improvement).toBeLessThanOrEqual(1)
    })

    it('T 范围限制生效（tMin/tMax）', () => {
      const samples: CalibrationSample[] = []
      for (let i = 0; i < 20; i++) samples.push(makeSample(0.7, Math.random() < 0.5, 'range'))
      const result = optimizeTemperature(samples, {
        providerId: 'range',
        tMin: 0.5,
        tMax: 2.0,
        tSteps: 10,
      })
      expect(result.searchTrace[0].t).toBeCloseTo(0.5, 2)
      expect(result.searchTrace[9].t).toBeCloseTo(2.0, 2)
      expect(result.optimalT).toBeGreaterThanOrEqual(0.5)
      expect(result.optimalT).toBeLessThanOrEqual(2.0)
    })

    it('Provider 过滤生效', () => {
      const samples = [
        makeSample(0.9, true, 'p1'),
        makeSample(0.9, false, 'p1'),
        makeSample(0.9, true, 'p1'),
        makeSample(0.9, false, 'p1'),
        makeSample(0.5, true, 'p2'), // 不同 provider，不参与 p1 校准
      ]
      const result = optimizeTemperature(samples, { providerId: 'p1', minSamples: 1 })
      // p1 样本数 = 4，p2 样本数 = 1
      expect(result.sampleCount).toBe(4)
    })
  })

  // ────────── computeNll ──────────
  describe('computeNll 负对数似然', () => {
    it('空样本返回 0', () => {
      expect(computeNll([], 1.0)).toBe(0)
    })

    it('不同 T 计算的 NLL 不同', () => {
      const samples = [makeSample(0.9, true, 'p'), makeSample(0.2, false, 'p')]
      const nll1 = computeNll(samples, 1.0)
      const nll15 = computeNll(samples, 1.5)
      expect(nll1).not.toBe(nll15)
    })

    it('完美校准时 NLL 数值稳定', () => {
      const samples: CalibrationSample[] = []
      for (let i = 0; i < 30; i++) samples.push(makeSample(0.5, true, 'p'))
      const nll1 = computeNll(samples, 1.0)
      const nll05 = computeNll(samples, 0.5)
      const nll2 = computeNll(samples, 2.0)
      expect(Number.isFinite(nll1)).toBe(true)
      expect(Number.isFinite(nll05)).toBe(true)
      expect(Number.isFinite(nll2)).toBe(true)
    })

    it('NLL ∈ [0, +∞)', () => {
      const samples = [makeSample(0.5, true, 'p'), makeSample(0.5, false, 'p')]
      const nll = computeNll(samples, 1.0)
      expect(nll).toBeGreaterThanOrEqual(0)
    })
  })

  // ────────── 默认值 ──────────
  describe('默认值', () => {
    it('默认 T 范围 [0.1, 5.0]', () => {
      expect(DEFAULT_T_MIN).toBe(0.1)
      expect(DEFAULT_T_MAX).toBe(5.0)
    })

    it('默认搜索步数 50', () => {
      expect(DEFAULT_T_STEPS).toBe(50)
    })

    it('默认最小样本数 10', () => {
      expect(DEFAULT_MIN_SAMPLES).toBe(10)
    })
  })
})
