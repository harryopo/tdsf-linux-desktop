/**
 * CalibrationTuner 单元测试
 *
 * 论文支撑：
 * - Guo, Pleiss, Sun, Weinberger 2017, "On Calibration of Modern Neural Networks"
 *   ICML 2017, arXiv:1706.04599
 *
 * 调研文档：d:\ai\linux教学一体\idea-to-dev-output\22-可信度算法论文支撑调研.md §4
 *
 * 测试目标：
 * - 样本管理（add / clear / 计数）
 * - 校准查询（getOptimalT / getProviderCalibration）
 * - 应用校准（applyCalibration / 批量）
 * - 重新校准（shouldRetune / tuneProvider / tuneAll / resetProvider）
 * - ECE 查询（computeEce / Provider 过滤）
 * - 持久化（toJSON / fromJSON / samplesToJSON）
 * - 诊断输出（summary）
 * - 多 Provider 隔离
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  CalibrationTuner,
  getCalibrationTuner,
  resetCalibrationTuner,
  DEFAULT_OPTIMAL_T,
  RETUNE_THRESHOLD,
  CALIBRATION_STATE_VERSION,
} from '../../../../src/main/core/agent/credibility/calibration/calibration-tuner'
import type {
  CalibrationSample,
  CalibrationState,
  ProviderId,
} from '../../../../src/main/core/agent/credibility/calibration/types'

/** 构造样本（providerId 必填） */
function makeSample(
  conf: number,
  correct: boolean,
  providerId: ProviderId,
  timestamp = Date.now()
): CalibrationSample {
  return {
    decisionId: `card-${Math.random()}`,
    reportedConfidence: conf,
    wasCorrect: correct,
    providerId,
    timestamp,
  }
}

/** 构造过度自信样本（conf=0.9, acc=0.5） */
function makeOverconfidentSamples(providerId: ProviderId, count = 30): CalibrationSample[] {
  const samples: CalibrationSample[] = []
  for (let i = 0; i < count; i++) samples.push(makeSample(0.9, i < count / 2, providerId))
  return samples
}

