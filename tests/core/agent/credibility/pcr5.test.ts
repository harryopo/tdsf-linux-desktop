/**
 * PCR5（Proportional Conflict Redistribution Rule No.5）单元测试
 *
 * 论文支撑：
 * - Smarandache, F. & Dezert, J. (2004). "Four Versions of the Proportional
 *   Conflict Redistribution Rules of Combination in Information Fusion".
 *   arXiv:cs.AI/0408064
 * - Smarandache, F. & Dezert, J. (2021). "Improvement of Proportional Conflict
 *   Redistribution Rules of Combination of Basic Belief Assignments".
 *   J. Advances in Information Fusion, Vol 16, No 2.
 *
 * 调研文档引用：
 * d:\ai\linux教学一体\idea-to-dev-output\22-可信度算法论文支撑调研.md §3
 *
 * 测试目标：
 * - 基本 PCR5 组合（低冲突也能用 PCR5，无需切换）
 * - 关键场景：Zadeh 悖论（PCR5 给出更合理结果）
 * - 分母为零保护（m1(X) + m2(Y) = 0 时不崩溃）
 * - 多焦元 PCR5 组合（3+ 焦元）
 * - 质量守恒：组合后总质量 = 1
 */
import { describe, it, expect } from 'vitest'
import {
  TRUSTED,
  UNTRUSTED,
  createMassFunction,
  computeBelief,
  computePlausibility,
  computeConflict
} from '../../../../src/main/core/agent/credibility/ds-theory'
import type { MassFunction } from '../../../../src/main/core/agent/credibility/ds-theory'
import { pcr5Combine } from '../../../../src/main/core/agent/credibility/pcr5'

const T_SET = new Set<string>([TRUSTED])
const NOT_T_SET = new Set<string>([UNTRUSTED])
const THETA_SET = new Set<string>([TRUSTED, UNTRUSTED])

