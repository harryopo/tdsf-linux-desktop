/**
 * 融合源 Mass 函数单元测试（7 源）
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
 * - log：createLogMassFunction（Drain3 + sourcePrior，先验以加法式进定标）
 * - observation：createObservationMassFunction（命令/指标/配置读数，#106 新增档）
 * - knowledge：createKnowledgeMassFunction（向量检索相似度；旧名 'kb'）
 * - ai-param：createAiParamMassFunction（verbalized + logprob + consistency + calibration）
 * - human：createHumanMassFunction（人工标注 + Fleiss' κ）
 * - history：createHistoryMassFunction（历史决策案例）
 * - best-practice：createBestPracticeMassFunction（YAML 规则库）
 *
 * #106 B 之后本文件多了一类断言：**先验必须真的改变数字**。
 * 每张表都成对比一次（sourcePrior=1 的全质量 vs 默认先验的折后质量），
 * 谁把 applySourcePrior 摘掉，这里立刻红——旧实现有五个先验常量写着却没人读，
 * 就是缺这道对照。
 */
import { describe, it, expect } from 'vitest'
import {
  TRUSTED,
  UNTRUSTED,
  createVacuousMassFunction,
  computeBelief
} from '../../../../src/main/core/agent/credibility/ds-theory'
import { createLogMassFunction } from '../../../../src/main/core/agent/credibility/mass-functions/log-source'
import { createObservationMassFunction } from '../../../../src/main/core/agent/credibility/mass-functions/observation-source'
import { createKnowledgeMassFunction } from '../../../../src/main/core/agent/credibility/mass-functions/knowledge-source'
import { createAiParamMassFunction } from '../../../../src/main/core/agent/credibility/mass-functions/ai-param-source'
import { createHumanMassFunction } from '../../../../src/main/core/agent/credibility/mass-functions/human-source'
import { createHistoryMassFunction } from '../../../../src/main/core/agent/credibility/mass-functions/history-source'
import { createBestPracticeMassFunction } from '../../../../src/main/core/agent/credibility/mass-functions/best-practice-source'
import { SOURCE_PRIORS } from '@shared/credibility'

const T_SET = new Set<string>([TRUSTED])
const NOT_T_SET = new Set<string>([UNTRUSTED])
const THETA_SET = new Set<string>([TRUSTED, UNTRUSTED])

/** 计算 mass 函数总质量 */
function totalMass(mf: { focalElements: Map<string, number> }): number {
  let total = 0
  for (const v of mf.focalElements.values()) total += v
  return total
}

