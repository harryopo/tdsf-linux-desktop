/**
 * 审计报告类型定义
 *
 * 职责：定义 EU AI Act 2026 + NIST AI RMF 600-1 合规审计报告所需的所有数据结构。
 *
 * 法规依据：
 * - EU AI Act Article 12（自动日志记录，6 个月保留期，可重建每个 AI 决策）
 * - EU AI Act Article 13（透明度 + 部署者说明，intended purpose / accuracy / limitations）
 * - EU AI Act Article 14（人工监督）
 * - EU AI Act Article 19（透明度义务）
 * - EU AI Act Annex IV（完整技术文档）
 * - NIST AI RMF 1.0 4 大功能：GOVERN / MAP / MEASURE / MANAGE
 * - NIST AI 600-1 GenAI Profile 12 类 GAI 风险
 *
 * 设计原则：
 * - 自包含：每份报告可独立重建决策全貌，无需追溯到运行时
 * - 机器可读：JSON 严格遵循 schema；Markdown / HTML 为人类可读
 * - 不可篡改：报告生成后带 SHA-256 哈希指纹
 * - 风险全覆盖：12 类 GAI 风险（confabulation / CBRN / harmful bias 等）逐项评估
 *
 * 调研文档：d:\ai\linux教学一体\idea-to-dev-output\22-可信度算法论文支撑调研.md §7
 */

// ============================================================================
// 法规 / 标准元数据
// ============================================================================

/**
 * 输出格式
 */
export type AuditFormat = 'json' | 'markdown' | 'html'

/**
 * 法规版本标识
 */
export interface RegulatoryFrame {
  /** EU AI Act 版本号 */
  euAiActVersion: string
  /** NIST AI RMF 版本号 */
  nistAiRmfVersion: string
  /** NIST AI 600-1 GenAI Profile 版本 */
  nistAi600Version: string
  /** 高风险系统分类依据（EU AI Act Annex III）*/
  riskClassificationBasis: string
  /** 报告生成时引用的所有法规条款 */
  applicableArticles: string[]
}

/**
 * NIST AI 600-1 12 类 GAI 风险覆盖评估
 */
export interface GenaiRiskCoverage {
  /** 风险类别 ID（1-12）*/
  riskId: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12
  /** 风险类别名称 */
  riskName: string
  /** 评估结论 */
  verdict: 'mitigated' | 'partially-mitigated' | 'unmitigated' | 'not-applicable'
  /** 评估依据（≤ 280 字符）*/
  rationale: string
  /** 引用的控制措施（CalibrationTuner / PCR5 / 人工审批 等）*/
  controls: string[]
}

// ============================================================================
// 报告生成元数据
// ============================================================================

/**
 * 报告生成元数据
 */
export interface AuditMetadata {
  /** 报告唯一 ID（UUID v4）*/
  reportId: string
  /** 报告生成时间（Unix 毫秒）*/
  generatedAt: number
  /** 报告生成时间（ISO 8601 字符串）*/
  generatedAtIso: string
  /** 报告 schema 版本 */
  schemaVersion: string
  /** 报告生成器版本 */
  generatorVersion: string
  /** 报告 SHA-256 哈希指纹（first 16 chars）*/
  fingerprint: string
  /** 报告过期时间（生成时间 + 6 个月，对应 EU AI Act Art.12 保留期）*/
  expiresAt: number
}

// ============================================================================
// 决策元数据（对应 EU AI Act Art.13(3)）
// ============================================================================

/**
 * 决策元数据
 * 对应 EU AI Act Annex IV §1（intended purpose、provider、deployment context）
 */
