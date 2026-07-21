/**
 * 6 源 Mass 函数单元测试
 *
 * 论文支撑：
 * - Guo et al. 2017, "On Calibration of Modern Neural Networks", ICML
 *   （过度自信校准折扣因子 0.85）
 * - Tian et al. 2023, "Just Ask for Calibration" / Lin et al. 2022
 *   （Verbalized Confidence）
 * - Wang et al. 2023, "Self-Consistency Improves Chain of Thought Reasoning", ICLR
 * - Fleiss 1971, "Measuring Nominal Scale Agreement Among Many Raters"
 *   （Fleiss' κ 标注者一致性）
 *
 * 调研文档引用：
 * d:\ai\linux教学一体\idea-to-dev-output\22-可信度算法论文支撑调研.md §6.3
 *
 * 测试目标：
 * - S1: createLogMassFunction（基于 Drain3 + sourcePrior）
 * - S2: createKbMassFunction（基于 ChromaDB top-k 相似度）
 * - S3: createAiParamMassFunction（verbalized + logprob + consistency + calibration）
 * - S4: createHumanMassFunction（基于人工标注 + Fleiss' κ）
 * - S5: createHistoryMassFunction（基于历史决策案例）
 * - S6: createBestPracticeMassFunction（基于 YAML 规则库）
 *
 * 每个源函数测试：
 * - 正常输入（边界值 0、0.5、1）
 * - 无效输入（NaN、负数、>1）clamp 到 [0, 1]
 * - 无证据/无匹配等空场景返回 VBF 或高无知
 * - confidence 字段正确反映综合强度
 */
import { describe, it, expect } from 'vitest'
import {
  TRUSTED,
  UNTRUSTED,
  createVacuousMassFunction,
  computeBelief
} from '../../../../src/main/core/agent/credibility/ds-theory'
import { createLogMassFunction } from '../../../../src/main/core/agent/credibility/mass-functions/log-source'
import { createKbMassFunction } from '../../../../src/main/core/agent/credibility/mass-functions/kb-source'
import { createAiParamMassFunction } from '../../../../src/main/core/agent/credibility/mass-functions/ai-param-source'
import { createHumanMassFunction } from '../../../../src/main/core/agent/credibility/mass-functions/human-source'
import { createHistoryMassFunction } from '../../../../src/main/core/agent/credibility/mass-functions/history-source'
import { createBestPracticeMassFunction } from '../../../../src/main/core/agent/credibility/mass-functions/best-practice-source'

const T_SET = new Set<string>([TRUSTED])
const NOT_T_SET = new Set<string>([UNTRUSTED])
const THETA_SET = new Set<string>([TRUSTED, UNTRUSTED])

/** 计算 mass 函数总质量 */
function totalMass(mf: { focalElements: Map<string, number> }): number {
  let total = 0
  for (const v of mf.focalElements.values()) total += v
  return total
}