describe('mass-functions — 7 源 Mass 函数', () => {
  // ────────── log: createLogMassFunction ──────────
  describe('log: createLogMassFunction', () => {
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

    it('默认 sourcePrior 取自 SOURCE_PRIORS.log（0.6，不再各模块自抄一份）', () => {
      const mf = createLogMassFunction({ drainMatch: 0.5 })
      // strength = 0.7×0.5 + 0.3×0.6 = 0.53
      expect(SOURCE_PRIORS.log).toBe(0.6)
      expect(mf.confidence).toBeCloseTo(0.53, 9)
    })

    it('log 档的先验是加法式、不重复打折（#106 的唯一例外）', () => {
      // 若按其余各档的乘法口径，strength 会是 0.7×drainMatch×prior，
      // 等于同一个先验在定标过的公式里再乘一遍
      const mf = createLogMassFunction({ drainMatch: 1, sourcePrior: 0.6 })
      expect(mf.confidence).toBeCloseTo(0.7 * 1 + 0.3 * 0.6, 9)
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

  // ────────── observation: createObservationMassFunction（#106 新增档）──────────
  describe('observation: createObservationMassFunction', () => {
    it('没有观测 → 完全无知（不凭空给信念）', () => {
      const mf = createObservationMassFunction({ hasObservations: false })
      expect(mf.focalElements.size).toBe(1)
      expect(mf.focalElements.get('T|¬T')).toBe(1)
      expect(mf.confidence).toBe(0)
    })

    it('全部观测成功 → strength = 1 × 0.9，反向质量不为零', () => {
      const mf = createObservationMassFunction({ hasObservations: true, successRate: 1 })
      // strength = 0.9 → m(T) = 0.8 × 0.9 = 0.72
      expect(mf.confidence).toBeCloseTo(SOURCE_PRIORS.observation, 9)
      expect(mf.focalElements.get('T')).toBeCloseTo(0.72, 9)
      // 先验折扣后 strength 不再是 1，所以还剩 0.15 × 0.1 的反向质量
      expect(mf.focalElements.get('¬T')).toBeCloseTo(0.015, 9)
      expect(mf.focalElements.get('T|¬T')).toBeCloseTo(0.265, 9)
    })

    it('全部观测失败 → 只剩反向证据 m({¬T}) = 0.15', () => {
      const mf = createObservationMassFunction({ hasObservations: true, successRate: 0 })
      expect(mf.focalElements.get('T')).toBeUndefined()
      expect(mf.focalElements.get('¬T')).toBeCloseTo(0.15, 9)
      expect(mf.focalElements.get('T|¬T')).toBeCloseTo(0.85, 9)
    })

    it('半数成功 → m({T}) = 0.8 × (0.5 × 0.9)', () => {
      const mf = createObservationMassFunction({ hasObservations: true, successRate: 0.5 })
      // strength = 0.45
      expect(mf.focalElements.get('T')).toBeCloseTo(0.36, 9)
      expect(mf.focalElements.get('¬T')).toBeCloseTo(0.0825, 9)
      expect(mf.focalElements.get('T|¬T')).toBeCloseTo(0.5575, 9)
    })

    it('不传 successRate 按中性 0.5（与半数成功同值）', () => {
      const mf = createObservationMassFunction({ hasObservations: true })
      expect(mf.confidence).toBeCloseTo(0.45, 9)
    })

    it('NaN / 超范围被 clamp', () => {
      expect(
        createObservationMassFunction({ hasObservations: true, successRate: NaN }).confidence
      ).toBe(0)
      expect(
        createObservationMassFunction({ hasObservations: true, successRate: 3 }).confidence
      ).toBeCloseTo(SOURCE_PRIORS.observation, 9)
    })

    it('先验真的乘进质量', () => {
      const discounted = createObservationMassFunction({ hasObservations: true, successRate: 1 })
      const undiscounted = createObservationMassFunction({
        hasObservations: true,
        successRate: 1,
        sourcePrior: 1,
      })
      expect(undiscounted.confidence).toBeCloseTo(1, 9)
      expect(discounted.confidence).toBeCloseTo(1 * SOURCE_PRIORS.observation, 9)
      expect(discounted.confidence).toBeLessThan(undiscounted.confidence)
    })
  })

  // ────────── knowledge: createKnowledgeMassFunction（旧名 kb）──────────
  describe('knowledge: createKnowledgeMassFunction', () => {
    it('hasResults=false → 返回 VBF（m(Θ) = 1）', () => {
      const mf = createKnowledgeMassFunction({ hasResults: false })
      expect(mf.focalElements.size).toBe(1)
      expect(mf.focalElements.get('T|¬T')).toBe(1)
    })

    it('高 topScore + 一致性高 → 质量按先验 0.5 折半', () => {
      const mf = createKnowledgeMassFunction({ hasResults: true, topScore: 0.8, avgScore: 0.78 })
      // consistency = 1 - |0.8 - 0.78| = 0.98
      // quality = 0.6×0.8 + 0.4×0.98 = 0.872
      // strength = 0.872 × 0.5 = 0.436
      // m(T) = 0.7 × 0.436 = 0.3052
      const mT = mf.focalElements.get('T') ?? 0
      expect(mT).toBeCloseTo(0.3052, 6)
    })

    it('topScore=0 边界', () => {
      const mf = createKnowledgeMassFunction({ hasResults: true, topScore: 0, avgScore: 0 })
      // consistency = 1 → quality = 0.4 → strength = 0.2 → m(T) = 0.14
      const mT = mf.focalElements.get('T') ?? 0
      expect(mT).toBeCloseTo(0.14, 9)
    })

    it('topScore=1 边界（满分相似度也只值先验那么多）', () => {
      const mf = createKnowledgeMassFunction({ hasResults: true, topScore: 1, avgScore: 1 })
      // quality = 1 → strength = 1 × 0.5 = 0.5 → m(T) = 0.35
      const mT = mf.focalElements.get('T') ?? 0
      expect(mf.confidence).toBeCloseTo(SOURCE_PRIORS.knowledge, 9)
      expect(mT).toBeCloseTo(0.35, 9)
    })

    it('NaN 输入被 clamp 到 0', () => {
      const mf = createKnowledgeMassFunction({ hasResults: true, topScore: NaN, avgScore: NaN })
      // topScore = 0, avgScore = 0 → quality = 0.4 → strength = 0.2
      expect(mf.confidence).toBeCloseTo(0.2, 9)
    })

    it('负数 / >1 输入被 clamp', () => {
      const mf = createKnowledgeMassFunction({ hasResults: true, topScore: 2, avgScore: -1 })
      // topScore = 1, avgScore = 0 → consistency = 0 → quality = 0.6 → strength = 0.3
      expect(mf.confidence).toBeCloseTo(0.3, 9)
    })

    it('先验真的乘进质量', () => {
      const discounted = createKnowledgeMassFunction({ hasResults: true, topScore: 1, avgScore: 1 })
      const undiscounted = createKnowledgeMassFunction({
        hasResults: true,
        topScore: 1,
        avgScore: 1,
        sourcePrior: 1,
      })
      expect(undiscounted.confidence).toBeCloseTo(1, 9)
      expect(discounted.confidence).toBeCloseTo(1 * SOURCE_PRIORS.knowledge, 9)
    })
  })

  // ────────── ai-param: createAiParamMassFunction ──────────
  describe('ai-param: createAiParamMassFunction', () => {
    it('仅 verbalizedConfidence：先过 0.85 校准折扣，再过 0.7 源先验', () => {
      const mf = createAiParamMassFunction({ verbalizedConfidence: 1.0 })
      // llmConf = 1.0 → calibrated = 0.85 → strength = 0.85 × 0.7 = 0.595
      // m(T) = 0.6 × 0.595 = 0.357
      const mT = mf.focalElements.get('T') ?? 0
      expect(mT).toBeCloseTo(0.357, 9)
      expect(mf.confidence).toBeCloseTo(0.595, 9)
    })

    it('verbalized + logprob: 0.5 权重融合', () => {
      const mf = createAiParamMassFunction({
        verbalizedConfidence: 0.8,
        logprobConfidence: 0.6
      })
      // llmConf = 0.5×0.8 + 0.5×0.6 = 0.7 → calibrated = 0.595 → strength = 0.4165
      expect(mf.confidence).toBeCloseTo(0.4165, 9)
    })

    it('加 self-consistency: 0.6/0.4 权重融合', () => {
      const mf = createAiParamMassFunction({
        verbalizedConfidence: 0.8,
        logprobConfidence: 0.6,
        consistency: 0.9
      })
      // step1: 0.7 → step2: 0.6×0.7 + 0.4×0.9 = 0.78
      // calibrated = 0.663 → strength = 0.4641
      expect(mf.confidence).toBeCloseTo(0.4641, 9)
    })

    it('CALIBRATION_DISCOUNT(0.85) 与源先验(0.7) 两道折扣都在，且各自可单独关掉', () => {
      const mf = createAiParamMassFunction({ verbalizedConfidence: 1.0 })
      // 0.85 × 0.7 —— 少任何一道都会红
      expect(mf.confidence).toBeCloseTo(0.85 * SOURCE_PRIORS['ai-param'], 9)
      const noPrior = createAiParamMassFunction({
        verbalizedConfidence: 1.0,
        sourcePrior: 1,
      })
      expect(noPrior.confidence).toBeCloseTo(0.85, 9)
    })

    it('verbalizedConfidence=0 → 全无信息（m(T) 被跳过）', () => {
      const mf = createAiParamMassFunction({ verbalizedConfidence: 0 })
      // strength = 0 → m(T) 跳过，m(¬T) = 0.2，m(Θ) = 0.8
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
      // llmConf = 0.5×0.8 + 0.5×0 = 0.4 → calibrated = 0.34 → strength = 0.238
      expect(mf.confidence).toBeCloseTo(0.238, 9)
    })

    it('超范围值被 clamp', () => {
      const mf = createAiParamMassFunction({ verbalizedConfidence: 2 })
      // clamp 到 1 → 0.85 × 0.7
      expect(mf.confidence).toBeCloseTo(0.595, 9)
    })

    // ────────── CoT-shape 熵轨迹信号集成 ──────────
    //
    // 论文依据：Zhao 2026, arXiv:2603.18940
    // - 熵轨迹**形状单调性**是独立预测因子（OR=2.50）
    // - 单调链 68.8% 准确率 vs 非单调链 46.8%
    // - 在 3 路标量融合后叠加，权重 0.3（不压制标量信号）
    //
    // 融合公式（叠加发生在校准折扣之前，先验折扣在最后）：
    //   if cotEntropyTrajectory:
    //     shapeConf = cotEntropyTrajectoryConfidence(trace)
    //     llm_conf = 0.7 × llm_conf + 0.3 × shapeConf
    describe('CoT-shape 熵轨迹信号集成（Zhao 2026）', () => {
      it('完美单调链 → 拉高 llmConf', () => {
        const baseMf = createAiParamMassFunction({ verbalizedConfidence: 0.5 })
        const cotMf = createAiParamMassFunction({
          verbalizedConfidence: 0.5,
          cotEntropyTrajectory: [0.9, 0.7, 0.5, 0.3, 0.1], // 完美单调
        })
        // base: 0.5 → cal 0.425 → ×0.7 = 0.2975
        // cot: 0.7×0.5 + 0.3×0.85 = 0.605 → cal 0.51425 → ×0.7 = 0.359975
        expect(baseMf.confidence).toBeCloseTo(0.2975, 9)
        expect(cotMf.confidence).toBeGreaterThan(baseMf.confidence)
        expect(cotMf.confidence).toBeCloseTo(0.359975, 5)
      })

      it('完全非单调链 → 拉低 llmConf', () => {
        const baseMf = createAiParamMassFunction({ verbalizedConfidence: 0.5 })
        const cotMf = createAiParamMassFunction({
          verbalizedConfidence: 0.5,
          cotEntropyTrajectory: [0.1, 0.9, 0.2, 0.8, 0.1, 0.7], // 3 违规
        })
        // shapeConf = 0.10 → llmConf 0.38 → cal 0.323 → ×0.7 = 0.2261
        expect(baseMf.confidence).toBeCloseTo(0.2975, 9)
        expect(cotMf.confidence).toBeLessThan(baseMf.confidence)
        expect(cotMf.confidence).toBeCloseTo(0.2261, 5)
      })

      it('轻度违规（1 步）→ 同样拉低', () => {
        const cotMf = createAiParamMassFunction({
          verbalizedConfidence: 0.5,
          cotEntropyTrajectory: [0.9, 0.5, 0.7, 0.3, 0.1], // 1 违规
        })
        // shapeConf = 0.55 → llmConf 0.515 → cal 0.43775 → ×0.7 = 0.306425
        expect(cotMf.confidence).toBeCloseTo(0.306425, 5)
      })

      it('CoT-shape 与 logprob/consistency 正交叠加', () => {
        const cotMf = createAiParamMassFunction({
          verbalizedConfidence: 0.8,
          logprobConfidence: 0.6,
          consistency: 0.9,
          cotEntropyTrajectory: [0.9, 0.7, 0.5, 0.3, 0.1], // 完美单调
        })
        // 0.8 → 0.7 → 0.78 → 0.7×0.78 + 0.3×0.85 = 0.801
        // cal = 0.68085 → ×0.7 = 0.476595
        expect(cotMf.confidence).toBeCloseTo(0.476595, 5)
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
        // llmConf = 0.7×0.5 + 0.3×0.6 = 0.53 → cal 0.4505 → ×0.7 = 0.31535
        expect(cotMf.confidence).toBeCloseTo(0.31535, 5)
      })

      it('不传 cotEntropyTrajectory → 不参与形状信号', () => {
        const mf = createAiParamMassFunction({ verbalizedConfidence: 0.5 })
        expect(mf.confidence).toBeCloseTo(0.2975, 9)
      })

      it('所有 4 路信号完整融合后 mass 守恒', () => {
        const mf = createAiParamMassFunction({
          verbalizedConfidence: 0.8,
          logprobConfidence: 0.7,
          consistency: 0.9,
          cotEntropyTrajectory: [0.9, 0.6, 0.3],
        })
        const mT = mf.focalElements.get('T') ?? 0
        const mNotT = mf.focalElements.get('¬T') ?? 0
        const mTheta = mf.focalElements.get('T|¬T') ?? 0
        expect(mT + mNotT + mTheta).toBeCloseTo(1, 9)
      })
    })
  })

  // ────────── human: createHumanMassFunction ──────────
  describe('human: createHumanMassFunction', () => {
    it('hasAnnotations=false → 返回 VBF', () => {
      const mf = createHumanMassFunction({ hasAnnotations: false })
      expect(mf.focalElements.get('T|¬T')).toBe(1)
    })

    it('高 positiveRate + 高 agreement → m({T}) 高', () => {
      const mf = createHumanMassFunction({ hasAnnotations: true, positiveRate: 0.9, agreement: 0.85 })
      // quality = 0.7×0.9 + 0.3×0.85 = 0.885 → strength = 0.885 × 0.9 = 0.7965
      // m(T) = 0.85 × 0.7965 = 0.677025
      const mT = mf.focalElements.get('T') ?? 0
      expect(mT).toBeCloseTo(0.677025, 6)
    })

    it('positiveRate=0, agreement=0 → m({T})=0 被跳过', () => {
      const mf = createHumanMassFunction({ hasAnnotations: true, positiveRate: 0, agreement: 0 })
      // strength = 0 → m(T) 跳过，m(¬T) = 0.1，m(Θ) = 0.9
      expect(mf.focalElements.get('T')).toBeUndefined()
      expect(mf.focalElements.get('¬T')).toBeCloseTo(0.1, 9)
      expect(mf.focalElements.get('T|¬T')).toBeCloseTo(0.9, 9)
    })

    it('Fleiss κ 权重 0.3 验证', () => {
      const mf1 = createHumanMassFunction({ hasAnnotations: true, positiveRate: 0, agreement: 0.5 })
      // quality = 0.3×0.5 = 0.15 → strength = 0.135 → m(T) = 0.85 × 0.135 = 0.11475
      const mT = mf1.focalElements.get('T') ?? 0
      expect(mT).toBeCloseTo(0.11475, 6)
    })

    it('NaN 输入被 clamp 到 0', () => {
      const mf = createHumanMassFunction({ hasAnnotations: true, positiveRate: NaN, agreement: NaN })
      expect(mf.confidence).toBe(0)
    })

    it('先验真的乘进质量', () => {
      const discounted = createHumanMassFunction({
        hasAnnotations: true,
        positiveRate: 1,
        agreement: 1,
      })
      const undiscounted = createHumanMassFunction({
        hasAnnotations: true,
        positiveRate: 1,
        agreement: 1,
        sourcePrior: 1,
      })
      expect(undiscounted.confidence).toBeCloseTo(1, 9)
      expect(discounted.confidence).toBeCloseTo(1 * SOURCE_PRIORS.human, 9)
    })
  })

  // ────────── history: createHistoryMassFunction ──────────
  describe('history: createHistoryMassFunction', () => {
    it('hasCases=false → 完全无知（旧实现这里凭空给 0.1 信念，已删）', () => {
      const mf = createHistoryMassFunction({ hasCases: false })
      expect(mf.focalElements.get('T')).toBeUndefined()
      expect(mf.focalElements.get('T|¬T')).toBe(1)
      expect(mf.confidence).toBe(0)
    })

    it('weightedSuccessRate=1 → 只剩先验那一道折扣', () => {
      const mf = createHistoryMassFunction({ hasCases: true, weightedSuccessRate: 1 })
      // strength = 1 × 0.75 = 0.75 → m(T) = 0.65 × 0.75 = 0.4875
      expect(mf.focalElements.get('T')).toBeCloseTo(0.4875, 9)
      // m(¬T) = 0.25 × (1 - 0.75) = 0.0625
      expect(mf.focalElements.get('¬T')).toBeCloseTo(0.0625, 9)
      expect(mf.focalElements.get('T|¬T')).toBeCloseTo(0.45, 9)
    })

    it('weightedSuccessRate=0 → m({T})=0（被跳过）', () => {
      const mf = createHistoryMassFunction({ hasCases: true, weightedSuccessRate: 0 })
      expect(mf.focalElements.get('T')).toBeUndefined()
      expect(mf.focalElements.get('¬T')).toBeCloseTo(0.25, 9)
      expect(mf.focalElements.get('T|¬T')).toBeCloseTo(0.75, 9)
    })

    it('weightedSuccessRate=0.5 边界', () => {
      const mf = createHistoryMassFunction({ hasCases: true, weightedSuccessRate: 0.5 })
      // strength = 0.5 × 0.75 = 0.375
      expect(mf.focalElements.get('T')).toBeCloseTo(0.24375, 9)
      expect(mf.focalElements.get('¬T')).toBeCloseTo(0.15625, 9)
      expect(mf.focalElements.get('T|¬T')).toBeCloseTo(0.6, 9)
    })

    it('NaN 输入被 clamp', () => {
      const mf = createHistoryMassFunction({ hasCases: true, weightedSuccessRate: NaN })
      expect(mf.confidence).toBe(0)
    })

    it('超范围输入被 clamp 到先验上限', () => {
      const mf = createHistoryMassFunction({ hasCases: true, weightedSuccessRate: 1.5 })
      // clamp 到 1 → strength = 0.75
      expect(mf.confidence).toBeCloseTo(SOURCE_PRIORS.history, 9)
    })
  })

  // ────────── best-practice: createBestPracticeMassFunction ──────────
  describe('best-practice: createBestPracticeMassFunction', () => {
    it('hasMatches=false → 完全无知（旧实现凭空给 0.2 信念，已删）', () => {
      const mf = createBestPracticeMassFunction({ hasMatches: false })
      expect(mf.focalElements.get('T')).toBeUndefined()
      expect(mf.focalElements.get('T|¬T')).toBe(1)
      expect(mf.confidence).toBe(0)
    })

    it('双方向证据：posRate + negRate 同时非零（两向同比例折先验）', () => {
      const mf = createBestPracticeMassFunction({
        hasMatches: true,
        positiveRate: 0.7,
        negativeRate: 0.3
      })
      // m(T) = 0.7 × (0.7×0.8) = 0.392
      // m(¬T) = 0.7 × (0.3×0.8) = 0.168
      // m(Θ) = 1 - 0.392 - 0.168 = 0.44
      expect(mf.focalElements.get('T')).toBeCloseTo(0.392, 9)
      expect(mf.focalElements.get('¬T')).toBeCloseTo(0.168, 9)
      expect(mf.focalElements.get('T|¬T')).toBeCloseTo(0.44, 9)
      // confidence = approve 占比，先验同比例折两向 → 比值不变
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
      // m(T) = 0.7 × (0.8×0.8) = 0.448，m(¬T) = 0 → 跳过
      expect(mf.focalElements.get('T')).toBeCloseTo(0.448, 9)
      expect(mf.focalElements.get('¬T')).toBeUndefined()
    })

    it('仅 negativeRate', () => {
      const mf = createBestPracticeMassFunction({
        hasMatches: true,
        positiveRate: 0,
        negativeRate: 0.8
      })
      expect(mf.focalElements.get('T')).toBeUndefined()
      expect(mf.focalElements.get('¬T')).toBeCloseTo(0.448, 9)
    })

    it('NaN 输入被 clamp', () => {
      const mf = createBestPracticeMassFunction({
        hasMatches: true,
        positiveRate: NaN,
        negativeRate: NaN
      })
      // 两向都是 0 → 只剩 m(Θ) = 1，confidence 走 0.5 兜底
      expect(mf.confidence).toBe(0.5)
    })

    it('超范围输入被 clamp', () => {
      const mf = createBestPracticeMassFunction({
        hasMatches: true,
        positiveRate: 1.5,
        negativeRate: 2
      })
      // clamp 后 posRate=1, negRate=1 → m(T)=m(¬T)=0.7×0.8=0.56，和 1.12 > 1
      // 工厂函数归一化 → 各 0.5，m(Θ) = 0 被跳过
      const mT = mf.focalElements.get('T') ?? 0
      const mNotT = mf.focalElements.get('¬T') ?? 0
      expect(mT + mNotT).toBeCloseTo(1, 9)
      expect(mf.focalElements.get('T|¬T')).toBeUndefined()
    })
  })

  // ────────── 跨源验证 ──────────
  describe('跨源验证', () => {
    it('所有源函数在 default 输入下返回合规的 Mass 函数', () => {
      const sources = [
        createLogMassFunction({ drainMatch: 0.5 }),
        createObservationMassFunction({ hasObservations: true, successRate: 0.5 }),
        createKnowledgeMassFunction({ hasResults: true, topScore: 0.5, avgScore: 0.5 }),
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

      const obs = createObservationMassFunction({ hasObservations: true, successRate: 1 })
      expect(obs.sourceId).toBe('observation')
      expect(obs.sourceName).toBe('直接观测证据')

      const knowledge = createKnowledgeMassFunction({ hasResults: true, topScore: 0.5 })
      expect(knowledge.sourceId).toBe('knowledge')
      expect(knowledge.sourceName).toBe('知识库匹配')

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

    it('有数据但质量为空的四条都走 VBF 路径（不再凭空投信念）', () => {
      const vbfKb = createKnowledgeMassFunction({ hasResults: false })
      const vbfObs = createObservationMassFunction({ hasObservations: false })
      const vbfHuman = createHumanMassFunction({ hasAnnotations: false })
      const vbfHistory = createHistoryMassFunction({ hasCases: false })
      const vbfBp = createBestPracticeMassFunction({ hasMatches: false })

      for (const mf of [vbfKb, vbfObs, vbfHuman, vbfHistory, vbfBp]) {
        // 纯 VBF：只有 Θ 一个焦元、质量 1、confidence 0
        expect(mf.focalElements.get('T|¬T'), `${mf.sourceId} 应返回真空 mass`).toBe(1)
        expect(mf.focalElements.size, `${mf.sourceId} 不该带别的焦元`).toBe(1)
      }
    })

    it('真空 mass 是融合的单位元：不改变其它源的结论', () => {
      const vacuous = createVacuousMassFunction('vacuous', '无信息')
      expect(computeBelief(vacuous, T_SET)).toBe(0)
      expect(computeBelief(vacuous, NOT_T_SET)).toBe(0)
      expect(computeBelief(vacuous, THETA_SET)).toBe(1)
    })
  })
})
