/**
 * 端到端场景测试：磁盘满场景
 *
 * 验证 6 大核心机制在磁盘空间不足故障场景下的协同工作：
 *   1. 规则引擎匹配磁盘满关键词
 *   2. 证据收集（从 df -h 命令输出提取磁盘使用率）
 *   3. 置信度计算（command 来源先验 0.9）
 *   4. Ground-Check（证据溯源到 df -h 命令）
 *   5. 风险引擎（多命令分级评估：CRITICAL / HIGH / MEDIUM / LOW）
 *   6. 决策卡片（推荐安全命令，拒绝危险命令）+ HITL 流程
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

/** 模拟 df -h 命令输出（磁盘满） */
const DF_H_OUTPUT =
  'Filesystem      Size  Used Avail Use% Mounted on\n' +
  '/dev/sda1        50G   50G   0G  100% /\n' +
  'tmpfs           2.0G  100M  1.9G   5% /dev/shm'

/** 创建磁盘满证据的辅助函数 */
function makeDiskEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev-disk-1',
    source: 'command',
    sourceDetail: 'df -h',
    content: '/dev/sda1',
    drainMatch: 0.95,
    sourcePrior: 0.9,
    confidence: 0,
    timestamp: Date.now(),
    verified: false,
    ...overrides
  }
}

/** 创建模拟 df -h 工具调用记录 */
function makeDfRecord(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    toolName: 'df',
    input: 'df -h',
    output: DF_H_OUTPUT,
    timestamp: Date.now() - 1000,
    sessionId: 'session-disk',
    ...overrides
  }
}

