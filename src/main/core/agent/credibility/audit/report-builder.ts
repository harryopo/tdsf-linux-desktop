/**
 * 报告构建器（核心逻辑）
 *
 * 职责：从 ConfidenceAssessment + 校准状态 + 决策卡数据构造完整的合规审计报告。
 *
 * 流程：
 * 1. 规范化输入（默认值填充 / 类型校验）
 * 2. 计算衍生字段（风险等级、合规评分、改进项）
 * 3. 评估 NIST 600-1 12 类 GAI 风险覆盖
 * 4. 生成报告指纹 SHA-256
 * 5. 计算过期时间（+6 个月，符合 EU AI Act Art.12 保留期）
 *
 * 论文 / 法规支撑：
 * - EU AI Act Art.12（6 个月保留期 + 决策可重建）
 * - EU AI Act Art.13(3)（intended purpose / accuracy / limitations / human oversight / logging）
 * - EU AI Act Art.15（accuracy / robustness）
 * - NIST AI 600-1（12 类 GAI 风险）
 * - NIST AI RMF 1.0（GOVERN / MAP / MEASURE / MANAGE）
 */

import { createHash, randomUUID } from 'node:crypto'
import type {
  AuditCalibrationState,
  AuditDecisionAction,
  AuditDecisionContext,
  AuditDecisionOutcome,
  AuditFormat,
  AuditFusionResult,
  AuditFusionStep,
  AuditHumanOversight,
  AuditMetadata,
  AuditReportInput,
  AuditSourceEvidence,
  AuditTransparency,
  ComplianceAuditReport,
  GenaiRiskCoverage,
  RegulatoryFrame,
} from './types'

// ============================================================================
// 常量
// ============================================================================

/** 报告 schema 版本 */
export const AUDIT_REPORT_SCHEMA_VERSION = '1.0.0'

/** 报告生成器版本 */
export const AUDIT_GENERATOR_VERSION = 'tdsf-linux-desktop/0.9.6-m6'

/** EU AI Act 2026 关键条款 */
const EU_AI_ACT_ARTICLES = [
  'Art.9 Risk Management',
  'Art.10 Data Governance',
  'Art.11 Technical Documentation',
  'Art.12 Automatic Logging',
  'Art.13 Transparency to Deployers',
  'Art.14 Human Oversight',
  'Art.15 Accuracy Robustness Cybersecurity',
  'Art.19 Transparency Obligations',
  'Annex IV Technical Documentation',
]

