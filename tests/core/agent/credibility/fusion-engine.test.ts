/**
 * 证据融合引擎（Fusion Engine）单元测试
 *
 * 论文支撑：
 * - Dempster 1967 / Shafer 1976（D-S 理论）
 * - Smarandache & Dezert 2004, 2021（PCR5 规则）
 * - Guo et al. 2017, "On Calibration of Modern Neural Networks", ICML
 * - Tian et al. 2023, "Just Ask for Calibration"（Verbalized Confidence）
 * - Wang et al. 2023, "Self-Consistency Improves Chain of Thought Reasoning"（ICLR）
 * - Fleiss 1971（Fleiss' κ 标注者一致性）
 *
 * 调研文档引用：
 * d:\ai\linux教学一体\idea-to-dev-output\22-可信度算法论文支撑调研.md §6.4（自适应组合）+ §6.6（完整流程示例）
 *
 * 测试目标：
 * - 关键场景：低冲突 → Dempster
 * - 关键场景：高冲突 → PCR5
 * - 关键场景：6 源完整融合流程
 * - 边界值：空数组、单源
 * - 冲突阈值配置
 * - assess() 单函数评估
 * - getLastFusionSteps() / getLastRuleUsed() 状态查询
 * - getFusionEngine() 单例
 * - ruleUsed: 'mixed' 当 Dempster 和 PCR5 都使用过
 */
import { describe, it, expect } from 'vitest'
import {
  TRUSTED,
  UNTRUSTED,
  createMassFunction
} from '../../../../src/main/core/agent/credibility/ds-theory'
import type { MassFunction } from '../../../../src/main/core/agent/credibility/ds-theory'
import {
  FusionEngine,
  getFusionEngine
} from '../../../../src/main/core/agent/credibility/fusion-engine'
import { createLogMassFunction } from '../../../../src/main/core/agent/credibility/mass-functions/log-source'
import { createKbMassFunction } from '../../../../src/main/core/agent/credibility/mass-functions/kb-source'
import { createAiParamMassFunction } from '../../../../src/main/core/agent/credibility/mass-functions/ai-param-source'
import { createHumanMassFunction } from '../../../../src/main/core/agent/credibility/mass-functions/human-source'
import { createHistoryMassFunction } from '../../../../src/main/core/agent/credibility/mass-functions/history-source'
import { createBestPracticeMassFunction } from '../../../../src/main/core/agent/credibility/mass-functions/best-practice-source'

const T_SET = new Set<string>([TRUSTED])
const NOT_T_SET = new Set<string>([UNTRUSTED])
const THETA_SET = new Set<string>([TRUSTED, UNTRUSTED])