export interface AuditDecisionContext {
  /** 决策 ID（与 DecisionCard.id 对应）*/
  decisionId: string
  /** 决策标题 */
  decisionTitle: string
  /** 决策时间（Unix 毫秒）*/
  decisionTime: number
  /** 决策时间（ISO 8601 字符串）*/
  decisionTimeIso: string
  /** AI 服务提供者（开发方）*/
  provider: string
  /** AI 模型版本 */
  modelVersion: string
  /** 模型部署方（使用方）*/
  deployer: string
  /** 部署方联系信息（email）*/
  deployerContact: string
  /** 预期用途（intended purpose，对应 EU AI Act Art.13(3)(b)(i)）*/
  intendedPurpose: string
  /** 已知局限性（对应 EU AI Act Art.13(3)(b)(iii)）*/
  knownLimitations: string[]
  /** 使用场景类型（运维 / 客服 / 医疗 / 金融 等）*/
  domain: string
  /** 是否高风险（EU AI Act Annex III）*/
  isHighRisk: boolean
}

// ============================================================================
// 6 源证据记录（对应 EU AI Act Art.10 + Art.13）
// ============================================================================

/**
 * 单源证据记录
 * 对应 EU AI Act Art.10（数据治理）+ Art.13(3)(b)(v)（受影响的个人或群体）
 */
export interface AuditSourceEvidence {
  /** 证据源 ID（S1-S6）*/
  sourceId: 'S1-log' | 'S2-knowledge' | 'S3-ai-param' | 'S4-human' | 'S5-history' | 'S6-best-practice'
  /** 证据源名称 */
  sourceName: string
  /** 焦元分布（key: 命题标识 / value: mass）*/
  focalElements: Record<string, number>
  /** 原始置信度 */
  rawConfidence: number
  /** 校准后置信度（应用 Temperature Scaling T）*/
  calibratedConfidence: number
  /** 校准温度 T */
  calibrationTemperature: number
  /** 权重（在 6 源中占比）*/
  weight: number
  /** 输入字段原始数据（用于审计回放）*/
  inputData: Record<string, unknown>
  /** 数据来源（来自哪个上游系统）*/
  dataProvenance: string
  /** 数据时间戳 */
  dataTimestamp: number
}

// ============================================================================
// 融合过程记录（对应 EU AI Act Art.13(3)(b)(vii)）
// ============================================================================

/**
 * 融合步骤（PCR5 / Dempster 过程）
 */
export interface AuditFusionStep {
  /** 步骤序号（从 1 开始）*/
  step: number
  /** 使用的组合规则 */
  ruleUsed: 'dempster' | 'pcr5'
  /** 触发规则选择的冲突阈值 k */
  conflictThreshold: number
  /** 实际冲突值 k */
  conflictValue: number
  /** 左操作数源 ID */
  leftSourceId: string
  /** 右操作数源 ID */
  rightSourceId: string
  /** 组合后 Bel({T}) */
  resultBelief: number
  /** 组合后 Pl({T}) */
  resultPlausibility: number
  /** 组合后不确定性 Pl - Bel */
  resultUncertainty: number
  /** 决策说明（为什么选这个规则）*/
  justification: string
}

/**
 * 融合结果
 * 对应 EU AI Act Art.13(3)(b)(iv)（输出可解释性的技术能力）
 */
export interface AuditFusionResult {
  /** 最终 Bel({T}) */
  belief: number
  /** 最终 Pl({T}) */
  plausibility: number
  /** 综合 confidence = (Bel + Pl) / 2 */
  confidence: number
  /** 不确定性 = Pl - Bel */
  uncertainty: number
  /** 冲突等级（最大成对冲突 k）*/
  conflictLevel: 'low' | 'medium' | 'high'
  /** 最终使用的规则 */
  ruleUsed: 'dempster' | 'pcr5' | 'mixed'
  /** 完整融合步骤 */
  fusionSteps: AuditFusionStep[]
  /** 信任度等级（L1 自动执行 / L2 沙箱预演 / L3 人工审批 / L4 审计回放）*/
  trustLevel: 'L1' | 'L2' | 'L3' | 'L4'
  /** 风险评分（0-100）*/
  riskScore: number
  /** 风险描述 */
  riskDescription: string
}

// ============================================================================
// 校准状态（对应 EU AI Act Art.15 准确性 / 鲁棒性）
// ============================================================================

/**
 * 校准状态
 * 对应 EU AI Act Art.15（accuracy / robustness / cybersecurity）
 * + NIST MEASURE-2（评估指标）
 */
