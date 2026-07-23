/**
 * decision-mappers — 决策数据映射工具函数
 *
 * 职责：将 DecisionCard / Evidence[] 等领域模型映射为决策详情页各子组件所需的数据结构。
 *
 * 抽离自 DecisionDetailPage.tsx（M2 Task 1），供 DecisionDetailPage / DecisionPage /
 * HistoryDetailPage 等页面复用，确保映射逻辑单一来源。
 *
 * 类型依赖：
 * - DecisionCard / Evidence / RiskLevel from @shared/models
 * - TimelineStep / RiskGate from @/components/decision/ApprovalStateMachine
 * - EvidenceSource from @/components/decision/EvidenceRadar
 * - DangerCommand from @/components/decision/EvidenceList
 * - AuditRow from @/components/decision/ExecutionResult
 * - CredibilityEvidenceInput from @shared/agent-types
 */
import type { DecisionCard, Evidence, RiskLevel } from '@shared/models'
import type { CredibilityEvidenceInput } from '@shared/agent-types'
import type { TimelineStep, RiskGate } from '@/components/decision/ApprovalStateMachine'
import type { EvidenceSource } from '@/components/decision/EvidenceRadar'
import type { DangerCommand } from '@/components/decision/EvidenceList'
import type { AuditRow } from '@/components/decision/ExecutionResult'

// ============================================================================
// 命令分段类型
// ============================================================================

/** 命令分段类型（ExecutionResult 兼容，含 comment） */
export type FullCmdSegment = { type: 'name' | 'flag' | 'path' | 'val' | 'sym' | 'comment' | 'text'; text: string }

/** 命令分段类型（EvidenceList 兼容，不含 comment） */
export type ListCmdSegment = { type: 'name' | 'flag' | 'path' | 'val' | 'sym' | 'text'; text: string }

// ============================================================================
// 风险等级元信息
// ============================================================================

/** 风险等级 → 中文标签 + 紧急程度 */
export function riskLevelMeta(level: RiskLevel): { label: string; urgency: string } {
  switch (level) {
    case 'SAFE': return { label: '安全', urgency: '低危' }
    case 'LOW': return { label: '低风险', urgency: '低危' }
    case 'MEDIUM': return { label: '中风险', urgency: '中危' }
    case 'HIGH': return { label: '高风险', urgency: '高危' }
    case 'CRITICAL': return { label: '极高风险', urgency: '紧急' }
  }
}

// ============================================================================
// 命令分段解析
// ============================================================================

/** 将 fixCommand 字符串解析为 CmdSegment[]（简易分词，ExecutionResult 用） */
export function parseCommandSegments(command: string): FullCmdSegment[] {
  const parts = command.trim().split(/\s+/)
  return parts.map((part, idx) => {
    if (idx === 0) return { type: 'name' as const, text: part }
    if (part.startsWith('-')) return { type: 'flag' as const, text: part }
    if (part.startsWith('/') || part.startsWith('./') || part.startsWith('~')) {
      return { type: 'path' as const, text: part }
    }
    if (/^\d+$/.test(part)) return { type: 'val' as const, text: part }
    if (/[|&;$()]/.test(part)) return { type: 'sym' as const, text: part }
    return { type: 'text' as const, text: part }
  })
}

/** 将 fixCommand 字符串解析为 EvidenceList 兼容的 CmdSegment[] */
export function parseListSegments(command: string): ListCmdSegment[] {
  const parts = command.trim().split(/\s+/)
  return parts.map((part, idx) => {
    if (idx === 0) return { type: 'name' as const, text: part }
    if (part.startsWith('-')) return { type: 'flag' as const, text: part }
    if (part.startsWith('/') || part.startsWith('./') || part.startsWith('~')) {
      return { type: 'path' as const, text: part }
    }
    if (/^\d+$/.test(part)) return { type: 'val' as const, text: part }
    if (/[|&;$()]/.test(part)) return { type: 'sym' as const, text: part }
    return { type: 'text' as const, text: part }
  })
}

// ============================================================================
// 证据源 → 雷达图数据
// ============================================================================

