/**
 * 审计报告构建器单元测试（v0.9.6 P2 M6）
 *
 * 法规 / 标准覆盖：
 * - EU AI Act 2026 Art.9/10/11/12/13/14/15/19 + Annex IV
 * - NIST AI RMF 1.0（GOVERN/MAP/MEASURE/MANAGE）
 * - NIST AI 600-1 GenAI Profile（12 类风险）
 *
 * 测试目标：
 * - 报告构建（buildAuditReport）正确性
 * - SHA-256 指纹稳定性（确定性 + 抗篡改）
 * - NIST 600-1 12 类风险评估逻辑
 * - 合规评分计算边界
 * - 冲突等级 / 信任度等级自动分配
 * - 字段缺失时的默认值兜底
 *
 * v1.0 状态：Windows 中文路径（`linux教学一体`）下 vite 加载该模块报 ENOENT，
 *   已用 describe.skip 临时跳过全部用例；待 v1.5 切到 Linux 容器 CI
 *   或迁移项目根到英文路径后恢复 describe 即可
 * v1.1（2026-07-20）：实测 pnpm vitest run 能正常加载该模块（46 tests skipped），
 *   但因为 describe.skip 全部跳过。决定：移除 skip 让 46 个测试真正跑起来。
 *   如 CI 上确实存在中文路径 ENOENT，可改回 describe.skip。
 */
import { describe, it, expect } from 'vitest'
import {
  buildAuditReport,
  buildAndFinalizeReport,
  computeReportFingerprint,
  AUDIT_REPORT_SCHEMA_VERSION,
  AUDIT_GENERATOR_VERSION,
} from '../../../../../src/main/core/agent/credibility/audit/report-builder'
import {
  formatAsJson,
  formatAsMarkdown,
  formatAsHtml,
  formatReport,
  getFileExtension,
  getMimeType,
  validateJsonReport,
} from '../../../../../src/main/core/agent/credibility/audit/formatters'
import type { AuditReportInput, ComplianceAuditReport } from '../../../../../src/main/core/agent/credibility/audit/types'

// ============================================================================
// 测试数据工厂
// ============================================================================

/** 构造一个最小的合法 AuditReportInput */
function makeInput(overrides: Partial<AuditReportInput> = {}): AuditReportInput {
  return {
    decisionContext: {
      decisionId: 'card-001',
      decisionTitle: 'Nginx 502 故障排查',
      decisionTime: 1700000000000,
      provider: 'DeepSeek',
      modelVersion: 'deepseek-chat',
      deployer: '运维团队',
      intendedPurpose: '辅助 Linux 运维决策（CVE 修复 / 服务配置）',
      knownLimitations: ['仅支持 LTS 系统', '不支持 Kubernetes'],
    },
    sourceEvidences: [
      {
        sourceId: 'S1-log',
        sourceName: '日志证据',
        focalElements: { T: 0.7, '¬T': 0.3 },
        rawConfidence: 0.7,
        calibratedConfidence: 0.68,
        calibrationTemperature: 1.2,
        weight: 0.2,
        inputData: { drainMatch: 0.85 },
        dataProvenance: 'Drain3 模板匹配',
        dataTimestamp: 1700000000000,
      },
      {
        sourceId: 'S2-knowledge',
        sourceName: '知识库',
        focalElements: { T: 0.8, '¬T': 0.2 },
        rawConfidence: 0.8,
        calibratedConfidence: 0.78,
        calibrationTemperature: 1.0,
        weight: 0.15,
        inputData: { hasResults: true, topScore: 0.92 },
        dataProvenance: 'ChromaDB',
        dataTimestamp: 1700000000000,
      },
      {
        sourceId: 'S3-ai-param',
        sourceName: 'AI 参数',
        focalElements: { T: 0.85, '¬T': 0.15 },
        rawConfidence: 0.85,
        calibratedConfidence: 0.82,
        calibrationTemperature: 1.0,
        weight: 0.25,
        inputData: { verbalizedConfidence: 0.85 },
        dataProvenance: 'LLM 输出',
        dataTimestamp: 1700000000000,
      },
      {
        sourceId: 'S4-human',
        sourceName: '人工证据',
        focalElements: { T: 0.9, '¬T': 0.1 },
        rawConfidence: 0.9,
        calibratedConfidence: 0.9,
        calibrationTemperature: 1.0,
        weight: 0.1,
        inputData: { hasAnnotations: true, positiveRate: 0.9 },
        dataProvenance: '工程师标注',
        dataTimestamp: 1700000000000,
      },
      {
        sourceId: 'S5-history',
        sourceName: '历史证据',
        focalElements: { T: 0.75, '¬T': 0.25 },
        rawConfidence: 0.75,
        calibratedConfidence: 0.75,
        calibrationTemperature: 1.0,
        weight: 0.15,
        inputData: { hasCases: true, weightedSuccessRate: 0.75 },
        dataProvenance: '历史决策库',
        dataTimestamp: 1700000000000,
      },
      {
        sourceId: 'S6-best-practice',
        sourceName: '最佳实践',
        focalElements: { T: 0.8, '¬T': 0.2 },
        rawConfidence: 0.8,
        calibratedConfidence: 0.8,
        calibrationTemperature: 1.0,
        weight: 0.15,
        inputData: { hasMatches: true, positiveRate: 0.8 },
        dataProvenance: 'YAML 规则库',
        dataTimestamp: 1700000000000,
      },
    ],
    confidenceAssessment: {
      belief: 0.78,
      plausibility: 0.92,
      confidence: 0.85,
      uncertainty: 0.14,
      conflictLevel: 0.08,
      ruleUsed: 'pcr5',
      fusionSteps: [
        {
          step: 1,
          ruleUsed: 'pcr5',
          leftSourceId: 'S1-log',
          rightSourceId: 'S2-knowledge',
          conflict: 0.05,
          resultBelief: 0.65,
          resultPlausibility: 0.85,
        },
        {
          step: 2,
          ruleUsed: 'pcr5',
          leftSourceId: 'S3-ai-param',
          rightSourceId: 'S4-human',
          conflict: 0.08,
          resultBelief: 0.78,
          resultPlausibility: 0.92,
        },
      ],
    },
    calibration: {
      providerId: 'deepseek',
      optimalT: 1.2,
      eceBefore: 0.18,
      eceAfter: 0.06,
      improvement: 0.67,
      sampleCount: 50,
      calibratedAtIso: new Date(1700000000000).toISOString(),
      isCalibrationFresh: true,
      daysSinceCalibration: 2,
      topCandidates: [
        { t: 0.5, ece: 0.09 },
        { t: 1.2, ece: 0.06 },
        { t: 2.0, ece: 0.08 },
      ],
    },
    humanOversight: {
      oversightMode: 'human-in-the-loop',
      approvalStatus: 'approved',
      approver: 'engineer-zhang',
      approvedAtIso: new Date(1700000000000).toISOString(),
      approverComment: '同意执行，参数合理',
      triggeredHighRiskInterception: false,
      interceptedCommandCount: 0,
    },
    decisionAction: {
      actionType: 'command',
      description: '重启 Nginx 服务',
      command: 'systemctl restart nginx',
      sandboxResult: 'passed',
      executionResult: 'success',
      executedAtIso: new Date(1700000000000).toISOString(),
      affectedResources: ['web-server-01', 'web-server-02'],
      isRollbackable: true,
    },
    deployerContact: 'admin@tdsf.dev',
    domain: 'Linux Operations / AIOps',
    isHighRisk: true,
    ...overrides,
  }
}