/** NIST AI 600-1 12 类 GAI 风险模板 */
const GENAI_RISK_TEMPLATES: Array<{
  riskId: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12
  riskName: string
  defaultRationale: string
  defaultControls: string[]
}> = [
  {
    riskId: 1,
    riskName: 'CBRN Information (化学/生物/放射/核信息)',
    defaultRationale: '本系统仅用于运维操作（CVE 修复 / 服务配置 / 资源调度），未涉及 CBRN 领域。',
    defaultControls: ['领域白名单', '命令黑名单', '知识库 KB 隔离'],
  },
  {
    riskId: 2,
    riskName: 'Confabulation (幻觉/虚构)',
    defaultRationale: 'D-S 证据理论 + PCR5 冲突融合 + 6 源交叉校验降低单源幻觉；ECE 校准监控 verbalized confidence 漂移。',
    defaultControls: ['D-S 证据理论', 'PCR5 冲突处理', '6 源交叉校验', 'ECE 校准'],
  },
  {
    riskId: 3,
    riskName: 'Dangerous, Violent, or Hateful Content (危险/暴力/仇恨内容)',
    defaultRationale: '运维场景无该风险；命令黑名单与人工审批覆盖。',
    defaultControls: ['命令黑名单', '人工审批', '风险门 L1-L4'],
  },
  {
    riskId: 4,
    riskName: 'Data Privacy (数据隐私)',
    defaultRationale: '本地部署，日志不外发；评估中无 PII 处理。',
    defaultControls: ['本地部署', '日志隔离', 'PII 脱敏（计划中）'],
  },
  {
    riskId: 5,
    riskName: 'Environmental Impact (环境影响)',
    defaultRationale: '本地推理，无外部 API 调用；token 监控有助节能减排。',
    defaultControls: ['本地推理', 'Token 监控', '小模型优先'],
  },
  {
    riskId: 6,
    riskName: 'Human-AI Configuration (人机配置)',
    defaultRationale: '采用 human-on-the-loop + human-in-command 双层监督；L3 人工审批不可绕过。',
    defaultControls: ['Human-on-the-loop', 'Human-in-command', 'L3 强制审批'],
  },
  {
    riskId: 7,
    riskName: 'Information Integrity (信息完整性)',
    defaultRationale: 'D-S 6 源独立性 + 知识库 + 历史 + 人工交叉校验保证信息完整性。',
    defaultControls: ['D-S 独立性假设', '6 源交叉校验', '知识库权威性'],
  },
  {
    riskId: 8,
    riskName: 'Information Security (信息安全)',
    defaultRationale: '审计日志 6 个月保留 + SHA-256 指纹 + IPC 4 步同步保证日志完整性。',
    defaultControls: ['审计日志', 'SHA-256 指纹', 'IPC 4 步同步'],
  },
  {
    riskId: 9,
    riskName: 'Intellectual Property (知识产权)',
    defaultRationale: '模型输出仅用于内部运维决策，不对外发布。',
    defaultControls: ['内部使用', '无对外发布', '审计追溯'],
  },
  {
    riskId: 10,
    riskName: 'Obscene, Degrading, and/or Abusive Content (淫秽/贬损/辱骂内容)',
    defaultRationale: '运维场景无该风险。',
    defaultControls: ['场景白名单', '输出过滤'],
  },
  {
    riskId: 11,
    riskName: 'Toxicity, Bias, and Homogenization (毒性/偏见/同质化)',
    defaultRationale: '6 源融合降低单源偏见；不同 Provider（DeepSeek / Claude）独立校准避免同质化。',
    defaultControls: ['6 源融合', 'Provider 独立校准', 'ECE 监控'],
  },
  {
    riskId: 12,
    riskName: 'Value Chain and Component Integration (价值链与组件集成)',
    defaultRationale: '上游（指标 / KB / 历史）数据来源明确，下游（命令 / 审批 / 审计）接口稳定。',
    defaultControls: ['数据来源记录', '接口契约', '集成测试'],
  },
]

/** EU AI Act 高风险分类依据 */
const EU_AI_ACT_RISK_BASIS =
  'EU AI Act Annex III §6 (Access to essential private services) + §5 (Critical infrastructure)：' +
  '本系统涉及关键基础设施（Linux 服务器运维 / AIOps），属于高风险 AI 系统。'

// ============================================================================
// 主函数：构建报告
// ============================================================================

/**
 * 从输入构造完整合规审计报告
 */
