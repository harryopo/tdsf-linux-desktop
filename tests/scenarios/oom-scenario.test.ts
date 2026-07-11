/**
 * 端到端场景测试：OOM（内存溢出）场景
 *
 * 验证 6 大核心机制在 OOM 故障场景下的协同工作：
 *   1. 规则引擎匹配 OOM 关键词
 *   2. 证据收集（从 dmesg 日志提取 OOM 证据）
 *   3. 置信度计算（log 来源先验 0.6）
 *   4. Ground-Check（证据溯源到 dmesg 命令）
 *   5. 风险引擎（kill -9 评估为 HIGH）
 *   6. 决策卡片 + HITL 流程（HIGH 需人工确认）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { analyzeByRules } from '../../src/main/core/rule-engine'
import {
  getSourcePrior,
  calculateConfidence,
  calculateEvidenceConfidence
} from '../../src/main/core/confidence'
import {
  verifyEvidence,
  verifyAllEvidences,
  type ToolCallRecord
} from '../../src/main/core/grounding'
import {
  assessRisk,
  requiresConfirmation,
  shouldBlock,
  clearAuditLog
} from '../../src/main/core/risk-engine'
import {
  generateDecisionCard,
  validateDecision
} from '../../src/main/core/decision-engine'
import type { Evidence } from '../../src/shared/models'

/** 模拟 OOM 故障的 dmesg 日志输出 */
const OOM_DMESG_OUTPUT =
  '[12345.678] Out of memory: Kill process 1234 (nginx) score 500 or sacrifice child\n' +
  '[12345.680] Killed process 1234 (nginx) total-vm:2048000kB, anon-rss:1024000kB'

/** 创建 OOM 证据的辅助函数 */
function makeOomEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev-oom-1',
    source: 'log',
    sourceDetail: 'dmesg',
    content: 'Out of memory: Kill process 1234 (nginx)',
    drainMatch: 0.85,
    sourcePrior: 0.6,
    confidence: 0,
    timestamp: Date.now(),
    verified: false,
    ...overrides
  }
}

/** 创建模拟工具调用记录的辅助函数 */
function makeDmesgRecord(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    toolName: 'dmesg',
    input: 'dmesg -T',
    output: OOM_DMESG_OUTPUT,
    timestamp: Date.now() - 1000,
    sessionId: 'session-oom',
    ...overrides
  }
}