/** 从 Evidence[] 构建六源证据雷达数据 */
export function buildEvidenceSources(evidences: Evidence[]): EvidenceSource[] {
  const sourceLabels: Record<string, { label: string; desc: string }> = {
    log: { label: '日志', desc: '系统/应用日志证据' },
    metric: { label: '指标', desc: '实时性能指标' },
    command: { label: '命令', desc: '命令执行输出' },
    config: { label: '配置', desc: '配置文件分析' },
    knowledge: { label: '知识库', desc: '知识库匹配' },
  }

  // 按来源分组，计算每组平均置信度作为权重
  const grouped = new Map<string, Evidence[]>()
  for (const ev of evidences) {
    const list = grouped.get(ev.source) ?? []
    list.push(ev)
    grouped.set(ev.source, list)
  }

  const sources: EvidenceSource[] = []
  for (const [sourceType, evs] of grouped) {
    const meta = sourceLabels[sourceType] ?? { label: sourceType, desc: `${sourceType} 证据` }
    const avgConfidence = evs.reduce((sum, e) => sum + e.confidence, 0) / evs.length
    const detail = evs[0]?.sourceDetail ?? ''
    sources.push({
      label: meta.label,
      weight: Math.round(avgConfidence * 100) / 100,
      desc: detail || meta.desc,
    })
  }

  // 补齐到 6 个（雷达图需要 6 轴），不足的用 0 填充
  const defaultAxes = ['基础分', '指标', '历史', '知识库', '校验', '模型']
  while (sources.length < 6) {
    const idx = sources.length
    sources.push({
      label: defaultAxes[idx] ?? `源${idx + 1}`,
      weight: 0,
      desc: '暂无数据',
    })
  }

  return sources.slice(0, 6)
}

// ============================================================================
// 时间线 / 风险门 / 高危命令 / 审计日志 / 工作流
// ============================================================================

/** 从 DecisionCard 构建 7 步时间线 */
export function buildTimelineSteps(card: DecisionCard): TimelineStep[] {
  // 7 步标准英文标识（spec §B HITL 标准命名）
  const stepKeys: TimelineStep['stepKey'][] = ['collect', 'analyze', 'reason', 'check', 'confirm', 'execute', 'verify']

  const stepDefs = [
    { num: 1, title: '数据采集', desc: card.evidences.length > 0 ? `采集 ${card.evidences.length} 项证据：${card.evidences.slice(0, 3).map(e => e.sourceDetail).join('、')}` : '采集环境数据' },
    { num: 2, title: '异常分析', desc: card.problem || '分析异常指标' },
    { num: 3, title: '推理归因', desc: card.hypothesis || '推理根因' },
    { num: 4, title: '交叉校验', desc: card.evidences.filter(e => e.verified).length > 0 ? `${card.evidences.filter(e => e.verified).length} 项证据通过 Ground-Check 校验` : '证据交叉校验' },
    { num: 5, title: '人工确认', desc: card.risk.requireConfirmation ? '等待工程师审核命令' : '无需人工确认（低风险）' },
    { num: 6, title: '执行变更', desc: card.fixDescription || `执行：${card.fixCommand}` },
    { num: 7, title: '效果验证', desc: card.status === 'verified' ? '验证通过' : '执行后回采指标验证' },
  ]

  // 根据决策状态推断每步完成状态
  const completedCount = card.status === 'failed' ? 5
    : card.status === 'verified' ? 7
    : card.status === 'executed' ? 6
    : card.status === 'approved' ? 5
    : card.status === 'rejected' ? 5
    : 4 // pending → 前 4 步完成

  // 基于决策起始时间戳生成各步骤时间戳（每步间隔 3-15 秒）
  const baseTs = new Date(card.timestamp)
  const stepOffsets = [0, 3, 7, 12, 15, 18, 22] // 秒
  const fmtTs = (offsetSec: number): string => {
    const t = new Date(baseTs.getTime() + offsetSec * 1000)
    return t.toISOString().replace('T', ' ').slice(0, 19)
  }

  return stepDefs.map((step, idx) => {
    let status: 'completed' | 'in-progress' | 'pending'
    if (step.num <= completedCount) {
      status = 'completed'
    } else if (step.num === completedCount + 1) {
      status = 'in-progress'
    } else {
      status = 'pending'
    }
    // rejected 状态下第 5 步标记为 in-progress（卡在人工确认）
    if (card.status === 'rejected' && step.num === 5) {
      status = 'in-progress'
    }
    // 待决定步骤不显示时间戳
    const timestamp = status === 'pending' ? undefined : fmtTs(stepOffsets[idx] ?? 0)
    return {
      ...step,
      stepKey: stepKeys[idx],
      weight: 0.2,
      status,
      timestamp,
    }
  })
}

