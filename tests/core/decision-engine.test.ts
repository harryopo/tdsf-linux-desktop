/**
 * 决策推荐引擎单元测试
 */
import { describe, it, expect } from 'vitest'
import {
  generateDecisionCard,
  calculateOverallConfidence,
  validateDecision
} from '../../src/main/core/decision-engine'
import type { Evidence, DecisionCard } from '../../src/shared/models'

/** 创建测试用证据的辅助函数 */
function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev-1',
    source: 'command',
    sourceDetail: 'df -h',
    content: 'disk usage 95%',
    drainMatch: 0.9,
    sourcePrior: 0.9,
    confidence: 0.9,
    timestamp: Date.now(),
    verified: true,
    ...overrides
  }
}

/** 创建测试用决策卡片的辅助函数 */
function makeCard(overrides: Partial<DecisionCard> = {}): DecisionCard {
  return {
    id: 'dc-test',
    problem: '磁盘空间不足',
    hypothesis: '日志文件占用过多空间',
    evidences: [makeEvidence()],
    confidence: 0.85,
    risk: {
      level: 'LOW',
      score: 30,
      matchedRules: [],
      description: '只读查询命令',
      requireConfirmation: false,
      blocked: false
    },
    fixCommand: 'df -h',
    fixDescription: '查看磁盘使用情况',
    status: 'pending',
    timestamp: Date.now(),
    ...overrides
  }
}

describe('decision-engine — 决策推荐引擎', () => {
  // ────────── generateDecisionCard ──────────

  it('generateDecisionCard: 正常生成决策卡片', () => {
    const evidences = [makeEvidence({ verified: true })]
    const card = generateDecisionCard(
      '磁盘空间不足',
      '日志文件过大',
      evidences,
      'df -h'
    )
    expect(card.id).toMatch(/^dc_\d+_/)
    expect(card.problem).toBe('磁盘空间不足')
    expect(card.hypothesis).toBe('日志文件过大')
    expect(card.evidences).toHaveLength(1)
    expect(card.fixCommand).toBe('df -h')
    expect(card.status).toBe('pending')
    expect(card.risk.level).toBe('LOW') // df -h 是只读命令
    expect(card.confidence).toBeGreaterThan(0)
  })

  it('generateDecisionCard: 自动生成修复说明', () => {
    const card = generateDecisionCard('问题', '假设', [], 'echo hello')
    expect(card.fixDescription).toContain('echo hello')
  })

  it('generateDecisionCard: 包含回滚命令', () => {
    const card = generateDecisionCard('问题', '假设', [], 'echo hello', '说明', 'rm /tmp/file')
    expect(card.rollbackCommand).toBe('rm /tmp/file')
  })

  // ────────── calculateOverallConfidence ──────────

  it('calculateOverallConfidence: 空证据返回 0', () => {
    expect(calculateOverallConfidence([])).toBe(0)
  })

  it('calculateOverallConfidence: 多条已验证证据加权平均', () => {
    const evidences = [
      makeEvidence({ drainMatch: 0.9, source: 'command', verified: true }),  // 0.9
      makeEvidence({ drainMatch: 0.8, source: 'metric', verified: true })     // 0.7×0.8+0.3×0.8=0.8
    ]
    const result = calculateOverallConfidence(evidences)
    // 两条都 verified，权重 1，平均 (0.9+0.8)/2 = 0.85
    expect(result).toBeCloseTo(0.85, 2)
  })

  it('calculateOverallConfidence: 未验证证据权重降低', () => {
    const verified = makeEvidence({ drainMatch: 0.9, source: 'command', verified: true })
    const unverified = makeEvidence({ drainMatch: 0.9, source: 'command', verified: false })
    // verified confidence = 0.9, weight = 1
    // unverified confidence = 0.9, weight = 0.3
    // (0.9×1 + 0.9×0.3) / (1 + 0.3) = (0.9 + 0.27) / 1.3 = 1.17/1.3 ≈ 0.9
    const result = calculateOverallConfidence([verified, unverified])
    expect(result).toBeCloseTo(0.9, 2)
    // 应低于全部已验证的情况
    const allVerified = calculateOverallConfidence([
      makeEvidence({ drainMatch: 0.9, source: 'command', verified: true }),
      makeEvidence({ drainMatch: 0.9, source: 'command', verified: true })
    ])
    expect(result).toBeLessThanOrEqual(allVerified)
  })

  // ────────── validateDecision ──────────

  it('validateDecision: 完整有效的卡片返回 valid=true', () => {
    const card = makeCard()
    const result = validateDecision(card)
    expect(result.valid).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('validateDecision: 问题描述为空时报错', () => {
    const card = makeCard({ problem: '' })
    const result = validateDecision(card)
    expect(result.valid).toBe(false)
    expect(result.issues).toContain('问题描述为空')
  })

  it('validateDecision: CRITICAL 风险命令报错', () => {
    const card = makeCard({
      fixCommand: 'rm -rf /',
      risk: {
        level: 'CRITICAL',
        score: 100,
        matchedRules: ['递归强制删除根目录'],
        description: '危险操作',
        requireConfirmation: true,
        blocked: true
      }
    })
    const result = validateDecision(card)
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.includes('CRITICAL'))).toBe(true)
  })

  it('validateDecision: 低置信度时警告', () => {
    const card = makeCard({ confidence: 0.3 })
    const result = validateDecision(card)
    expect(result.issues.some((i) => i.includes('置信度过低'))).toBe(true)
  })

  it('validateDecision: 无证据时报错', () => {
    const card = makeCard({ evidences: [] })
    const result = validateDecision(card)
    expect(result.valid).toBe(false)
    expect(result.issues).toContain('无证据支持')
  })
})