export interface AuditCalibrationState {
  /** Provider ID */
  providerId: string
  /** 当前 T（最优温度）*/
  optimalT: number
  /** 校准前 ECE */
  eceBefore: number
  /** 校准后 ECE */
  eceAfter: number
  /** 改进率 = (eceBefore - eceAfter) / eceBefore */
  improvement: number
  /** 校准样本数 */
  sampleCount: number
  /** 校准时间（ISO 8601）*/
  calibratedAtIso: string
  /** 校准是否最新（< 7 天）*/
  isCalibrationFresh: boolean
  /** 距离上次校准的天数 */
  daysSinceCalibration: number
  /** 历史校准曲线（前 5 个 T 候选）*/
  topCandidates: Array<{ t: number; ece: number }>
}

// ============================================================================
// 人工监督记录（对应 EU AI Act Art.14）
// ============================================================================

/**
 * 人工监督状态
 * 对应 EU AI Act Art.14（human oversight）
 */
export interface AuditHumanOversight {
  /** 监督模式 */
  oversightMode: 'human-in-the-loop' | 'human-on-the-loop' | 'human-in-command'
  /** 审批状态 */
  approvalStatus: 'auto-approved' | 'pending' | 'approved' | 'rejected' | 'timeout'
  /** 审批人（用户名 / 工号）*/
  approver: string | null
  /** 审批时间（ISO 8601，未审批为 null）*/
  approvedAtIso: string | null
  /** 审批意见 */
  approverComment: string | null
  /** 是否触发了高危命令拦截 */
  triggeredHighRiskInterception: boolean
  /** 拦截的命令数 */
  interceptedCommandCount: number
}

// ============================================================================
// 决策动作与后果（对应 EU AI Act Art.12 日志 + Art.19 透明度）
// ============================================================================

/**
 * 决策动作（执行了什么命令 / 操作）
 * 对应 EU AI Act Art.12（决策可重建）
 */
export interface AuditDecisionAction {
  /** 动作类型 */
  actionType: 'command' | 'config-change' | 'rollback' | 'no-op' | 'escalation'
  /** 动作描述 */
  description: string
  /** 关联命令（若为 command 类型）*/
  command: string | null
  /** 沙箱预演结果 */
  sandboxResult: 'passed' | 'failed' | 'not-run' | null
  /** 执行结果 */
  executionResult: 'success' | 'failed' | 'rolled-back' | 'not-executed' | null
  /** 执行时间（ISO 8601）*/
  executedAtIso: string | null
  /** 影响的资源（主机名 / 路径 / 服务名）*/
  affectedResources: string[]
  /** 是否可回滚 */
  isRollbackable: boolean
}

/**
 * 决策后果（实际影响）
 * 对应 EU AI Act Art.19（透明度义务）
 */
export interface AuditDecisionOutcome {
  /** 决策整体状态 */
  decisionStatus: 'verified-correct' | 'verified-incorrect' | 'pending-verification' | 'rejected'
  /** 实际正确性（事后 ground truth）*/
  wasCorrect: boolean | null
  /** 实际置信度（与预测对比）*/
  observedAccuracy: number | null
  /** 影响等级 */
  impactLevel: 'none' | 'low' | 'medium' | 'high' | 'critical'
  /** 后续影响（用户反馈 / 监控告警 / 业务指标）*/
  followUpNotes: string | null
}

// ============================================================================
// 透明度声明（对应 EU AI Act Art.13(3)(b)）
// ============================================================================

/**
 * 透明度声明
 * 对应 EU AI Act Art.13(3)(b) — deployer 必读
 */
export interface AuditTransparency {
  /** 预期用途（人类可读）*/
  intendedPurposeHuman: string
  /** 准确度声明（含 ECE）*/
  accuracyStatement: string
  /** 鲁棒性声明 */
  robustnessStatement: string
  /** 已知限制（人类可读）*/
  limitationsHuman: string[]
  /** 人工监督措施说明 */
  humanOversightMeasures: string
  /** 计算与硬件需求 */
  computationalRequirements: string
  /** 维护与更新说明 */
  maintenanceNotes: string
  /** 日志机制说明（Art.12 引用 Art.13(3)(f)）*/
  loggingMechanismDescription: string
}