/** 从 DecisionCard 构建 4 道风险门 */
export function buildRiskGates(card: DecisionCard): RiskGate[] {
  const blocked = card.risk.blocked
  const needConfirm = card.risk.requireConfirmation

  return [
    {
      level: 'L1',
      name: '预拦截层',
      desc: blocked ? `高危命令拦截 · ${card.risk.matchedRules.length} 条命中` : '语法检查通过 · 无高危命令',
      status: 'completed',
    },
    {
      level: 'L2',
      name: '沙箱预演层',
      desc: card.status === 'pending' ? '等待 dry-run 预演' : 'dry-run 通过 · 无副作用',
      status: card.status === 'pending' ? 'in-progress' : 'completed',
    },
    {
      level: 'L3',
      name: '人工审批层',
      desc: needConfirm
        ? (card.status === 'approved' || card.status === 'executed' || card.status === 'verified' ? '工程师已确认' : '等待工程师确认')
        : '低风险 · 自动通过',
      status: needConfirm
        ? (card.status === 'approved' || card.status === 'executed' || card.status === 'verified' ? 'completed' : 'in-progress')
        : 'completed',
    },
    {
      level: 'L4',
      name: '审计回放层',
      desc: card.status === 'executed' || card.status === 'verified' ? '执行后自动记录' : '执行后自动记录',
      status: card.status === 'executed' || card.status === 'verified' ? 'completed' : 'pending',
    },
  ]
}

/** 从 risk.matchedRules 构建高危命令拦截清单 */
export function buildDangerCommands(card: DecisionCard): DangerCommand[] {
  if (card.risk.matchedRules.length === 0) return []

  return card.risk.matchedRules.map((rule, idx) => ({
    ruleId: rule.startsWith('R-') ? rule : `R-${String(idx + 1).padStart(3, '0')}`,
    level: (card.risk.level === 'HIGH' || card.risk.level === 'CRITICAL' ? 'high' : 'mid') as 'high' | 'mid',
    threat: card.risk.description || `命中规则 ${rule}`,
    segments: parseListSegments(card.fixCommand),
  }))
}

/** 从 DecisionCard 构建审计日志行 */
export function buildAuditRows(card: DecisionCard): AuditRow[] {
  const ts = new Date(card.timestamp)
  const fmt = (d: Date, offsetSec: number): string => {
    const t = new Date(d.getTime() + offsetSec * 1000)
    return t.toISOString().replace('T', ' ').slice(0, 19)
  }

  const rows: AuditRow[] = [
    {
      timestamp: fmt(ts, 0),
      operator: 'Monitor',
      action: `告警触发 · ${card.problem.slice(0, 30)}`,
      hash: `0x${card.id.slice(0, 4)}...${card.id.slice(-3)}`,
      result: 'completed',
    },
    {
      timestamp: fmt(ts, 3),
      operator: 'System',
      action: `证据采集 · ${card.evidences.length} 项证据`,
      hash: `0x${card.id.slice(1, 5)}...${card.id.slice(-3)}`,
      result: 'completed',
    },
    {
      timestamp: fmt(ts, 7),
      operator: 'AI Engine',
      action: `推理归因 · ${card.hypothesis.slice(0, 30)}`,
      hash: `0x${card.id.slice(2, 6)}...${card.id.slice(-3)}`,
      result: 'completed',
    },
  ]

  if (card.evidences.some(e => e.verified)) {
    rows.push({
      timestamp: fmt(ts, 12),
      operator: 'Sandbox',
      action: `dry-run 预演 · ${card.fixCommand.slice(0, 30)}`,
      hash: `0x${card.id.slice(3, 7)}...${card.id.slice(-3)}`,
      result: 'passed',
    })
  }

  if (card.risk.requireConfirmation) {
    rows.push({
      timestamp: fmt(ts, 15),
      operator: 'Engineer',
      action: card.status === 'approved' ? '已审批 · 确认执行' : '审批中 · 等待人工确认',
      hash: `0x${card.id.slice(4, 8)}...${card.id.slice(-3)}`,
      result: card.status === 'approved' || card.status === 'executed' || card.status === 'verified' ? 'completed' : 'waiting',
    })
  }

  if (card.status === 'executed' || card.status === 'verified') {
    rows.push({
      timestamp: fmt(ts, 18),
      operator: 'Executor',
      action: `执行变更 · ${card.fixCommand.slice(0, 30)}`,
      hash: `0x${card.id.slice(5, 9)}...${card.id.slice(-3)}`,
      result: 'completed',
    })
  } else {
    rows.push({
      timestamp: fmt(ts, 18),
      operator: '—',
      action: '执行变更 · 待触发',
      hash: `0x${card.id.slice(5, 9)}...${card.id.slice(-3)}`,
      result: 'pending',
    })
  }

  return rows
}