export function buildAuditReport(input: AuditReportInput): ComplianceAuditReport {
  // 1. 规范化决策上下文
  // v1.0 修复：原始类型用 Omit + Partial 导致 deployerContact/domain/isHighRisk 是 optional，
  //   与 AuditDecisionContext 必填字段不兼容，显式断言为 AuditDecisionContext
  const decisionContext = {
    ...input.decisionContext,
    deployerContact: input.decisionContext.deployerContact ?? input.deployerContact ?? 'admin@tdsf.dev',
    domain: input.decisionContext.domain ?? input.domain ?? 'Linux Operations / AIOps',
    isHighRisk: input.decisionContext.isHighRisk ?? input.isHighRisk ?? true,
  } as AuditDecisionContext

  // 2. 规范化 6 源证据
  const sourceEvidences: AuditSourceEvidence[] = input.sourceEvidences.map((s) => ({
    ...s,
    focalElements: s.focalElements ?? { T: s.calibratedConfidence ?? 0, '¬T': 1 - (s.calibratedConfidence ?? 0) },
    rawConfidence: s.rawConfidence ?? s.calibratedConfidence ?? 0,
    calibratedConfidence: s.calibratedConfidence ?? s.rawConfidence ?? 0,
    calibrationTemperature: s.calibrationTemperature ?? 1.0,
  }))

  // 3. 构造融合结果
  const fusionResult = buildFusionResult(input.confidenceAssessment)

  // 4. 评估 NIST 600-1 12 类风险
  const genaiRiskCoverage = buildGenaiRiskCoverage(input, fusionResult, sourceEvidences)

  // 5. 构造透明度声明
  // v1.0 修复：传规范化后的 decisionContext（含默认值的 AuditDecisionContext），
  //   而不是 input.decisionContext（含 undefined 字段的 Omit+Partial 类型）
  const transparency = buildTransparencyStatement(
    decisionContext,
    input.confidenceAssessment,
    input.calibration,
    sourceEvidences,
  )

  // 6. 构造决策后果
  const decisionOutcome: AuditDecisionOutcome = input.decisionOutcome ?? {
    decisionStatus: 'pending-verification',
    wasCorrect: null,
    observedAccuracy: null,
    impactLevel: fusionResult.riskScore > 70 ? 'high' : fusionResult.riskScore > 40 ? 'medium' : 'low',
    followUpNotes: null,
  }

  // 7. 计算整体合规结论
  const overallCompliance = computeOverallCompliance(
    genaiRiskCoverage,
    input.calibration,
    input.humanOversight,
    fusionResult,
  )

  // 8. 构造监管元数据
  const regulatory: RegulatoryFrame = {
    euAiActVersion: '2024/1689 (生效 2024-08-01; 高风险条款 2026-08-02 强制)',
    nistAiRmfVersion: 'AI RMF 1.0 (NIST AI 100-1, 2023-01-26)',
    nistAi600Version: 'NIST AI 600-1 GenAI Profile (2024-07-26)',
    riskClassificationBasis: EU_AI_ACT_RISK_BASIS,
    applicableArticles: EU_AI_ACT_ARTICLES,
  }

  // 9. 生成元数据
  const metadata = generateMetadata(input, decisionContext)

  return {
    regulatory,
    metadata,
    decisionContext,
    sourceEvidences,
    fusionResult,
    // v1.0 修复：calibration 在 AuditReportInput 中可空（首次使用无校准数据），
    //   此处兜底为空校准，确保返回类型非 null
    calibration: (input.calibration ?? buildEmptyCalibration(decisionContext.provider)) as AuditCalibrationState,
    humanOversight: input.humanOversight,
    decisionAction: input.decisionAction,
    decisionOutcome,
    transparency,
    genaiRiskCoverage: genaiRiskCoverage as GenaiRiskCoverage[],
    overallCompliance,
  }
}

// ============================================================================
// 内部：融合结果
// ============================================================================

function buildFusionResult(assessment: AuditReportInput['confidenceAssessment']): AuditFusionResult {
  const { belief, plausibility, conflictLevel, ruleUsed } = assessment
  const conflictLevelLabel: AuditFusionResult['conflictLevel'] =
    conflictLevel < 0.1 ? 'low' : conflictLevel < 0.3 ? 'medium' : 'high'

  const fusionSteps: AuditFusionStep[] = assessment.fusionSteps.map((s) => ({
    step: s.step,
    ruleUsed: s.ruleUsed,
    conflictThreshold: 0.3,
    conflictValue: s.conflict,
    leftSourceId: s.leftSourceId,
    rightSourceId: s.rightSourceId,
    resultBelief: s.resultBelief,
    resultPlausibility: s.resultPlausibility,
    resultUncertainty: s.resultPlausibility - s.resultBelief,
    justification: ruleJustification(s.ruleUsed, s.conflict),
  }))

  // 风险评分：不确定性大 + 冲突高 → 高风险
  const riskScore = Math.round(100 * (0.4 * assessment.uncertainty + 0.3 * conflictLevel + 0.3 * (1 - assessment.confidence)))
  const riskDescription = describeRisk(riskScore, conflictLevelLabel, assessment.confidence)

  // 信任度等级：基于 confidence + uncertainty
  const trustLevel: AuditFusionResult['trustLevel'] =
    assessment.confidence > 0.85 && assessment.uncertainty < 0.1
      ? 'L1'
      : assessment.confidence > 0.7 && assessment.uncertainty < 0.2
      ? 'L2'
      : assessment.confidence > 0.5 && assessment.uncertainty < 0.3
      ? 'L3'
      : 'L4'

  return {
    belief,
    plausibility,
    confidence: assessment.confidence,
    uncertainty: assessment.uncertainty,
    conflictLevel: conflictLevelLabel,
    ruleUsed,
    fusionSteps,
    trustLevel,
    riskScore,
    riskDescription,
  }
}

