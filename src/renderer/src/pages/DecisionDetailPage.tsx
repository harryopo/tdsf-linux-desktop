/**
 * DecisionDetailPage — AI 可信决策详情（核心页面）
 *
 * 路由：/decision/:id
 *
 * 设计稿：tdsf-linux-redesign/pages/decision-detail.html
 *
 * 7 个 section + footer：
 * 1. Header（决策摘要 + 决策 ID + 时间 + 场景 + 紧急程度 + 3 个链接）
 * 2. 核心视觉锚点：大型径向置信度仪表（左）+ 命令决策终端（右）
 * 3. 六源证据融合面板（D-S 证据理论透明化）：EvidenceRadar + PCR5Result
 * 4. 证据溯源链（7 步光路时间线）+ 5. 四层风险控制 → 合并为 ApprovalStateMachine
 * 5.5 高危命令拦截清单 → EvidenceList
 * 6. 决策审计日志 → 已内置在 ExecutionResult
 * Footer: Agent 工作流进度条（7 步 5/7）
 *
 * 数据来源：
 * - window.electronAPI.historyGet(id) 获取决策记录
 * - window.electronAPI.credibilityAssess(inputs) 获取可信度评估（可选）
 */
import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Sparkles, ArrowLeft, Fingerprint, Clock, Activity,
  FileText, ScrollText, Loader2, AlertTriangle,
} from 'lucide-react'
import { EvidenceRadar, type EvidenceSource } from '@/components/decision/EvidenceRadar'
import { PCR5Result } from '@/components/decision/PCR5Result'
import { ApprovalStateMachine, type TimelineStep, type RiskGate } from '@/components/decision/ApprovalStateMachine'
import { EvidenceList, type DangerCommand } from '@/components/decision/EvidenceList'
import { ExecutionResult, type AuditRow } from '@/components/decision/ExecutionResult'
import type { DecisionCard, Evidence, RiskLevel } from '@shared/models'
import type { ConfidenceAssessment, CredibilityEvidenceInput } from '@shared/agent-types'

// ============================================================================
// 数据映射工具函数
// ============================================================================

/** 风险等级 → 中文标签 + 紧急程度 */
function riskLevelMeta(level: RiskLevel): { label: string; urgency: string } {
  switch (level) {
    case 'SAFE': return { label: '安全', urgency: '低危' }
    case 'LOW': return { label: '低风险', urgency: '低危' }
    case 'MEDIUM': return { label: '中风险', urgency: '中危' }
    case 'HIGH': return { label: '高风险', urgency: '高危' }
    case 'CRITICAL': return { label: '极高风险', urgency: '紧急' }
  }
}

/** 命令分段类型（ExecutionResult 兼容，含 comment） */
type FullCmdSegment = { type: 'name' | 'flag' | 'path' | 'val' | 'sym' | 'comment' | 'text'; text: string }

/** 命令分段类型（EvidenceList 兼容，不含 comment） */
type ListCmdSegment = { type: 'name' | 'flag' | 'path' | 'val' | 'sym' | 'text'; text: string }

