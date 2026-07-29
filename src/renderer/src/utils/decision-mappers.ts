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
// 时间格式化（本地时区，YYYY-MM-DD HH:mm:ss）
// ============================================================================

/**
 * 将时间戳（ms）格式化为本地时区字符串 YYYY-MM-DD HH:mm:ss
 *
 * 取代 toISOString()（UTC），与页面顶部 formatTimestamp 保持时区一致，
 * 避免审计行与决策标题时间戳出现 8 小时偏差（Task 6 修复 [I1]）。
 */
function formatLocalTs(tsMs: number): string {
  const d = new Date(tsMs)
  if (Number.isNaN(d.getTime())) return 'Invalid Date'
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

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

/** 从 Evidence[] 构建六源证据雷达数据
 *
 * v2.6 去假：六轴固定语义（日志/指标/命令/配置/知识库/模型），不再按位置漂移补位；
 * 无数据的轴诚实标注「无此来源证据」；模型轴用真实的综合置信度（可选传入）。
 */
export function buildEvidenceSources(evidences: Evidence[], modelConfidence?: number): EvidenceSource[] {
  /** 固定六轴：前 5 轴对应 Evidence.source 的 5 种真实来源，第 6 轴为模型综合置信度 */
  const axes: Array<{ key: string; label: string; desc: string }> = [
    { key: 'log', label: '日志', desc: '系统/应用日志证据' },
    { key: 'metric', label: '指标', desc: '实时性能指标' },
    { key: 'command', label: '命令', desc: '命令执行输出' },
    { key: 'config', label: '配置', desc: '配置文件分析' },
    { key: 'knowledge', label: '知识库', desc: '知识库匹配' },
    { key: 'model', label: '模型', desc: '模型综合置信度' },
  ]

  // 按来源分组，计算每组平均置信度作为权重
  const grouped = new Map<string, Evidence[]>()
  for (const ev of evidences) {
    const list = grouped.get(ev.source) ?? []
    list.push(ev)
    grouped.set(ev.source, list)
  }

  return axes.map((axis) => {
    if (axis.key === 'model') {
      return {
        label: axis.label,
        weight: typeof modelConfidence === 'number' ? Math.round(modelConfidence * 100) / 100 : 0,
        desc: typeof modelConfidence === 'number' ? axis.desc : '无此来源证据',
      }
    }
    const evs = grouped.get(axis.key)
    if (!evs || evs.length === 0) {
      return { label: axis.label, weight: 0, desc: '无此来源证据' }
    }
    const avgConfidence = evs.reduce((sum, e) => sum + e.confidence, 0) / evs.length
    return {
      label: axis.label,
      weight: Math.round(avgConfidence * 100) / 100,
      desc: evs[0]?.sourceDetail || axis.desc,
    }
  })
}

// ============================================================================
// 时间线 / 风险门 / 高危命令 / 审计日志 / 工作流
// ============================================================================

/**
 * 把 AI 回复/markdown 文本清洗成单行纯文本摘要（v2.6）
 *
 * 溯源链/时间线步骤描述直接展示 card.hypothesis（AI 回复原文）时，
 * 加粗星号、井号标题、emoji、代码块符号会原样满屏铺开；
 * 这里去 markdown 标记 + 压缩空白 + 截断。
 */
function plainTextSummary(text: string, max = 120): string {
  const t = (text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*`>|_~]+/g, '')
    .replace(/^-{3,}$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** 从 DecisionCard 构建 7 步时间线 */
export function buildTimelineSteps(card: DecisionCard): TimelineStep[] {
  // 7 步标准英文标识（spec §B HITL 标准命名）
  const stepKeys: TimelineStep['stepKey'][] = ['collect', 'analyze', 'reason', 'check', 'confirm', 'execute', 'verify']

  const stepDefs = [
    { num: 1, title: '数据采集', desc: card.evidences.length > 0 ? `采集 ${card.evidences.length} 项证据：${plainTextSummary(card.evidences.slice(0, 3).map(e => e.sourceDetail).join('、'), 80)}` : '采集环境数据' },
    { num: 2, title: '异常分析', desc: plainTextSummary(card.problem, 100) || '分析异常指标' },
    { num: 3, title: '推理归因', desc: plainTextSummary(card.hypothesis, 100) || '推理根因' },
    { num: 4, title: '交叉校验', desc: card.evidences.filter(e => e.verified).length > 0 ? `${card.evidences.filter(e => e.verified).length} 项证据通过 Ground-Check 校验` : '证据交叉校验' },
    { num: 5, title: '人工确认', desc: card.risk.requireConfirmation ? '等待工程师审核命令' : '无需人工确认（低风险）' },
    { num: 6, title: '执行变更', desc: plainTextSummary(card.fixDescription || `执行：${card.fixCommand}`, 100) },
    { num: 7, title: '效果验证', desc: card.status === 'verified' ? '验证通过' : '执行后回采指标验证' },
  ]

  // 根据决策状态推断每步完成状态
  const completedCount = card.status === 'failed' ? 5
    : card.status === 'verified' ? 7
    : card.status === 'executed' ? 6
    : card.status === 'approved' ? 5
    : card.status === 'rejected' ? 5
    : 4 // pending → 前 4 步完成

  // 真实时间戳（v2.6 去假）：只展示确切知道的时刻 ——
  // 证据采集步用最早证据的真实 timestamp，确认/执行步用决策落库时刻，
  // 其余步骤无真实时间不显示（不再用 0/3/7/… 秒固定偏移伪造）
  const evidenceTs = card.evidences.length > 0
    ? Math.min(...card.evidences.map((e) => e.timestamp))
    : undefined
  const executedLike = card.status === 'executed' || card.status === 'verified' || card.status === 'approved'
  const stepRealTs: Array<number | undefined> = [
    evidenceTs,               // 1 数据采集：真实证据时间
    undefined,                // 2 异常分析：无独立时间记录
    undefined,                // 3 推理归因：无独立时间记录
    undefined,                // 4 交叉校验：无独立时间记录
    executedLike ? card.timestamp : undefined, // 5 人工确认：批准时刻
    executedLike ? card.timestamp : undefined, // 6 执行变更：同批准时刻（对话链路批准即发送）
    undefined,                // 7 效果验证：无独立时间记录
  ]

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
    // 只展示真实可知的时间戳
    const realTs = stepRealTs[idx]
    const timestamp = status === 'pending' || realTs === undefined ? undefined : formatLocalTs(realTs)
    return {
      ...step,
      stepKey: stepKeys[idx],
      weight: 0.2,
      status,
      timestamp,
    }
  })
}

/** 从 DecisionCard 构建风险门（v2.6：移除已下线的「沙箱预演」假门，3 层真实门控） */
export function buildRiskGates(card: DecisionCard): RiskGate[] {
  const blocked = card.risk.blocked
  const needConfirm = card.risk.requireConfirmation

  return [
    {
      level: 'L1',
      name: '预拦截层',
      desc: blocked ? `高危命令拦截 · ${card.risk.matchedRules.length} 条命中` : `风险评估 ${card.risk.level} · ${card.risk.matchedRules.length} 条规则命中`,
      status: 'completed',
    },
    {
      level: 'L2',
      name: '人工审批层',
      desc: needConfirm
        ? (card.status === 'approved' || card.status === 'executed' || card.status === 'verified' ? '工程师已确认' : '等待工程师确认')
        : '低风险 · 自动通过',
      status: needConfirm
        ? (card.status === 'approved' || card.status === 'executed' || card.status === 'verified' ? 'completed' : 'in-progress')
        : 'completed',
    },
    {
      level: 'L3',
      name: '审计回放层',
      desc: '执行后自动记录',
      status: card.status === 'executed' || card.status === 'verified' ? 'completed' : 'pending',
    },
  ]
}

/** 从 risk.matchedRules 构建高危命令拦截清单 */
export function buildDangerCommands(card: DecisionCard): DangerCommand[] {
  if (card.risk.matchedRules.length === 0) return []

  // v2.11 去假：intercepted 来自真实的 card.risk.blocked / status（而非无条件永真）
  // 拦截判定：风险引擎 blocked=true 或决策被 rejected → 已拦截；
  // 若命中高危规则但状态为 executed/approved → 经审批放行（未拦截）
  const intercepted = card.risk.blocked === true || card.status === 'rejected'

  return card.risk.matchedRules.map((rule, idx) => ({
    ruleId: rule.startsWith('R-') ? rule : `R-${String(idx + 1).padStart(3, '0')}`,
    level: (card.risk.level === 'HIGH' || card.risk.level === 'CRITICAL' ? 'high' : 'mid') as 'high' | 'mid',
    threat: card.risk.description || `命中规则 ${rule}`,
    segments: parseListSegments(card.fixCommand),
    intercepted,
  }))
}

/** 计算字符串的 SHA-256 十六进制摘要（Web Crypto，渲染进程可用） */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** 哈希展示格式：0x + 前 6 位 + … + 后 4 位 */
function shortHash(hex: string): string {
  return `0x${hex.slice(0, 6)}…${hex.slice(-4)}`
}

/**
 * 从 DecisionCard 构建审计日志行（v2.6 去假，async）
 *
 * - 只记录【真实发生】的事件：每项证据的采集（用证据自身真实 timestamp）、
 *   风险评估、人工批准/执行（用决策落库时刻）；不再编造 Monitor 告警/沙箱预演行。
 * - 哈希是真 SHA-256 链：hash_i = sha256(hash_{i-1} + timestamp + operator + action)，
 *   任意一行内容变动都会使后续整链哈希变化（可验证的链式完整性）。
 */
export async function buildAuditRows(card: DecisionCard): Promise<AuditRow[]> {
  /** 待哈希的事件行（真实事件 + 真实时间） */
  const events: Array<Omit<AuditRow, 'hash'>> = []

  // 1. 证据采集：每项证据一行，时间戳 = 证据真实产生时刻
  for (const ev of [...card.evidences].sort((a, b) => a.timestamp - b.timestamp)) {
    events.push({
      timestamp: formatLocalTs(ev.timestamp),
      operator: ev.source === 'command' ? 'SSH Executor' : ev.source === 'knowledge' ? 'Knowledge' : 'Collector',
      action: `证据采集 · ${(ev.sourceDetail || ev.source).slice(0, 40)}`,
      result: ev.verified ? 'passed' : 'completed',
    })
  }

  // 2. 风险评估（落库时随卡一起写入，时间 = 决策时刻）
  events.push({
    timestamp: formatLocalTs(card.timestamp),
    operator: 'Risk Engine',
    action: `风险评估 · ${card.risk.level} · ${card.risk.description.slice(0, 30)}`,
    result: 'completed',
  })

  // 3. 人工确认 + 执行（对话链路：批准即发送终端，同一时刻）
  const executedLike = card.status === 'executed' || card.status === 'verified'
  if (card.risk.requireConfirmation || executedLike) {
    events.push({
      timestamp: formatLocalTs(card.timestamp),
      operator: 'Engineer',
      action: executedLike || card.status === 'approved' ? '人工批准 · 确认执行' : '审批中 · 等待人工确认',
      result: executedLike || card.status === 'approved' ? 'completed' : 'waiting',
    })
  }
  if (executedLike) {
    events.push({
      timestamp: formatLocalTs(card.timestamp),
      operator: 'Executor',
      action: `发送终端执行 · ${card.fixCommand.slice(0, 40)}`,
      result: 'completed',
    })
  } else if (card.status === 'rejected') {
    events.push({
      timestamp: formatLocalTs(card.timestamp),
      operator: 'Engineer',
      action: '已拒绝 · 命令未执行',
      result: 'completed',
    })
  } else {
    events.push({
      timestamp: formatLocalTs(card.timestamp),
      operator: '—',
      action: '执行变更 · 待触发',
      result: 'pending',
    })
  }

  // 4. 真 SHA-256 链式哈希：创世块 = 决策 ID，逐行链接
  const rows: AuditRow[] = []
  let prevHash = await sha256Hex(card.id)
  for (const evt of events) {
    const lineHash = await sha256Hex(`${prevHash}|${evt.timestamp}|${evt.operator}|${evt.action}`)
    rows.push({ ...evt, hash: shortHash(lineHash) })
    prevHash = lineHash
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
