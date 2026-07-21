/**
 * 审计报告格式化器（JSON + Markdown + HTML 三种输出）
 *
 * 职责：将 ComplianceAuditReport 序列化为机器可读或人类可读格式。
 *
 * 设计原则：
 * - JSON：严格符合 schema（用于 CI / 监管对接 / diff）
 * - Markdown：人类可读技术报告（用于 PR 描述 / 内部归档）
 * - HTML：自包含可打印报告（单文件、内联 CSS、可直接浏览器打开）
 *
 * 论文 / 法规依据：
 * - EU AI Act Art.11（technical documentation 必须 machine-readable）
 * - EU AI Act Art.12（自动日志需可重建决策）
 * - EU AI Act Art.13(3)(d)（accuracy / robustness metrics 必须以 transparent 方式呈现）
 * - NIST AI RMF MEASURE-2（评估报告模板）
 *
 * 调研文档：d:\ai\linux教学一体\idea-to-dev-output\22-可信度算法论文支撑调研.md §7
 */

import type {
  AuditFormat,
  AuditSourceEvidence,
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

/**
 * JSON Schema 验证函数（轻量级，仅检查必填字段）
 *
 * 不引入 ajv 等重型依赖，仅校验 EU AI Act Art.11 要求的最小字段集。
 */
export function validateJsonReport(json: string): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    return { valid: false, errors: [`JSON 解析失败: ${(err as Error).message}`] }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { valid: false, errors: ['根节点必须为对象'] }
  }

  const r = parsed as Record<string, unknown>

  // EU AI Act Art.11 必填字段
  const requiredFields: Array<[string, string]> = [
    ['metadata.reportId', '报告 ID'],
    ['metadata.fingerprint', 'SHA-256 指纹'],
    ['decisionContext.decisionId', '决策 ID'],
    ['decisionContext.intendedPurpose', '预期用途'],
    ['fusionResult.belief', 'Bel({T})'],
    ['fusionResult.plausibility', 'Pl({T})'],
    ['fusionResult.confidence', '综合 confidence'],
    ['calibration.optimalT', '校准温度 T'],
    ['genaiRiskCoverage', 'NIST 600-1 风险评估'],
    ['overallCompliance.complianceScore', '合规评分'],
  ]

  for (const [path, label] of requiredFields) {
    const value = getByPath(r, path)
    if (value === undefined || value === null) {
      errors.push(`必填字段缺失: ${path} (${label})`)
    }
  }

  return { valid: errors.length === 0, errors }
}

function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const p of parts) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[p]
  }
  return current
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
// HTML 格式化器
// ============================================================================

/**
 * HTML 格式化器入口
 *
 * 用途：单文件可打印报告（内联 CSS，浏览器直接打开 / 打印 PDF）
 *
 * 设计原则：
 * - 自包含：无外部 CSS/JS 依赖
 * - 打印友好：A4 分页友好（@page）
 * - 高对比度：暗色头部 + 浅色正文，专业风格
 * - 数据可视化：使用 inline style 模拟简洁图表
 *
 * @param report - 合规审计报告
 * @returns 完整 HTML 字符串
 */