describe('calibration-tuner — Provider 分类校准管理器', () => {
  let tuner: CalibrationTuner

  beforeEach(() => {
    tuner = new CalibrationTuner()
  })

  // ────────── 构造与初始状态 ──────────
  describe('构造与初始状态', () => {
    it('默认状态：defaultT=1.0, providers={}', () => {
      const state = tuner.getState()
      expect(state.defaultT).toBe(DEFAULT_OPTIMAL_T)
      expect(state.defaultT).toBe(1.0)
      expect(state.providers).toEqual({})
      expect(state.version).toBe(CALIBRATION_STATE_VERSION)
    })

    it('接受初始状态', () => {
      const initialState: Partial<CalibrationState> = {
        defaultT: 0.9,
        providers: {
          test: {
            providerId: 'test',
            optimalT: 1.2,
            lastCalibratedAt: 1000,
            sampleCount: 50,
            eceBefore: 0.15,
            eceAfter: 0.05,
            totalSamplesEver: 50,
          },
        },
      }
      const t = new CalibrationTuner(initialState)
      expect(t.getOptimalT('test')).toBe(1.2)
    })
  })

  // ────────── 样本管理 ──────────
  describe('样本管理', () => {
    it('addSample 单条添加', () => {
      tuner.addSample(makeSample(0.8, true, 'p1'))
      expect(tuner.getSampleCount('p1')).toBe(1)
      expect(tuner.getSampleCount('p2')).toBe(0)
    })

    it('addSamples 批量添加（多个 Provider）', () => {
      const samples = [
        makeSample(0.8, true, 'p1'),
        makeSample(0.7, true, 'p1'),
        makeSample(0.9, false, 'p2'),
        makeSample(0.6, true, 'p2'),
        makeSample(0.5, true, 'p2'),
      ]
      tuner.addSamples(samples)
      expect(tuner.getSampleCount('p1')).toBe(2)
      expect(tuner.getSampleCount('p2')).toBe(3)
      expect(tuner.getTotalSampleCount()).toBe(5)
    })

    it('clearSamples 清空所有', () => {
      tuner.addSample(makeSample(0.5, true, 'p1'))
      tuner.addSample(makeSample(0.5, true, 'p2'))
      tuner.clearSamples()
      expect(tuner.getTotalSampleCount()).toBe(0)
    })

    it('clearProviderSamples 清空指定 Provider', () => {
      tuner.addSample(makeSample(0.5, true, 'p1'))
      tuner.addSample(makeSample(0.5, true, 'p2'))
      tuner.clearProviderSamples('p1')
      expect(tuner.getSampleCount('p1')).toBe(0)
      expect(tuner.getSampleCount('p2')).toBe(1)
    })
  })

  // ────────── 校准查询 ──────────
  describe('校准查询', () => {
    it('未校准的 Provider 返回 defaultT', () => {
      expect(tuner.getOptimalT('unknown')).toBe(1.0)
    })

    it('getProviderCalibration 包含 Provider 元信息', () => {
      const c = tuner.getProviderCalibration('unknown')
      expect(c.providerId).toBe('unknown')
      expect(c.optimalT).toBe(1.0)
      expect(c.lastCalibratedAt).toBe(0)
      expect(c.sampleCount).toBe(0)
    })
  })

  // ────────── 应用校准 ──────────
  describe('应用校准', () => {
    it('T=1.0 时无校准（恒等）', () => {
      const result = tuner.applyCalibration(0.7, 'any')
      expect(result).toBeCloseTo(0.7, 6)
    })

    it('T>1 平滑：conf 向 0.5 收敛', () => {
      tuner.addSamples(makeOverconfidentSamples('p1', 50))
      const result = tuner.tuneProvider('p1')
      expect(result.optimalT).toBeGreaterThan(1.0)

      // 应用校准后，原始 conf=0.9 应该被降低
      const calibrated = tuner.applyCalibration(0.9, 'p1')
      expect(calibrated).toBeLessThan(0.9)
    })

    it('applyCalibrationBatch 批量应用', () => {
      tuner.addSamples(makeOverconfidentSamples('p1', 50))
      tuner.tuneProvider('p1')

      const results = tuner.applyCalibrationBatch([
        { value: 0.9, providerId: 'p1' },
        { value: 0.5, providerId: 'p1' },
        { value: 0.7, providerId: 'unknown' }, // defaultT=1
      ])
      expect(results).toHaveLength(3)
      // p1 已校准，0.9 应该被降低
      expect(results[0]).toBeLessThan(0.9)
      // unknown 用 defaultT=1，无变化
      expect(results[2]).toBeCloseTo(0.7, 6)
    })
  })

  // ────────── 重新校准 ──────────
  describe('重新校准', () => {
    it('shouldRetune：未校准时样本数 < RETUNE_THRESHOLD 返回 false', () => {
      tuner.addSamples(makeOverconfidentSamples('p1', RETUNE_THRESHOLD - 1))
      expect(tuner.shouldRetune('p1')).toBe(false)
    })

    it('shouldRetune：未校准时样本数 ≥ RETUNE_THRESHOLD 返回 true', () => {
      tuner.addSamples(makeOverconfidentSamples('p1', RETUNE_THRESHOLD + 5))
      expect(tuner.shouldRetune('p1')).toBe(true)
    })

    it('shouldRetune：已校准后新增样本 < 阈值返回 false', () => {
      tuner.addSamples(makeOverconfidentSamples('p1', RETUNE_THRESHOLD + 5))
      tuner.tuneProvider('p1')
      // 已校准，再加 5 个样本（小于阈值）
      tuner.addSamples(makeOverconfidentSamples('p1', 5))
      expect(tuner.shouldRetune('p1')).toBe(false)
    })

    it('tuneProvider：过度自信场景返回 T > 1', () => {
      tuner.addSamples(makeOverconfidentSamples('p1', 50))
      const result = tuner.tuneProvider('p1')
      expect(result.optimalT).toBeGreaterThan(1.0)
      expect(result.sampleCount).toBe(50)
      expect(result.providerId).toBe('p1')
      expect(result.eceAfter).toBeLessThanOrEqual(result.eceBefore)
    })

    it('tuneProvider 更新内部状态', () => {
      tuner.addSamples(makeOverconfidentSamples('p1', 50))
      tuner.tuneProvider('p1')
      const c = tuner.getProviderCalibration('p1')
      expect(c.optimalT).toBeGreaterThan(1.0)
      expect(c.lastCalibratedAt).toBeGreaterThan(0)
      expect(c.sampleCount).toBe(50)
    })

    it('tuneAll：批量校准多个 Provider', () => {
      tuner.addSamples(makeOverconfidentSamples('p1', RETUNE_THRESHOLD + 5))
      tuner.addSamples(makeOverconfidentSamples('p2', RETUNE_THRESHOLD + 5))
      tuner.addSample(makeSample(0.5, true, 'p3')) // 样本不足，跳过

      const results = tuner.tuneAll()
      expect(results).toHaveLength(2)
      expect(results.map((r) => r.providerId).sort()).toEqual(['p1', 'p2'])
      expect(tuner.getProviderCalibration('p3').optimalT).toBe(1.0)
    })

    it('resetProvider：重置后回到 defaultT', () => {
      tuner.addSamples(makeOverconfidentSamples('p1', 50))
      tuner.tuneProvider('p1')
      expect(tuner.getOptimalT('p1')).toBeGreaterThan(1.0)

      const ok = tuner.resetProvider('p1')
      expect(ok).toBe(true)
      expect(tuner.getOptimalT('p1')).toBe(1.0)
    })

    it('resetProvider：未校准的 Provider 返回 false', () => {
      expect(tuner.resetProvider('unknown')).toBe(false)
    })
  })

  // ────────── ECE 查询 ──────────
  describe('ECE 查询', () => {
    it('computeEce 默认全 Provider', () => {
      tuner.addSamples(makeOverconfidentSamples('p1', 30))
      tuner.addSamples(makeOverconfidentSamples('p2', 30))
      const result = tuner.computeEce()
      expect(result.totalSamples).toBe(60)
    })

    it('computeEce 按 Provider 过滤', () => {
      tuner.addSamples(makeOverconfidentSamples('p1', 30))
      tuner.addSample(makeSample(0.5, true, 'p2'))
      const result = tuner.computeEce('p1')
      expect(result.totalSamples).toBe(30)
      expect(result.providerId).toBe('p1')
    })
  })

  // ────────── 持久化 ──────────
  describe('持久化', () => {
    it('toJSON 导出 CalibrationState', () => {
      tuner.addSamples(makeOverconfidentSamples('p1', 30))
      tuner.tuneProvider('p1')
      const json = tuner.toJSON()
      expect(json.version).toBe(CALIBRATION_STATE_VERSION)
      expect(json.providers.p1).toBeDefined()
      expect(json.providers.p1.optimalT).toBeGreaterThan(1.0)
    })

    it('fromJSON 恢复状态', () => {
      const state: CalibrationState = {
        version: CALIBRATION_STATE_VERSION,
        defaultT: 1.0,
        providers: {
          deepseek: {
            providerId: 'deepseek',
            optimalT: 1.3,
            lastCalibratedAt: 1000,
            sampleCount: 100,
            eceBefore: 0.2,
            eceAfter: 0.05,
            totalSamplesEver: 100,
          },
        },
        updatedAt: 1000,
      }
      tuner.fromJSON(state)
      expect(tuner.getOptimalT('deepseek')).toBe(1.3)
    })

    it('samplesToJSON / samplesFromJSON 双向', () => {
      const original = [
        makeSample(0.8, true, 'p1'),
        makeSample(0.7, false, 'p1'),
        makeSample(0.9, true, 'p2'),
      ]
      tuner.addSamples(original)
      const exported = tuner.samplesToJSON()

      const newTuner = new CalibrationTuner()
      newTuner.samplesFromJSON(exported)
      expect(newTuner.getTotalSampleCount()).toBe(3)
      expect(newTuner.getSampleCount('p1')).toBe(2)
      expect(newTuner.getSampleCount('p2')).toBe(1)
    })
  })

  // ────────── 诊断输出 ──────────
  describe('诊断输出', () => {
    it('summary 包含关键信息', () => {
      tuner.addSamples(makeOverconfidentSamples('p1', 30))
      tuner.tuneProvider('p1')
      const s = tuner.summary()
      expect(s).toContain('CalibrationTuner Summary')
      expect(s).toContain('Default T: 1')
      expect(s).toContain('[p1]')
      expect(s).toContain('T=')
    })
  })

  // ────────── 多 Provider 隔离 ──────────
  describe('多 Provider 隔离', () => {
    it('两个 Provider 独立校准，选到不同 T', () => {
      // p1 报告 conf=0.7，50% 正确（acc=0.5, gap=0.2）
      // sigmoid 的极限：T→∞ 才能让 conf 接近 0.5（sigmoid 极限）
      // grid 边界 T=5 让 conf→0.542，gap=0.042
      const p1Samples: CalibrationSample[] = []
      for (let i = 0; i < 20; i++) p1Samples.push(makeSample(0.7, true, 'p1'))
      for (let i = 0; i < 20; i++) p1Samples.push(makeSample(0.7, false, 'p1'))
      tuner.addSamples(p1Samples)

      // p2 报告 conf=0.5，70% 正确（acc=0.7, gap=0.2 但方向相反）
      // 完美校准中 T=1 时 conf=0.5 但 acc=0.7
      // T<1 让 conf 更极端，gap 更大；T>1 让 conf→0.5，gap 不变
      // 所以最优 T=1（gap 最小）
      const p2Samples: CalibrationSample[] = []
      for (let i = 0; i < 14; i++) p2Samples.push(makeSample(0.5, true, 'p2'))
      for (let i = 0; i < 6; i++) p2Samples.push(makeSample(0.5, false, 'p2'))
      tuner.addSamples(p2Samples)

      tuner.tuneProvider('p1')
      tuner.tuneProvider('p2')

      // p1 过度自信 T > 1
      expect(tuner.getOptimalT('p1')).toBeGreaterThan(1.0)
      // p2 完美校准 T = 1
      expect(tuner.getOptimalT('p2')).toBeCloseTo(1.0, 1)
      // 不交叉
      expect(tuner.getOptimalT('p1')).not.toBeCloseTo(tuner.getOptimalT('p2'), 1)
    })
  })

  // ────────── 全局单例 ──────────
  describe('全局单例', () => {
    it('getCalibrationTuner 返回同一实例', () => {
      resetCalibrationTuner()
      const t1 = getCalibrationTuner()
      const t2 = getCalibrationTuner()
      expect(t1).toBe(t2)
    })

    it('resetCalibrationTuner 清除单例', () => {
      const t1 = getCalibrationTuner()
      t1.addSample(makeSample(0.5, true, 'p1'))
      resetCalibrationTuner()
      const t2 = getCalibrationTuner()
      expect(t2).not.toBe(t1)
      expect(t2.getTotalSampleCount()).toBe(0)
    })
  })
})