function ruleJustification(rule: 'dempster' | 'pcr5', conflict: number): string {
  if (rule === 'pcr5') {
    return `冲突 k=${conflict.toFixed(4)} 超过阈值 0.3，使用 PCR5（比例冲突再分配）避免 Dempster 反直觉归一化。`
  }
  return `冲突 k=${conflict.toFixed(4)} 低于阈值 0.3，使用经典 Dempster 规则。`
}

function describeRisk(riskScore: number, conflict: 'low' | 'medium' | 'high', confidence: number): string {
  if (riskScore >= 70) return `高风险（${riskScore}/100）：不确定性显著，建议人工审批后再执行。`
  if (riskScore >= 40) return `中风险（${riskScore}/100）：需关注冲突等级（${conflict}）与 confidence（${(confidence * 100).toFixed(1)}%）。`
  return `低风险（${riskScore}/100）：confidence（${(confidence * 100).toFixed(1)}%）较高，冲突（${conflict}）可控。`
}

// ============================================================================
// 内部：NIST 600-1 12 类 GAI 风险
// ============================================================================

function buildGenaiRiskCoverage(
  input: AuditReportInput,
  fusion: AuditFusionResult,
  _sources: AuditSourceEvidence[],
): GenaiRiskCoverage[] {
  // 根据实际情况动态调整部分风险评级
  return GENAI_RISK_TEMPLATES.map<GenaiRiskCoverage>((tpl) => {
    // 基础结构：把模板的 defaultControls / defaultRationale 映射为 controls / rationale
    const base: GenaiRiskCoverage = {
      riskId: tpl.riskId,
      riskName: tpl.riskName,
      verdict: 'not-applicable',
      rationale: tpl.defaultRationale,
      controls: [...tpl.defaultControls],
    }

    // Confabulation (id=2)：根据 ECE / 校准状态调整
    if (tpl.riskId === 2) {
      const ece = input.calibration?.eceAfter ?? 0.5
      const verdict: GenaiRiskCoverage['verdict'] =
        ece < 0.05 ? 'mitigated' : ece < 0.15 ? 'partially-mitigated' : 'unmitigated'
      return {
        ...base,
        verdict,
        rationale: `D-S + PCR5 融合后 ECE=${(ece * 100).toFixed(2)}%，校准 T=${input.calibration?.optimalT.toFixed(3) ?? '1.000'}。${
          verdict === 'mitigated' ? '校准充分，confabulation 风险低。' : '需进一步校准。'
        }`,
        controls: [...tpl.defaultControls, `Temperature T=${input.calibration?.optimalT.toFixed(3) ?? '1.000'}`],
      }
    }

    // Human-AI Configuration (id=6)：根据 oversight mode 调整
    if (tpl.riskId === 6) {
      const verdict: GenaiRiskCoverage['verdict'] =
        input.humanOversight.oversightMode === 'human-in-command' ? 'mitigated' : 'partially-mitigated'
      return {
        ...base,
        verdict,
        rationale: `Oversight 模式：${input.humanOversight.oversightMode}；L3 审批触发 ${input.humanOversight.triggeredHighRiskInterception ? '是' : '否'}。`,
      }
    }

    // Information Security (id=8)：本审计报告本身就是缓解
    if (tpl.riskId === 8) {
      return {
        ...base,
        verdict: 'mitigated',
        rationale: '本审计报告含 SHA-256 指纹 + 6 个月保留期，符合 EU AI Act Art.12。',
      }
    }

    // Toxicity/Bias (id=11)：根据 6 源多样性调整
    if (tpl.riskId === 11) {
      const distinctProviders = new Set(input.sourceEvidences.map((s) => s.sourceId)).size
      return {
        ...base,
        verdict: distinctProviders >= 5 ? 'mitigated' : 'partially-mitigated',
        rationale: `${distinctProviders} 个独立证据源，降低单源偏见。ECE=${(input.calibration?.eceAfter ?? 0.5) * 100}%。`,
      }
    }

    // Information Integrity (id=7)：根据 conflict level 调整
    if (tpl.riskId === 7) {
      const verdict: GenaiRiskCoverage['verdict'] =
        fusion.conflictLevel === 'low' ? 'mitigated' : fusion.conflictLevel === 'medium' ? 'partially-mitigated' : 'unmitigated'
      return {
        ...base,
        verdict,
        rationale: `融合冲突等级 ${fusion.conflictLevel}（k=${input.confidenceAssessment.conflictLevel.toFixed(4)}），6 源独立性保证信息完整性。`,
      }
    }

    return base
  })
}

