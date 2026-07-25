/**
 * Evidence → CredibilityEvidenceInput 映射工具
 *
 * 职责：将 DecisionCard 的 Evidence[] 列表转换为可信度评估所需的 6 源证据输入。
 *
 * 论文支撑：
 * - 调研文档 §6.3（6 源 Mass 函数定义）
 * - Shafer 1976（D-S 证据理论）
 * - Smarandache & Dezert 2004（PCR5）
 *
 * 映射规则（基于 evidence.source + card 元数据）：
 * - S1 日志（log）：直接使用 drainMatch + sourcePrior
 * - S2 知识库（knowledge）：使用 topScore + avgScore
 * - S3 AI 参数：基于 card.confidence（verbalized）+ consistency
 * - S4 人工：默认无标注（chat 流程）
 * - S5 历史：基于 evidence 数量 + 加权平均 confidence
 * - S6 最佳实践：默认（chat 流程无规则上下文）
 *
 * 方案书依据：v0.9 §可信度算法升级（D-S + PCR5 + 6 源证据融合）
 */

import type { Evidence } from '@shared/models'
import type { CredibilityEvidenceInput, CredibilitySourceId } from '@shared/agent-types'

/**
 * DecisionCard 元数据（用于构造 6 源输入）
 *
 * 注：DecisionCard 本身不直接持有这些字段，需要从 props/上下文推断
 */
export interface DecisionContext {
  /** 决策卡片 ID（用于触发重算） */
  cardId: string
  /** 证据列表 */
  evidences: Evidence[]
  /** LLM 单一置信度 [0, 1]（来自 card.confidence） */
  llmVerbalized: number
  /** 是否有流式一致性数据（默认 0.7） */
  llmConsistency?: number
  /** 是否有 logprob（默认 0.7） */
  llmLogprob?: number
  /**
   * CoT 熵轨迹（v0.9.6 P2 M5+ 新增，可选）
   *
   * 透传路径：ChatResult.cotEntropyTrajectory → DecisionContext.cotEntropyTrajectory
   *   → buildCredibilityInputs → S3 ai-param.fields.cotEntropyTrajectory
   *   → IPC → createAiParamMassFunction → CoT-shape 融合
   *
   * 数据来源（由 CotTraceCollector 在主进程收集）：
   * 1. Anthropic Claude thinking block（最高优先级）
   * 2. Reasoning model 多 turn（次优先级）
   * 3. 文本启发式 fallback（按句子切分）
   *
   * 论文依据：Zhao 2026, arXiv:2603.18940
   */
  cotEntropyTrajectory?: number[]
}

/** 限制值到 [0, 1] */
function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.max(0, Math.min(1, v))
}

/**
 * 从证据列表中过滤并取均值（NaN 安全）
 */
function avgByField(
  evidences: Evidence[],
  predicate: (e: Evidence) => boolean,
  field: keyof Evidence
): number {
  const matched = evidences.filter(predicate)
  if (matched.length === 0) return 0
  const sum = matched.reduce((acc, e) => acc + (Number(e[field]) || 0), 0)
  return sum / matched.length
}

/**
 * 构造 6 源证据输入
 *
 * @param ctx 决策上下文
 * @returns CredibilityEvidenceInput[] 数组（6 个源，按固定顺序）
 */