/** 从 DecisionCard 构建 Agent 工作流进度 */
export function buildWorkflowSteps(card: DecisionCard): Array<{ label: string; status: 'completed' | 'in-progress' | 'pending' }> {
  const steps = ['采集', '分析', '推理', '校验', '确认', '执行', '验证']
  const completedCount = card.status === 'failed' ? 5
    : card.status === 'verified' ? 7
    : card.status === 'executed' ? 6
    : card.status === 'approved' ? 5
    : card.status === 'rejected' ? 5
    : 4

  return steps.map((label, idx) => {
    let status: 'completed' | 'in-progress' | 'pending'
    if (idx < completedCount) {
      status = 'completed'
    } else if (idx === completedCount) {
      status = 'in-progress'
    } else {
      status = 'pending'
    }
    return { label, status }
  })
}

// ============================================================================
// 可信度评估输入
// ============================================================================

/**
 * 将 DecisionCard.evidences 映射为 CredibilityEvidenceInput[]
 *
 * 注：与 utils/evidence-to-input.ts 中的 buildCredibilityInputs(ctx: DecisionContext)
 * 是不同实现。本函数面向 DecisionCard 直接映射（DecisionDetailPage 专用简化版），
 * evidence-to-input.ts 中的版本面向更通用的 6 源构造（含 cotEntropyTrajectory 等）。
 */
export function buildCredibilityInputs(card: DecisionCard): CredibilityEvidenceInput[] {
  const inputs: CredibilityEvidenceInput[] = []

  // 按来源类型聚合
  const hasLog = card.evidences.some(e => e.source === 'log')
  const hasKb = card.evidences.some(e => e.source === 'knowledge')
  const hasCmd = card.evidences.some(e => e.source === 'command')
  const hasMetric = card.evidences.some(e => e.source === 'metric')

  if (hasLog) {
    const logEvs = card.evidences.filter(e => e.source === 'log')
    const avgDrain = logEvs.reduce((s, e) => s + e.drainMatch, 0) / logEvs.length
    inputs.push({ sourceId: 'log', fields: { drainMatch: avgDrain, count: logEvs.length } })
  }
  if (hasKb) {
    const kbEvs = card.evidences.filter(e => e.source === 'knowledge')
    const avgConf = kbEvs.reduce((s, e) => s + e.confidence, 0) / kbEvs.length
    inputs.push({ sourceId: 'kb', fields: { topScore: avgConf, hasResults: true } })
  }
  if (hasCmd || hasMetric) {
    inputs.push({ sourceId: 'ai-param', fields: { confidence: card.confidence } })
  }
  if (card.risk.requireConfirmation) {
    inputs.push({ sourceId: 'human', fields: { approved: card.status === 'approved' || card.status === 'executed' || card.status === 'verified' ? 1 : 0 } })
  }

  // 至少提供一个输入
  if (inputs.length === 0) {
    inputs.push({ sourceId: 'ai-param', fields: { confidence: card.confidence } })
  }

  return inputs
}