// ============================================================================
// 内部：透明度声明
// ============================================================================

function buildTransparencyStatement(
  context: AuditDecisionContext,
  assessment: AuditReportInput['confidenceAssessment'],
  calibration: AuditReportInput['calibration'],
  sources: AuditSourceEvidence[],
): AuditTransparency {
  return {
    intendedPurposeHuman: context.intendedPurpose,
    accuracyStatement:
      `融合 confidence = ${(assessment.confidence * 100).toFixed(2)}%，` +
      `Bel = ${(assessment.belief * 100).toFixed(2)}%，Pl = ${(assessment.plausibility * 100).toFixed(2)}%，` +
      `ECE = ${calibration ? (calibration.eceAfter * 100).toFixed(2) : 'N/A'}%。`,
    robustnessStatement:
      `校准温度 T = ${calibration?.optimalT.toFixed(3) ?? '1.000'}，` +
      `${calibration?.sampleCount ?? 0} 个历史决策样本参与校准。`,
    limitationsHuman: context.knownLimitations,
    humanOversightMeasures:
      'L1 预拦截 + L2 沙箱预演 + L3 工程师审批 + L4 审计回放，' +
      `${sources.length} 个证据源独立加权。`,
    computationalRequirements: '主进程 Node.js ≥ 18，IPC 4 步同步，无外部 API 依赖。',
    maintenanceNotes: '校准状态每 20 个新样本自动重校准，触发增量更新。',
    loggingMechanismDescription:
      '6 个月保留期（EU AI Act Art.12），SHA-256 指纹防篡改，IPC 日志 + 文件持久化双通道。',
  }
}

// ============================================================================
// 内部：合规计算
// ============================================================================

function computeOverallCompliance(
  genaiRisk: GenaiRiskCoverage[],
  calibration: AuditReportInput['calibration'],
  oversight: AuditHumanOversight,
  fusion: AuditFusionResult,
): {
  euAiActCompliant: boolean
  nistAiRmfCompliant: boolean
  nistAi600Compliant: boolean
  complianceScore: number
  improvementAreas: string[]
} {
  const mitigatedCount = genaiRisk.filter((r) => r.verdict === 'mitigated').length
  const partialCount = genaiRisk.filter((r) => r.verdict === 'partially-mitigated').length
  const unmitigatedCount = genaiRisk.filter((r) => r.verdict === 'unmitigated').length

  // NIST 600-1 通过：unmitigated = 0
  const nistAi600Compliant = unmitigatedCount === 0

  // NIST AI RMF 通过：GOVERN（高风险分类）+ MAP（intended purpose）+ MEASURE（ECE）+ MANAGE（人工审批）全覆盖
  const nistAiRmfCompliant =
    nistAi600Compliant && (calibration !== null) && (oversight.approvalStatus !== 'pending')

  // EU AI Act 通过：Art.12（日志保留）+ Art.13（透明度）+ Art.14（人工审批）+ Art.15（accuracy / ECE < 0.1）
  const eceAcceptable = calibration ? calibration.eceAfter < 0.1 : false
  const euAiActCompliant =
    nistAiRmfCompliant &&
    eceAcceptable &&
    fusion.conflictLevel !== 'high' &&
    oversight.approvalStatus !== 'timeout'

  // 合规评分：12 类风险
  // - mitigated 与 not-applicable 视作满分（前者主动缓解，后者场景不适用即天然规避）
  // - partial 60 分（部分缓解）
  // - unmitigated 0 分（未处理）
  const mitigatedFullCount =
    genaiRisk.filter((r) => r.verdict === 'mitigated' || r.verdict === 'not-applicable').length
  const baseScore = (mitigatedFullCount * 100 + partialCount * 60 + unmitigatedCount * 0) / 12
  const calibrationBonus = calibration ? Math.max(0, 10 - calibration.eceAfter * 50) : 0
  const oversightBonus = oversight.approvalStatus === 'approved' ? 5 : 0
  const complianceScore = Math.min(100, Math.round(baseScore + calibrationBonus + oversightBonus))

  const improvementAreas: string[] = []
  if (calibration && calibration.eceAfter > 0.05) {
    improvementAreas.push(`降低 ECE 至 < 5%（当前 ${(calibration.eceAfter * 100).toFixed(2)}%）`)
  }
  if (calibration && calibration.daysSinceCalibration > 7) {
    improvementAreas.push(`重新校准（距上次 ${calibration.daysSinceCalibration} 天）`)
  }
  if (oversight.approvalStatus === 'pending') {
    improvementAreas.push('完成人工审批')
  }
  if (fusion.conflictLevel === 'high') {
    improvementAreas.push('降低证据源冲突（增加独立证据源）')
  }
  if (unmitigatedCount > 0) {
    improvementAreas.push(`处理 ${unmitigatedCount} 项 unmitigated 风险`)
  }
  if (improvementAreas.length === 0) {
    improvementAreas.push('保持当前合规水平，定期（≤ 90 天）复审')
  }

  return {
    euAiActCompliant,
    nistAiRmfCompliant,
    nistAi600Compliant,
    complianceScore,
    improvementAreas,
  }
}