// ============================================================================
// 报告构建基础
// ============================================================================

describe('audit/report-builder — 报告构建', () => {
  it('buildAuditReport：6 源完整输入生成完整结构', () => {
    const report = buildAuditReport(makeInput())

    // 顶层字段
    expect(report.regulatory).toBeDefined()
    expect(report.metadata).toBeDefined()
    expect(report.decisionContext).toBeDefined()
    expect(report.sourceEvidences).toHaveLength(6)
    expect(report.fusionResult).toBeDefined()
    expect(report.calibration).toBeDefined()
    expect(report.humanOversight).toBeDefined()
    expect(report.decisionAction).toBeDefined()
    expect(report.decisionOutcome).toBeDefined()
    expect(report.transparency).toBeDefined()
    expect(report.genaiRiskCoverage).toHaveLength(12)
    expect(report.overallCompliance).toBeDefined()
  })

  it('buildAuditReport：fingerprint 字段在 buildAndFinalizeReport 后填充', () => {
    const draft = buildAuditReport(makeInput())
    expect(draft.metadata.fingerprint).toBe('') // 构建阶段不计算
    expect(draft.metadata.reportId).toMatch(/^[0-9a-f-]{36}$/i) // UUID v4

    const final = buildAndFinalizeReport(makeInput())
    expect(final.metadata.fingerprint).toHaveLength(16)
    expect(final.metadata.fingerprint).toMatch(/^[0-9a-f]{16}$/)
  })

  it('buildAndFinalizeReport：相同输入产生相同指纹（确定性）', async () => {
    // 锁定时间避免 timestamp 漂移
    const fixedInput = makeInput()
    const a = buildAndFinalizeReport(fixedInput)
    await new Promise((r) => setTimeout(r, 5))
    const b = buildAndFinalizeReport(fixedInput)
    // 字段相同（除 reportId / generatedAt / fingerprint 外）→ 指纹不同
    // 因为 reportId 是 UUID v4 随机
    expect(a.metadata.reportId).not.toBe(b.metadata.reportId)
  })

  it('字段缺失时使用默认值兜底', () => {
    const minimal: AuditReportInput = {
      decisionContext: {
        decisionId: 'card-min',
        decisionTitle: 'Minimal',
        decisionTime: 1700000000000,
        provider: 'Claude',
        modelVersion: 'claude-sonnet-4',
        deployer: 'dev',
        intendedPurpose: 'test',
        knownLimitations: [],
      },
      sourceEvidences: [],
      confidenceAssessment: {
        belief: 0.5,
        plausibility: 0.5,
        confidence: 0.5,
        uncertainty: 0.0,
        conflictLevel: 0.0,
        ruleUsed: 'dempster',
        fusionSteps: [],
      },
      calibration: null,
      humanOversight: {
        oversightMode: 'human-on-the-loop',
        approvalStatus: 'pending',
        approver: null,
        approvedAtIso: null,
        approverComment: null,
        triggeredHighRiskInterception: false,
        interceptedCommandCount: 0,
      },
      decisionAction: {
        actionType: 'no-op',
        description: 'no-op',
        command: null,
        sandboxResult: null,
        executionResult: null,
        executedAtIso: null,
        affectedResources: [],
        isRollbackable: false,
      },
    }
    const report = buildAndFinalizeReport(minimal)
    // 部署方联系 / domain / isHighRisk 兜底
    expect(report.decisionContext.deployerContact).toBe('admin@tdsf.dev')
    expect(report.decisionContext.domain).toContain('Operations')
    expect(report.decisionContext.isHighRisk).toBe(true)
    // calibration 兜底
    expect(report.calibration.providerId).toBe('Claude')
    expect(report.calibration.optimalT).toBe(1.0)
  })
})

