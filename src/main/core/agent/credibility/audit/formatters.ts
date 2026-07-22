/**
 * 审计报告格式化器（JSON + Markdown）
 *
 * 职责：将 ComplianceAuditReport 序列化为 JSON 或 Markdown 格式。
 */

import type {
  AuditFormat,
  ComplianceAuditReport,
  GenaiRiskCoverage,
} from './types'

// ============================================================================
// JSON 格式化器
// ============================================================================

/**
 * JSON 格式化器入口
 *
 * 用途：CI / 监管对接 / schema 校验
 *
 * @param report - 合规审计报告
 * @param pretty - 是否美化输出（默认 true，便于审计人读）
 * @returns JSON 字符串
 */
export function formatAsJson(report: ComplianceAuditReport, pretty = true): string {
  // 严格序列化：2 空格缩进、保证 key 顺序（report 对象已排好序）
  return JSON.stringify(report, null, pretty ? 2 : 0)
}

// ============================================================================
// Markdown 格式化器
// ============================================================================

/**
 * Markdown 格式化器入口
 *
 * 用途：PR 描述 / 内部归档 / GitHub issue 粘贴
 *
 * @param report - 合规审计报告
 * @returns Markdown 字符串
 */
export function formatAsMarkdown(report: ComplianceAuditReport): string {
  const lines: string[] = []

  // ────────── 标题与摘要 ──────────
  lines.push(`# 合规审计报告：${report.decisionContext.decisionTitle}`)
  lines.push('')
  lines.push(`> **报告 ID**: \`${report.metadata.reportId}\`  `)
  lines.push(`> **生成时间**: ${report.metadata.generatedAtIso}  `)
  lines.push(`> **SHA-256 指纹**: \`${report.metadata.fingerprint}\`  `)
  lines.push(`> **Schema 版本**: ${report.metadata.schemaVersion}  `)
  lines.push(`> **生成器**: ${report.metadata.generatorVersion}  `)
  lines.push(`> **过期时间**: ${new Date(report.metadata.expiresAt).toISOString()}  `)
  lines.push('')

  // ────────── 总体合规结论 ──────────
  lines.push('## 总体合规结论')
  lines.push('')
  const { overallCompliance } = report
  const verdictIcon = overallCompliance.complianceScore >= 80
    ? '✅'
    : overallCompliance.complianceScore >= 60
    ? '⚠️'
    : '❌'
  lines.push(`${verdictIcon} **合规评分**: **${overallCompliance.complianceScore}/100**`)
  lines.push('')
  lines.push('| 标准 | 通过 |')
  lines.push('|------|------|')
  lines.push(
    `| EU AI Act 2026 (高风险条款) | ${overallCompliance.euAiActCompliant ? '✅ 通过' : '❌ 不通过'} |`,
  )
  lines.push(
    `| NIST AI RMF 1.0 | ${overallCompliance.nistAiRmfCompliant ? '✅ 通过' : '❌ 不通过'} |`,
  )
  lines.push(
    `| NIST AI 600-1 GenAI Profile | ${overallCompliance.nistAi600Compliant ? '✅ 通过' : '❌ 不通过'} |`,
  )
  lines.push('')
  if (overallCompliance.improvementAreas.length > 0) {
    lines.push('### 待改进项')
    lines.push('')
    for (const area of overallCompliance.improvementAreas) {
      lines.push(`- ${area}`)
    }
    lines.push('')
  }

  // ────────── 法规依据 ──────────
  lines.push('## 法规与标准依据')
  lines.push('')
  lines.push('| 法规 / 标准 | 版本 |')
  lines.push('|------------|------|')
  lines.push(`| ${report.regulatory.euAiActVersion.split(' ')[0]} | ${report.regulatory.euAiActVersion} |`)
  lines.push(`| ${report.regulatory.nistAiRmfVersion.split(' ')[0]} | ${report.regulatory.nistAiRmfVersion} |`)
  lines.push(`| ${report.regulatory.nistAi600Version.split(' ')[0]} | ${report.regulatory.nistAi600Version} |`)
  lines.push('')
  lines.push('**风险分类依据**:')
  lines.push(`> ${report.regulatory.riskClassificationBasis}`)
  lines.push('')
  lines.push('**适用条款**:')
  for (const art of report.regulatory.applicableArticles) {
    lines.push(`- ${art}`)
  }
  lines.push('')

  // ────────── 决策上下文 ──────────
  lines.push('## 决策上下文（EU AI Act Art.13(3)）')
  lines.push('')
  const ctx = report.decisionContext
  lines.push('| 字段 | 值 |')
  lines.push('|------|-----|')
  lines.push(`| 决策 ID | \`${ctx.decisionId}\` |`)
  lines.push(`| 决策标题 | ${ctx.decisionTitle} |`)
  lines.push(`| 决策时间 | ${ctx.decisionTimeIso} |`)
  lines.push(`| AI 服务提供者 | ${ctx.provider} |`)
  lines.push(`| 模型版本 | ${ctx.modelVersion} |`)
  lines.push(`| 部署方 | ${ctx.deployer} |`)
  lines.push(`| 部署方联系 | ${ctx.deployerContact} |`)
  lines.push(`| 使用场景 | ${ctx.domain} |`)
  lines.push(`| 高风险系统 | ${ctx.isHighRisk ? '⚠️ 是' : '否'} |`)
  lines.push('')
  lines.push('**预期用途** (intended purpose, Art.13(3)(b)(i)):')
  lines.push(`> ${ctx.intendedPurpose}`)
  lines.push('')
  if (ctx.knownLimitations.length > 0) {
    lines.push('**已知局限性** (Art.13(3)(b)(iii)):')
    for (const lim of ctx.knownLimitations) {
      lines.push(`- ${lim}`)
    }
    lines.push('')
  }

  // ────────── 6 源证据 ──────────
  lines.push('## 6 源证据记录（EU AI Act Art.10 数据治理）')
  lines.push('')
  lines.push(
    '| 源 | 名称 | 校准 conf | T | 焦元分布 | 权重 | 数据时间 |',
  )
  lines.push('|----|------|----------|---|---------|------|---------|')
  for (const ev of report.sourceEvidences) {
    const focalSummary = Object.entries(ev.focalElements)
      .map(([k, v]) => `\`${k}\`: ${(v * 100).toFixed(1)}%`)
      .join(' · ')
    lines.push(
      `| ${ev.sourceId} | ${ev.sourceName} | ${(ev.calibratedConfidence * 100).toFixed(1)}% | ${ev.calibrationTemperature.toFixed(3)} | ${focalSummary} | ${(ev.weight * 100).toFixed(0)}% | ${new Date(ev.dataTimestamp).toISOString().slice(0, 16)} |`,
    )
  }
  lines.push('')

  // ────────── 融合过程 ──────────
  lines.push('## 融合过程与结果（EU AI Act Art.13(3)(b)(iv)）')
  lines.push('')
  const f = report.fusionResult
  lines.push('### 核心结果')
  lines.push('')
  lines.push('| 指标 | 值 |')
  lines.push('|------|-----|')
  lines.push(`| Bel({T}) | ${(f.belief * 100).toFixed(2)}% |`)
  lines.push(`| Pl({T}) | ${(f.plausibility * 100).toFixed(2)}% |`)
  lines.push(`| 综合 confidence | ${(f.confidence * 100).toFixed(2)}% |`)
  lines.push(`| 不确定性 (Pl - Bel) | ${(f.uncertainty * 100).toFixed(2)}% |`)
  lines.push(`| 冲突等级 | ${f.conflictLevel} |`)
  lines.push(`| 使用的规则 | ${f.ruleUsed} |`)
  lines.push(`| 信任度等级 | ${f.trustLevel} |`)
  lines.push(`| 风险评分 | ${f.riskScore}/100 |`)
  lines.push('')
  lines.push(`**风险描述**: ${f.riskDescription}`)
  lines.push('')
  if (f.fusionSteps.length > 0) {
    lines.push('### 融合步骤')
    lines.push('')
    lines.push('| # | 规则 | 冲突 k | 阈值 | 左源 | 右源 | Bel | Pl | 理由 |')
    lines.push('|---|------|--------|------|------|------|-----|-----|------|')
    for (const step of f.fusionSteps) {
      lines.push(
        `| ${step.step} | ${step.ruleUsed} | ${step.conflictValue.toFixed(4)} | ${step.conflictThreshold} | ${step.leftSourceId} | ${step.rightSourceId} | ${(step.resultBelief * 100).toFixed(2)}% | ${(step.resultPlausibility * 100).toFixed(2)}% | ${step.justification} |`,
      )
    }
    lines.push('')
  }

  // ────────── 校准状态 ──────────
  lines.push('## 校准状态（EU AI Act Art.15 + NIST MEASURE-2）')
  lines.push('')
  const c = report.calibration
  lines.push('| 指标 | 值 |')
  lines.push('|------|-----|')
  lines.push(`| Provider | \`${c.providerId}\` |`)
  lines.push(`| 最优温度 T | ${c.optimalT.toFixed(3)} |`)
  lines.push(`| 校准前 ECE | ${(c.eceBefore * 100).toFixed(2)}% |`)
  lines.push(`| 校准后 ECE | ${(c.eceAfter * 100).toFixed(2)}% |`)
  lines.push(`| 改进率 | ${(c.improvement * 100).toFixed(2)}% |`)
  lines.push(`| 样本数 | ${c.sampleCount} |`)
  lines.push(`| 校准时间 | ${c.calibratedAtIso} |`)
  lines.push(`| 是否新鲜（< 7 天） | ${c.isCalibrationFresh ? '✅ 是' : '⚠️ 否'} |`)
  if (Number.isFinite(c.daysSinceCalibration)) {
    lines.push(`| 距上次校准 | ${c.daysSinceCalibration.toFixed(1)} 天 |`)
  }
  lines.push('')
  if (c.topCandidates.length > 0) {
    lines.push('**Top-5 T 候选**（Temperature Scaling 网格搜索）:')
    lines.push('')
    lines.push('| T | ECE |')
    lines.push('|---|-----|')
    for (const cand of c.topCandidates) {
      lines.push(`| ${cand.t.toFixed(3)} | ${(cand.ece * 100).toFixed(2)}% |`)
    }
    lines.push('')
  }

  // ────────── 人工监督 ──────────
  lines.push('## 人工监督（EU AI Act Art.14）')
  lines.push('')
  const h = report.humanOversight
  lines.push('| 指标 | 值 |')
  lines.push('|------|-----|')
  lines.push(`| 监督模式 | ${h.oversightMode} |`)
  lines.push(`| 审批状态 | ${h.approvalStatus} |`)
  lines.push(`| 审批人 | ${h.approver ?? '（未指定）'} |`)
  lines.push(`| 审批时间 | ${h.approvedAtIso ?? '（未审批）'} |`)
  lines.push(`| 审批意见 | ${h.approverComment ?? '（无）'} |`)
  lines.push(`| 触发高危拦截 | ${h.triggeredHighRiskInterception ? '⚠️ 是' : '否'} |`)
  lines.push(`| 拦截命令数 | ${h.interceptedCommandCount} |`)
  lines.push('')

  // ────────── 决策动作 ──────────
  lines.push('## 决策动作（EU AI Act Art.12 日志）')
  lines.push('')
  const a = report.decisionAction
  lines.push('| 指标 | 值 |')
  lines.push('|------|-----|')
  lines.push(`| 动作类型 | ${a.actionType} |`)
  lines.push(`| 描述 | ${a.description} |`)
  lines.push(`| 关联命令 | \`${a.command ?? '（无）'}\` |`)
  lines.push(`| 沙箱预演 | ${a.sandboxResult ?? '（未运行）'} |`)
  lines.push(`| 执行结果 | ${a.executionResult ?? '（未执行）'} |`)
  lines.push(`| 执行时间 | ${a.executedAtIso ?? '（未执行）'} |`)
  lines.push(`| 影响的资源 | ${a.affectedResources.join(', ') || '（无）'} |`)
  lines.push(`| 可回滚 | ${a.isRollbackable ? '✅ 是' : '⚠️ 否'} |`)
  lines.push('')

  // ────────── 决策后果 ──────────
  lines.push('## 决策后果（EU AI Act Art.19 透明度）')
  lines.push('')
  const o = report.decisionOutcome
  lines.push('| 指标 | 值 |')
  lines.push('|------|-----|')
  lines.push(`| 决策状态 | ${o.decisionStatus} |`)
  lines.push(`| 实际正确性 | ${o.wasCorrect === null ? '（未验证）' : o.wasCorrect ? '✅ 正确' : '❌ 错误'} |`)
  lines.push(`| 观察准确度 | ${o.observedAccuracy === null ? '（未验证）' : (o.observedAccuracy * 100).toFixed(2) + '%'} |`)
  lines.push(`| 影响等级 | ${o.impactLevel} |`)
  lines.push(`| 后续影响 | ${o.followUpNotes ?? '（无）'} |`)
  lines.push('')

  // ────────── NIST 600-1 风险覆盖 ──────────
  lines.push('## NIST AI 600-1 GenAI 12 类风险覆盖')
  lines.push('')
  lines.push('| # | 风险类别 | 评估结论 | 依据 | 控制措施 |')
  lines.push('|---|---------|---------|------|---------|')
  for (const risk of report.genaiRiskCoverage) {
    const verdictIcon = verdictToIcon(risk.verdict)
    const controls = risk.controls.join(' / ')
    lines.push(
      `| ${risk.riskId} | ${risk.riskName} | ${verdictIcon} ${risk.verdict} | ${risk.rationale} | ${controls} |`,
    )
  }
  lines.push('')

  // ────────── 透明度声明 ──────────
  lines.push('## 透明度声明（EU AI Act Art.13(3)）')
  lines.push('')
  const t = report.transparency
  lines.push('### 预期用途')
  lines.push(`> ${t.intendedPurposeHuman}`)
  lines.push('')
  lines.push('### 准确度声明')
  lines.push(`> ${t.accuracyStatement}`)
  lines.push('')
  lines.push('### 鲁棒性声明')
  lines.push(`> ${t.robustnessStatement}`)
  lines.push('')
  if (t.limitationsHuman.length > 0) {
    lines.push('### 已知限制（人类可读）')
    for (const lim of t.limitationsHuman) {
      lines.push(`- ${lim}`)
    }
    lines.push('')
  }
  lines.push('### 人工监督措施')
  lines.push(`> ${t.humanOversightMeasures}`)
  lines.push('')
  lines.push('### 计算与硬件需求')
  lines.push(`> ${t.computationalRequirements}`)
  lines.push('')
  lines.push('### 维护与更新')
  lines.push(`> ${t.maintenanceNotes}`)
  lines.push('')
  lines.push('### 日志机制（Art.12）')
  lines.push(`> ${t.loggingMechanismDescription}`)
  lines.push('')

  // ────────── 页脚 ──────────
  lines.push('---')
  lines.push('')
  lines.push(
    `*本报告由 \`${report.metadata.generatorVersion}\` 自动生成，遵循 EU AI Act 2026 + NIST AI RMF 1.0 + NIST AI 600-1。*`,
  )
  lines.push(
    `*报告完整性校验：计算 SHA-256 时排除 fingerprint 与 generatedAt 字段，避免自引用哈希循环。*`,
  )
  lines.push('')

  return lines.join('\n')
}

function verdictToIcon(verdict: GenaiRiskCoverage['verdict']): string {
  switch (verdict) {
    case 'mitigated':
      return '✅'
    case 'partially-mitigated':
      return '⚠️'
    case 'unmitigated':
      return '❌'
    case 'not-applicable':
      return '➖'
  }
}

// ============================================================================
// 统一入口
// ============================================================================

/**
 * 按格式分发到对应格式化器
 *
 * @param report - 合规审计报告
 * @param format - 输出格式
 * @returns 序列化后的字符串
 */
export function formatReport(
  report: ComplianceAuditReport,
  format: AuditFormat,
): string {
  switch (format) {
    case 'json':
      return formatAsJson(report)
    default:
      return formatAsMarkdown(report)
  }
}

/**
 * 文件扩展名映射
 */
export function getFileExtension(format: AuditFormat): string {
  switch (format) {
    case 'json':
      return 'json'
    case 'markdown':
    default:
      return 'md'
  }
}

/**
 * MIME 类型映射
 */
export function getMimeType(format: AuditFormat): string {
  switch (format) {
    case 'json':
      return 'application/json'
    case 'markdown':
    default:
      return 'text/markdown'
  }
}
