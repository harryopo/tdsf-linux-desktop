/**
 * D-S 证据理论核心模块单元测试
 *
 * 论文支撑：
 * - Dempster, A.P. (1967). "Upper and Lower Probabilities Induced by a Multivalued Mapping".
 *   Annals of Mathematical Statistics, 38(2): 325-339.
 * - Shafer, G. (1976). "A Mathematical Theory of Evidence". Princeton University Press.
 *
 * 调研文档引用：
 * d:\ai\linux教学一体\idea-to-dev-output\22-可信度算法论文支撑调研.md §2
 *
 * 测试目标：
 * - Set ↔ String 焦元 key 的双向转换（focalKey/parseFocalKey）
 * - 集合运算（setsIntersect/setIntersection/isSubset）
 * - 工厂函数（createMassFunction 归一化、空集跳过、相同焦元合并）
 * - 无信息 Mass 函数 VBF（m(Θ) = 1）
 * - 冲突系数计算（k = Σ_{A∩B=∅} m1(A)·m2(B)）
 * - Dempster 组合规则（含 K≈0 时抛错）
 * - 信任/似真函数（Bel/Pl）
 * - 浮点容差 1e-9 数值稳定性
 */
import { describe, it, expect } from 'vitest'
import {
  TRUSTED,
  UNTRUSTED,
  FRAME_OF_DISCERNMENT,
  TRUSTED_SET,
  UNTRUSTED_SET,
  focalKey,
  parseFocalKey,
  setsIntersect,
  setIntersection,
  isSubset,
  createMassFunction,
  createVacuousMassFunction,
  getMass,
  normalizeMassFunction,
  computeConflict,
  dempsterCombine,
  computeBelief,
  computePlausibility
} from '../../../../src/main/core/agent/credibility/ds-theory'
import type { FocalAssignment, MassFunction } from '../../../../src/main/core/agent/credibility/ds-theory'

/** 焦元快捷 Set */
const T_SET = new Set<string>([TRUSTED])
const NOT_T_SET = new Set<string>([UNTRUSTED])
const THETA_SET = new Set<string>([TRUSTED, UNTRUSTED])