// ============================================================================
// 主报告
// ============================================================================

/**
 * 合规审计报告（主结构）
 *
 * 完整覆盖：
 * - EU AI Act 2026：Art.9 / Art.10 / Art.11 / Art.12 / Art.13 / Art.14 / Art.15 / Art.19
 * - NIST AI RMF 1.0：GOVERN / MAP / MEASURE / MANAGE
 * - NIST AI 600-1：12 类 GAI 风险评估
 */
export interface ComplianceAuditReport {
  /** 法规 / 标准元数据 */
  regulatory: RegulatoryFrame
  /** 报告生成元数据 */
  metadata: AuditMetadata
  /** 决策元数据（Art.13(3)）*/
  decisionContext: AuditDecisionContext
  /** 6 源证据记录（Art.10）*/
  sourceEvidences: AuditSourceEvidence[]
  /** 融合过程与结果（Art.13(3)(b)(iv)）*/
  fusionResult: AuditFusionResult
  /** 校准状态（Art.15 + NIST MEASURE）*/
  calibration: AuditCalibrationState
  /** 人工监督状态（Art.14）*/
  humanOversight: AuditHumanOversight
  /** 决策动作（Art.12）*/
  decisionAction: AuditDecisionAction
  /** 决策后果（Art.19）*/
  decisionOutcome: AuditDecisionOutcome
  /** 透明度声明（Art.13(3)）*/
  transparency: AuditTransparency
  /** NIST 600-1 12 类 GAI 风险覆盖评估 */
  genaiRiskCoverage: GenaiRiskCoverage[]
  /** 总体合规结论 */
  overallCompliance: {
    /** 是否通过 EU AI Act 高风险系统合规 */
    euAiActCompliant: boolean
    /** 是否通过 NIST AI RMF 1.0 评估 */
    nistAiRmfCompliant: boolean
    /** 是否通过 NIST AI 600-1 评估 */
    nistAi600Compliant: boolean
    /** 整体合规评分（0-100）*/
    complianceScore: number
    /** 待改进项（≤ 10 条）*/
    improvementAreas: string[]
  }
}

// ============================================================================
// 报告构建输入
// ============================================================================

/**
 * 报告构建器输入（从 ConfidenceAssessment + DecisionCard 构造）
 */
export interface AuditReportInput {
  /** 决策上下文（来自 DecisionCard）*/
  decisionContext: Omit<AuditDecisionContext, 'deployerContact' | 'domain' | 'isHighRisk'> & {
    deployerContact?: string
    domain?: string
    isHighRisk?: boolean
  }
  /** 6 源证据（来自 mass-functions）*/
  sourceEvidences: Array<Omit<AuditSourceEvidence, 'focalElements' | 'rawConfidence' | 'calibratedConfidence' | 'calibrationTemperature'> & {
    focalElements?: Record<string, number>
    rawConfidence?: number
    calibratedConfidence?: number
    calibrationTemperature?: number
  }>
  /** 可信度评估（来自 ConfidenceAssessment）*/
  confidenceAssessment: {
    belief: number
    plausibility: number
    confidence: number
    uncertainty: number
    conflictLevel: number
    ruleUsed: 'dempster' | 'pcr5' | 'mixed'
    fusionSteps: Array<{
      step: number
      ruleUsed: 'dempster' | 'pcr5'
      leftSourceId: string
      rightSourceId: string
      conflict: number
      resultBelief: number
      resultPlausibility: number
    }>
  }
  /** 校准状态（来自 CalibrationTuner）*/
  calibration: AuditCalibrationState | null
  /** 人工监督状态（来自 DecisionCard.humanReview）*/
  humanOversight: AuditHumanOversight
  /** 决策动作（来自 ExecutionResult）*/
  decisionAction: AuditDecisionAction
  /** 决策后果（事后评估，可选）*/
  decisionOutcome?: AuditDecisionOutcome
  /** 部署方联系信息 */
  deployerContact?: string
  /** 使用场景 */
  domain?: string
  /** 是否高风险 */
  isHighRisk?: boolean
}