export function buildCredibilityInputs(ctx: DecisionContext): CredibilityEvidenceInput[] {
  const { evidences, llmVerbalized, llmConsistency = 0.7, llmLogprob = 0.7, cotEntropyTrajectory } = ctx

  // ===== S1 日志证据 =====
  const logEvidences = evidences.filter((e) => e.source === 'log')
  const s1DrainMatch = clamp01(avgByField(logEvidences, () => true, 'drainMatch'))
  const s1SourcePrior = clamp01(avgByField(logEvidences, () => true, 'sourcePrior'))
  const s1Input: CredibilityEvidenceInput = {
    sourceId: 'log' as CredibilitySourceId,
    fields: {
      drainMatch: logEvidences.length > 0 ? s1DrainMatch : 0.5,
      sourcePrior: logEvidences.length > 0 ? s1SourcePrior : 0.5,
    },
  }

  // ===== S2 知识库证据 =====
  const kbEvidences = evidences.filter((e) => e.source === 'knowledge')
  const kbTopScore = clamp01(avgByField(kbEvidences, () => true, 'drainMatch'))
  const kbAvgScore = clamp01(avgByField(kbEvidences, () => true, 'confidence'))
  const s2Input: CredibilityEvidenceInput = {
    sourceId: 'kb' as CredibilitySourceId,
    fields: {
      hasResults: kbEvidences.length > 0,
      topScore: kbTopScore,
      avgScore: kbAvgScore,
    },
  }

  // ===== S3 AI 参数证据 =====
  // v0.9.6 P2 M5+：附加 cotEntropyTrajectory 到 S3 fields（可选）
  //  - 不传时 createAiParamMassFunction 走 v0.9.6 P1 行为
  //  - 传时走 4 路融合（verbalized + logprob + consistency + CoT-shape）
  const s3Fields: Record<string, number | boolean | number[]> = {
    verbalizedConfidence: clamp01(llmVerbalized),
    logprobConfidence: clamp01(llmLogprob),
    consistency: clamp01(llmConsistency),
  }
  if (cotEntropyTrajectory !== undefined && cotEntropyTrajectory.length > 0) {
    s3Fields.cotEntropyTrajectory = cotEntropyTrajectory
  }
  const s3Input: CredibilityEvidenceInput = {
    sourceId: 'ai-param' as CredibilitySourceId,
    fields: s3Fields,
  }

  // ===== S4 人工证据 =====
  // Chat 流程默认无标注，hasAnnotations=false
  const s4Input: CredibilityEvidenceInput = {
    sourceId: 'human' as CredibilitySourceId,
    fields: {
      hasAnnotations: false,
      positiveRate: 0.5,
      agreement: 0.5,
    },
  }

  // ===== S5 历史证据 =====
  // 用 evidence 列表长度作为案例数估计，加权平均 confidence 作为成功率
  const allVerified = evidences.filter((e) => e.verified)
  const allConfidence = clamp01(avgByField(evidences, () => true, 'confidence'))
  const s5Input: CredibilityEvidenceInput = {
    sourceId: 'history' as CredibilitySourceId,
    fields: {
      hasCases: evidences.length > 0,
      weightedSuccessRate: allVerified.length > 0
        ? clamp01(avgByField(allVerified, () => true, 'confidence'))
        : allConfidence,
    },
  }

  // ===== S6 最佳实践证据 =====
  // Chat 流程默认无规则上下文
  const s6Input: CredibilityEvidenceInput = {
    sourceId: 'best-practice' as CredibilitySourceId,
    fields: {
      hasMatches: false,
      positiveRate: 0.5,
      negativeRate: 0.5,
    },
  }

  return [s1Input, s2Input, s3Input, s4Input, s5Input, s6Input]
}

/**
 * 输入指纹（用于去重）
 *
 * 当 evidence 列表内容未变时，避免重复调用 credibilityAssess。
 * v0.9.6 P2 M5+：把 cotEntropyTrajectory 纳入指纹，CoT 轨迹变化时触发重算。
 */
export function fingerprint(ctx: DecisionContext): string {
  const evidenceSig = ctx.evidences
    .map((e) => `${e.id}:${e.confidence.toFixed(2)}:${e.verified ? 1 : 0}`)
    .join('|')
  const cotSig = ctx.cotEntropyTrajectory
    ? ctx.cotEntropyTrajectory.map((v) => v.toFixed(3)).join(',')
    : 'none'
  return `${ctx.cardId}|${ctx.llmVerbalized.toFixed(2)}|${evidenceSig}|cot:${cotSig}`
}