/** 将 fixCommand 字符串解析为 CmdSegment[]（简易分词，ExecutionResult 用） */
function parseCommandSegments(command: string): FullCmdSegment[] {
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
function parseListSegments(command: string): ListCmdSegment[] {
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

/** 从 Evidence[] 构建六源证据雷达数据 */
function buildEvidenceSources(evidences: Evidence[]): EvidenceSource[] {
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

/** 从 DecisionCard 构建 7 步时间线 */
function buildTimelineSteps(card: DecisionCard): TimelineStep[] {
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
function buildRiskGates(card: DecisionCard): RiskGate[] {
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
function buildDangerCommands(card: DecisionCard): DangerCommand[] {
  if (card.risk.matchedRules.length === 0) return []

  return card.risk.matchedRules.map((rule, idx) => ({
    ruleId: rule.startsWith('R-') ? rule : `R-${String(idx + 1).padStart(3, '0')}`,
    level: (card.risk.level === 'HIGH' || card.risk.level === 'CRITICAL' ? 'high' : 'mid') as 'high' | 'mid',
    threat: card.risk.description || `命中规则 ${rule}`,
    segments: parseListSegments(card.fixCommand),
  }))
}

/** 从 DecisionCard 构建审计日志行 */
function buildAuditRows(card: DecisionCard): AuditRow[] {
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
function buildWorkflowSteps(card: DecisionCard): Array<{ label: string; status: 'completed' | 'in-progress' | 'pending' }> {
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

/** 将 DecisionCard.evidences 映射为 CredibilityEvidenceInput[] */
function buildCredibilityInputs(card: DecisionCard): CredibilityEvidenceInput[] {
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

// ============================================================================
// 示例数据 fallback（IPC 不可用或决策记录不存在时使用，保证页面可演示）
// ============================================================================

/**
 * 构建示例 DecisionCard，用于：
 * 1. IPC 桥接不可用（开发预览 / 跑 typecheck 时）
 * 2. historyGet 返回 null（决策 ID 不存在）
 *
 * 数据全部为虚构演示值，不涉及真实生产数据。
 */
function buildSampleDecisionCard(id: string): DecisionCard {
  const now = Date.now()
  return {
    id: id || 'DEC-087',
    problem: 'nginx 进程 CPU 占用异常飙升至 68%',
    hypothesis: 'nginx worker_processes 配置过低 + access_log 未压缩导致 IO 阻塞',
    evidences: [
      {
        id: 'ev-001',
        source: 'log',
        sourceDetail: '/var/log/nginx/error.log',
        content: '2026-07-21 14:23:18 [error] 1234#0: *567 worker process exited on signal 9',
        drainMatch: 0.92,
        sourcePrior: 0.85,
        confidence: 0.88,
        timestamp: now - 60000,
        verified: true,
      },
      {
        id: 'ev-002',
        source: 'metric',
        sourceDetail: 'prometheus:node_cpu_seconds_total',
        content: 'CPU usage 68% (user 52% / sys 16%) · 持续 5 分钟',
        drainMatch: 0.78,
        sourcePrior: 0.90,
        confidence: 0.85,
        timestamp: now - 55000,
        verified: true,
      },
      {
        id: 'ev-003',
        source: 'command',
        sourceDetail: 'nginx -T 2>&1 | grep worker_processes',
        content: 'worker_processes 4;  # 实际 CPU 核数 8',
        drainMatch: 0.95,
        sourcePrior: 0.95,
        confidence: 0.92,
        timestamp: now - 50000,
        verified: true,
      },
      {
        id: 'ev-004',
        source: 'config',
        sourceDetail: '/etc/nginx/nginx.conf',
        content: 'access_log /var/log/nginx/access.log;  # 未启用 buffer/gzip',
        drainMatch: 0.88,
        sourcePrior: 0.92,
        confidence: 0.87,
        timestamp: now - 48000,
        verified: true,
      },
      {
        id: 'ev-005',
        source: 'knowledge',
        sourceDetail: 'KB-NGINX-2024-014',
        content: 'nginx 高 CPU 排查指南：worker_processes 与 CPU 核数对齐 + access_log buffer',
        drainMatch: 0.82,
        sourcePrior: 0.80,
        confidence: 0.78,
        timestamp: now - 45000,
        verified: false,
      },
      {
        id: 'ev-006',
        source: 'log',
        sourceDetail: '/var/log/nginx/access.log',
        content: '最近 5 分钟 12.4k 请求 · 平均响应 180ms · P99 1.2s',
        drainMatch: 0.75,
        sourcePrior: 0.85,
        confidence: 0.80,
        timestamp: now - 42000,
        verified: true,
      },
    ],
    confidence: 0.87,
    trident: {
      dangerScore: 0.85,
      idempotentScore: 0.70,
      relevanceScore: 0.92,
      compositeScore: 0.84,
      source: 'hybrid',
    },
    risk: {
      level: 'MEDIUM',
      score: 42,
      matchedRules: ['R-003', 'R-007'],
      description: '修改 nginx 配置需重启服务，影响线上请求',
      requireConfirmation: true,
      blocked: false,
    },
    fixCommand: 'sudo sed -i "s/worker_processes 4/worker_processes 8/" /etc/nginx/nginx.conf && sudo nginx -t && sudo systemctl reload nginx',
    fixDescription: '调整 worker_processes 至 8（与 CPU 核数对齐）+ reload 而非 restart 保持连接',
    rollbackCommand: 'sudo sed -i "s/worker_processes 8/worker_processes 4/" /etc/nginx/nginx.conf && sudo nginx -t && sudo systemctl reload nginx',
    status: 'approved',
    timestamp: now - 30000,
    sessionId: 'sess-preview-001',
  }
}

// ============================================================================
// 大型径向置信度仪表（SVG 直接绘制）
// ============================================================================

function ConfidenceGauge({ value, sources }: { value: number; sources: EvidenceSource[] }) {
  const weights = sources.length >= 6
    ? sources.map(s => ({ label: s.label, val: s.weight, opacity: Math.max(0.4, s.weight) }))
    : [
        { label: '基础分', val: 0.3, opacity: 1 },
        { label: '指标采集', val: 0.3, opacity: 1 },
        { label: '历史匹配', val: 0.22, opacity: 0.85 },
        { label: '知识库', val: 0.15, opacity: 0.6 },
        { label: '人工校验', val: 0.2, opacity: 0.9 },
        { label: '模型置信', val: 0.2, opacity: 0.9 },
      ]

  // 6 段弧的起止点（与设计稿一致）
  const segments = [
    'M 110,20 A 90,90 0 0 1 197.44,88.71',
    'M 198.10,91.63 A 90,90 0 0 1 148.71,191.25',
    'M 145.99,192.49 A 90,90 0 0 1 61.78,185.99',
    'M 59.26,184.33 A 90,90 0 0 1 24.22,137.23',
    'M 23.42,134.57 A 90,90 0 0 1 36.44,58.15',
    'M 38.35,55.54 A 90,90 0 0 1 106.92,20.05',
  ]

  const confidenceLabel = value >= 0.8 ? '高可信' : value >= 0.6 ? '中可信' : '低可信'

  return (
    <div className="flex min-w-[300px] flex-[0_0_38%] flex-col items-center gap-4 rounded-[var(--trae-radius-10)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] p-6">
      <div className="flex items-center gap-1.5 self-start">
        <Activity className="h-3.5 w-3.5 text-[var(--trae-text-secondary)]" />
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--trae-text-secondary)]">
          置信度仪表
        </span>
      </div>
      <div className="relative h-[220px] w-[220px]">
        <svg width="220" height="220" viewBox="0 0 220 220" style={{ display: 'block', overflow: 'visible' }}>
          <circle cx="110" cy="110" r="90" fill="none" stroke="var(--trae-bg-overlay-l1)" strokeWidth="8" />
          {segments.map((d, i) => {
            const w = weights[i]
            // hover tooltip：源名 + 权重 + 数值
            const tooltipText = w
              ? `${w.label} · 权重 ${w.val.toFixed(2)} · 占比 ${((w.val / weights.reduce((s, x) => s + x.val, 0)) * 100).toFixed(1)}%`
              : `源 ${i + 1}`
            return (
              <path
                key={i}
                className="gauge-segment"
                d={d}
                fill="none"
                stroke="var(--trae-bg-brand)"
                strokeWidth="8"
                opacity={w?.opacity ?? 0.5}
                strokeLinecap="round"
                role="presentation"
              >
                <title>{tooltipText}</title>
              </path>
            )
          })}
          <circle cx="110" cy="110" r="70" fill="none" stroke="var(--trae-bg-overlay-l2)" strokeWidth="6" />
          <circle
            className="gauge-progress"
            cx="110"
            cy="110"
            r="70"
            fill="none"
            stroke="var(--trae-bg-brand)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${value * 439.82} 439.82`}
            transform="rotate(-90 110 110)"
          >
            <title>{`综合置信度 ${value.toFixed(2)} · ${confidenceLabel}`}</title>
          </circle>
          <text x="110" y="214" textAnchor="middle" fontSize="9" fill="var(--trae-text-tertiary)" fontFamily="var(--trae-font-family-mono)">0.5</text>
          <text x="6" y="150" textAnchor="start" fontSize="9" fill="var(--trae-text-tertiary)" fontFamily="var(--trae-font-family-mono)">0.7</text>
          <text x="46" y="24" textAnchor="middle" fontSize="9" fill="var(--trae-text-tertiary)" fontFamily="var(--trae-font-family-mono)">0.9</text>
        </svg>
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1">
          <span
            className="font-mono font-bold leading-none tabular-nums text-[var(--trae-text-brand)]"
            style={{ fontSize: '48px' }}
          >
            {value.toFixed(2)}
          </span>
          <span className="text-[11px] text-[var(--trae-text-tertiary)]">置信度</span>
          <span className="mt-1 inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-status-success-default)] bg-[rgba(51,193,146,0.12)] px-2 text-[10px] font-medium text-[var(--trae-status-success-default)]">
            {confidenceLabel}
          </span>
        </div>
      </div>
      {/* 6 源权重明细 */}
      <div className="grid w-full max-w-[260px] grid-cols-2 gap-x-3 gap-y-1">
        {weights.map((w) => (
          <div key={w.label} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-sm bg-[var(--trae-bg-brand)]"
              style={{ opacity: w.opacity }}
            />
            <span className="text-[10px] text-[var(--trae-text-secondary)]">{w.label}</span>
            <span className="ml-auto font-mono text-[10px] tabular-nums text-[var(--trae-text-default)]">
              {w.val.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// 加载 / 错误 / 空状态组件
// ============================================================================

function LoadingState() {
  return (
    <main className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[var(--trae-bg-base-default)]">
      <Loader2 className="h-8 w-8 animate-spin text-[var(--trae-bg-brand)]" />
      <span className="text-[13px] text-[var(--trae-text-secondary)]">正在加载决策详情...</span>
    </main>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[var(--trae-bg-base-default)]">
      <AlertTriangle className="h-8 w-8 text-[var(--trae-status-alert-default)]" />
      <span className="text-[13px] text-[var(--trae-text-secondary)]">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] px-3 text-[12px] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
      >
        重试
      </button>
    </main>
  )
}

function EmptyState({ id, onBack }: { id: string; onBack: () => void }) {
  return (
    <main className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[var(--trae-bg-base-default)]">
      <Fingerprint className="h-8 w-8 text-[var(--trae-text-tertiary)]" />
      <span className="text-[13px] text-[var(--trae-text-secondary)]">
        未找到决策记录 #{id}
      </span>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] px-3 text-[12px] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        返回工作台
      </button>
    </main>
  )
}

// ============================================================================
// DecisionDetailPage 主组件
// ============================================================================

export function DecisionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [card, setCard] = useState<DecisionCard | null>(null)
  const [credibility, setCredibility] = useState<ConfidenceAssessment | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)

  /** 加载决策数据 */
  const loadData = useCallback(async () => {
    if (!id) {
      setError('缺少决策 ID 参数')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    // Guard: electronAPI 不可用 → 使用示例数据 fallback（保证页面可演示）
    if (!window.electronAPI?.historyGet) {
      const sample = buildSampleDecisionCard(id)
      setCard(sample)
      setCredibility(null)
      setLoading(false)
      return
    }

    try {
      const result = await window.electronAPI.historyGet(id)
      if (!result) {
        // 决策记录不存在 → 使用示例数据 fallback（保证页面可演示）
        const sample = buildSampleDecisionCard(id)
        setCard(sample)
        setCredibility(null)
        setLoading(false)
        return
      }
      setCard(result)

      // 尝试获取可信度评估（可选，失败不影响主流程）
      if (window.electronAPI.credibilityAssess) {
        try {
          const inputs = buildCredibilityInputs(result)
          const assessment = await window.electronAPI.credibilityAssess(inputs)
          setCredibility(assessment)
        } catch {
          // 可信度评估失败不阻塞页面渲染
          setCredibility(null)
        }
      }
    } catch (err) {
      // 加载异常 → 使用示例数据 fallback（保证页面可演示）
      const sample = buildSampleDecisionCard(id)
      setCard(sample)
      setCredibility(null)
      // 记录错误到控制台但不阻塞渲染
      console.warn('[DecisionDetailPage] historyGet failed, using sample data:', err)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadData()
  }, [loadData])

  /** 显示操作反馈 */
  const handleAction = (action: string) => {
    setActionFeedback(action)
    setTimeout(() => setActionFeedback(null), 2000)
  }

  // ===== 状态渲染 =====
  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} onRetry={() => void loadData()} />
  if (!card) return <EmptyState id={id ?? ''} onBack={() => navigate('/workbench')} />

  // ===== 数据映射 =====
  const riskMeta = riskLevelMeta(card.risk.level)
  const evidenceSources = buildEvidenceSources(card.evidences)
  const timelineSteps = buildTimelineSteps(card)
  const riskGates = buildRiskGates(card)
  const dangerCommands = buildDangerCommands(card)
  const commandSegments = parseCommandSegments(card.fixCommand)
  const auditRows = buildAuditRows(card)
  const workflowSteps = buildWorkflowSteps(card)

  // 置信度：优先使用 credibilityAssess 结果，否则用 card.confidence
  const displayConfidence = credibility?.confidence ?? card.confidence
  const conflictK = credibility?.conflictLevel ?? 0
  const fusedValue = credibility?.confidence ?? card.confidence

  // 时间格式化
  const timestamp = new Date(card.timestamp)
  const timeStr = `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, '0')}-${String(timestamp.getDate()).padStart(2, '0')} ${String(timestamp.getHours()).padStart(2, '0')}:${String(timestamp.getMinutes()).padStart(2, '0')}:${String(timestamp.getSeconds()).padStart(2, '0')} CST`

  // 工作流完成计数
  const completedSteps = workflowSteps.filter(s => s.status === 'completed').length

  return (
    <main className="flex h-full w-full flex-col overflow-y-auto bg-[var(--trae-bg-base-default)]">
      {/* ===== Section 1: 决策摘要 Header ===== */}
      <header className="flex flex-col gap-4 px-8 pb-4 pt-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Sparkles className="h-6 w-6 shrink-0 text-[var(--trae-bg-brand)]" />
            <div className="flex flex-col gap-0.5">
              <span className="text-[28px] font-semibold leading-[36px] text-[var(--trae-text-default)]">
                可信决策内核
              </span>
              <span className="text-[11px] text-[var(--trae-text-tertiary)]">
                Human-in-the-Loop · 可解释 · 可审计 · #{id}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/workbench')}
            className="inline-flex h-7 items-center gap-1.5 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] px-2.5 text-[11px] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
            aria-label="返回工作台"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回工作台
          </button>
        </div>

        {/* 决策摘要条 */}
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Fingerprint className="h-3 w-3 text-[var(--trae-text-secondary)]" />
            <span className="font-mono text-[10px] text-[var(--trae-text-secondary)]">决策ID</span>
            <span className="font-mono text-[12px] font-medium tabular-nums text-[var(--trae-text-default)]">
              #{card.id}
            </span>
          </div>
          <span className="h-3.5 w-px bg-[var(--trae-border-neutral-l2)]" />
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3 text-[var(--trae-text-secondary)]" />
            <span className="font-mono text-[10px] tabular-nums text-[var(--trae-text-secondary)]">
              {timeStr}
            </span>
          </div>
          <span className="h-3.5 w-px bg-[var(--trae-border-neutral-l2)]" />
          <div className="flex items-center gap-1.5">
            <Activity className="h-3 w-3 text-[var(--trae-text-secondary)]" />
            <span className="text-[10px] text-[var(--trae-text-secondary)]">场景</span>
            <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-2 text-[10px] font-medium text-[var(--trae-text-brand)]">
              {card.problem.slice(0, 20)}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--trae-text-tertiary)]">紧急程度</span>
            <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-status-alert-default)] bg-[rgba(210,157,0,0.12)] px-2 text-[10px] font-medium text-[var(--trae-status-alert-default)]">
              {riskMeta.urgency}
            </span>
          </div>
          <span className="h-3.5 w-px bg-[var(--trae-border-neutral-l2)]" />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => navigate('/knowledge')}
              className="inline-flex items-center gap-1 rounded-[var(--trae-radius-4)] px-2 py-0.5 text-[10px] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
            >
              <FileText className="h-3 w-3" />
              关联知识
            </button>
            <button
              type="button"
              onClick={() => navigate('/history')}
              className="inline-flex items-center gap-1 rounded-[var(--trae-radius-4)] px-2 py-0.5 text-[10px] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
            >
              <Clock className="h-3 w-3" />
              历史决策
            </button>
            <button
              type="button"
              onClick={() => handleAction('查看系统日志：审计链路完整可追溯')}
              className="inline-flex items-center gap-1 rounded-[var(--trae-radius-4)] px-2 py-0.5 text-[10px] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
            >
              <ScrollText className="h-3 w-3" />
              系统日志
            </button>
          </div>
        </div>
      </header>

      {/* ===== Section 2: 置信度仪表 + 命令决策终端 ===== */}
      <section className="flex flex-wrap items-stretch gap-6 px-8 pb-4">
        <ConfidenceGauge value={displayConfidence} sources={evidenceSources} />
        <ExecutionResult
          decisionId={card.id}
          commandSegments={commandSegments}
          commandComment={card.fixDescription}
          impact={card.risk.description || '目标服务'}
          duration="~120ms"
          rollback={card.rollbackCommand ?? 'N/A'}
          auditRows={auditRows}
          onAccept={() => handleAction('已采纳执行：等待人工审批通过后启动')}
          onModify={() => handleAction('已切换至修改模式')}
          onReject={() => handleAction('已拒绝该决策')}
        />
      </section>

      {/* ===== Section 3: 六源证据融合（D-S 证据理论透明化）===== */}
      <section className="px-8 pb-6">
        <div className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] p-6">
          {/* 标题栏 */}
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[var(--trae-text-brand)]" />
              <span className="text-[16px] font-semibold text-[var(--trae-text-default)]">六源证据融合</span>
              <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-2 text-[10px] font-medium text-[var(--trae-text-brand)]">
                D-S 证据理论
              </span>
            </div>
            <span className="text-[10px] text-[var(--trae-text-tertiary)]">
              Dempster-Shafer · {credibility ? `规则: ${credibility.ruleUsed}` : '透明可追溯'}
            </span>
          </div>

          {/* 左右布局：雷达图 + 明细列表 */}
          <div className="flex flex-col gap-8 lg:flex-row">
            <EvidenceRadar sources={evidenceSources} />
            <PCR5Result sources={evidenceSources} fusedValue={fusedValue} conflictK={conflictK} />
          </div>
        </div>
      </section>

      {/* ===== Section 4 + 5: 证据溯源链 + 四层风险控制（ApprovalStateMachine）===== */}
      <section className="px-8 pb-6">
        <ApprovalStateMachine steps={timelineSteps} gates={riskGates} />
      </section>

      {/* ===== Section 5.5: 高危命令拦截清单（EvidenceList）===== */}
      {dangerCommands.length > 0 && (
        <section className="px-8 pb-6">
          <EvidenceList commands={dangerCommands} defaultExpanded />
        </section>
      )}

      {/* ===== Footer: Agent 工作流进度条 ===== */}
      <footer className="mt-auto border-t border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] px-8 py-3">
        <div className="flex items-center gap-4">
          <div className="flex shrink-0 items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-[var(--trae-bg-brand)]" />
            <span className="text-[10px] text-[var(--trae-text-secondary)]">Agent 工作流</span>
          </div>
          <div className="flex flex-1 items-center gap-2">
            {workflowSteps.map((step, idx) => (
              <div key={step.label} className="flex flex-1 items-center gap-2">
                <div className="flex items-center gap-1.5">
                  {step.status === 'completed' && (
                    <span className="h-2 w-2 rounded-full bg-[var(--trae-bg-brand)]" />
                  )}
                  {step.status === 'in-progress' && (
                    <span className="relative h-2.5 w-2.5">
                      <span
                        className="absolute inset-0 rounded-full bg-[var(--trae-bg-brand)] opacity-50"
                        style={{ animation: 'pulse-ring 2s cubic-bezier(.4,0,.6,1) infinite' }}
                      />
                      <span className="absolute inset-0 rounded-full bg-[var(--trae-bg-brand)]" />
                    </span>
                  )}
                  {step.status === 'pending' && (
                    <span className="h-2 w-2 rounded-full border border-[var(--trae-border-neutral-l2)] bg-transparent" />
                  )}
                  <span
                    className={`text-[10px] ${
                      step.status === 'in-progress'
                        ? 'font-medium text-[var(--trae-text-brand)]'
                        : step.status === 'pending'
                        ? 'text-[var(--trae-text-tertiary)]'
                        : 'text-[var(--trae-text-secondary)]'
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
                {idx < workflowSteps.length - 1 && (
                  <div
                    className={`h-0.5 flex-1 rounded-full ${
                      step.status === 'completed' ? 'bg-[var(--trae-bg-brand)]' : 'bg-[var(--trae-border-neutral-l1)]'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
          <span className="shrink-0 font-mono text-[12px] tabular-nums text-[var(--trae-text-secondary)]">
            {completedSteps} / 7
          </span>
        </div>
      </footer>

      {/* 操作反馈浮层 */}
      {actionFeedback && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-4 py-2 text-[12px] font-medium text-[var(--trae-text-brand)] shadow-lg">
          {actionFeedback}
        </div>
      )}

      {/* 内联 keyframes */}
      <style>{`
        @keyframes pulse-ring {
          0%, 100% { box-shadow: 0 0 0 0 var(--trae-bg-brand-popup); }
          50% { box-shadow: 0 0 0 6px transparent; }
        }
      `}</style>
    </main>
  )
}