export function formatAsHtml(report: ComplianceAuditReport): string {
  const verdictColor = (verdict: 'mitigated' | 'partially-mitigated' | 'unmitigated' | 'not-applicable'): string => {
    switch (verdict) {
      case 'mitigated':
        return '#10b981' // 翠绿
      case 'partially-mitigated':
        return '#f59e0b' // 琥珀
      case 'unmitigated':
        return '#ef4444' // 红色
      case 'not-applicable':
        return '#6b7280' // 灰色
    }
  }

  const riskScoreColor =
    report.fusionResult.riskScore >= 70
      ? '#ef4444'
      : report.fusionResult.riskScore >= 40
      ? '#f59e0b'
      : '#10b981'

  const escape = (s: string | null | undefined): string => {
    if (s === null || s === undefined) return ''
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  // ────────── HTML 头部（含内联 CSS） ──────────
  const head = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>合规审计报告 - ${escape(report.decisionContext.decisionTitle)}</title>
<style>
  :root {
    --color-bg: #f9fafb;
    --color-fg: #111827;
    --color-card: #ffffff;
    --color-border: #e5e7eb;
    --color-primary: #4f46e5;
    --color-text-muted: #6b7280;
    --color-accent: #0891b2;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --color-bg: #0f172a;
      --color-fg: #f1f5f9;
      --color-card: #1e293b;
      --color-border: #334155;
      --color-primary: #818cf8;
      --color-text-muted: #94a3b8;
      --color-accent: #22d3ee;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    background: var(--color-bg);
    color: var(--color-fg);
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
    line-height: 1.6;
    font-size: 14px;
  }
  .container { max-width: 1024px; margin: 0 auto; padding: 32px 24px; }
  .header {
    background: linear-gradient(135deg, #1e1b4b, #312e81);
    color: #f1f5f9;
    padding: 32px;
    border-radius: 12px;
    margin-bottom: 24px;
  }
  .header h1 { margin: 0 0 16px 0; font-size: 28px; }
  .header .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
  .header .meta-item { font-size: 12px; opacity: 0.85; }
  .header .meta-item .label { display: block; font-size: 11px; opacity: 0.65; text-transform: uppercase; letter-spacing: 0.05em; }
  .header .meta-item .value { font-family: "JetBrains Mono", "Cascadia Code", monospace; }
  .card { background: var(--color-card); border: 1px solid var(--color-border); border-radius: 8px; padding: 24px; margin-bottom: 20px; }
  .card h2 { margin: 0 0 16px 0; font-size: 18px; color: var(--color-primary); border-bottom: 2px solid var(--color-border); padding-bottom: 8px; }
  .card h3 { margin: 20px 0 12px 0; font-size: 15px; color: var(--color-accent); }
  .verdict-banner { padding: 16px; border-radius: 6px; font-size: 16px; font-weight: 600; text-align: center; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--color-border); vertical-align: top; }
  th { background: var(--color-bg); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-muted); }
  td.code, .code { font-family: "JetBrains Mono", "Cascadia Code", monospace; font-size: 12px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .badge-mitigated { background: rgba(16, 185, 129, 0.15); color: #10b981; }
  .badge-partial { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
  .badge-unmitigated { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
  .badge-na { background: rgba(107, 114, 128, 0.15); color: #6b7280; }
  .progress-bar { width: 100%; height: 8px; background: var(--color-border); border-radius: 4px; overflow: hidden; }
  .progress-bar > div { height: 100%; transition: width 0.3s; }
  .grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
  .stat { padding: 12px; background: var(--color-bg); border-radius: 6px; }
  .stat .label { font-size: 11px; color: var(--color-text-muted); text-transform: uppercase; }
  .stat .value { font-size: 22px; font-weight: 700; margin-top: 4px; }
  blockquote { margin: 0 0 12px 0; padding: 12px 16px; background: var(--color-bg); border-left: 3px solid var(--color-primary); border-radius: 0 4px 4px 0; }
  ul, ol { padding-left: 20px; }
  li { margin-bottom: 4px; }
  .footer { text-align: center; padding: 24px 0; font-size: 12px; color: var(--color-text-muted); border-top: 1px solid var(--color-border); margin-top: 32px; }
  @media print {
    body { background: white; color: black; }
    .card { border: 1px solid #ddd; page-break-inside: avoid; }
    .header { background: #1e1b4b !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { size: A4; margin: 1.5cm; }
  }
</style>
</head>
<body>
<div class="container">`

  // ────────── 头部（标题 + 报告元数据） ──────────
  const header = `
  <div class="header">
    <h1>合规审计报告</h1>
    <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 400; opacity: 0.9;">${escape(report.decisionContext.decisionTitle)}</h2>
    <div class="meta">
      <div class="meta-item"><span class="label">报告 ID</span><span class="value">${escape(report.metadata.reportId)}</span></div>
      <div class="meta-item"><span class="label">生成时间</span><span class="value">${escape(report.metadata.generatedAtIso)}</span></div>
      <div class="meta-item"><span class="label">SHA-256 指纹</span><span class="value">${escape(report.metadata.fingerprint)}</span></div>
      <div class="meta-item"><span class="label">Schema</span><span class="value">${escape(report.metadata.schemaVersion)}</span></div>
      <div class="meta-item"><span class="label">生成器</span><span class="value">${escape(report.metadata.generatorVersion)}</span></div>
      <div class="meta-item"><span class="label">过期时间</span><span class="value">${escape(new Date(report.metadata.expiresAt).toISOString())}</span></div>
    </div>
  </div>`

  // ────────── 总体合规结论 ──────────
  const verdictBg =
    report.overallCompliance.complianceScore >= 80
      ? 'rgba(16, 185, 129, 0.15)'
      : report.overallCompliance.complianceScore >= 60
      ? 'rgba(245, 158, 11, 0.15)'
      : 'rgba(239, 68, 68, 0.15)'
  const verdictFg =
    report.overallCompliance.complianceScore >= 80
      ? '#10b981'
      : report.overallCompliance.complianceScore >= 60
      ? '#f59e0b'
      : '#ef4444'

  const complianceCard = `
  <div class="card">
    <h2>总体合规结论</h2>
    <div class="verdict-banner" style="background: ${verdictBg}; color: ${verdictFg};">
      合规评分：${report.overallCompliance.complianceScore}/100
    </div>
    <div class="grid-3">
      <div class="stat">
        <div class="label">EU AI Act 2026</div>
        <div class="value" style="color: ${report.overallCompliance.euAiActCompliant ? '#10b981' : '#ef4444'};">
          ${report.overallCompliance.euAiActCompliant ? '✓ 通过' : '✗ 不通过'}
        </div>
      </div>
      <div class="stat">
        <div class="label">NIST AI RMF 1.0</div>
        <div class="value" style="color: ${report.overallCompliance.nistAiRmfCompliant ? '#10b981' : '#ef4444'};">
          ${report.overallCompliance.nistAiRmfCompliant ? '✓ 通过' : '✗ 不通过'}
        </div>
      </div>
      <div class="stat">
        <div class="label">NIST AI 600-1</div>
        <div class="value" style="color: ${report.overallCompliance.nistAi600Compliant ? '#10b981' : '#ef4444'};">
          ${report.overallCompliance.nistAi600Compliant ? '✓ 通过' : '✗ 不通过'}
        </div>
      </div>
    </div>
    ${
      report.overallCompliance.improvementAreas.length > 0
        ? `<h3>待改进项</h3><ul>${report.overallCompliance.improvementAreas
            .map((a) => `<li>${escape(a)}</li>`)
            .join('')}</ul>`
        : ''
    }
  </div>`

  // ────────── 决策上下文 ──────────
  const ctx = report.decisionContext
  const decisionCard = `
  <div class="card">
    <h2>决策上下文（EU AI Act Art.13(3)）</h2>
    <table>
      <tr><th style="width: 30%;">字段</th><th>值</th></tr>
      <tr><td>决策 ID</td><td class="code">${escape(ctx.decisionId)}</td></tr>
      <tr><td>决策时间</td><td>${escape(ctx.decisionTimeIso)}</td></tr>
      <tr><td>AI 服务提供者</td><td>${escape(ctx.provider)}</td></tr>
      <tr><td>模型版本</td><td class="code">${escape(ctx.modelVersion)}</td></tr>
      <tr><td>部署方</td><td>${escape(ctx.deployer)}</td></tr>
      <tr><td>使用场景</td><td>${escape(ctx.domain)}</td></tr>
      <tr><td>高风险系统</td><td>${ctx.isHighRisk ? '<span class="badge badge-partial">⚠️ 是</span>' : '<span class="badge badge-mitigated">否</span>'}</td></tr>
    </table>
    <h3>预期用途 (intended purpose)</h3>
    <blockquote>${escape(ctx.intendedPurpose)}</blockquote>
    ${
      ctx.knownLimitations.length > 0
        ? `<h3>已知局限性</h3><ul>${ctx.knownLimitations.map((l) => `<li>${escape(l)}</li>`).join('')}</ul>`
        : ''
    }
  </div>`

  // ────────── 6 源证据 ──────────
  const sourceTable = `
  <div class="card">
    <h2>6 源证据记录（EU AI Act Art.10 数据治理）</h2>
    <table>
      <tr><th>源</th><th>校准 conf</th><th>T</th><th>焦元分布</th><th>权重</th></tr>
      ${report.sourceEvidences
        .map(
          (ev: AuditSourceEvidence) => `
        <tr>
          <td><strong>${escape(ev.sourceId)}</strong><br/><small>${escape(ev.sourceName)}</small></td>
          <td>${(ev.calibratedConfidence * 100).toFixed(1)}%</td>
          <td class="code">${ev.calibrationTemperature.toFixed(3)}</td>
          <td class="code">${Object.entries(ev.focalElements)
            .map(([k, v]) => `${escape(k)}: ${(v * 100).toFixed(1)}%`)
            .join('<br/>')}</td>
          <td>${(ev.weight * 100).toFixed(0)}%</td>
        </tr>
      `,
        )
        .join('')}
    </table>
  </div>`

  // ────────── 融合结果 ──────────
  const f = report.fusionResult
  const fusionCard = `
  <div class="card">
    <h2>融合过程与结果（EU AI Act Art.13(3)(b)(iv)）</h2>
    <div class="grid-3">
      <div class="stat">
        <div class="label">Bel({T})</div>
        <div class="value" style="color: var(--color-primary);">${(f.belief * 100).toFixed(2)}%</div>
      </div>
      <div class="stat">
        <div class="label">Pl({T})</div>
        <div class="value" style="color: var(--color-primary);">${(f.plausibility * 100).toFixed(2)}%</div>
      </div>
      <div class="stat">
        <div class="label">综合 confidence</div>
        <div class="value" style="color: var(--color-primary);">${(f.confidence * 100).toFixed(2)}%</div>
      </div>
      <div class="stat">
        <div class="label">不确定性</div>
        <div class="value">${(f.uncertainty * 100).toFixed(2)}%</div>
      </div>
      <div class="stat">
        <div class="label">冲突等级</div>
        <div class="value" style="font-size: 18px;">${escape(f.conflictLevel)}</div>
      </div>
      <div class="stat">
        <div class="label">信任度等级</div>
        <div class="value" style="font-size: 18px;">${escape(f.trustLevel)}</div>
      </div>
    </div>
    <h3>风险评分</h3>
    <div class="progress-bar"><div style="width: ${f.riskScore}%; background: ${riskScoreColor};"></div></div>
    <p style="margin-top: 8px;"><strong>${f.riskScore}/100</strong> — ${escape(f.riskDescription)}</p>
    ${
      f.fusionSteps.length > 0
        ? `<h3>融合步骤</h3>
        <table>
          <tr><th>#</th><th>规则</th><th>冲突 k</th><th>左源</th><th>右源</th><th>Bel</th><th>Pl</th></tr>
          ${f.fusionSteps
            .map(
              (s) => `<tr>
                <td>${s.step}</td>
                <td class="code">${escape(s.ruleUsed)}</td>
                <td class="code">${s.conflictValue.toFixed(4)}</td>
                <td>${escape(s.leftSourceId)}</td>
                <td>${escape(s.rightSourceId)}</td>
                <td>${(s.resultBelief * 100).toFixed(2)}%</td>
                <td>${(s.resultPlausibility * 100).toFixed(2)}%</td>
              </tr>`,
            )
            .join('')}
        </table>`
        : ''
    }
  </div>`

  // ────────── 校准状态 ──────────
  const c = report.calibration
  const calibrationCard = `
  <div class="card">
    <h2>校准状态（EU AI Act Art.15 + NIST MEASURE-2）</h2>
    <div class="grid-3">
      <div class="stat">
        <div class="label">Provider</div>
        <div class="value" style="font-size: 16px; font-family: monospace;">${escape(c.providerId)}</div>
      </div>
      <div class="stat">
        <div class="label">最优温度 T</div>
        <div class="value" style="color: var(--color-accent);">${c.optimalT.toFixed(3)}</div>
      </div>
      <div class="stat">
        <div class="label">校准前 ECE</div>
        <div class="value">${(c.eceBefore * 100).toFixed(2)}%</div>
      </div>
      <div class="stat">
        <div class="label">校准后 ECE</div>
        <div class="value" style="color: #10b981;">${(c.eceAfter * 100).toFixed(2)}%</div>
      </div>
      <div class="stat">
        <div class="label">改进率</div>
        <div class="value">${(c.improvement * 100).toFixed(2)}%</div>
      </div>
      <div class="stat">
        <div class="label">样本数</div>
        <div class="value">${c.sampleCount}</div>
      </div>
    </div>
    <h3>ECE 改进</h3>
    <div style="display: flex; gap: 16px; align-items: center;">
      <div style="flex: 1;">
        <div style="font-size: 12px; color: var(--color-text-muted);">校准前</div>
        <div class="progress-bar"><div style="width: ${c.eceBefore * 100}%; background: #ef4444;"></div></div>
        <div style="text-align: center; font-size: 12px; margin-top: 4px;">${(c.eceBefore * 100).toFixed(2)}%</div>
      </div>
      <div style="font-size: 24px;">→</div>
      <div style="flex: 1;">
        <div style="font-size: 12px; color: var(--color-text-muted);">校准后</div>
        <div class="progress-bar"><div style="width: ${c.eceAfter * 100}%; background: #10b981;"></div></div>
        <div style="text-align: center; font-size: 12px; margin-top: 4px;">${(c.eceAfter * 100).toFixed(2)}%</div>
      </div>
    </div>
  </div>`

  // ────────── NIST 600-1 风险覆盖 ──────────
  const riskRows = report.genaiRiskCoverage
    .map((risk) => {
      const badgeClass =
        risk.verdict === 'mitigated'
          ? 'badge-mitigated'
          : risk.verdict === 'partially-mitigated'
          ? 'badge-partial'
          : risk.verdict === 'unmitigated'
          ? 'badge-unmitigated'
          : 'badge-na'
      return `<tr>
        <td class="code">${risk.riskId}</td>
        <td>${escape(risk.riskName)}</td>
        <td><span class="badge ${badgeClass}" style="background: ${verdictColor(risk.verdict)}22; color: ${verdictColor(risk.verdict)};">${escape(risk.verdict)}</span></td>
        <td><small>${escape(risk.rationale)}</small></td>
      </tr>`
    })
    .join('')

  const riskCard = `
  <div class="card">
    <h2>NIST AI 600-1 GenAI 12 类风险覆盖</h2>
    <table>
      <tr><th>#</th><th>风险类别</th><th>评估结论</th><th>依据</th></tr>
      ${riskRows}
    </table>
  </div>`

  // ────────── 透明度声明 ──────────
  const t = report.transparency
  const transparencyCard = `
  <div class="card">
    <h2>透明度声明（EU AI Act Art.13(3)）</h2>
    <h3>预期用途</h3>
    <blockquote>${escape(t.intendedPurposeHuman)}</blockquote>
    <h3>准确度声明</h3>
    <blockquote>${escape(t.accuracyStatement)}</blockquote>
    <h3>鲁棒性声明</h3>
    <blockquote>${escape(t.robustnessStatement)}</blockquote>
    <h3>人工监督措施</h3>
    <blockquote>${escape(t.humanOversightMeasures)}</blockquote>
    <h3>计算与硬件需求</h3>
    <blockquote>${escape(t.computationalRequirements)}</blockquote>
    <h3>维护与更新</h3>
    <blockquote>${escape(t.maintenanceNotes)}</blockquote>
    <h3>日志机制（Art.12）</h3>
    <blockquote>${escape(t.loggingMechanismDescription)}</blockquote>
  </div>`

  // ────────── 页脚 ──────────
  const footer = `
  <div class="footer">
    <p>本报告由 <code>${escape(report.metadata.generatorVersion)}</code> 自动生成</p>
    <p>遵循：EU AI Act 2026 + NIST AI RMF 1.0 + NIST AI 600-1</p>
    <p>报告完整性校验：计算 SHA-256 时排除 fingerprint 与 generatedAt 字段，避免自引用哈希循环</p>
  </div>
</div>
</body>
</html>`

  return head + header + complianceCard + decisionCard + sourceTable + fusionCard + calibrationCard + riskCard + transparencyCard + footer
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
    case 'markdown':
      return formatAsMarkdown(report)
    case 'html':
      return formatAsHtml(report)
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
      return 'md'
    case 'html':
      return 'html'
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
      return 'text/markdown'
    case 'html':
      return 'text/html'
  }
}
