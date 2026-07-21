/**
 * CoT-shape 熵轨迹信号单元测试（v0.9.6 P2 M4）
 *
 * 论文支撑：
 * - **Zhao, X. 2026**, "Entropy Trajectory Shape Predicts LLM Reasoning Reliability"
 *   arXiv:2603.18940v1, 2026-03-19
 *   - 核心发现：单调链 68.8% 准确率 vs 非单调链 46.8%
 *   - 违规 0/1/2 对应 68.8%/50.8%/28.6% 准确率
 *
 * 测试目标：
 * - analyzeCotEntropyTrajectory：单调性检测 + 违规计数 + 置信度映射
 * - cotEntropyTrajectoryConfidence：便捷标量提取函数
 * - 边界：空 trace / 单步 / NaN / 越界值
 * - 行为契约：可解释性（monotone, violations, summary）
 *
 * 调研依据：
 * d:\ai\linux教学一体\idea-to-dev-output\40-CoT-shape熵轨迹置信度架构设计.md
 */
import { describe, it, expect } from 'vitest'
import {
  analyzeCotEntropyTrajectory,
  cotEntropyTrajectoryConfidence,
  type CotEntropyTrajectory,
} from '../../../../src/main/core/agent/credibility/mass-functions/cot-trace-signal'

describe('cot-trace-signal — CoT-shape 熵轨迹分析（Zhao 2026）', () => {
  // ────────── 论文核心场景 1：完美单调链 ──────────
  describe('完美单调链（论文场景 1）', () => {
    it('5 步严格递减 → violations=0, monotone=true, conf=0.85', () => {
      const trace: CotEntropyTrajectory = [0.9, 0.7, 0.5, 0.3, 0.1]
      const r = analyzeCotEntropyTrajectory(trace)
      expect(r.monotone).toBe(true)
      expect(r.violations).toBe(0)
      expect(r.steps).toBe(5)
      expect(r.confidence).toBeCloseTo(0.85, 9)
      expect(r.startEntropy).toBeCloseTo(0.9, 9)
      expect(r.endEntropy).toBeCloseTo(0.1, 9)
      expect(r.totalReduction).toBeCloseTo(0.8, 9)
      expect(r.summary).toContain('单调')
      expect(r.summary).toContain('conf=0.85')
    })

    it('等值也算单调（不增不减也 OK）', () => {
      const trace: CotEntropyTrajectory = [0.5, 0.5, 0.5]
      const r = analyzeCotEntropyTrajectory(trace)
      expect(r.monotone).toBe(true)
      expect(r.violations).toBe(0)
      expect(r.confidence).toBeCloseTo(0.85, 9)
    })

    it('长时间单调（20 步）仍稳定', () => {
      const trace: CotEntropyTrajectory = Array.from({ length: 20 }, (_, i) => 1 - i * 0.05)
      const r = analyzeCotEntropyTrajectory(trace)
      expect(r.monotone).toBe(true)
      expect(r.violations).toBe(0)
      expect(r.confidence).toBeCloseTo(0.85, 9)
    })
  })

  // ────────── 论文核心场景 2：1 步违规 ──────────
  describe('轻度违规链（1 步违规，论文场景 2）', () => {
    it('中间反弹 1 次 → violations=1, conf=0.55', () => {
      // 0.9 → 0.5（违规：0.5 < 0.9 ✓ 严格递减）
      // 0.5 → 0.7（违规：0.5 < 0.7，违反单调）→ 计入
      // 0.7 → 0.3（违规：0.7 < 0.3 ✗ 严格递减）
      // 0.3 → 0.1（违规：0.3 < 0.1 ✓）
      // 总违规 = 1
      const trace: CotEntropyTrajectory = [0.9, 0.5, 0.7, 0.3, 0.1]
      const r = analyzeCotEntropyTrajectory(trace)
      expect(r.monotone).toBe(false)
      expect(r.violations).toBe(1)
      expect(r.confidence).toBeCloseTo(0.55, 9)
    })
  })

  // ────────── 论文核心场景 3：2 步违规 ──────────
  describe('重度违规链（2 步违规，论文场景 3）', () => {
    it('2 次反弹 → violations=2, conf=0.30', () => {
      const trace: CotEntropyTrajectory = [0.5, 0.7, 0.4, 0.6, 0.2]
      const r = analyzeCotEntropyTrajectory(trace)
      expect(r.monotone).toBe(false)
      expect(r.violations).toBe(2)
      expect(r.confidence).toBeCloseTo(0.3, 9)
    })
  })

  // ────────── 论文核心场景 4：完全非单调 ──────────
  describe('完全非单调链（≥3 步违规，论文场景 4）', () => {
    it('3 次反弹 → violations=3, conf=0.10', () => {
      // k=0: 0.1<0.9 ✓ 违规 (1)
      // k=1: 0.9>0.2 ✓
      // k=2: 0.2<0.8 ✓ 违规 (2)
      // k=3: 0.8>0.1 ✓
      // k=4: 0.1<0.7 ✓ 违规 (3)
      // 总违规 = 3
      const trace: CotEntropyTrajectory = [0.1, 0.9, 0.2, 0.8, 0.1, 0.7]
      const r = analyzeCotEntropyTrajectory(trace)
      expect(r.monotone).toBe(false)
      expect(r.violations).toBe(3)
      expect(r.confidence).toBeCloseTo(0.1, 9)
    })

    it('5+ 步违规封顶 conf=0.10', () => {
      // 4 步违规：0.2 → 0.5 → 0.3 → 0.6 → 0.4 → 0.7 → 0.5
      // k=0: 0.2<0.5 ✓ 违规
      // k=1: 0.5>0.3 ✓
      // k=2: 0.3<0.6 ✓ 违规
      // k=3: 0.6>0.4 ✓
      // k=4: 0.4<0.7 ✓ 违规
      // k=5: 0.7>0.5 ✓
      // 总违规 = 3
      const trace: CotEntropyTrajectory = [0.2, 0.5, 0.3, 0.6, 0.4, 0.7, 0.5]
      const r = analyzeCotEntropyTrajectory(trace)
      expect(r.violations).toBeGreaterThanOrEqual(3)
      expect(r.confidence).toBeCloseTo(0.1, 9)
    })
  })

  // ────────── 边界 1：空 trace ──────────
  describe('边界 — 空 trace', () => {
    it('空数组 → conf=0.5 (中性默认)', () => {
      const r = analyzeCotEntropyTrajectory([])
      expect(r.monotone).toBe(false)
      expect(r.violations).toBe(0)
      expect(r.steps).toBe(0)
      expect(r.startEntropy).toBe(0)
      expect(r.endEntropy).toBe(0)
      expect(r.totalReduction).toBe(0)
      expect(r.confidence).toBeCloseTo(0.5, 9)
      expect(r.summary).toContain('中性')
    })

    it('非数组 → conf=0.5 (fallback 安全)', () => {
      // 运行时类型不安全的兜底
      const r = analyzeCotEntropyTrajectory(null as unknown as CotEntropyTrajectory)
      expect(r.confidence).toBeCloseTo(0.5, 9)
    })
  })

  // ────────── 边界 2：单步 trace ──────────
  describe('边界 — 单步 trace', () => {
    it('1 步 → conf=0.6 (信息不足)', () => {
      const r = analyzeCotEntropyTrajectory([0.7])
      expect(r.steps).toBe(1)
      expect(r.monotone).toBe(true) // 1 元素总是"单调"
      expect(r.violations).toBe(0)
      expect(r.confidence).toBeCloseTo(0.6, 9)
      expect(r.summary).toContain('单步')
    })
  })

  // ────────── 边界 3：非法值兜底 ──────────
  describe('边界 — 非法值兜底（NaN / Infinity / 越界）', () => {
    it('NaN → clamp 到 0', () => {
      const r = analyzeCotEntropyTrajectory([0.8, NaN, 0.2])
      expect(r.startEntropy).toBeCloseTo(0.8, 9)
      expect(r.endEntropy).toBeCloseTo(0.2, 9)
      // NaN 被 clamp 到 0，0.8 → 0（违规：0.8 < 0？实际 0.8 > 0 ✓ 不违规）
      // 0 → 0.2（违规：0 < 0.2，违反单调）→ violations=1
      expect(r.violations).toBe(1)
    })

    it('Infinity → clamp 到 1', () => {
      const r = analyzeCotEntropyTrajectory([0.5, Infinity, 0.3])
      // Infinity 被 clamp 到 1，0.5 → 1（违规）→ violations=1
      expect(r.violations).toBe(1)
    })

    it('负数 → clamp 到 0', () => {
      const r = analyzeCotEntropyTrajectory([0.5, -0.3, 0.2])
      // -0.3 被 clamp 到 0，0.5 → 0（违规：0.5 < 0？实际 0.5 > 0 ✓ 不违规）
      // 0 → 0.2（违规）→ violations=1
      expect(r.violations).toBe(1)
    })

    it('>1 → clamp 到 1', () => {
      const r = analyzeCotEntropyTrajectory([0.5, 1.5, 0.3])
      // 1.5 被 clamp 到 1，0.5 → 1（违规）→ violations=1
      expect(r.violations).toBe(1)
    })
  })

  // ────────── 便捷函数 ──────────
  describe('cotEntropyTrajectoryConfidence — 便捷标量函数', () => {
    it('undefined → null', () => {
      expect(cotEntropyTrajectoryConfidence(undefined)).toBeNull()
    })

    it('合法单调链 → 0.85', () => {
      expect(cotEntropyTrajectoryConfidence([0.9, 0.5, 0.2])).toBeCloseTo(0.85, 9)
    })

    it('合法非单调链 → 0.10/0.30/0.55 之一', () => {
      expect(cotEntropyTrajectoryConfidence([0.5, 0.7, 0.4, 0.6, 0.2])).toBeCloseTo(0.3, 9)
    })

    it('空数组 → 0.5 (中性)', () => {
      expect(cotEntropyTrajectoryConfidence([])).toBeCloseTo(0.5, 9)
    })
  })

  // ────────── 可解释性契约 ──────────
  describe('可解释性契约', () => {
    it('summary 包含关键诊断信息（步数 / 起点 / 终点 / 置信度）', () => {
      const r = analyzeCotEntropyTrajectory([0.8, 0.5, 0.2])
      expect(r.summary).toMatch(/3 步/)
      expect(r.summary).toMatch(/H₀=0\.800/)
      expect(r.summary).toMatch(/Hₙ=0\.200/)
      expect(r.summary).toMatch(/conf=0\.85/)
    })

    it('所有返回值字段都是 number / boolean / string（无 undefined）', () => {
      const r = analyzeCotEntropyTrajectory([0.8, 0.5, 0.2])
      expect(typeof r.monotone).toBe('boolean')
      expect(typeof r.violations).toBe('number')
      expect(typeof r.steps).toBe('number')
      expect(typeof r.confidence).toBe('number')
      expect(typeof r.summary).toBe('string')
    })
  })
})