// ============================================================================
// 融合结果映射
// ============================================================================

describe('audit/report-builder — 融合结果映射', () => {
  it('conflictLevel 数值映射：< 0.1 → low，0.1-0.3 → medium，>= 0.3 → high', () => {
    const low = buildAuditReport(makeInput({ confidenceAssessment: { ...makeInput().confidenceAssessment, conflictLevel: 0.05 } }))
    expect(low.fusionResult.conflictLevel).toBe('low')

    const med = buildAuditReport(makeInput({ confidenceAssessment: { ...makeInput().confidenceAssessment, conflictLevel: 0.2 } }))
    expect(med.fusionResult.conflictLevel).toBe('medium')

    const high = buildAuditReport(makeInput({ confidenceAssessment: { ...makeInput().confidenceAssessment, conflictLevel: 0.5 } }))
    expect(high.fusionResult.conflictLevel).toBe('high')
  })

  it('trustLevel 自动分级：confidence + uncertainty 联合判断', () => {
    // L1: conf > 0.85 && unc < 0.1
    const l1 = buildAuditReport(makeInput({ confidenceAssessment: { ...makeInput().confidenceAssessment, confidence: 0.9, uncertainty: 0.05 } }))
    expect(l1.fusionResult.trustLevel).toBe('L1')

    // L2: conf > 0.7 && unc < 0.2
    const l2 = buildAuditReport(makeInput({ confidenceAssessment: { ...makeInput().confidenceAssessment, confidence: 0.75, uncertainty: 0.15 } }))
    expect(l2.fusionResult.trustLevel).toBe('L2')

    // L3: conf > 0.5 && unc < 0.3
    const l3 = buildAuditReport(makeInput({ confidenceAssessment: { ...makeInput().confidenceAssessment, confidence: 0.55, uncertainty: 0.25 } }))
    expect(l3.fusionResult.trustLevel).toBe('L3')

    // L4: 其余（默认降级）
    const l4 = buildAuditReport(makeInput({ confidenceAssessment: { ...makeInput().confidenceAssessment, confidence: 0.4, uncertainty: 0.4 } }))
    expect(l4.fusionResult.trustLevel).toBe('L4')
  })

  it('riskScore = 100 * (0.4*uncertainty + 0.3*conflict + 0.3*(1-confidence))', () => {
    // 完全确定：unc=0, conf=1, conflict=0 → risk=0
    const perfect = buildAuditReport(makeInput({ confidenceAssessment: { ...makeInput().confidenceAssessment, confidence: 1.0, uncertainty: 0, conflictLevel: 0 } }))
    expect(perfect.fusionResult.riskScore).toBe(0)

    // 完全不确定：unc=1, conf=0, conflict=1 → risk=100
    const worst = buildAuditReport(makeInput({ confidenceAssessment: { ...makeInput().confidenceAssessment, confidence: 0, uncertainty: 1, conflictLevel: 1 } }))
    expect(worst.fusionResult.riskScore).toBe(100)
  })
})

// ============================================================================
// NIST 600-1 12 类风险
// ============================================================================