describe('端到端场景：OOM（内存溢出）', () => {
  beforeEach(() => {
    clearAuditLog()
  })

  // ────────── 1. 规则引擎匹配 OOM ──────────

  it('规则引擎：从 dmesg 日志匹配 OOM 关键词并给出假设', () => {
    const result = analyzeByRules('进程被杀死，服务不稳定', OOM_DMESG_OUTPUT)
    expect(result).not.toBeNull()
    expect(result!.hypothesis).toContain('内存')
    expect(result!.hypothesis).toContain('OOM')
    expect(result!.fixCommand).toContain('free')
    expect(result!.confidence).toBe(0.7)
  })

  // ────────── 2. 证据收集 ──────────

  it('证据收集：从 dmesg 日志提取 OOM 证据，字段完整', () => {
    const evidence = makeOomEvidence({
      content: 'Out of memory: Kill process 1234 (nginx)',
      sourceDetail: 'dmesg',
      drainMatch: 0.85
    })
    expect(evidence.source).toBe('log')
    expect(evidence.sourceDetail).toBe('dmesg')
    expect(evidence.content).toContain('Out of memory')
    expect(evidence.content).toContain('Kill process')
    expect(evidence.drainMatch).toBeGreaterThan(0.7)
  })

  // ────────── 3. 置信度计算 ──────────

  it('置信度计算：log 来源证据 = 0.7×匹配度 + 0.3×0.6（log 先验）', () => {
    const prior = getSourcePrior('log')
    expect(prior).toBe(0.6)

    // drainMatch=0.85, sourcePrior=0.6
    // confidence = 0.7×0.85 + 0.3×0.6 = 0.595 + 0.18 = 0.775
    const confidence = calculateConfidence(0.85, 0.6)
    expect(confidence).toBeCloseTo(0.775, 5)

    // calculateEvidenceConfidence 自动填充 sourcePrior 并重算
    const evidence = makeOomEvidence({ sourcePrior: 0, confidence: 0 })
    const computed = calculateEvidenceConfidence(evidence)
    expect(computed.sourcePrior).toBe(0.6)
    expect(computed.confidence).toBeCloseTo(0.775, 5)
  })

  // ────────── 4. Ground-Check 证据溯源 ──────────

  it('Ground-Check：OOM 证据可溯源到模拟的 dmesg 命令', () => {
    const evidence = makeOomEvidence({
      content: 'Out of memory: Kill process 1234 (nginx)',
      sourceDetail: 'dmesg',
      timestamp: Date.now()
    })
    const records = [makeDmesgRecord({ timestamp: Date.now() - 1000 })]

    // dmesg 属于 log 来源匹配的工具（sourceTypeMatchesTool: /dmesg/ ）
    expect(verifyEvidence(evidence, records)).toBe(true)

    // 批量验证：verified 字段应更新为 true
    const verified = verifyAllEvidences([evidence], records)
    expect(verified[0].verified).toBe(true)
  })

  it('Ground-Check：证据时间戳早于工具调用时验证失败', () => {
    const toolTime = Date.now()
    const evidence = makeOomEvidence({ timestamp: toolTime - 5000 })
    const records = [makeDmesgRecord({ timestamp: toolTime })]
    expect(verifyEvidence(evidence, records)).toBe(false)
  })

  // ────────── 5. 风险引擎评估 ──────────

  it('风险引擎：kill -9 <pid> 评估为 HIGH 风险，需人工确认', () => {
    const assessment = assessRisk('kill -9 1234')
    expect(assessment.level).toBe('HIGH')
    expect(assessment.score).toBe(75)
    expect(assessment.requireConfirmation).toBe(true)
    expect(assessment.blocked).toBe(false) // HIGH 不阻止，仅确认
    expect(assessment.matchedRules).toContain('强制杀死进程')

    // requiresConfirmation 对 HIGH 返回 true
    expect(requiresConfirmation(assessment.level)).toBe(true)
    // shouldBlock 对 HIGH 返回 false（仅 CRITICAL 阻止）
    expect(shouldBlock(assessment.level)).toBe(false)
  })

  // ────────── 6. 决策卡片生成 ──────────

  it('决策卡片：包含假设、证据、修复命令、风险等级', () => {
    const evidence = makeOomEvidence({ verified: true })
    const card = generateDecisionCard(
      'nginx 进程被 OOM Killer 杀死',
      '内存不足导致进程被 OOM Killer 杀死',
      [evidence],
      'kill -9 1234',
      '强制杀死占用内存过高的进程 1234',
      'systemctl start nginx'
    )

    expect(card.id).toMatch(/^dc_\d+_/)
    expect(card.problem).toContain('OOM')
    expect(card.hypothesis).toContain('内存')
    expect(card.evidences).toHaveLength(1)
    expect(card.evidences[0].content).toContain('Out of memory')
    expect(card.fixCommand).toBe('kill -9 1234')
    expect(card.fixDescription).toContain('强制杀死')
    expect(card.rollbackCommand).toBe('systemctl start nginx')
    expect(card.risk.level).toBe('HIGH')
    expect(card.risk.requireConfirmation).toBe(true)
    expect(card.confidence).toBeGreaterThan(0)
    expect(card.status).toBe('pending')
  })

  // ────────── 7. HITL 流程验证 ──────────

  it('HITL 流程：HIGH 风险命令需人工确认，不应被自动阻止', () => {
    const assessment = assessRisk('kill -9 1234')
    const evidence = makeOomEvidence({ verified: true })
    const card = generateDecisionCard(
      'OOM 故障',
      '内存不足，进程被杀',
      [evidence],
      'kill -9 1234'
    )

    // HIGH 风险需要人工确认
    expect(assessment.requireConfirmation).toBe(true)
    // HIGH 风险不应被直接阻止（允许人工确认后执行）
    expect(assessment.blocked).toBe(false)
    // 决策卡片状态为 pending，等待人工审核
    expect(card.status).toBe('pending')
    // 决策卡片应通过完整性验证（非 CRITICAL、有证据、置信度合理）
    const validation = validateDecision(card)
    expect(validation.valid).toBe(true)
    expect(validation.issues).toHaveLength(0)
  })
})