describe('ds-theory — D-S 证据理论核心', () => {
  // ────────── focalKey / parseFocalKey 双向转换 ──────────
  describe('focalKey / parseFocalKey', () => {
    it('focalKey: 空集返回空字符串', () => {
      expect(focalKey(new Set<string>())).toBe('')
    })

    it('focalKey: 单元素 Set 转为字符串', () => {
      expect(focalKey(T_SET)).toBe('T')
      expect(focalKey(NOT_T_SET)).toBe('¬T')
    })

    it('focalKey: 多元素 Set 排序后用 | 连接', () => {
      // Set 是无序的，必须排序后产生稳定 key
      expect(focalKey(THETA_SET)).toBe('T|¬T')
      // 不同顺序的 Set 产生相同 key
      const reverse = new Set<string>([UNTRUSTED, TRUSTED])
      expect(focalKey(reverse)).toBe('T|¬T')
    })

    it('parseFocalKey: 空字符串返回空 Set', () => {
      expect(parseFocalKey('').size).toBe(0)
    })

    it('parseFocalKey: 字符串转 Set', () => {
      expect(parseFocalKey('T')).toEqual(T_SET)
      expect(parseFocalKey('¬T')).toEqual(NOT_T_SET)
      expect(parseFocalKey('T|¬T')).toEqual(THETA_SET)
    })

    it('focalKey ↔ parseFocalKey: 双向转换幂等', () => {
      const sets = [T_SET, NOT_T_SET, THETA_SET, new Set<string>([TRUSTED, UNTRUSTED])]
      for (const s of sets) {
        expect(parseFocalKey(focalKey(s))).toEqual(s)
      }
    })
  })

  // ────────── 集合运算 ──────────
  describe('集合运算', () => {
    it('setsIntersect: 有交集返回 true', () => {
      expect(setsIntersect(T_SET, THETA_SET)).toBe(true)
      expect(setsIntersect(T_SET, T_SET)).toBe(true)
    })

    it('setsIntersect: 无交集返回 false', () => {
      expect(setsIntersect(T_SET, NOT_T_SET)).toBe(false)
    })

    it('setsIntersect: 空集总是不相交', () => {
      expect(setsIntersect(new Set(), T_SET)).toBe(false)
    })

    it('setIntersection: 计算交集', () => {
      const a = new Set<string>([TRUSTED, UNTRUSTED])
      const b = T_SET
      expect(setIntersection(a, b)).toEqual(T_SET)
    })

    it('setIntersection: 不相交返回空集', () => {
      expect(setIntersection(T_SET, NOT_T_SET)).toEqual(new Set())
    })

    it('isSubset: 真子集返回 true', () => {
      expect(isSubset(T_SET, THETA_SET)).toBe(true)
      expect(isSubset(new Set(), T_SET)).toBe(true)
    })

    it('isSubset: 集合自身是自身的子集', () => {
      expect(isSubset(T_SET, T_SET)).toBe(true)
    })

    it('isSubset: 元素不在目标集合返回 false', () => {
      expect(isSubset(THETA_SET, T_SET)).toBe(false)
      expect(isSubset(NOT_T_SET, T_SET)).toBe(false)
    })
  })

  // ────────── 识别框架常量 ──────────
  describe('识别框架常量', () => {
    it('FRAME_OF_DISCERNMENT 包含 T 和 ¬T', () => {
      expect(FRAME_OF_DISCERNMENT.has(TRUSTED)).toBe(true)
      expect(FRAME_OF_DISCERNMENT.has(UNTRUSTED)).toBe(true)
      expect(FRAME_OF_DISCERNMENT.size).toBe(2)
    })

    it('TRUSTED_SET 仅含 T', () => {
      expect(TRUSTED_SET.has(TRUSTED)).toBe(true)
      expect(TRUSTED_SET.size).toBe(1)
    })

    it('UNTRUSTED_SET 仅含 ¬T', () => {
      expect(UNTRUSTED_SET.has(UNTRUSTED)).toBe(true)
      expect(UNTRUSTED_SET.size).toBe(1)
    })
  })

  // ────────── createMassFunction ──────────
  describe('createMassFunction — 工厂函数', () => {
    it('基本焦元赋值', () => {
      const mf = createMassFunction('s1', '源1', [
        { elements: T_SET, mass: 0.7 },
        { elements: THETA_SET, mass: 0.3 }
      ], 0.5)
      expect(mf.sourceId).toBe('s1')
      expect(mf.sourceName).toBe('源1')
      expect(mf.confidence).toBe(0.5)
      // 总和为 1
      let total = 0
      for (const v of mf.focalElements.values()) total += v
      expect(total).toBeCloseTo(1, 9)
    })

    it('归一化：总质量 ≠ 1 时按比例缩放', () => {
      const mf = createMassFunction('s', 's', [
        { elements: T_SET, mass: 0.4 },
        { elements: THETA_SET, mass: 0.2 }
      ], 0.5)
      // 总质量 0.6 → 缩放为 1
      // m(T) = 0.4/0.6 ≈ 0.6667, m(Θ) = 0.2/0.6 ≈ 0.3333
      const t = mf.focalElements.get(focalKey(T_SET)) ?? 0
      const theta = mf.focalElements.get(focalKey(THETA_SET)) ?? 0
      expect(t).toBeCloseTo(0.4 / 0.6, 9)
      expect(theta).toBeCloseTo(0.2 / 0.6, 9)
    })

    it('跳过空集（m(∅) = 0 是 D-S 理论约束）', () => {
      const mf = createMassFunction('s', 's', [
        { elements: T_SET, mass: 0.6 },
        { elements: new Set<string>(), mass: 0.4 }
      ], 0.5)
      // 空集不计入
      let total = 0
      for (const v of mf.focalElements.values()) total += v
      expect(total).toBeCloseTo(1, 9)
      // 空集不在 focalElements 中
      expect(mf.focalElements.has('')).toBe(false)
    })

    it('跳过零质量（mass <= 0）', () => {
      const mf = createMassFunction('s', 's', [
        { elements: T_SET, mass: 0.5 },
        { elements: NOT_T_SET, mass: 0 },
        { elements: THETA_SET, mass: 0.5 }
      ], 0.5)
      // NOT_T_SET 质量为 0，应被跳过
      expect(mf.focalElements.has(focalKey(NOT_T_SET))).toBe(false)
    })

    it('相同焦元的 mass 自动合并', () => {
      const mf = createMassFunction('s', 's', [
        { elements: T_SET, mass: 0.3 },
        { elements: T_SET, mass: 0.4 },
        { elements: THETA_SET, mass: 0.3 }
      ], 0.5)
      // 两次 T_SET 累加为 0.7
      const t = mf.focalElements.get(focalKey(T_SET))
      expect(t).toBeCloseTo(0.7, 9)
    })

    it('confidence 被 clamp 到 [0, 1]', () => {
      const mf1 = createMassFunction('s', 's', [{ elements: T_SET, mass: 1.0 }], 1.5)
      expect(mf1.confidence).toBe(1)
      const mf2 = createMassFunction('s', 's', [{ elements: T_SET, mass: 1.0 }], -0.5)
      expect(mf2.confidence).toBe(0)
    })
  })

  // ────────── createVacuousMassFunction ──────────
  describe('createVacuousMassFunction — VBF 无信息函数', () => {
    it('默认 m(Θ) = 1', () => {
      const vbf = createVacuousMassFunction()
      expect(vbf.focalElements.size).toBe(1)
      const theta = vbf.focalElements.get(focalKey(THETA_SET))
      expect(theta).toBe(1)
    })

    it('自定义 sourceId / sourceName', () => {
      const vbf = createVacuousMassFunction('test', '测试')
      expect(vbf.sourceId).toBe('test')
      expect(vbf.sourceName).toBe('测试')
    })

    it('VBF 与任何 Mass 函数组合保持中性（Dempster）', () => {
      const mf = createMassFunction('a', 'A', [
        { elements: T_SET, mass: 0.7 },
        { elements: THETA_SET, mass: 0.3 }
      ], 0.5)
      const vbf = createVacuousMassFunction('v', 'V')
      const combined = dempsterCombine(mf, vbf)
      // 合取部分：T∩Θ=T (0.7×1=0.7), Θ∩T=T (0.3×0.7=0.21), Θ∩Θ=Θ (0.3×1=0.3)
      // T = 0.91, Θ = 0.3, K = 0.21 (来自 T∩¬T=∅, 0.7×0)
      // 归一化后 m(T) ≈ 0.91/(0.91+0.3) = 0.752
      // 验证 VBF 不会引入额外不确定性
      const beliefT = computeBelief(combined, T_SET)
      const plausT = computePlausibility(combined, T_SET)
      // VBF 中性：Bel 应等于原始 mf 的 Bel（m(T)=0.7）
      expect(beliefT).toBeCloseTo(0.7, 2)
      // Pl 应略高于 Bel（融合后存在 VBF 的 m(Θ) 分量）
      expect(plausT).toBeGreaterThanOrEqual(beliefT)
    })
  })

  // ────────── getMass / normalizeMassFunction ──────────
  describe('getMass / normalizeMassFunction', () => {
    it('getMass: 存在焦元返回 mass', () => {
      const mf = createMassFunction('s', 's', [
        { elements: T_SET, mass: 0.6 },
        { elements: THETA_SET, mass: 0.4 }
      ], 0.5)
      expect(getMass(mf, T_SET)).toBeCloseTo(0.6, 9)
    })

    it('getMass: 不存在焦元返回 0', () => {
      const mf = createMassFunction('s', 's', [
        { elements: T_SET, mass: 1.0 }
      ], 0.5)
      expect(getMass(mf, NOT_T_SET)).toBe(0)
    })

    it('normalizeMassFunction: 不修改原对象', () => {
      const mf = createMassFunction('s', 's', [
        { elements: T_SET, mass: 0.5 },
        { elements: THETA_SET, mass: 0.5 }
      ], 0.5)
      const original = mf.focalElements.get(focalKey(T_SET))
      const normalized = normalizeMassFunction(mf)
      // 归一化前后值不变（已经 = 1）
      expect(normalized.focalElements.get(focalKey(T_SET))).toBeCloseTo(0.5, 9)
      expect(mf.focalElements.get(focalKey(T_SET))).toBe(original)
    })

    it('normalizeMassFunction: 总质量 = 0 返回 VBF', () => {
      // 构造一个总和为 0 的退化 Mass 函数
      const mf: MassFunction = {
        sourceId: 's',
        sourceName: 's',
        focalElements: new Map<string, number>([[focalKey(T_SET), 0]]),
        confidence: 0
      }
      const normalized = normalizeMassFunction(mf)
      // 应退化为 VBF：m(Θ) = 1
      expect(normalized.focalElements.get(focalKey(THETA_SET))).toBe(1)
    })

    it('normalizeMassFunction: 重新缩放非 1 总和', () => {
      const mf: MassFunction = {
        sourceId: 's',
        sourceName: 's',
        focalElements: new Map<string, number>([
          [focalKey(T_SET), 0.4],
          [focalKey(THETA_SET), 0.2]
        ]),
        confidence: 0
      }
      const normalized = normalizeMassFunction(mf)
      expect(normalized.focalElements.get(focalKey(T_SET))).toBeCloseTo(0.4 / 0.6, 9)
      expect(normalized.focalElements.get(focalKey(THETA_SET))).toBeCloseTo(0.2 / 0.6, 9)
    })
  })

  // ────────── computeConflict ──────────
  describe('computeConflict — 冲突系数', () => {
    it('无交集的焦元产生冲突', () => {
      // m1: T → 0.8, m2: ¬T → 0.7
      const m1 = createMassFunction('m1', 'm1', [{ elements: T_SET, mass: 1.0 }], 0.8)
      const m2 = createMassFunction('m2', 'm2', [{ elements: NOT_T_SET, mass: 1.0 }], 0.7)
      // k = 1×1 = 1（完全冲突）
      expect(computeConflict(m1, m2)).toBeCloseTo(1, 9)
    })

    it('完全一致的焦元无冲突', () => {
      const m1 = createMassFunction('m1', 'm1', [{ elements: T_SET, mass: 1.0 }], 0.8)
      const m2 = createMassFunction('m2', 'm2', [{ elements: T_SET, mass: 1.0 }], 0.8)
      expect(computeConflict(m1, m2)).toBe(0)
    })

    it('部分冲突：T vs T+Θ', () => {
      // m1: T → 1, m2: T → 0.6, Θ → 0.4
      const m1 = createMassFunction('m1', 'm1', [{ elements: T_SET, mass: 1.0 }], 1)
      const m2 = createMassFunction('m2', 'm2', [
        { elements: T_SET, mass: 0.6 },
        { elements: THETA_SET, mass: 0.4 }
      ], 0.5)
      // T∩T = T（非空），T∩Θ = T（非空）→ 无冲突
      expect(computeConflict(m1, m2)).toBe(0)
    })

    it('T vs T+¬T 部分冲突', () => {
      // m1: T → 0.6, ¬T → 0.4
      // m2: T → 0.5, ¬T → 0.5
      // k = 0.6×0.5 + 0.4×0.5 = 0.5
      const m1 = createMassFunction('m1', 'm1', [
        { elements: T_SET, mass: 0.6 },
        { elements: NOT_T_SET, mass: 0.4 }
      ], 0.5)
      const m2 = createMassFunction('m2', 'm2', [
        { elements: T_SET, mass: 0.5 },
        { elements: NOT_T_SET, mass: 0.5 }
      ], 0.5)
      expect(computeConflict(m1, m2)).toBeCloseTo(0.5, 9)
    })
  })

  // ────────── dempsterCombine ──────────
  describe('dempsterCombine — Dempster 组合规则', () => {
    it('基本组合：两个单焦元 Mass 函数', () => {
      // m1: T → 1, m2: T → 1
      // m12: T → 1
      const m1 = createMassFunction('m1', 'm1', [{ elements: T_SET, mass: 1.0 }], 1)
      const m2 = createMassFunction('m2', 'm2', [{ elements: T_SET, mass: 1.0 }], 1)
      const combined = dempsterCombine(m1, m2)
      expect(combined.focalElements.get(focalKey(T_SET))).toBeCloseTo(1, 9)
    })

    it('合取 + 归一化：典型低冲突场景', () => {
      // m1: T → 0.8, Θ → 0.2
      // m2: T → 0.7, Θ → 0.3
      // T∩T = T: 0.8×0.7 = 0.56
      // T∩Θ = T: 0.8×0.3 = 0.24
      // Θ∩T = T: 0.2×0.7 = 0.14
      // Θ∩Θ = Θ: 0.2×0.3 = 0.06
      // T = 0.94, Θ = 0.06, K = 1
      const m1 = createMassFunction('m1', 'm1', [
        { elements: T_SET, mass: 0.8 },
        { elements: THETA_SET, mass: 0.2 }
      ], 0.8)
      const m2 = createMassFunction('m2', 'm2', [
        { elements: T_SET, mass: 0.7 },
        { elements: THETA_SET, mass: 0.3 }
      ], 0.7)
      const combined = dempsterCombine(m1, m2)
      expect(combined.focalElements.get(focalKey(T_SET))).toBeCloseTo(0.94, 9)
      expect(combined.focalElements.get(focalKey(THETA_SET))).toBeCloseTo(0.06, 9)
    })

    it('完全冲突抛错（K ≤ 1e-12）', () => {
      const m1 = createMassFunction('m1', 'm1', [{ elements: T_SET, mass: 1.0 }], 1)
      const m2 = createMassFunction('m2', 'm2', [{ elements: NOT_T_SET, mass: 1.0 }], 1)
      // Zadeh 悖论典型场景：Dempster 无法处理
      expect(() => dempsterCombine(m1, m2)).toThrow(/完全冲突|Dempster|PCR5/)
    })

    it('sourceId 和 sourceName 正确拼接', () => {
      const m1 = createMassFunction('a', '源A', [{ elements: T_SET, mass: 1.0 }], 1)
      const m2 = createMassFunction('b', '源B', [{ elements: T_SET, mass: 1.0 }], 1)
      const combined = dempsterCombine(m1, m2)
      expect(combined.sourceId).toBe('a+b')
      expect(combined.sourceName).toContain('⊕')
    })

    it('confidence 取平均值', () => {
      const m1 = createMassFunction('a', 'a', [{ elements: T_SET, mass: 1.0 }], 0.6)
      const m2 = createMassFunction('b', 'b', [{ elements: T_SET, mass: 1.0 }], 0.8)
      const combined = dempsterCombine(m1, m2)
      expect(combined.confidence).toBeCloseTo(0.7, 9)
    })
  })

  // ────────── computeBelief / computePlausibility ──────────
  describe('computeBelief / computePlausibility — 信任与似真函数', () => {
    it('Bel({T}) = m({T})', () => {
      const mf = createMassFunction('s', 's', [
        { elements: T_SET, mass: 0.6 },
        { elements: THETA_SET, mass: 0.4 }
      ], 0.5)
      // Bel({T}) = Σ_{B⊆{T}} m(B) = m({T}) = 0.6
      expect(computeBelief(mf, T_SET)).toBeCloseTo(0.6, 9)
    })

    it('Bel({T, ¬T}) = 1（全集）', () => {
      const mf = createMassFunction('s', 's', [
        { elements: T_SET, mass: 0.6 },
        { elements: NOT_T_SET, mass: 0.1 },
        { elements: THETA_SET, mass: 0.3 }
      ], 0.5)
      // Bel(Θ) = 所有焦元 ⊆ Θ，恒为 1
      expect(computeBelief(mf, THETA_SET)).toBeCloseTo(1, 9)
    })

    it('Pl({T}) = m({T}) + m(Θ)', () => {
      const mf = createMassFunction('s', 's', [
        { elements: T_SET, mass: 0.6 },
        { elements: THETA_SET, mass: 0.4 }
      ], 0.5)
      // Pl({T}) = Σ_{B∩T≠∅} m(B) = m(T) + m(Θ) = 1
      expect(computePlausibility(mf, T_SET)).toBeCloseTo(1, 9)
    })

    it('Pl({¬T}) = m(¬T) + m(Θ)', () => {
      const mf = createMassFunction('s', 's', [
        { elements: NOT_T_SET, mass: 0.3 },
        { elements: T_SET, mass: 0.5 },
        { elements: THETA_SET, mass: 0.2 }
      ], 0.5)
      // Pl({¬T}) = m(¬T) + m(Θ) = 0.5
      expect(computePlausibility(mf, NOT_T_SET)).toBeCloseTo(0.5, 9)
    })

    it('Bel ≤ Pl 恒成立', () => {
      const mf = createMassFunction('s', 's', [
        { elements: T_SET, mass: 0.5 },
        { elements: NOT_T_SET, mass: 0.2 },
        { elements: THETA_SET, mass: 0.3 }
      ], 0.5)
      for (const target of [T_SET, NOT_T_SET, THETA_SET]) {
        const bel = computeBelief(mf, target)
        const pl = computePlausibility(mf, target)
        expect(bel).toBeLessThanOrEqual(pl + 1e-9)
      }
    })

    it('VBF 的 Bel = 0, Pl = 1', () => {
      const vbf = createVacuousMassFunction()
      // Bel({T}) = 0（无 T 焦元）
      expect(computeBelief(vbf, T_SET)).toBe(0)
      // Pl({T}) = 1（Θ 与 T 有交集）
      expect(computePlausibility(vbf, T_SET)).toBe(1)
    })
  })

  // ────────── 数值稳定性 ──────────
  describe('数值稳定性', () => {
    it('浮点容差 1e-9: 大量小数运算不损失精度', () => {
      // 三次 Dempster 组合
      let mf: MassFunction = createMassFunction('a', 'a', [{ elements: T_SET, mass: 1.0 }], 1)
      for (let i = 0; i < 5; i++) {
        const next = createMassFunction(`s${i}`, `S${i}`, [
          { elements: T_SET, mass: 0.7 + i * 0.05 },
          { elements: THETA_SET, mass: 0.3 - i * 0.05 }
        ], 0.5)
        mf = dempsterCombine(mf, next)
      }
      // 总质量应保持为 1
      let total = 0
      for (const v of mf.focalElements.values()) total += v
      expect(total).toBeCloseTo(1, 9)
    })

    it('质量总和校验：所有工厂函数输出总和 = 1', () => {
      const tests: FocalAssignment[][] = [
        [{ elements: T_SET, mass: 1.0 }],
        [{ elements: T_SET, mass: 0.5 }, { elements: NOT_T_SET, mass: 0.5 }],
        [{ elements: T_SET, mass: 0.7 }, { elements: THETA_SET, mass: 0.3 }],
        [{ elements: T_SET, mass: 0.3 }, { elements: NOT_T_SET, mass: 0.3 }, { elements: THETA_SET, mass: 0.4 }]
      ]
      for (const t of tests) {
        const mf = createMassFunction('s', 's', t, 0.5)
        let total = 0
        for (const v of mf.focalElements.values()) total += v
        expect(total).toBeCloseTo(1, 9)
      }
    })
  })
})