// ============================================================================
// 内部：元数据
// ============================================================================

function generateMetadata(
  _input: AuditReportInput,
  _context: AuditDecisionContext,
): AuditMetadata {
  const generatedAt = Date.now()
  const reportId = randomUUID()
  const generatedAtIso = new Date(generatedAt).toISOString()
  // 6 个月过期（EU AI Act Art.12 保留期）
  const expiresAt = generatedAt + 1000 * 60 * 60 * 24 * 30 * 6

  return {
    reportId,
    generatedAt,
    generatedAtIso,
    schemaVersion: AUDIT_REPORT_SCHEMA_VERSION,
    generatorVersion: AUDIT_GENERATOR_VERSION,
    fingerprint: '', // 在所有字段填完后计算
    expiresAt,
  }
}

// ============================================================================
// 指纹生成
// ============================================================================

/**
 * 计算报告 SHA-256 指纹（写入 report.metadata.fingerprint）
 *
 * 流程：递归规范化对象（按 key 排序） → SHA-256 → 取前 16 字符
 *
 * 为什么排除 metadata？避免自引用导致哈希循环
 *
 * 关键实现：使用递归稳定序列化而非 JSON.stringify 的 array replacer，
 *   因为后者只会序列化顶层 key，嵌套属性（不在 array 中）会被静默忽略，
 *   导致修改嵌套字段后指纹不变（v1.1 修复）
 */
export function computeReportFingerprint(report: ComplianceAuditReport): string {
  const { metadata: _metadata, ...rest } = report
  const canonical = stableStringify(rest)
  const hash = createHash('sha256').update(canonical).digest('hex')
  return hash.substring(0, 16)
}

/**
 * 稳定 JSON 序列化：递归对所有 key 排序，保证相同内容产生相同字符串
 *
 * 用途：SHA-256 指纹计算前的规范化
 */
function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj)
  if (typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) {
    return '[' + obj.map((item) => stableStringify(item)).join(',') + ']'
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort()
  const pairs = keys.map(
    (k) => JSON.stringify(k) + ':' + stableStringify((obj as Record<string, unknown>)[k]),
  )
  return '{' + pairs.join(',') + '}'
}

/**
 * 完整流程：构建报告 + 写回指纹
 */
export function buildAndFinalizeReport(input: AuditReportInput): ComplianceAuditReport {
  const report = buildAuditReport(input)
  report.metadata.fingerprint = computeReportFingerprint(report)
  return report
}

// ============================================================================
// 内部：空校准状态
// ============================================================================

function buildEmptyCalibration(provider: string): AuditReportInput['calibration'] {
  return {
    providerId: provider,
    optimalT: 1.0,
    eceBefore: 0,
    eceAfter: 0,
    improvement: 0,
    sampleCount: 0,
    calibratedAtIso: new Date(0).toISOString(),
    isCalibrationFresh: false,
    daysSinceCalibration: Infinity,
    topCandidates: [],
  }
}

// ============================================================================
// 类型导出
// ============================================================================

export type { AuditFormat, ComplianceAuditReport, AuditReportInput }