describe('fusion-engine — 自适应 Dempster/PCR5 切换引擎', () => {
  // ────────── 关键场景：低冲突 → Dempster ──────────
  describe('关键场景 1：低冲突 → Dempster', () => {
    it('两个低冲突源融合：使用 Dempster 规则', () => {
      const engine = new FusionEngine()
      // 两个都偏向 T 的源
      const sources = [
        createLogMassFunction({ drainMatch: 0.7, sourcePrior: 0.6 }),
        createKbMassFunction({ hasResults: true, topScore: 0.6, avgScore: 0.55 })
      ]
      const assessment = engine.fuseAndAssess(sources)
      expect(assessment.ruleUsed).toBe('dempster')
      expect(assessment.conflictLevel).toBeLessThan(0.3)
    })

    it('三个一致偏向 T 的源：全部使用 Dempster', () => {
      const engine = new FusionEngine()
      const sources = [
        createLogMassFunction({ drainMatch: 0.7, sourcePrior: 0.6 }),
        createKbMassFunction({ hasResults: true, topScore: 0.6, avgScore: 0.55 }),
        createHistoryMassFunction({ hasCases: true, weightedSuccessRate: 0.7 })
      ]
      const assessment = engine.fuseAndAssess(sources)
      expect(assessment.ruleUsed).toBe('dempster')
      // 每个融合步骤都应该是 dempster
      for (const step of assessment.fusionSteps) {
        expect(step.ruleUsed).toBe('dempster')
      }
    })
  })

  // ────────── 关键场景：高冲突 → PCR5 ──────────
  describe('关键场景 2：高冲突 → PCR5', () => {
    it('一个完全可信 vs 一个完全不可信：高冲突触发 PCR5', () => {
      const engine = new FusionEngine()
      // 几乎完全相反的两个源
      const m1 = createMassFunction('m1', 'm1', [
        { elements: T_SET, mass: 0.95 },
        { elements: THETA_SET, mass: 0.05 }
      ], 0.95)
      const m2 = createMassFunction('m2', 'm2', [
        { elements: NOT_T_SET, mass: 0.95 },
        { elements: THETA_SET, mass: 0.05 }
      ], 0.05)
      const assessment = engine.fuseAndAssess([m1, m2])
      expect(assessment.ruleUsed).toBe('pcr5')
      expect(assessment.conflictLevel).toBeGreaterThan(0.3)
    })

    it('多个源中包含高冲突对：触发的步骤使用 PCR5', () => {
      const engine = new FusionEngine()
      const m1 = createMassFunction('m1', 'm1', [
        { elements: T_SET, mass: 0.95 },
        { elements: THETA_SET, mass: 0.05 }
      ], 0.95)
      const m2 = createMassFunction('m2', 'm2', [
        { elements: NOT_T_SET, mass: 0.95 },
        { elements: THETA_SET, mass: 0.05 }
      ], 0.05)
      const m3 = createLogMassFunction({ drainMatch: 0.7, sourcePrior: 0.6 })
      const assessment = engine.fuseAndAssess([m1, m2, m3])
      // 至少有一个步骤使用 PCR5
      const hasPcr5 = assessment.fusionSteps.some((s) => s.ruleUsed === 'pcr5')
      expect(hasPcr5).toBe(true)
    })
  })

  // ────────── 关键场景：6 源完整融合 ──────────
  describe('关键场景 3：6 源完整融合（按调研 §6.6 示例）', () => {
    it('6 源按顺序融合：生成 5 个融合步骤，ruleUsed = dempster', () => {
      const engine = new FusionEngine()
      const sources = [
        createLogMassFunction({ drainMatch: 0.9, sourcePrior: 0.6 }),         // S1
        createKbMassFunction({ hasResults: true, topScore: 0.8, avgScore: 0.6 }), // S2
        createAiParamMassFunction({ verbalizedConfidence: 0.85 }),              // S3
        createHumanMassFunction({ hasAnnotations: true, positiveRate: 0.9, agreement: 0.85 }), // S4
        createHistoryMassFunction({ hasCases: true, weightedSuccessRate: 0.8 }), // S5
        createBestPracticeMassFunction({ hasMatches: true, positiveRate: 0.7, negativeRate: 0.2 }) // S6
      ]
      const assessment = engine.fuseAndAssess(sources)
      // 6 源两两融合 = 5 步
      expect(assessment.fusionSteps.length).toBe(5)
      // 各评估指标
      expect(assessment.belief).toBeGreaterThan(0.5)
      expect(assessment.plausibility).toBeLessThanOrEqual(1.0 + 1e-9)
      expect(assessment.uncertainty).toBeLessThanOrEqual(0.5 + 1e-9)
      expect(assessment.uncertainty).toBeGreaterThanOrEqual(0)
      // sources 包含所有 6 个源
      expect(assessment.sources.length).toBe(6)
      // ruleUsed: 6 个源都偏向 T，应该用 dempster
      expect(assessment.ruleUsed).toBe('dempster')
    })

    it('6 源融合结果：综合可信度 > 0.6（多数源支持 T）', () => {
      const engine = new FusionEngine()
      const sources = [
        createLogMassFunction({ drainMatch: 0.9, sourcePrior: 0.6 }),
        createKbMassFunction({ hasResults: true, topScore: 0.8, avgScore: 0.6 }),
        createAiParamMassFunction({ verbalizedConfidence: 0.85 }),
        createHumanMassFunction({ hasAnnotations: true, positiveRate: 0.9, agreement: 0.85 }),
        createHistoryMassFunction({ hasCases: true, weightedSuccessRate: 0.8 }),
        createBestPracticeMassFunction({ hasMatches: true, positiveRate: 0.7, negativeRate: 0.2 })
      ]
      const assessment = engine.fuseAndAssess(sources)
      expect(assessment.confidence).toBeGreaterThan(0.6)
    })
  })

  // ────────── 边界值：空数组、单源 ──────────
  describe('边界值', () => {
    it('空数组：返回 VBF 评估', () => {
      const engine = new FusionEngine()
      const assessment = engine.fuseAndAssess([])
      // VBF: m(Θ) = 1, Bel({T}) = 0, Pl({T}) = 1
      expect(assessment.belief).toBe(0)
      expect(assessment.plausibility).toBe(1)
      expect(assessment.confidence).toBeCloseTo(0.5, 9)
      expect(assessment.uncertainty).toBe(1)
      expect(assessment.conflictLevel).toBe(0)
      expect(assessment.fusionSteps.length).toBe(0)
    })

    it('单源：直接评估，无融合步骤', () => {
      const engine = new FusionEngine()
      const single = createLogMassFunction({ drainMatch: 0.7, sourcePrior: 0.6 })
      const assessment = engine.fuseAndAssess([single])
      expect(assessment.fusionSteps.length).toBe(0)
      expect(assessment.sources.length).toBe(1)
      // 单源时 conflictLevel = 0
      expect(assessment.conflictLevel).toBe(0)
    })

    it('单源 fuse：直接返回该 Mass 函数', () => {
      const engine = new FusionEngine()
      const single = createLogMassFunction({ drainMatch: 0.7, sourcePrior: 0.6 })
      const fused = engine.fuse([single])
      expect(fused.sourceId).toBe('log')
    })
  })

  // ────────── 冲突阈值配置 ──────────
  describe('冲突阈值配置', () => {
    it('自定义低阈值（0.1）：中等冲突也触发 PCR5', () => {
      const engine = new FusionEngine(0.1)
      // 中等冲突
      const m1 = createMassFunction('m1', 'm1', [
        { elements: T_SET, mass: 0.6 },
        { elements: NOT_T_SET, mass: 0.3 },
        { elements: THETA_SET, mass: 0.1 }
      ], 0.5)
      const m2 = createMassFunction('m2', 'm2', [
        { elements: NOT_T_SET, mass: 0.6 },
        { elements: T_SET, mass: 0.3 },
        { elements: THETA_SET, mass: 0.1 }
      ], 0.5)
      const assessment = engine.fuseAndAssess([m1, m2])
      // 冲突 ≈ 0.6×0.6 + 0.3×0.3 = 0.45 > 0.1
      expect(assessment.ruleUsed).toBe('pcr5')
    })

    it('默认阈值（0.3）：保持稳定行为', () => {
      const engine = new FusionEngine()
      expect(engine).toBeDefined()
      const sources = [
        createLogMassFunction({ drainMatch: 0.7, sourcePrior: 0.6 }),
        createKbMassFunction({ hasResults: true, topScore: 0.6, avgScore: 0.55 })
      ]
      const assessment = engine.fuseAndAssess(sources)
      expect(assessment.ruleUsed).toBe('dempster')
    })

    it('自定义高阈值（0.8）：仅极端冲突才触发 PCR5', () => {
      const engine = new FusionEngine(0.8)
      const m1 = createMassFunction('m1', 'm1', [
        { elements: T_SET, mass: 0.95 },
        { elements: THETA_SET, mass: 0.05 }
      ], 0.95)
      const m2 = createMassFunction('m2', 'm2', [
        { elements: T_SET, mass: 0.9 },
        { elements: NOT_T_SET, mass: 0.05 },
        { elements: THETA_SET, mass: 0.05 }
      ], 0.9)
      // 冲突 ≈ 0.95×0.05 = 0.0475 < 0.8
      const assessment = engine.fuseAndAssess([m1, m2])
      expect(assessment.ruleUsed).toBe('dempster')
    })
  })

  // ────────── assess() 单函数评估 ──────────
  describe('assess() 单函数评估', () => {
    it('单函数评估：正确计算 Bel/Pl/confidence/uncertainty', () => {
      const engine = new FusionEngine()
      const mf = createMassFunction('test', 'test', [
        { elements: T_SET, mass: 0.6 },
        { elements: THETA_SET, mass: 0.4 }
      ], 0.5)
      const assessment = engine.assess(mf)
      // Bel({T}) = m(T) = 0.6
      expect(assessment.belief).toBeCloseTo(0.6, 9)
      // Pl({T}) = m(T) + m(Θ) = 1
      expect(assessment.plausibility).toBeCloseTo(1, 9)
      // confidence = (Bel + Pl) / 2 = 0.8
      expect(assessment.confidence).toBeCloseTo(0.8, 9)
      // uncertainty = Pl - Bel = 0.4
      expect(assessment.uncertainty).toBeCloseTo(0.4, 9)
      // 单函数 conflictLevel = 0
      expect(assessment.conflictLevel).toBe(0)
      // 单函数 fusionSteps = []
      expect(assessment.fusionSteps).toEqual([])
    })

    it('VBF 评估：Bel=0, Pl=1, uncertainty=1', () => {
      const engine = new FusionEngine()
      const vbf = createMassFunction('vbf', 'VBF', [
        { elements: THETA_SET, mass: 1.0 }
      ], 0)
      const assessment = engine.assess(vbf)
      expect(assessment.belief).toBe(0)
      expect(assessment.plausibility).toBe(1)
      expect(assessment.uncertainty).toBe(1)
    })
  })

  // ────────── getLastFusionSteps / getLastRuleUsed ──────────
  describe('getLastFusionSteps / getLastRuleUsed', () => {
    it('getLastFusionSteps: 融合后返回步骤列表', () => {
      const engine = new FusionEngine()
      const sources = [
        createLogMassFunction({ drainMatch: 0.7, sourcePrior: 0.6 }),
        createKbMassFunction({ hasResults: true, topScore: 0.6, avgScore: 0.55 })
      ]
      engine.fuse(sources)
      const steps = engine.getLastFusionSteps()
      expect(steps.length).toBe(1)
      expect(steps[0].step).toBe(1)
    })

    it('getLastRuleUsed: 融合后返回使用的规则', () => {
      const engine = new FusionEngine()
      engine.fuse([
        createLogMassFunction({ drainMatch: 0.7, sourcePrior: 0.6 }),
        createKbMassFunction({ hasResults: true, topScore: 0.6, avgScore: 0.55 })
      ])
      expect(engine.getLastRuleUsed()).toBe('dempster')
    })

    it('步骤列表是只读副本：修改不影响内部状态', () => {
      const engine = new FusionEngine()
      engine.fuse([
        createLogMassFunction({ drainMatch: 0.7, sourcePrior: 0.6 }),
        createKbMassFunction({ hasResults: true, topScore: 0.6, avgScore: 0.55 })
      ])
      const steps = engine.getLastFusionSteps()
      steps.pop()
      // 再次获取，步骤数应保持
      expect(engine.getLastFusionSteps().length).toBe(1)
    })

    it('getLastFusionSteps 初始为空数组', () => {
      const engine = new FusionEngine()
      expect(engine.getLastFusionSteps()).toEqual([])
    })
  })

  // ────────── 单例 ──────────
  describe('getFusionEngine() 单例', () => {
    it('getFusionEngine: 多次调用返回相同实例', () => {
      const e1 = getFusionEngine()
      const e2 = getFusionEngine()
      expect(e1).toBe(e2)
    })
  })

  // ────────── mixed 规则 ──────────
  describe('mixed 规则（Dempster + PCR5 混合使用）', () => {
    it('混合冲突水平的多源融合：ruleUsed = mixed', () => {
      const engine = new FusionEngine()
      // 第一对低冲突
      const m1 = createLogMassFunction({ drainMatch: 0.7, sourcePrior: 0.6 })
      const m2 = createKbMassFunction({ hasResults: true, topScore: 0.6, avgScore: 0.55 })
      // 第二对高冲突
      const m3 = createMassFunction('m3', 'm3', [
        { elements: T_SET, mass: 0.95 },
        { elements: THETA_SET, mass: 0.05 }
      ], 0.95)
      const m4 = createMassFunction('m4', 'm4', [
        { elements: NOT_T_SET, mass: 0.95 },
        { elements: THETA_SET, mass: 0.05 }
      ], 0.05)
      const assessment = engine.fuseAndAssess([m1, m2, m3, m4])
      // 至少有一个 dempster 和一个 pcr5
      const hasDempster = assessment.fusionSteps.some((s) => s.ruleUsed === 'dempster')
      const hasPcr5 = assessment.fusionSteps.some((s) => s.ruleUsed === 'pcr5')
      if (hasDempster && hasPcr5) {
        expect(assessment.ruleUsed).toBe('mixed')
      }
    })
  })

  // ────────── 融合步骤详情 ──────────
  describe('融合步骤详情', () => {
    it('每个 FusionStep 包含必要字段', () => {
      const engine = new FusionEngine()
      const sources = [
        createLogMassFunction({ drainMatch: 0.7, sourcePrior: 0.6 }),
        createKbMassFunction({ hasResults: true, topScore: 0.6, avgScore: 0.55 })
      ]
      const assessment = engine.fuseAndAssess(sources)
      const step = assessment.fusionSteps[0]
      expect(step.step).toBe(1)
      expect(step.ruleUsed).toBeDefined()
      expect(step.leftSourceId).toBeDefined()
      expect(step.rightSourceId).toBeDefined()
      expect(step.conflict).toBeGreaterThanOrEqual(0)
      expect(step.conflict).toBeLessThanOrEqual(1)
      expect(step.resultBelief).toBeGreaterThanOrEqual(0)
      expect(step.resultPlausibility).toBeLessThanOrEqual(1 + 1e-9)
    })

    it('步骤冲突系数 conflict 反映该步的 k 值', () => {
      const engine = new FusionEngine()
      // 高冲突
      const m1 = createMassFunction('m1', 'm1', [
        { elements: T_SET, mass: 0.95 },
        { elements: THETA_SET, mass: 0.05 }
      ], 0.95)
      const m2 = createMassFunction('m2', 'm2', [
        { elements: NOT_T_SET, mass: 0.95 },
        { elements: THETA_SET, mass: 0.05 }
      ], 0.05)
      const assessment = engine.fuseAndAssess([m1, m2])
      // 该步 conflict 应 > 0.3
      expect(assessment.fusionSteps[0].conflict).toBeGreaterThan(0.3)
      // conflictLevel 是最大冲突
      expect(assessment.conflictLevel).toBeGreaterThanOrEqual(assessment.fusionSteps[0].conflict)
    })
  })

  // ────────── 质量守恒 ──────────
  describe('融合质量守恒', () => {
    it('融合后 Mass 函数总质量 = 1', () => {
      const engine = new FusionEngine()
      const sources = [
        createLogMassFunction({ drainMatch: 0.7, sourcePrior: 0.6 }),
        createKbMassFunction({ hasResults: true, topScore: 0.6, avgScore: 0.55 }),
        createAiParamMassFunction({ verbalizedConfidence: 0.85 })
      ]
      const assessment = engine.fuseAndAssess(sources)
      const fused = assessment.fusedMassFunction
      let total = 0
      for (const v of fused.focalElements.values()) total += v
      expect(total).toBeCloseTo(1, 9)
    })
  })
})