describe('端到端场景：磁盘满', () => {
  beforeEach(() => {
    clearAuditLog()
  })

  // ────────── 1. 规则引擎匹配磁盘满 ──────────

  it('规则引擎：从 df -h 输出匹配磁盘满关键词', () => {
    const result = analyzeByRules('磁盘空间不足，写入失败', DF_H_OUTPUT)
    expect(result).not.toBeNull()
    expect(result!.hypothesis).toContain('磁盘')
    expect(result!.fixCommand).toContain('df')
    expect(result!.confidence).toBe(0.7)
  })

  // ────────── 2. 证据收集 ──────────

  it('证据收集：从 df -h 命令输出提取磁盘使用率', () => {
    const evidence = makeDiskEvidence({
      content: '/dev/sda1',
      sourceDetail: 'df -h',
      drainMatch: 0.95
    })
    expect(evidence.source).toBe('command')
    expect(evidence.sourceDetail).toBe('df -h')
    expect(evidence.content).toContain('/dev/sda1')
    expect(evidence.drainMatch).toBeGreaterThan(0.9)
    // 工具输出中包含 100% 使用率
    expect(DF_H_OUTPUT).toContain('100%')
  })

  // ────────── 3. 置信度计算（command 先验 0.9） ──────────

  it('置信度计算：command 类型证据先验 = 0.9', () => {
    const prior = getSourcePrior('command')
    expect(prior).toBe(0.9)

    // drainMatch=0.95, sourcePrior=0.9
    // confidence = 0.7×0.95 + 0.3×0.9 = 0.665 + 0.27 = 0.935
    const confidence = calculateConfidence(0.95, 0.9)
    expect(confidence).toBeCloseTo(0.935, 5)

    // calculateEvidenceConfidence 自动填充 sourcePrior 并重算
    const evidence = makeDiskEvidence({ sourcePrior: 0, confidence: 0 })
    const computed = calculateEvidenceConfidence(evidence)
    expect(computed.sourcePrior).toBe(0.9)
    expect(computed.confidence).toBeCloseTo(0.935, 5)
  })

  // ────────── 4. Ground-Check 证据溯源 ──────────

  it('Ground-Check：磁盘满证据可溯源到模拟的 df -h 命令', () => {
    const evidence = makeDiskEvidence({
      content: '/dev/sda1',
      sourceDetail: 'df -h',
      timestamp: Date.now()
    })
    const records = [makeDfRecord({ timestamp: Date.now() - 1000 })]

    // sourceDetail='df -h' 匹配 record.input='df -h'（input.includes(sourceDetail)）
    expect(verifyEvidence(evidence, records)).toBe(true)

    // 批量验证：verified 字段应更新为 true
    const verified = verifyAllEvidences([evidence], records)
    expect(verified[0].verified).toBe(true)
  })

  it('Ground-Check：证据内容不在工具输出中时验证失败', () => {
    const evidence = makeDiskEvidence({
      content: 'completely different content',
      sourceDetail: 'df -h',
      timestamp: Date.now()
    })
    const records = [makeDfRecord({ timestamp: Date.now() - 1000 })]
    expect(verifyEvidence(evidence, records)).toBe(false)
  })

  // ────────── 5. 风险引擎多命令分级评估 ──────────

  it('风险引擎：rm -rf / 为 CRITICAL 且被阻止（拒绝危险命令）', () => {
    const assessment = assessRisk('rm -rf /')
    expect(assessment.level).toBe('CRITICAL')
    expect(assessment.score).toBe(100)
    expect(assessment.blocked).toBe(true)
    expect(assessment.requireConfirmation).toBe(true)
    expect(shouldBlock(assessment.level)).toBe(true)
  })

  it('风险引擎：rm -rf /var/log/* 为 HIGH（递归删除需确认）', () => {
    const assessment = assessRisk('rm -rf /var/log/*')
    expect(assessment.level).toBe('HIGH')
    expect(assessment.requireConfirmation).toBe(true)
    expect(assessment.blocked).toBe(false)
    expect(requiresConfirmation(assessment.level)).toBe(true)
  })

  it('风险引擎：find -delete 和 journalctl --vacuum 为 LOW（安全清理）', () => {
    // find 命令在 LOW 白名单中
    const findAssessment = assessRisk('find /var/log -mtime +30 -delete')
    expect(findAssessment.level).toBe('LOW')
    expect(findAssessment.requireConfirmation).toBe(false)

    // journalctl 在 LOW 白名单中
    const journalctlAssessment = assessRisk('journalctl --vacuum-time=7d')
    expect(journalctlAssessment.level).toBe('LOW')
    expect(journalctlAssessment.requireConfirmation).toBe(false)
    expect(journalctlAssessment.blocked).toBe(false)
    expect(requiresConfirmation(journalctlAssessment.level)).toBe(false)
  })

  // ────────── 6. 决策卡片：推荐安全命令，拒绝危险命令 ──────────

  it('决策卡片：推荐 journalctl --vacuum-time=7d 安全命令，拒绝 rm -rf / 危险命令', () => {
    const evidence = makeDiskEvidence({ verified: true })

    // 安全命令的决策卡片
    const safeCard = generateDecisionCard(
      '磁盘空间不足，/dev/sda1 使用率 100%',
      '日志文件占用过多磁盘空间',
      [evidence],
      'journalctl --vacuum-time=7d',
      '清理 7 天前的 journal 日志释放空间',
      'journalctl --disk-usage'
    )
    expect(safeCard.fixCommand).toBe('journalctl --vacuum-time=7d')
    expect(safeCard.risk.level).toBe('LOW')
    expect(safeCard.risk.requireConfirmation).toBe(false)
    expect(safeCard.risk.blocked).toBe(false)
    // 安全命令应通过完整性验证
    const safeValidation = validateDecision(safeCard)
    expect(safeValidation.valid).toBe(true)

    // 危险命令的决策卡片应未通过验证（CRITICAL 风险）
    const dangerousCard = generateDecisionCard(
      '磁盘空间不足',
      '日志文件占用过多空间',
      [evidence],
      'rm -rf /'
    )
    expect(dangerousCard.risk.level).toBe('CRITICAL')
    expect(dangerousCard.risk.blocked).toBe(true)
    const dangerousValidation = validateDecision(dangerousCard)
    expect(dangerousValidation.valid).toBe(false)
    expect(dangerousValidation.issues.some((i) => i.includes('CRITICAL'))).toBe(true)
  })

  // ────────── 7. HITL 流程验证 ──────────

  it('HITL 流程：CRITICAL 被阻止，HIGH 需确认，LOW 可直接执行', () => {
    // CRITICAL：rm -rf / 被阻止
    const criticalAssessment = assessRisk('rm -rf /')
    expect(criticalAssessment.level).toBe('CRITICAL')
    expect(shouldBlock(criticalAssessment.level)).toBe(true)

    // HIGH：rm -rf /var/log/* 需人工确认
    const highAssessment = assessRisk('rm -rf /var/log/*')
    expect(highAssessment.level).toBe('HIGH')
    expect(requiresConfirmation(highAssessment.level)).toBe(true)
    expect(shouldBlock(highAssessment.level)).toBe(false)

    // LOW：journalctl --vacuum-time=7d 可直接执行
    const lowAssessment = assessRisk('journalctl --vacuum-time=7d')
    expect(lowAssessment.level).toBe('LOW')
    expect(requiresConfirmation(lowAssessment.level)).toBe(false)
    expect(shouldBlock(lowAssessment.level)).toBe(false)

    // 综合验证：LOW 风险命令生成的决策卡片可直接执行
    const evidence = makeDiskEvidence({ verified: true })
    const card = generateDecisionCard(
      '磁盘满',
      '日志占用过多空间',
      [evidence],
      'journalctl --vacuum-time=7d'
    )
    expect(card.risk.level).toBe('LOW')
    expect(card.risk.requireConfirmation).toBe(false)
    expect(card.status).toBe('pending')
    const validation = validateDecision(card)
    expect(validation.valid).toBe(true)
  })
})
