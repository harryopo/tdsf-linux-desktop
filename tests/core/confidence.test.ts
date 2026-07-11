/**
 * 置信度计算模块单元测试
 */
import { describe, it, expect } from 'vitest'
import {
  getSourcePrior,
  calculateConfidence,
  calculateEvidenceConfidence
} from '../../src/main/core/confidence'
import type { Evidence } from '../../src/shared/models'

describe('confidence — 置信度计算', () => {
  // ────────── getSourcePrior ──────────

  it('getSourcePrior: 返回所有来源类型的正确先验值', () => {
    expect(getSourcePrior('log')).toBe(0.6)
    expect(getSourcePrior('metric')).toBe(0.8)
    expect(getSourcePrior('command')).toBe(0.9)
    expect(getSourcePrior('config')).toBe(0.7)
    expect(getSourcePrior('knowledge')).toBe(0.5)
  })

  // ────────── calculateConfidence ──────────

  it('calculateConfidence: 正常计算 0.7×drain + 0.3×prior', () => {
    // 0.7×0.8 + 0.3×0.9 = 0.56 + 0.27 = 0.83
    expect(calculateConfidence(0.8, 0.9)).toBeCloseTo(0.83, 5)
    // 0.7×0.5 + 0.3×0.6 = 0.35 + 0.18 = 0.53
    expect(calculateConfidence(0.5, 0.6)).toBeCloseTo(0.53, 5)
  })

  it('calculateConfidence: 边界值 0 和 1', () => {
    expect(calculateConfidence(0, 0)).toBe(0)
    expect(calculateConfidence(1, 1)).toBe(1)
  })

  it('calculateConfidence: 超范围值被 clamp 到 [0, 1]', () => {
    // drainMatch=-0.5 → clamp 0, sourcePrior=2 → clamp 1
    // 0.7×0 + 0.3×1 = 0.3
    expect(calculateConfidence(-0.5, 2)).toBeCloseTo(0.3, 5)
    // drainMatch=1.5 → clamp 1, sourcePrior=-1 → clamp 0
    // 0.7×1 + 0.3×0 = 0.7
    expect(calculateConfidence(1.5, -1)).toBeCloseTo(0.7, 5)
  })

  it('calculateConfidence: NaN 输入视为 0', () => {
    expect(calculateConfidence(NaN, 0.9)).toBeCloseTo(0.27, 5)
    expect(calculateConfidence(0.8, NaN)).toBeCloseTo(0.56, 5)
    expect(calculateConfidence(NaN, NaN)).toBe(0)
  })

  // ────────── calculateEvidenceConfidence ──────────

  it('calculateEvidenceConfidence: 返回带计算后置信度的证据副本', () => {
    const evidence: Evidence = {
      id: 'ev-1',
      source: 'command',
      sourceDetail: 'free -m',
      content: 'total: 2048 used: 1024',
      drainMatch: 0.9,
      sourcePrior: 0, // 会被覆盖为 command 的先验 0.9
      confidence: 0,  // 会被重算
      timestamp: Date.now(),
      verified: false
    }
    const result = calculateEvidenceConfidence(evidence)
    // sourcePrior 应被覆盖为 0.9
    expect(result.sourcePrior).toBe(0.9)
    // confidence = 0.7×0.9 + 0.3×0.9 = 0.63 + 0.27 = 0.9
    expect(result.confidence).toBeCloseTo(0.9, 5)
    // 原始对象不应被修改
    expect(evidence.confidence).toBe(0)
    expect(evidence.sourcePrior).toBe(0)
    // 其他字段保持不变
    expect(result.id).toBe('ev-1')
    expect(result.source).toBe('command')
    expect(result.content).toBe('total: 2048 used: 1024')
  })

  it('calculateEvidenceConfidence: log 来源证据计算正确', () => {
    const evidence: Evidence = {
      id: 'ev-2',
      source: 'log',
      sourceDetail: '/var/log/syslog',
      content: 'error: disk full',
      drainMatch: 0.7,
      sourcePrior: 0,
      confidence: 0,
      timestamp: Date.now(),
      verified: false
    }
    const result = calculateEvidenceConfidence(evidence)
    // log 先验 = 0.6, confidence = 0.7×0.7 + 0.3×0.6 = 0.49 + 0.18 = 0.67
    expect(result.sourcePrior).toBe(0.6)
    expect(result.confidence).toBeCloseTo(0.67, 5)
  })
})