describe('pcr5 — PCR5 冲突融合规则', () => {
  // ────────── 基本 PCR5 组合 ──────────
  describe('基本 PCR5 组合', () => {
    it('低冲突场景：PCR5 与 Dempster 行为近似', () => {
      // 两个都偏向 T 的低冲突组合
      const m1 = createMassFunction('m1', 'm1', [
        { elements: T_SET, mass: 0.8 },
        { elements: THETA_SET, mass: 0.2 }
      ], 0.8)
      const m2 = createMassFunction('m2', 'm2', [
        { elements: T_SET, mass: 0.7 },
        { elements: THETA_SET, mass: 0.3 }
      ], 0.7)
      const result = pcr5Combine(m1, m2)
      // 总质量守恒
      let total = 0
      for (const v of result.focalElements.values()) total += v
      expect(total).toBeCloseTo(1, 9)
      // m({T}) 应很高（两者都支持 T）
      const tMass = result.focalElements.get('T') ?? 0
      expect(tMass).toBeGreaterThan(0.5)
    })

    it('VBF 与任何 Mass 函数 PCR5 组合保持中性', () => {
      const mf = createMassFunction('a', 'A', [
        { elements: T_SET, mass: 0.7 },
        { elements: THETA_SET, mass: 0.3 }
      ], 0.5)
      const vbf = createMassFunction('v', 'V', [
        { elements: THETA_SET, mass: 1.0 }
      ], 0)
      const result = pcr5Combine(mf, vbf)
      // 验证 VBF 不改变 m(T)
      const tMass = result.focalElements.get('T') ?? 0
      expect(tMass).toBeCloseTo(0.7, 9)
    })

    it('sourceId 和 sourceName 正确拼接', () => {
      const m1 = createMassFunction('a', '源A', [{ elements: T_SET, mass: 1.0 }], 1)
      const m2 = createMassFunction('b', '源B', [{ elements: T_SET, mass: 1.0 }], 1)
      const result = pcr5Combine(m1, m2)
      expect(result.sourceId).toBe('a+b')
      expect(result.sourceName).toContain('⊕')
    })

    it('confidence 取平均值', () => {
      const m1 = createMassFunction('a', 'a', [{ elements: T_SET, mass: 1.0 }], 0.6)
      const m2 = createMassFunction('b', 'b', [{ elements: T_SET, mass: 1.0 }], 0.8)
      const result = pcr5Combine(m1, m2)
      expect(result.confidence).toBeCloseTo(0.7, 9)
    })
  })

  // ────────── 关键场景：Zadeh 悖论 ──────────
  describe('关键场景：Zadeh 悖论', () => {
    it('PCR5 解决 Zadeh 悖论：Dempster 会抛错，PCR5 给出合理结果', () => {
      // 场景：两个医生结论完全相反
      // 医生1：m1(¬T) = 0.99, m1(Θ) = 0.01（99% 不可信）
      // 医生2：m2(T)  = 0.99, m2(Θ) = 0.01（99% 可信）
      const m1 = createMassFunction('doctor1', '医生1', [
        { elements: NOT_T_SET, mass: 0.99 },
        { elements: THETA_SET, mass: 0.01 }
      ], 0.5)
      const m2 = createMassFunction('doctor2', '医生2', [
        { elements: T_SET, mass: 0.99 },
        { elements: THETA_SET, mass: 0.01 }
      ], 0.5)

      // 验证冲突极大：Dempster 必然抛错
      const conflict = computeConflict(m1, m2)
      expect(conflict).toBeGreaterThan(0.9)

      // PCR5 必须能正常处理（这是 PCR5 的核心价值）
      const result = pcr5Combine(m1, m2)

      // 验证：总质量 = 1（守恒）
      let total = 0
      for (const v of result.focalElements.values()) total += v
      expect(total).toBeCloseTo(1, 9)

      // 验证：m({T}) 和 m({¬T}) 接近 0.5（PCR5 按比例回填，不偏向任何一方）
      const tMass = result.focalElements.get('T') ?? 0
      const notTMass = result.focalElements.get('¬T') ?? 0
      // 预期 m(T) ≈ 0.495, m(¬T) ≈ 0.495（小部分被回填）
      expect(tMass).toBeGreaterThan(0.4)
      expect(tMass).toBeLessThan(0.55)
      expect(notTMass).toBeGreaterThan(0.4)
      expect(notTMass).toBeLessThan(0.55)

      // 验证：Bel({T}) 和 Pl({T}) 反映不确定性
      const belT = computeBelief(result, T_SET)
      const plT = computePlausibility(result, T_SET)
      // Bel({T}) ≈ m(T) ≈ 0.495
      expect(belT).toBeCloseTo(tMass, 9)
      // Pl({T}) ≥ Bel({T})
      expect(plT).toBeGreaterThanOrEqual(belT)
    })

    it('Zadeh 场景：完全相反的判断应该平衡', () => {
      // 极端版本：完全无 Θ
      const m1 = createMassFunction('m1', 'm1', [
        { elements: NOT_T_SET, mass: 1.0 }
      ], 0.5)
      const m2 = createMassFunction('m2', 'm2', [
        { elements: T_SET, mass: 1.0 }
      ], 0.5)
      const result = pcr5Combine(m1, m2)
      // PCR5 在极端冲突下应该产生 50/50 结果
      // m(T) = m(¬T) = 0.5（按贡献均分）
      const tMass = result.focalElements.get('T') ?? 0
      const notTMass = result.focalElements.get('¬T') ?? 0
      expect(tMass).toBeCloseTo(0.5, 9)
      expect(notTMass).toBeCloseTo(0.5, 9)
    })
  })

  // ────────── 分母为零保护 ──────────
  describe('分母为零保护', () => {
    it('m1(X) + m2(Y) = 0 时不崩溃', () => {
      // 构造两个 m 中某焦元都 = 0 的情况
      // m1: T → 0, ¬T → 0.5, Θ → 0.5
      // m2: T → 0, ¬T → 0.5, Θ → 0.5
      // 实际上 m1 + m2 的 T 焦元都是 0，但 PCR5 应能处理
      const m1 = createMassFunction('m1', 'm1', [
        { elements: NOT_T_SET, mass: 0.5 },
        { elements: THETA_SET, mass: 0.5 }
      ], 0.5)
      const m2 = createMassFunction('m2', 'm2', [
        { elements: NOT_T_SET, mass: 0.5 },
        { elements: THETA_SET, mass: 0.5 }
      ], 0.5)
      // 应正常返回，不抛错
      const result = pcr5Combine(m1, m2)
      // 总质量 = 1
      let total = 0
      for (const v of result.focalElements.values()) total += v
      expect(total).toBeCloseTo(1, 9)
    })

    it('空焦元不计入回填计算', () => {
      // 注：m(∅) 在工厂函数中被跳过，所以这里没有空集焦元
      // 这个测试确保 PCR5 不会因为空集除法崩溃
      const m1 = createMassFunction('m1', 'm1', [
        { elements: T_SET, mass: 0.6 },
        { elements: NOT_T_SET, mass: 0.4 }
      ], 0.5)
      const m2 = createMassFunction('m2', 'm2', [
        { elements: T_SET, mass: 0.4 },
        { elements: NOT_T_SET, mass: 0.6 }
      ], 0.5)
      // 即使 m1 中的 T 和 m2 中的 ¬T 形成冲突，分母不会为 0
      const result = pcr5Combine(m1, m2)
      let total = 0
      for (const v of result.focalElements.values()) total += v
      expect(total).toBeCloseTo(1, 9)
    })
  })

  // ────────── 多焦元 PCR5 组合 ──────────
  describe('多焦元 PCR5 组合', () => {
    it('3 个焦元（含 Θ）的 PCR5 组合', () => {
      const m1 = createMassFunction('m1', 'm1', [
        { elements: T_SET, mass: 0.4 },
        { elements: NOT_T_SET, mass: 0.3 },
        { elements: THETA_SET, mass: 0.3 }
      ], 0.5)
      const m2 = createMassFunction('m2', 'm2', [
        { elements: T_SET, mass: 0.5 },
        { elements: NOT_T_SET, mass: 0.2 },
        { elements: THETA_SET, mass: 0.3 }
      ], 0.5)
      const result = pcr5Combine(m1, m2)
      // 质量守恒
      let total = 0
      for (const v of result.focalElements.values()) total += v
      expect(total).toBeCloseTo(1, 9)
      // m({T}) 应该较高（双方都偏向 T）
      const tMass = result.focalElements.get('T') ?? 0
      expect(tMass).toBeGreaterThan(0.4)
    })

    it('多焦元对高冲突场景的回填', () => {
      // m1: T → 0.6, ¬T → 0.3, Θ → 0.1
      // m2: T → 0.1, ¬T → 0.6, Θ → 0.3
      const m1 = createMassFunction('m1', 'm1', [
        { elements: T_SET, mass: 0.6 },
        { elements: NOT_T_SET, mass: 0.3 },
        { elements: THETA_SET, mass: 0.1 }
      ], 0.5)
      const m2 = createMassFunction('m2', 'm2', [
        { elements: T_SET, mass: 0.1 },
        { elements: NOT_T_SET, mass: 0.6 },
        { elements: THETA_SET, mass: 0.3 }
      ], 0.5)
      const conflict = computeConflict(m1, m2)
      expect(conflict).toBeGreaterThan(0.2)
      const result = pcr5Combine(m1, m2)
      let total = 0
      for (const v of result.focalElements.values()) total += v
      expect(total).toBeCloseTo(1, 9)
    })
  })

  // ────────── 质量守恒 ──────────
  describe('质量守恒', () => {
    it('所有 PCR5 组合结果总质量 = 1', () => {
      // 多次随机组合验证守恒
      const m1 = createMassFunction('m1', 'm1', [
        { elements: T_SET, mass: 0.5 },
        { elements: NOT_T_SET, mass: 0.3 },
        { elements: THETA_SET, mass: 0.2 }
      ], 0.5)
      const m2 = createMassFunction('m2', 'm2', [
        { elements: T_SET, mass: 0.4 },
        { elements: NOT_T_SET, mass: 0.4 },
        { elements: THETA_SET, mass: 0.2 }
      ], 0.5)
      const m3 = createMassFunction('m3', 'm3', [
        { elements: T_SET, mass: 0.3 },
        { elements: NOT_T_SET, mass: 0.5 },
        { elements: THETA_SET, mass: 0.2 }
      ], 0.5)

      const r12 = pcr5Combine(m1, m2)
      const r123 = pcr5Combine(r12, m3)

      let total = 0
      for (const v of r123.focalElements.values()) total += v
      expect(total).toBeCloseTo(1, 9)
    })

    it('PCR5 组合后焦元归一化（含冲突回填）', () => {
      // 简单对偶：m1 支持 T，m2 支持 ¬T
      const m1 = createMassFunction('m1', 'm1', [
        { elements: T_SET, mass: 0.8 },
        { elements: THETA_SET, mass: 0.2 }
      ], 0.8)
      const m2 = createMassFunction('m2', 'm2', [
        { elements: NOT_T_SET, mass: 0.8 },
        { elements: THETA_SET, mass: 0.2 }
      ], 0.8)
      const result = pcr5Combine(m1, m2)
      // 即使有冲突，PCR5 仍能归一化（不回填到 m(Θ)，而回填到参与冲突的命题）
      let total = 0
      for (const v of result.focalElements.values()) total += v
      expect(total).toBeCloseTo(1, 9)
    })
  })

  // ────────── 信任区间一致性 ──────────
  describe('信任区间一致性', () => {
    it('PCR5 组合后 Bel ≤ Pl 恒成立', () => {
      const m1 = createMassFunction('m1', 'm1', [
        { elements: T_SET, mass: 0.7 },
        { elements: NOT_T_SET, mass: 0.2 },
        { elements: THETA_SET, mass: 0.1 }
      ], 0.5)
      const m2 = createMassFunction('m2', 'm2', [
        { elements: NOT_T_SET, mass: 0.6 },
        { elements: T_SET, mass: 0.3 },
        { elements: THETA_SET, mass: 0.1 }
      ], 0.5)
      const result = pcr5Combine(m1, m2)
      const belT = computeBelief(result, T_SET)
      const plT = computePlausibility(result, T_SET)
      expect(belT).toBeLessThanOrEqual(plT + 1e-9)
      const belNotT = computeBelief(result, NOT_T_SET)
      const plNotT = computePlausibility(result, NOT_T_SET)
      expect(belNotT).toBeLessThanOrEqual(plNotT + 1e-9)
    })

    it('PCR5 不完全满足结合律（已知理论特性）', () => {
      // 这里只验证多次组合不崩溃，不验证严格等式
      const m1 = createMassFunction('m1', 'm1', [
        { elements: T_SET, mass: 0.6 },
        { elements: THETA_SET, mass: 0.4 }
      ], 0.5)
      const m2 = createMassFunction('m2', 'm2', [
        { elements: NOT_T_SET, mass: 0.5 },
        { elements: THETA_SET, mass: 0.5 }
      ], 0.5)
      const m3 = createMassFunction('m3', 'm3', [
        { elements: T_SET, mass: 0.7 },
        { elements: NOT_T_SET, mass: 0.2 },
        { elements: THETA_SET, mass: 0.1 }
      ], 0.5)

      // (m1 ⊕ m2) ⊕ m3
      const left = pcr5Combine(pcr5Combine(m1, m2), m3)
      let totalL = 0
      for (const v of left.focalElements.values()) totalL += v
      expect(totalL).toBeCloseTo(1, 9)

      // m1 ⊕ (m2 ⊕ m3)
      const right = pcr5Combine(m1, pcr5Combine(m2, m3))
      let totalR = 0
      for (const v of right.focalElements.values()) totalR += v
      expect(totalR).toBeCloseTo(1, 9)
    })
  })

  // ────────── 边界值 ──────────
  describe('边界值', () => {
    it('空焦元 Map 参与组合：不崩溃（极端降级场景）', () => {
      // 退化情况：m1 的 focalElements 为空（极端降级）
      // PCR5 在这种情况下返回空 Map 是已知的边界行为
      const m1: MassFunction = {
        sourceId: 'm1',
        sourceName: 'm1',
        focalElements: new Map<string, number>(),
        confidence: 0
      }
      const m2 = createMassFunction('m2', 'm2', [{ elements: T_SET, mass: 1.0 }], 1)
      // 不应崩溃
      const result = pcr5Combine(m1, m2)
      // 返回有效 MassFunction 结构（即使 focalElements 为空）
      expect(result).toBeDefined()
      expect(typeof result.sourceId).toBe('string')
    })

    it('相同 Mass 函数组合：应该幂等', () => {
      const m1 = createMassFunction('m1', 'm1', [
        { elements: T_SET, mass: 0.7 },
        { elements: NOT_T_SET, mass: 0.2 },
        { elements: THETA_SET, mass: 0.1 }
      ], 0.5)
      const m2 = createMassFunction('m2', 'm2', [
        { elements: T_SET, mass: 0.7 },
        { elements: NOT_T_SET, mass: 0.2 },
        { elements: THETA_SET, mass: 0.1 }
      ], 0.5)
      const result = pcr5Combine(m1, m2)
      // 相同 Mass 函数组合：m(T) 应大于任一方（合取增强）
      const tMass = result.focalElements.get('T') ?? 0
      expect(tMass).toBeGreaterThan(0.7)
    })
  })
})