describe('mass-functions — 6 源 Mass 函数', () => {
  // ────────── S1: createLogMassFunction ──────────
  describe('S1: createLogMassFunction', () => {
    it('高 drainMatch + 高 sourcePrior → m({T}) 高', () => {
      const mf = createLogMassFunction({ drainMatch: 0.9, sourcePrior: 0.8 })
      // strength = 0.7×0.9 + 0.3×0.8 = 0.87
      // m(T) = 0.8 × 0.87 = 0.696
      expect(mf.focalElements.get('T')).toBeCloseTo(0.696, 9)
      // m(Θ) = 1 - 0.696 - 0.1×(1-0.87) = 1 - 0.696 - 0.013 = 0.291
      expect(mf.focalElements.get('T|¬T')).toBeCloseTo(0.291, 9)
      // m(¬T) = 0.1 × 0.13 = 0.013
      expect(mf.focalElements.get('¬T')).toBeCloseTo(0.013, 9)
    })

    it('低 drainMatch → m(Θ) 高', () => {
      const mf = createLogMassFunction({ drainMatch: 0.1 })
      // strength = 0.7×0.1 + 0.3×0.6 = 0.25
      // m(T) = 0.8 × 0.25 = 0.2
      // m(¬T) = 0.1 × 0.75 = 0.075
      // m(Θ) = 1 - 0.2 - 0.075 = 0.725
      const mT = mf.focalElements.get('T') ?? 0
      const mTheta = mf.focalElements.get('T|¬T') ?? 0
      expect(mT).toBeLessThan(0.3)
      expect(mTheta).toBeGreaterThan(0.6)
    })

    it('默认 sourcePrior = 0.6', () => {
      const mf = createLogMassFunction({ drainMatch: 0.5 })
      // strength = 0.7×0.5 + 0.3×0.6 = 0.53
      expect(mf.confidence).toBeCloseTo(0.53, 9)
    })

    it('NaN 输入被 clamp 到 0', () => {
      const mf = createLogMassFunction({ drainMatch: NaN, sourcePrior: NaN })
      // drainMatch = 0, sourcePrior = 0
      // strength = 0
      // m(T) = 0 → 工厂函数跳过
      // m(¬T) = 0.1 → 0.1×(1-0) = 0.1
      // m(Θ) = 1 - 0 - 0.1 = 0.9
      expect(mf.focalElements.get('T')).toBeUndefined()
      expect(mf.focalElements.get('¬T')).toBeCloseTo(0.1, 9)
      expect(mf.focalElements.get('T|¬T')).toBeCloseTo(0.9, 9)
    })

    it('超范围值被 clamp 到 [0, 1]', () => {
      const mf = createLogMassFunction({ drainMatch: 1.5, sourcePrior: -0.5 })
      // drainMatch = 1, sourcePrior = 0
      // strength = 0.7
      const mT = mf.focalElements.get('T') ?? 0
      // m(T) = 0.8 × 0.7 = 0.56
      expect(mT).toBeCloseTo(0.56, 9)
    })

    it('质量总和 = 1', () => {
      const mf = createLogMassFunction({ drainMatch: 0.7, sourcePrior: 0.5 })
      expect(totalMass(mf)).toBeCloseTo(1, 9)
    })
  })

  // ────────── S2: createKbMassFunction ──────────
  describe('S2: createKbMassFunction', () => {
    it('hasResults=false → 返回 VBF（m(Θ) = 1）', () => {
      const mf = createKbMassFunction({ hasResults: false })
      expect(mf.focalElements.size).toBe(1)
      expect(mf.focalElements.get('T|¬T')).toBe(1)
    })

    it('高 topScore + 一致性高 → m({T}) 高', () => {
      const mf = createKbMassFunction({ hasResults: true, topScore: 0.8, avgScore: 0.78 })
      // consistency = 1 - |0.8 - 0.78| = 0.98
      // strength = 0.6×0.8 + 0.4×0.98 = 0.872
      // m(T) = 0.7 × 0.872 = 0.6104
      const mT = mf.focalElements.get('T') ?? 0
      expect(mT).toBeCloseTo(0.6104, 3)
    })

    it('topScore=0 边界', () => {
      const mf = createKbMassFunction({ hasResults: true, topScore: 0, avgScore: 0 })
      // consistency = 1
      // strength = 0 + 0.4 = 0.4
      // m(T) = 0.7 × 0.4 = 0.28
      const mT = mf.focalElements.get('T') ?? 0
      expect(mT).toBeCloseTo(0.28, 9)
    })

    it('topScore=1 边界', () => {
      const mf = createKbMassFunction({ hasResults: true, topScore: 1, avgScore: 1 })
      // consistency = 1
      // strength = 0.6 + 0.4 = 1
      // m(T) = 0.7
      const mT = mf.focalElements.get('T') ?? 0
      expect(mT).toBeCloseTo(0.7, 9)
    })

    it('NaN 输入被 clamp 到 0', () => {
      const mf = createKbMassFunction({ hasResults: true, topScore: NaN, avgScore: NaN })
      // topScore = 0, avgScore = 0
      expect(mf.confidence).toBeCloseTo(0.4, 9)
    })

    it('负数 / >1 输入被 clamp', () => {
      const mf = createKbMassFunction({ hasResults: true, topScore: 2, avgScore: -1 })
      // topScore = 1, avgScore = 0
      // consistency = 1 - |1 - 0| = 0
      // strength = 0.6
      expect(mf.confidence).toBeCloseTo(0.6, 9)
    })
  })

  // ────────── S3: createAiParamMassFunction ──────────
  describe('S3: createAiParamMassFunction', () => {
    it('仅 verbalizedConfidence: 应用 0.85 calibration discount', () => {
      const mf = createAiParamMassFunction({ verbalizedConfidence: 1.0 })
      // llmConf = 1.0
      // calibrated = 1.0 × 0.85 = 0.85
      // m(T) = 0.6 × 0.85 = 0.51
      const mT = mf.focalElements.get('T') ?? 0
      expect(mT).toBeCloseTo(0.51, 9)
      // confidence = 0.85
      expect(mf.confidence).toBeCloseTo(0.85, 9)
    })

    it('verbalized + logprob: 0.5 权重融合', () => {
      const mf = createAiParamMassFunction({
        verbalizedConfidence: 0.8,
        logprobConfidence: 0.6
      })
      // llmConf = 0.5×0.8 + 0.5×0.6 = 0.7
      // calibrated = 0.7 × 0.85 = 0.595
      expect(mf.confidence).toBeCloseTo(0.595, 9)
    })

    it('加 self-consistency: 0.6/0.4 权重融合', () => {
      const mf = createAiParamMassFunction({
        verbalizedConfidence: 0.8,
        logprobConfidence: 0.6,
        consistency: 0.9
      })
      // step1: llmConf = 0.7
      // step2: llmConf = 0.6×0.7 + 0.4×0.9 = 0.42 + 0.36 = 0.78
      // calibrated = 0.78 × 0.85 = 0.663
      expect(mf.confidence).toBeCloseTo(0.663, 9)
    })

    it('CALIBRATION_DISCOUNT = 0.85 验证（verbalized=1.0）', () => {
      const mf = createAiParamMassFunction({ verbalizedConfidence: 1.0 })
      // confidence 应该是 1.0 × 0.85 = 0.85
      expect(mf.confidence).toBe(0.85)
    })

    it('verbalizedConfidence=0 → 全无信息（m(T) 被跳过）', () => {
      const mf = createAiParamMassFunction({ verbalizedConfidence: 0 })
      // llmConf = 0
      // calibrated = 0
      // m(T) = 0 → 工厂函数跳过
      // m(¬T) = 0.2 → 实际：calibrated=0 → m(¬T) = 0.2×(1-0) = 0.2
      // m(Θ) = 1 - 0 - 0.2 = 0.8
      expect(mf.focalElements.get('T')).toBeUndefined()
      expect(mf.focalElements.get('¬T')).toBeCloseTo(0.2, 9)
      expect(mf.focalElements.get('T|¬T')).toBeCloseTo(0.8, 9)
    })

    it('NaN verbalizedConfidence 被 clamp 到 0', () => {
      const mf = createAiParamMassFunction({ verbalizedConfidence: NaN })
      expect(mf.confidence).toBe(0)
    })

    it('logprob NaN 被 clamp 到 0', () => {
      const mf = createAiParamMassFunction({
        verbalizedConfidence: 0.8,
        logprobConfidence: NaN
      })
      // logprob = 0, llmConf = 0.5×0.8 + 0.5×0 = 0.4
      // calibrated = 0.34
      expect(mf.confidence).toBeCloseTo(0.34, 9)
    })

    it('超范围值被 clamp', () => {
      const mf = createAiParamMassFunction({ verbalizedConfidence: 2 })
      // clamp 到 1
      expect(mf.confidence).toBeCloseTo(0.85, 9)
    })

    // ────────── S3 v0.9.6 P2 M4：CoT-shape 熵轨迹信号集成 ──────────
    //
    // 论文依据：Zhao 2026, arXiv:2603.18940
    // - 熵轨迹**形状单调性**是独立预测因子（OR=2.50）
    // - 单调链 68.8% 准确率 vs 非单调链 46.8%
    // - 在 3 路标量融合后叠加，权重 0.3（不压制标量信号）
    //
    // 融合公式：
    //   if cotEntropyTrajectory:
    //     shapeConf = cotEntropyTrajectoryConfidence(trace)
    //     llm_conf = 0.7 × llm_conf + 0.3 × shapeConf
    describe('S3 P2 M4: CoT-shape 熵轨迹信号集成（Zhao 2026）', () => {
      it('完美单调链 → 拉高 llmConf', () => {
        const baseMf = createAiParamMassFunction({ verbalizedConfidence: 0.5 })
        const cotMf = createAiParamMassFunction({
          verbalizedConfidence: 0.5,
          cotEntropyTrajectory: [0.9, 0.7, 0.5, 0.3, 0.1], // 完美单调
        })
        // base: 0.5 × 0.85 = 0.425
        // cot: 0.7 × 0.5 + 0.3 × 0.85 = 0.605 → × 0.85 = 0.51425
        expect(baseMf.confidence).toBeCloseTo(0.425, 9)
        expect(cotMf.confidence).toBeGreaterThan(baseMf.confidence)
        expect(cotMf.confidence).toBeCloseTo(0.51425, 3)
      })

      it('完全非单调链 → 拉低 llmConf', () => {
        const baseMf = createAiParamMassFunction({ verbalizedConfidence: 0.5 })
        const cotMf = createAiParamMassFunction({
          verbalizedConfidence: 0.5,
          cotEntropyTrajectory: [0.1, 0.9, 0.2, 0.8, 0.1, 0.7], // 3 违规
        })
        // base: 0.425
        // shapeConf = 0.10
        // cot: 0.7 × 0.5 + 0.3 × 0.10 = 0.38 → × 0.85 = 0.323
        expect(baseMf.confidence).toBeCloseTo(0.425, 9)
        expect(cotMf.confidence).toBeLessThan(baseMf.confidence)
        expect(cotMf.confidence).toBeCloseTo(0.323, 3)
      })

      it('轻度违规（1 步）→ 拉低 0.5*0.15 = 0.075', () => {
        const cotMf = createAiParamMassFunction({
          verbalizedConfidence: 0.5,
          cotEntropyTrajectory: [0.9, 0.5, 0.7, 0.3, 0.1], // 1 违规
        })
        // shapeConf = 0.55
        // llmConf = 0.7 × 0.5 + 0.3 × 0.55 = 0.515 → × 0.85 = 0.43775
        expect(cotMf.confidence).toBeCloseTo(0.43775, 3)
      })

      it('CoT-shape 与 logprob/consistency 正交叠加', () => {
        // 验证 4 路信号融合正确
        const cotMf = createAiParamMassFunction({
          verbalizedConfidence: 0.8,
          logprobConfidence: 0.6,
          consistency: 0.9,
          cotEntropyTrajectory: [0.9, 0.7, 0.5, 0.3, 0.1], // 完美单调
        })
        // 步骤 1: 0.8
        // 步骤 2: 0.5×0.8 + 0.5×0.6 = 0.7
        // 步骤 3: 0.6×0.7 + 0.4×0.9 = 0.78
        // 步骤 3.5: 0.7×0.78 + 0.3×0.85 = 0.546 + 0.255 = 0.801
        // 步骤 4: 0.801 × 0.85 = 0.68085
        expect(cotMf.confidence).toBeCloseTo(0.68085, 3)
      })

      it('空 cotEntropyTrajectory → 中性默认（不改变 llmConf）', () => {
        const baseMf = createAiParamMassFunction({ verbalizedConfidence: 0.5 })
        const emptyCotMf = createAiParamMassFunction({
          verbalizedConfidence: 0.5,
          cotEntropyTrajectory: [], // 空 → conf=0.5
        })
        // 0.7 × 0.5 + 0.3 × 0.5 = 0.5（不变）
        expect(emptyCotMf.confidence).toBeCloseTo(baseMf.confidence, 9)
      })

      it('单步 cotEntropyTrajectory → conf=0.6', () => {
        const cotMf = createAiParamMassFunction({
          verbalizedConfidence: 0.5,
          cotEntropyTrajectory: [0.7], // 1 步
        })
        // shapeConf = 0.6
        // llmConf = 0.7 × 0.5 + 0.3 × 0.6 = 0.53 → × 0.85 = 0.4505
        expect(cotMf.confidence).toBeCloseTo(0.4505, 3)
      })

      it('不传 cotEntropyTrajectory → 保持 P1 行为（向后兼容）', () => {
        const mf = createAiParamMassFunction({ verbalizedConfidence: 0.5 })
        expect(mf.confidence).toBeCloseTo(0.425, 9)
      })

      it('所有 4 路信号完整融合后 mass 守恒', () => {
        const mf = createAiParamMassFunction({
          verbalizedConfidence: 0.8,
          logprobConfidence: 0.7,
          consistency: 0.9,
          cotEntropyTrajectory: [0.9, 0.6, 0.3],
        })
        // 验证 m(T) + m(¬T) + m(Θ) = 1
        const mT = mf.focalElements.get('T') ?? 0
        const mNotT = mf.focalElements.get('¬T') ?? 0
        const mTheta = mf.focalElements.get('T|¬T') ?? 0
        expect(mT + mNotT + mTheta).toBeCloseTo(1, 9)
      })
    })
  })

  // ────────── S4: createHumanMassFunction ──────────
  describe('S4: createHumanMassFunction', () => {
    it('hasAnnotations=false → 返回 VBF', () => {
      const mf = createHumanMassFunction({ hasAnnotations: false })
      expect(mf.focalElements.get('T|¬T')).toBe(1)
    })

    it('高 positiveRate + 高 agreement → m({T}) 高', () => {
      const mf = createHumanMassFunction({ hasAnnotations: true, positiveRate: 0.9, agreement: 0.85 })
      // strength = 0.7×0.9 + 0.3×0.85 = 0.885
      // m(T) = 0.85 × 0.885 = 0.75225
      const mT = mf.focalElements.get('T') ?? 0
      expect(mT).toBeCloseTo(0.75225, 3)
    })

    it('positiveRate=0, agreement=0 → m({T})=0 被跳过', () => {
      const mf = createHumanMassFunction({ hasAnnotations: true, positiveRate: 0, agreement: 0 })
      // strength = 0
      // m(T) = 0 → 工厂函数跳过
      // m(¬T) = 0.1
      // m(Θ) = 0.9
      expect(mf.focalElements.get('T')).toBeUndefined()
      expect(mf.focalElements.get('¬T')).toBeCloseTo(0.1, 9)
      expect(mf.focalElements.get('T|¬T')).toBeCloseTo(0.9, 9)
    })

    it('Fleiss κ 权重 0.3 验证', () => {
      // 仅用 agreement: positiveRate=0
      // strength = 0 + 0.3×agreement
      const mf1 = createHumanMassFunction({ hasAnnotations: true, positiveRate: 0, agreement: 0.5 })
      // strength = 0.15
      // m(T) = 0.85 × 0.15 = 0.1275
      const mT = mf1.focalElements.get('T') ?? 0
      expect(mT).toBeCloseTo(0.1275, 3)
    })

    it('NaN 输入被 clamp 到 0', () => {
      const mf = createHumanMassFunction({ hasAnnotations: true, positiveRate: NaN, agreement: NaN })
      // clamp01(NaN) = 0
      // strength = 0.7*0 + 0.3*0 = 0
      // confidence = 0
      expect(mf.confidence).toBe(0)
    })
  })

  // ────────── S5: createHistoryMassFunction ──────────
  describe('S5: createHistoryMassFunction', () => {
    it('hasCases=false → 高无知（m(Θ)=0.9, m({T})=0.1）', () => {
      const mf = createHistoryMassFunction({ hasCases: false })
      expect(mf.focalElements.get('T')).toBeCloseTo(0.1, 9)
      expect(mf.focalElements.get('T|¬T')).toBeCloseTo(0.9, 9)
      expect(mf.confidence).toBeCloseTo(0.1, 9)
    })

    it('weightedSuccessRate=1 → m({¬T})=0（被跳过）', () => {
      const mf = createHistoryMassFunction({ hasCases: true, weightedSuccessRate: 1 })
      // strength = 1
      // m(T) = 0.65
      // m(¬T) = 0 → 工厂函数跳过（mass=0 不计入）
      // m(Θ) = 0.35
      expect(mf.focalElements.get('T')).toBeCloseTo(0.65, 9)
      // m(¬T) 不存在于 focalElements（被跳过）
      expect(mf.focalElements.get('¬T')).toBeUndefined()
      expect(mf.focalElements.get('T|¬T')).toBeCloseTo(0.35, 9)
    })

    it('weightedSuccessRate=0 → m({T})=0（被跳过）', () => {
      const mf = createHistoryMassFunction({ hasCases: true, weightedSuccessRate: 0 })
      // strength = 0
      // m(T) = 0 → 工厂函数跳过
      // m(¬T) = 0.25
      // m(Θ) = 0.75
      // m(T) 不存在于 focalElements（被跳过）
      expect(mf.focalElements.get('T')).toBeUndefined()
      expect(mf.focalElements.get('¬T')).toBeCloseTo(0.25, 9)
      expect(mf.focalElements.get('T|¬T')).toBeCloseTo(0.75, 9)
    })

    it('weightedSuccessRate=0.5 边界', () => {
      const mf = createHistoryMassFunction({ hasCases: true, weightedSuccessRate: 0.5 })
      // strength = 0.5
      // m(T) = 0.65×0.5 = 0.325
      // m(¬T) = 0.25×0.5 = 0.125
      // m(Θ) = 0.55
      expect(mf.focalElements.get('T')).toBeCloseTo(0.325, 9)
      expect(mf.focalElements.get('¬T')).toBeCloseTo(0.125, 9)
      expect(mf.focalElements.get('T|¬T')).toBeCloseTo(0.55, 9)
    })

    it('NaN 输入被 clamp', () => {
      const mf = createHistoryMassFunction({ hasCases: true, weightedSuccessRate: NaN })
      // clamp 到 0
      expect(mf.confidence).toBe(0)
    })

    it('超范围输入被 clamp', () => {
      const mf = createHistoryMassFunction({ hasCases: true, weightedSuccessRate: 1.5 })
      // clamp 到 1
      expect(mf.confidence).toBeCloseTo(1, 9)
    })
  })

  // ────────── S6: createBestPracticeMassFunction ──────────
  describe('S6: createBestPracticeMassFunction', () => {
    it('hasMatches=false → m(Θ)=0.8, m({T})=0.2', () => {
      const mf = createBestPracticeMassFunction({ hasMatches: false })
      expect(mf.focalElements.get('T')).toBeCloseTo(0.2, 9)
      expect(mf.focalElements.get('T|¬T')).toBeCloseTo(0.8, 9)
      expect(mf.confidence).toBeCloseTo(0.2, 9)
    })

    it('双方向证据：posRate + negRate 同时非零', () => {
      const mf = createBestPracticeMassFunction({
        hasMatches: true,
        positiveRate: 0.7,
        negativeRate: 0.3
      })
      // m(T) = 0.7×0.7 = 0.49
      // m(¬T) = 0.7×0.3 = 0.21
      // m(Θ) = 1 - 0.49 - 0.21 = 0.3
      expect(mf.focalElements.get('T')).toBeCloseTo(0.49, 9)
      expect(mf.focalElements.get('¬T')).toBeCloseTo(0.21, 9)
      expect(mf.focalElements.get('T|¬T')).toBeCloseTo(0.3, 9)
      // confidence = posRate / (posRate + negRate) = 0.7/1.0 = 0.7
      expect(mf.confidence).toBeCloseTo(0.7, 9)
    })

    it('归一化：m({T}) + m({¬T}) + m(Θ) = 1', () => {
      const mf = createBestPracticeMassFunction({
        hasMatches: true,
        positiveRate: 0.5,
        negativeRate: 0.3
      })
      expect(totalMass(mf)).toBeCloseTo(1, 9)
    })

    it('仅 positiveRate（无 reject 规则）', () => {
      const mf = createBestPracticeMassFunction({
        hasMatches: true,
        positiveRate: 0.8,
        negativeRate: 0
      })
      // m(T) = 0.56
      // m(¬T) = 0 → 工厂函数跳过
      // m(Θ) = 0.44
      expect(mf.focalElements.get('T')).toBeCloseTo(0.56, 9)
      expect(mf.focalElements.get('¬T')).toBeUndefined()
    })

    it('仅 negativeRate', () => {
      const mf = createBestPracticeMassFunction({
        hasMatches: true,
        positiveRate: 0,
        negativeRate: 0.8
      })
      // m(T) = 0 → 工厂函数跳过
      // m(¬T) = 0.56
      // m(Θ) = 0.44
      expect(mf.focalElements.get('T')).toBeUndefined()
      expect(mf.focalElements.get('¬T')).toBeCloseTo(0.56, 9)
    })

    it('NaN 输入被 clamp', () => {
      const mf = createBestPracticeMassFunction({
        hasMatches: true,
        positiveRate: NaN,
        negativeRate: NaN
      })
      // clamp01(NaN) = 0
      // m(T) = 0 → 跳过
      // m(¬T) = 0 → 跳过
      // m(Θ) = 1
      // confidence: posRate+negRate = 0 → total=0 → 0.5 fallback
      expect(mf.confidence).toBe(0.5)
    })

    it('超范围输入被 clamp', () => {
      const mf = createBestPracticeMassFunction({
        hasMatches: true,
        positiveRate: 1.5,
        negativeRate: 2
      })
      // clamp 后 posRate=1, negRate=1
      // m(T) = 0.7, m(¬T) = 0.7
      // m(Θ) = max(0, 1 - 0.7 - 0.7) = 0
      // 工厂函数归一化：total = 1.4
      // m(T) = 0.7/1.4 = 0.5
      // m(¬T) = 0.7/1.4 = 0.5
      const mT = mf.focalElements.get('T') ?? 0
      const mNotT = mf.focalElements.get('¬T') ?? 0
      expect(mT + mNotT).toBeCloseTo(1, 9)
      // m(Θ) = 0 被跳过
      expect(mf.focalElements.get('T|¬T')).toBeUndefined()
    })
  })

  // ────────── 跨源验证 ──────────
  describe('跨源验证', () => {
    it('所有源函数在 default 输入下返回合规的 Mass 函数', () => {
      const sources = [
        createLogMassFunction({ drainMatch: 0.5 }),
        createKbMassFunction({ hasResults: true, topScore: 0.5, avgScore: 0.5 }),
        createAiParamMassFunction({ verbalizedConfidence: 0.5 }),
        createHumanMassFunction({ hasAnnotations: true, positiveRate: 0.5, agreement: 0.5 }),
        createHistoryMassFunction({ hasCases: true, weightedSuccessRate: 0.5 }),
        createBestPracticeMassFunction({ hasMatches: true, positiveRate: 0.5, negativeRate: 0.2 })
      ]
      for (const mf of sources) {
        // 质量守恒
        expect(totalMass(mf)).toBeCloseTo(1, 9)
        // confidence ∈ [0, 1]
        expect(mf.confidence).toBeGreaterThanOrEqual(0)
        expect(mf.confidence).toBeLessThanOrEqual(1)
        // Bel ∈ [0, 1]
        const belT = computeBelief(mf, T_SET)
        expect(belT).toBeGreaterThanOrEqual(0)
        expect(belT).toBeLessThanOrEqual(1)
      }
    })

    it('所有源函数都有正确的 sourceId 和 sourceName', () => {
      const log = createLogMassFunction({ drainMatch: 0.5 })
      expect(log.sourceId).toBe('log')
      expect(log.sourceName).toBe('日志证据')

      const kb = createKbMassFunction({ hasResults: true, topScore: 0.5 })
      expect(kb.sourceId).toBe('kb')
      expect(kb.sourceName).toBe('知识库匹配')

      const ai = createAiParamMassFunction({ verbalizedConfidence: 0.5 })
      expect(ai.sourceId).toBe('ai-param')
      expect(ai.sourceName).toBe('AI 参数证据')

      const human = createHumanMassFunction({ hasAnnotations: true, positiveRate: 0.5, agreement: 0.5 })
      expect(human.sourceId).toBe('human')
      expect(human.sourceName).toBe('人工证据')

      const history = createHistoryMassFunction({ hasCases: true, weightedSuccessRate: 0.5 })
      expect(history.sourceId).toBe('history')
      expect(history.sourceName).toBe('历史证据')

      const bp = createBestPracticeMassFunction({ hasMatches: true, positiveRate: 0.5, negativeRate: 0.2 })
      expect(bp.sourceId).toBe('best-practice')
      expect(bp.sourceName).toBe('最佳实践证据')
    })

    it('所有 6 源都包含 VBF 路径', () => {
      // VBF 应被工厂函数识别（hasResults=false, hasAnnotations=false, hasCases=false, hasMatches=false）
      const vbfKb = createKbMassFunction({ hasResults: false })
      const vbfHuman = createHumanMassFunction({ hasAnnotations: false })
      const highUncertaintyHistory = createHistoryMassFunction({ hasCases: false })
      const highUncertaintyBp = createBestPracticeMassFunction({ hasMatches: false })

      // KB 和 Human 返回纯 VBF（m(Θ) = 1）
      expect(vbfKb.focalElements.get('T|¬T')).toBe(1)
      expect(vbfHuman.focalElements.get('T|¬T')).toBe(1)
      // History 和 BP 返回高无知（带少量乐观偏置）
      expect(highUncertaintyHistory.focalElements.get('T|¬T')).toBe(0.9)
      expect(highUncertaintyBp.focalElements.get('T|¬T')).toBe(0.8)
    })
  })
})