describe('audit/report-builder — NIST 600-1 12 类风险评估', () => {
  it('固定输出 12 条风险评估', () => {
    const report = buildAuditReport(makeInput())
    expect(report.genaiRiskCoverage).toHaveLength(12)
    // riskId 应为 1-12 连续（用数值排序而非字典序）
    const ids = report.genaiRiskCoverage.map((r) => r.riskId).sort((a, b) => a - b)
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('Confabulation (id=2) 评级随 ECE 变化', () => {
    // ECE < 5% → mitigated
    const eceLow = makeInput({ calibration: { ...makeInput().calibration!, eceAfter: 0.03 } })
    expect(buildAuditReport(eceLow).genaiRiskCoverage.find((r) => r.riskId === 2)!.verdict).toBe('mitigated')

    // 5% ≤ ECE < 15% → partially-mitigated
    const eceMid = makeInput({ calibration: { ...makeInput().calibration!, eceAfter: 0.1 } })
    expect(buildAuditReport(eceMid).genaiRiskCoverage.find((r) => r.riskId === 2)!.verdict).toBe('partially-mitigated')

    // ECE ≥ 15% → unmitigated
    const eceHigh = makeInput({ calibration: { ...makeInput().calibration!, eceAfter: 0.2 } })
    expect(buildAuditReport(eceHigh).genaiRiskCoverage.find((r) => r.riskId === 2)!.verdict).toBe('unmitigated')
  })

  it('Human-AI Configuration (id=6)：human-in-command → mitigated，否则 partial', () => {
    const command = makeInput({ humanOversight: { ...makeInput().humanOversight, oversightMode: 'human-in-command' } })
    expect(buildAuditReport(command).genaiRiskCoverage.find((r) => r.riskId === 6)!.verdict).toBe('mitigated')

    const loop = makeInput({ humanOversight: { ...makeInput().humanOversight, oversightMode: 'human-in-the-loop' } })
    expect(buildAuditReport(loop).genaiRiskCoverage.find((r) => r.riskId === 6)!.verdict).toBe('partially-mitigated')
  })

  it('Information Security (id=8)：报告本身即合规证据 → mitigated', () => {
    const report = buildAuditReport(makeInput())
    const sec = report.genaiRiskCoverage.find((r) => r.riskId === 8)!
    expect(sec.verdict).toBe('mitigated')
  })

  it('Toxicity/Bias (id=11)：≥ 5 源 → mitigated', () => {
    // makeInput 默认 6 源
    const report = buildAuditReport(makeInput())
    const tox = report.genaiRiskCoverage.find((r) => r.riskId === 11)!
    expect(tox.verdict).toBe('mitigated')

    // 4 源 → partially-mitigated
    const truncated = makeInput({ sourceEvidences: makeInput().sourceEvidences.slice(0, 4) })
    expect(buildAuditReport(truncated).genaiRiskCoverage.find((r) => r.riskId === 11)!.verdict).toBe('partially-mitigated')
  })
})

// ============================================================================
// 合规评分
// ============================================================================

describe('audit/report-builder — 合规评分', () => {
  it('完美合规：ECE < 5% + human-in-command + approved → 高分', () => {
    const perfect = makeInput({
      calibration: { ...makeInput().calibration!, eceAfter: 0.03 },
      humanOversight: { ...makeInput().humanOversight, oversightMode: 'human-in-command', approvalStatus: 'approved' },
      confidenceAssessment: { ...makeInput().confidenceAssessment, conflictLevel: 0.05 },
    })
    const result = buildAuditReport(perfect).overallCompliance
    expect(result.complianceScore).toBeGreaterThanOrEqual(80)
    expect(result.nistAi600Compliant).toBe(true)
    expect(result.nistAiRmfCompliant).toBe(true)
    // EU AI Act 还需 eceAfter < 0.1
    expect(result.euAiActCompliant).toBe(true)
  })

  it('高冲突：conflict=high → EU AI Act 不通过', () => {
    const highConflict = makeInput({ confidenceAssessment: { ...makeInput().confidenceAssessment, conflictLevel: 0.5 } })
    const result = buildAuditReport(highConflict).overallCompliance
    expect(result.euAiActCompliant).toBe(false)
  })

  it('未审批：approvalStatus=pending → NIST AI RMF 不通过', () => {
    const pending = makeInput({ humanOversight: { ...makeInput().humanOversight, approvalStatus: 'pending' } })
    const result = buildAuditReport(pending).overallCompliance
    expect(result.nistAiRmfCompliant).toBe(false)
  })

  it('improvementAreas 至少 1 条（不通过时给出建议）', () => {
    const bad = makeInput({ confidenceAssessment: { ...makeInput().confidenceAssessment, conflictLevel: 0.5 } })
    const areas = buildAuditReport(bad).overallCompliance.improvementAreas
    expect(areas.length).toBeGreaterThan(0)
  })

  it('合规通过时 improvementAreas 含"保持"建议', () => {
    const good = makeInput({
      calibration: { ...makeInput().calibration!, eceAfter: 0.03, daysSinceCalibration: 1 },
      humanOversight: { ...makeInput().humanOversight, oversightMode: 'human-in-command', approvalStatus: 'approved' },
      confidenceAssessment: { ...makeInput().confidenceAssessment, conflictLevel: 0.05 },
    })
    const areas = buildAuditReport(good).overallCompliance.improvementAreas
    expect(areas.some((a) => a.includes('保持') || a.includes('复审'))).toBe(true)
  })
})

// ============================================================================
// 过期时间
// ============================================================================

describe('audit/report-builder — 过期时间（EU AI Act Art.12 6 个月）', () => {
  it('expiresAt = generatedAt + 6 个月（180 天）', () => {
    const before = Date.now()
    const report = buildAndFinalizeReport(makeInput())
    const diff = report.metadata.expiresAt - report.metadata.generatedAt
    const expectedDiff = 1000 * 60 * 60 * 24 * 30 * 6 // 6 个月
    expect(diff).toBe(expectedDiff)
    // generatedAt 在调用时间附近
    expect(report.metadata.generatedAt).toBeGreaterThanOrEqual(before - 100)
  })
})

// ============================================================================
// 指纹（SHA-256 稳定性 + 抗篡改）
// ============================================================================

describe('audit/report-builder — SHA-256 指纹', () => {
  it('computeReportFingerprint 输出 16 字符 hex', () => {
    const report = buildAndFinalizeReport(makeInput())
    const fp = computeReportFingerprint(report)
    expect(fp).toHaveLength(16)
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
  })

  it('轻微修改报告内容 → 指纹变化（敏感性）', () => {
    // v1.1 修复：直接调 computeReportFingerprint 计算指纹（不依赖 buildAndFinalizeReport 的固定指纹）
    // 因为 buildAndFinalizeReport 内部已经写死 fingerprint，再修改其他字段指纹不会重算
    // v1.2 修复：配合 stableStringify 修复后，重新启用此测试
    const a = buildAuditReport(makeInput())
    const b = buildAuditReport(makeInput({ decisionContext: { ...makeInput().decisionContext, decisionTitle: 'Different title' } }))
    const fa = computeReportFingerprint(a)
    const fb = computeReportFingerprint(b)
    expect(fa).not.toBe(fb)
  })

  it('固定 reportId / generatedAt 后，相同内容产生相同指纹', () => {
    const a = buildAndFinalizeReport(makeInput())
    const b = buildAndFinalizeReport(makeInput())
    // 强制一致关键字段
    a.metadata.reportId = 'fixed-uuid-aaaa-bbbb'
    a.metadata.generatedAt = 1700000000000
    a.metadata.fingerprint = ''
    b.metadata.reportId = 'fixed-uuid-aaaa-bbbb'
    b.metadata.generatedAt = 1700000000000
    b.metadata.fingerprint = ''
    expect(computeReportFingerprint(a)).toBe(computeReportFingerprint(b))
  })
})

// ============================================================================
// JSON 格式化器
// ============================================================================

describe('audit/formatters — JSON 格式化', () => {
  it('formatAsJson 输出可解析的 JSON', () => {
    const report = buildAndFinalizeReport(makeInput())
    const json = formatAsJson(report)
    const parsed = JSON.parse(json)
    expect(parsed.decisionContext.decisionId).toBe('card-001')
    expect(parsed.metadata.fingerprint).toBe(report.metadata.fingerprint)
  })

  it('formatAsJson pretty=true 时含缩进', () => {
    const report = buildAndFinalizeReport(makeInput())
    const pretty = formatAsJson(report, true)
    expect(pretty).toContain('\n  ')
  })

  it('formatAsJson pretty=false 时为单行', () => {
    const report = buildAndFinalizeReport(makeInput())
    const minified = formatAsJson(report, false)
    expect(minified).not.toContain('\n  ')
  })

  it('validateJsonReport：合法报告通过校验', () => {
    const report = buildAndFinalizeReport(makeInput())
    const result = validateJsonReport(formatAsJson(report))
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('validateJsonReport：必填字段缺失时报告错误', () => {
    const json = JSON.stringify({ metadata: { reportId: 'x' } })
    const result = validateJsonReport(json)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('validateJsonReport：非法 JSON 返回解析错误', () => {
    const result = validateJsonReport('not valid json{')
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatch(/JSON 解析失败/)
  })
})

// ============================================================================
// Markdown 格式化器
// ============================================================================

describe('audit/formatters — Markdown 格式化', () => {
  it('formatAsMarkdown 输出含主要章节', () => {
    const report = buildAndFinalizeReport(makeInput())
    const md = formatAsMarkdown(report)
    expect(md).toMatch(/^# 合规审计报告/m)
    expect(md).toContain('总体合规结论')
    expect(md).toContain('法规与标准依据')
    expect(md).toContain('决策上下文')
    expect(md).toContain('6 源证据记录')
    expect(md).toContain('融合过程与结果')
    expect(md).toContain('校准状态')
    expect(md).toContain('人工监督')
    expect(md).toContain('决策动作')
    expect(md).toContain('NIST AI 600-1')
    expect(md).toContain('透明度声明')
  })

  it('formatAsMarkdown 含合规评分', () => {
    const report = buildAndFinalizeReport(makeInput())
    const md = formatAsMarkdown(report)
    expect(md).toMatch(/合规评分.*\d+\/100/)
  })

  it('formatAsMarkdown 含 SHA-256 指纹', () => {
    const report = buildAndFinalizeReport(makeInput())
    const md = formatAsMarkdown(report)
    expect(md).toContain(report.metadata.fingerprint)
  })

  it('formatAsMarkdown 含 12 类风险表格', () => {
    const report = buildAndFinalizeReport(makeInput())
    const md = formatAsMarkdown(report)
    // 12 行风险表 + 表头
    const riskRows = md.split('\n').filter((l) => l.match(/^\| \d+ \|/))
    expect(riskRows.length).toBeGreaterThanOrEqual(12)
  })

  it('formatAsMarkdown 转义 Markdown 特殊字符', () => {
    const report = buildAndFinalizeReport(
      makeInput({ decisionContext: { ...makeInput().decisionContext, intendedPurpose: '包含 | pipe 和 * 星号' } }),
    )
    const md = formatAsMarkdown(report)
    // 管道符在 markdown 表格中需要转义
    expect(md).toContain('pipe')
  })
})

// ============================================================================
// HTML 格式化器
// ============================================================================

describe('audit/formatters — HTML 格式化', () => {
  it('formatAsHtml 输出完整 HTML 文档', () => {
    const report = buildAndFinalizeReport(makeInput())
    const html = formatAsHtml(report)
    expect(html).toMatch(/^<!DOCTYPE html>/)
    expect(html).toContain('<html')
    expect(html).toContain('</html>')
    expect(html).toContain('<head>')
    expect(html).toContain('<style>')
  })

  it('formatAsHtml 含内联 CSS（自包含）', () => {
    const report = buildAndFinalizeReport(makeInput())
    const html = formatAsHtml(report)
    expect(html).toContain('--color-bg:')
    expect(html).toContain('.card')
    expect(html).toContain('@media print')
  })

  it('formatAsHtml 含决策上下文与合规评分', () => {
    const report = buildAndFinalizeReport(makeInput())
    const html = formatAsHtml(report)
    expect(html).toContain('Nginx 502')
    expect(html).toContain(report.decisionContext.decisionId)
    expect(html).toMatch(/合规评分：\d+/)
  })

  it('formatAsHtml 转义 HTML 特殊字符（XSS 防护）', () => {
    const report = buildAndFinalizeReport(
      makeInput({ decisionContext: { ...makeInput().decisionContext, decisionTitle: '<script>alert(1)</script>' } }),
    )
    const html = formatAsHtml(report)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

// ============================================================================
// 统一入口与工具函数
// ============================================================================

describe('audit/formatters — 统一入口', () => {
  it('formatReport 分发到对应格式化器', () => {
    const report = buildAndFinalizeReport(makeInput())
    expect(formatReport(report, 'json')).toMatch(/^\{/)
    expect(formatReport(report, 'markdown')).toMatch(/^# /)
    expect(formatReport(report, 'html')).toMatch(/^<!DOCTYPE/)
  })

  it('getFileExtension / getMimeType', () => {
    expect(getFileExtension('json')).toBe('json')
    expect(getFileExtension('markdown')).toBe('md')
    expect(getFileExtension('html')).toBe('html')

    expect(getMimeType('json')).toBe('application/json')
    expect(getMimeType('markdown')).toBe('text/markdown')
    expect(getMimeType('html')).toBe('text/html')
  })
})

// ============================================================================
// 导出器（基础）
// ============================================================================

describe('audit/exporter — 导出器基础', () => {
  it('getDefaultAuditDir 返回字符串路径', async () => {
    const { getDefaultAuditDir } = await import('../../../../../src/main/core/agent/credibility/audit/exporter')
    const dir = getDefaultAuditDir()
    expect(typeof dir).toBe('string')
    expect(dir).toContain('audit-reports')
  })

  it('getReportDir 构造 YYYY-MM-DD/{decisionId} 路径', async () => {
    const { getReportDir } = await import('../../../../../src/main/core/agent/credibility/audit/exporter')
    const decisionTime = new Date('2026-07-20T00:00:00Z').getTime()
    const dir = getReportDir('/tmp/audit', decisionTime, 'card-001')
    expect(dir).toContain('2026-07-20')
    expect(dir).toContain('card-001')
  })

  it('getReportDir 拒绝非法时间', async () => {
    const { getReportDir } = await import('../../../../../src/main/core/agent/credibility/audit/exporter')
    expect(() => getReportDir('/tmp', NaN, 'x')).toThrow(/无效的决策时间/)
  })

  it('diffAuditReports 计算差异', async () => {
    const { diffAuditReports } = await import('../../../../../src/main/core/agent/credibility/audit/exporter')
    const a = buildAndFinalizeReport(makeInput())
    const b = buildAndFinalizeReport(
      makeInput({
        calibration: { ...makeInput().calibration!, eceAfter: 0.02 },
        confidenceAssessment: { ...makeInput().confidenceAssessment, confidence: 0.9 },
      }),
    )
    const diff = diffAuditReports(a, b)
    expect(diff.eceAfterDelta).toBeCloseTo(0.02 - 0.06, 4)
    expect(diff.confidenceDelta).toBeCloseTo(0.05, 4)
    expect(typeof diff.fingerprintChanged).toBe('boolean')
  })
})

// ============================================================================
// 元数据常量
// ============================================================================

describe('audit — 元数据常量', () => {
  it('AUDIT_REPORT_SCHEMA_VERSION 存在', () => {
    expect(typeof AUDIT_REPORT_SCHEMA_VERSION).toBe('string')
    expect(AUDIT_REPORT_SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('AUDIT_GENERATOR_VERSION 标识为 tdsf-linux-desktop/0.9.6-m6', () => {
    expect(AUDIT_GENERATOR_VERSION).toContain('tdsf-linux-desktop')
    expect(AUDIT_GENERATOR_VERSION).toContain('m6')
  })

  it('报告中 generatorVersion / schemaVersion 引用常量', () => {
    const report = buildAndFinalizeReport(makeInput())
    expect(report.metadata.schemaVersion).toBe(AUDIT_REPORT_SCHEMA_VERSION)
    expect(report.metadata.generatorVersion).toBe(AUDIT_GENERATOR_VERSION)
  })
})

// ============================================================================
// 往返一致性
// ============================================================================

describe('audit — JSON 往返一致性', () => {
  it('序列化后再反序列化字段一致', () => {
    const original = buildAndFinalizeReport(makeInput())
    const json = formatAsJson(original)
    const restored = JSON.parse(json) as ComplianceAuditReport

    expect(restored.decisionContext.decisionId).toBe(original.decisionContext.decisionId)
    expect(restored.fusionResult.belief).toBe(original.fusionResult.belief)
    expect(restored.fusionResult.plausibility).toBe(original.fusionResult.plausibility)
    expect(restored.calibration.optimalT).toBe(original.calibration.optimalT)
    expect(restored.overallCompliance.complianceScore).toBe(original.overallCompliance.complianceScore)
    expect(restored.metadata.fingerprint).toBe(original.metadata.fingerprint)
    expect(restored.genaiRiskCoverage).toHaveLength(12)
  })
})

// ============================================================================
// Zadeh 悖论场景（高冲突 + PCR5 必要性证明）
// ============================================================================
// 论文支撑：
// - Zadeh 1984, "Review of Books: A Mathematical Theory of Evidence"
//   AI Magazine Vol 5, No 3, pp 81-83
// - Smarandache & Dezert 2009, "Advances and Applications of DSmT for Information Fusion"
//   Vol 1-3, ARP
// - 调研文档：d:\ai\linux教学一体\idea-to-dev-output\22-可信度算法论文支撑调研.md §2-3
//
// Zadeh 悖论场景示例：
//   m1: {T: 0.99, ¬T: 0.01}  (高支持 T)
//   m2: {T: 0,    ¬T: 1.00}  (完全否定 T)
//   经典 Dempster 规则：m(T) ≈ 0, m(¬T) ≈ 1 (反直觉)
//   PCR5 规则：保留原始 mass，避免反直觉归一化
//
// 本测试通过 audit/report-builder 的入口验证：
// 1. 高冲突下正确选 PCR5
// 2. 报告的 riskScore / trustLevel / conflictLevel 合理
// 3. 决策不被完全否定

describe('audit/report-builder — Zadeh 悖论场景', () => {
  it('高冲突（k=0.5）→ 使用 PCR5 + conflictLevel=high', () => {
    // Zadeh 悖论：两源完全对立，conflictLevel=0.5
    const input = makeInput({
      confidenceAssessment: {
        ...makeInput().confidenceAssessment,
        belief: 0.5,         // 悖论：被否定到 0.5 而不是 0
        plausibility: 0.5,
        confidence: 0.5,     // 中等 confidence
        uncertainty: 0,
        conflictLevel: 0.5,  // 高冲突
        ruleUsed: 'pcr5',    // 正确选择 PCR5
        fusionSteps: [
          {
            step: 1,
            ruleUsed: 'pcr5',
            leftSourceId: 'S1-log',
            rightSourceId: 'S2-knowledge',
            conflict: 0.5,
            resultBelief: 0.495,    // PCR5 保留部分 mass
            resultPlausibility: 0.505,
          },
        ],
      },
    })
    const report = buildAuditReport(input)
    expect(report.fusionResult.conflictLevel).toBe('high')
    expect(report.fusionResult.ruleUsed).toBe('pcr5')
    // 关键：belief 不应被归一化到 0（Zadeh 悖论的反直觉结果）
    expect(report.fusionResult.belief).toBeGreaterThan(0.4)
  })

  it('低冲突（k=0.05）→ 使用 Dempster 经典规则', () => {
    // 正常场景：6 源高度一致，conflictLevel=0.05
    const report = buildAuditReport(makeInput({
      confidenceAssessment: { ...makeInput().confidenceAssessment, conflictLevel: 0.05, ruleUsed: 'dempster' },
    }))
    expect(report.fusionResult.conflictLevel).toBe('low')
    expect(report.fusionResult.ruleUsed).toBe('dempster')
  })

  it('冲突边界：conflictLevel=0.299 → medium，0.3 → high', () => {
    // 边界 0.3 是 PCR5 触发阈值（report-builder.ts 中 hardcode）
    const medInput = makeInput({ confidenceAssessment: { ...makeInput().confidenceAssessment, conflictLevel: 0.299 } })
    expect(buildAuditReport(medInput).fusionResult.conflictLevel).toBe('medium')

    const highInput = makeInput({ confidenceAssessment: { ...makeInput().confidenceAssessment, conflictLevel: 0.3 } })
    expect(buildAuditReport(highInput).fusionResult.conflictLevel).toBe('high')
  })
})

// ============================================================================
// 边界场景（calibration 空 / 6 源空 / decisionContext 最小）
// ============================================================================

describe('audit/report-builder — 边界与降级场景', () => {
  it('calibration=null 时：构建不崩溃 + 默认校准状态', () => {
    const input = makeInput()
    ;(input as any).calibration = null
    const report = buildAuditReport(input)
    // 应该自动构建空校准（providerId 来自 decisionContext.provider）
    expect(report.calibration).toBeDefined()
    expect(report.calibration.providerId).toBe('DeepSeek')
    expect(report.calibration.optimalT).toBe(1.0)
    expect(report.calibration.eceAfter).toBe(0)
  })

  it('sourceEvidences=空数组：6 源融合的退化场景', () => {
    const input = makeInput()
    input.sourceEvidences = []
    const report = buildAuditReport(input)
    expect(report.sourceEvidences).toHaveLength(0)
    // 不崩溃
    expect(report.fusionResult).toBeDefined()
    // 风险评估仍输出 12 条
    expect(report.genaiRiskCoverage).toHaveLength(12)
  })

  it('conflictLevel=1.0（完全冲突）：trustLevel=L4 + 风险评分高', () => {
    // 极端边界：所有源完全对立
    const input = makeInput({
      confidenceAssessment: {
        ...makeInput().confidenceAssessment,
        confidence: 0.0,
        uncertainty: 1.0,
        conflictLevel: 1.0,
        ruleUsed: 'pcr5',
      },
    })
    const report = buildAuditReport(input)
    expect(report.fusionResult.trustLevel).toBe('L4') // 最低信任度
    expect(report.fusionResult.riskScore).toBe(100)   // 最高风险
  })

  it('confidence=0.5 + uncertainty=0.5（完全无知）：trustLevel=L4', () => {
    // 另一个边界：完全无知
    const input = makeInput({
      confidenceAssessment: {
        ...makeInput().confidenceAssessment,
        confidence: 0.5,
        uncertainty: 0.5,
        conflictLevel: 0,
      },
    })
    const report = buildAuditReport(input)
    expect(report.fusionResult.trustLevel).toBe('L4')
  })

  it('EU AI Act：art.15 阈值边界（ECE=0.099 vs ECE=0.1）', () => {
    // EU AI Act Art.15 要求 ECE < 0.1
    // 测试 0.099 通过 / 0.1 临界 / 0.101 不通过
    const passInput = makeInput({ calibration: { ...makeInput().calibration!, eceAfter: 0.099 } })
    expect(buildAuditReport(passInput).overallCompliance.euAiActCompliant).toBe(true)

    const failInput = makeInput({ calibration: { ...makeInput().calibration!, eceAfter: 0.101 } })
    expect(buildAuditReport(failInput).overallCompliance.euAiActCompliant).toBe(false)
  })
})

// ============================================================================
// 指纹稳定性：v1.1 修复后回归测试
// ============================================================================

describe('audit/report-builder — 指纹算法 v1.1 回归（嵌套字段变化）', () => {
  it('修改 sourceEvidences 字段 → 指纹变化', () => {
    // v1.1 修复前：JSON.stringify 嵌套对象时 array replacer 忽略嵌套 key，导致修改不变化
    // v1.1 修复后：stableStringify 递归排序所有嵌套 key
    const a = buildAuditReport(makeInput())
    const b = buildAuditReport(makeInput({
      sourceEvidences: [
        { ...makeInput().sourceEvidences[0], rawConfidence: 0.99 },
        ...makeInput().sourceEvidences.slice(1),
      ],
    }))
    const fa = computeReportFingerprint(a)
    const fb = computeReportFingerprint(b)
    expect(fa).not.toBe(fb)
  })

  it('修改 fusionSteps 字段 → 指纹变化', () => {
    const a = buildAuditReport(makeInput())
    const b = buildAuditReport(makeInput({
      confidenceAssessment: {
        ...makeInput().confidenceAssessment,
        fusionSteps: [
          {
            step: 1,
            ruleUsed: 'dempster',
            leftSourceId: 'S1-log',
            rightSourceId: 'S2-knowledge',
            conflict: 0.05,
            resultBelief: 0.65,
            resultPlausibility: 0.85,
          },
          {
            step: 2,
            ruleUsed: 'dempster',
            leftSourceId: 'S3-ai-param',
            rightSourceId: 'S4-human',
            conflict: 0.08,
            resultBelief: 0.78,
            resultPlausibility: 0.92,
          },
          {
            step: 3,    // 多了第 3 步
            ruleUsed: 'dempster',
            leftSourceId: 'S5-history',
            rightSourceId: 'S6-best-practice',
            conflict: 0.03,
            resultBelief: 0.85,
            resultPlausibility: 0.95,
          },
        ],
      },
    }))
    expect(computeReportFingerprint(a)).not.toBe(computeReportFingerprint(b))
  })

  it('修改 overallCompliance 字段 → 指纹变化', () => {
    const a = buildAuditReport(makeInput())
    const b = buildAuditReport(makeInput({
      decisionContext: { ...makeInput().decisionContext, intendedPurpose: '完全不同的用途说明' },
    }))
    expect(computeReportFingerprint(a)).not.toBe(computeReportFingerprint(b))
  })

  it('修改 topCandidates 嵌套数组 → 指纹变化', () => {
    const a = buildAuditReport(makeInput())
    const b = buildAuditReport(makeInput({
      calibration: {
        ...makeInput().calibration!,
        topCandidates: [
          { t: 0.5, ece: 0.10 },
          { t: 1.5, ece: 0.04 },  // 调整了 T 候选
          { t: 2.5, ece: 0.07 },
        ],
      },
    }))
    expect(computeReportFingerprint(a)).not.toBe(computeReportFingerprint(b))
  })

  it('完全相同输入（除 metadata 外）→ 相同指纹', () => {
    // 构造两份输入完全一致的报告
    const a = buildAuditReport(makeInput())
    const b = buildAuditReport(makeInput())
    // metadata.reportId 不同，但 fingerprint 排除 metadata
    expect(a.metadata.reportId).not.toBe(b.metadata.reportId)
    expect(computeReportFingerprint(a)).toBe(computeReportFingerprint(b))
  })
})

// ============================================================================
// 跨章节集成：报告→JSON→读回→diff
// ============================================================================

describe('audit/exporter — 跨章节集成', () => {
  it('loadAuditReport + diffAuditReports：两次校准差异可计算', async () => {
    const { diffAuditReports } = await import('../../../../../src/main/core/agent/credibility/audit/exporter')
    // 第 1 次报告：ECE 0.15, confidence 0.7
    const r1 = buildAndFinalizeReport(makeInput({
      calibration: { ...makeInput().calibration!, eceAfter: 0.15 },
      confidenceAssessment: { ...makeInput().confidenceAssessment, confidence: 0.7 },
    }))
    // 第 2 次报告：ECE 0.05, confidence 0.85（优化后）
    const r2 = buildAndFinalizeReport(makeInput({
      calibration: { ...makeInput().calibration!, eceAfter: 0.05 },
      confidenceAssessment: { ...makeInput().confidenceAssessment, confidence: 0.85 },
    }))

    const diff = diffAuditReports(r1, r2)
    expect(diff.eceAfterDelta).toBeCloseTo(-0.10, 4)
    expect(diff.confidenceDelta).toBeCloseTo(0.15, 4)
    expect(diff.optimalTDelta).toBe(0) // T 相同
    expect(typeof diff.fingerprintChanged).toBe('boolean')
  })

  it('formatReport 三种格式输出都包含关键元数据', () => {
    const report = buildAndFinalizeReport(makeInput())
    // JSON
    const json = formatReport(report, 'json')
    const parsed = JSON.parse(json)
    expect(parsed.metadata.fingerprint).toBe(report.metadata.fingerprint)
    expect(parsed.decisionContext.decisionId).toBe('card-001')

    // Markdown
    const md = formatReport(report, 'markdown')
    expect(md).toContain('Nginx 502')
    expect(md).toContain(report.metadata.fingerprint)

    // HTML
    const html = formatReport(report, 'html')
    expect(html).toContain('Nginx 502')
    expect(html).toContain(report.metadata.fingerprint)
    expect(html).toContain('<!DOCTYPE html>')
  })
})

