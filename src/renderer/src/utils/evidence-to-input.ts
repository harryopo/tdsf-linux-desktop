/**
 * Evidence → CredibilityEvidenceInput 映射工具
 *
 * 职责：将 DecisionCard 的 Evidence[] 列表转换为可信度评估所需的证据源输入。
 *
 * 论文支撑：
 * - 调研文档 §6.3（6 源 Mass 函数定义）
 * - Shafer 1976（D-S 证据理论）
 * - Smarandache & Dezert 2004（PCR5）
 *
 * 映射规则（#82 起：没有真实数据的源不送，避免常数变成融合里的假信念）：
 * - S1 日志（log）：仅当证据里真有 source='log' 时送出，取 drainMatch/sourcePrior 均值
 * - S2 知识库（kb）：始终送；无命中时 hasResults=false，主进程返回真空 mass（不产生信念）
 * - S3 AI 参数（ai-param）：仅当调用方给了真实 verbalizedConfidence 时送出，
 *   logprob/consistency 采到才带（不再默认 0.7）
 * - S4 人工（human）：hasAnnotations=false → 真空 mass，保留占位意义
 * - S5 历史（history）：仅当有证据时送出（主进程对 hasCases=false 仍会给 0.1 信念，故不送）
 * - S6 最佳实践（best-practice）：这两个 builder 都没有规则命中数据，不送
 *   （主进程对 hasMatches=false 给 m({T})=0.2，那是凭空信念）
 *
 * 方案书依据：v0.9 §可信度算法升级（D-S + PCR5 + 6 源证据融合）
 */

import type { Evidence } from '@shared/models'
import type { CredibilityEvidenceInput } from '@shared/agent-types'

/**
 * DecisionCard 元数据（用于构造证据源输入）
 *
 * 注：DecisionCard 本身不直接持有这些字段，需要从 props/上下文推断
 */
export interface DecisionContext {
  /** 决策卡片 ID（用于触发重算） */
  cardId: string
  /** 证据列表 */
  evidences: Evidence[]
  /**
   * LLM 自评置信度 [0, 1]（来自 card.confidence 或模型真实自评）
   *
   * #82 起为可选：聊天主链路目前没有向模型要过自评，
   * 传了才送 S3，不传就不把常数当证据喂进融合（旧代码硬塞 0.7，
   * 而 verbalizedConfidence 在 mass 函数里会变成 committed belief）。
   */
  llmVerbalized?: number
  /** 流式一致性（多次采样时才有；没采到就不送，不补默认值） */
  llmConsistency?: number
  /** logprob 置信度（API 暴露 logprobs 才有；没采到就不送，不补默认值） */
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
 * 构造证据源输入（六个源位，但只填真是有数据的那几个）
 *
 * @param ctx 决策上下文
 * @returns CredibilityEvidenceInput[] 数组（6 个源，按固定顺序）
 */
export function buildCredibilityInputs(ctx: DecisionContext): CredibilityEvidenceInput[] {
  const { evidences, llmVerbalized, llmConsistency, llmLogprob, cotEntropyTrajectory } = ctx

  const inputs: CredibilityEvidenceInput[] = []

  // ===== S1 日志证据 =====
  // 只在真有日志证据时送出：聊天工具轨迹的来源是 command/metric/knowledge，
  // 旧代码在这种情况下补 0.5/0.5 当一个日志源，等于凭空造一份带权重的"假证据"。
  const logEvidences = evidences.filter((e) => e.source === 'log')
  if (logEvidences.length > 0) {
    inputs.push({
      sourceId: 'log',
      fields: {
        drainMatch: clamp01(avgByField(logEvidences, () => true, 'drainMatch')),
        sourcePrior: clamp01(avgByField(logEvidences, () => true, 'sourcePrior')),
      },
    })
  }

  // ===== S2 知识库证据 =====
  const kbEvidences = evidences.filter((e) => e.source === 'knowledge')
  const kbTopScore = clamp01(avgByField(kbEvidences, () => true, 'drainMatch'))
  const kbAvgScore = clamp01(avgByField(kbEvidences, () => true, 'confidence'))
  inputs.push({
    sourceId: 'kb',
    fields: {
      hasResults: kbEvidences.length > 0,
      topScore: kbTopScore,
      avgScore: kbAvgScore,
    },
  })

  // ===== S3 AI 参数证据 =====
  // verbalizedConfidence 是主进程必填项，也是"模型自报置信度"——只有调用方真的给过才送。
  // logprob / consistency 同理：没采到就不带字段（主进程按可选处理），不写 0.7 兜底。
  if (llmVerbalized !== undefined) {
    const s3Fields: Record<string, number | boolean | number[]> = {
      verbalizedConfidence: clamp01(llmVerbalized),
    }
    if (llmLogprob !== undefined) s3Fields.logprobConfidence = clamp01(llmLogprob)
    if (llmConsistency !== undefined) s3Fields.consistency = clamp01(llmConsistency)
    // v0.9.6 P2 M5+：有轨迹时叠加 CoT-shape（第 4 路信号）
    // 注意：轨迹单独不构成 S3（主进程要求 verbalizedConfidence 必填），
    //     没有自评只有轨迹时，轨迹仍由 ChatCredibility 的 CoT 分析块单独展示。
    if (cotEntropyTrajectory !== undefined && cotEntropyTrajectory.length > 0) {
      s3Fields.cotEntropyTrajectory = cotEntropyTrajectory
    }
    inputs.push({ sourceId: 'ai-param', fields: s3Fields })
  }

  // ===== S4 人工证据 =====
  // Chat 流程默认无标注，hasAnnotations=false → 主进程返回真空 mass（不产生信念，安全）
  inputs.push({
    sourceId: 'human',
    fields: {
      hasAnnotations: false,
    },
  })

  // ===== S5 历史证据 =====
  // 用本次真实证据的案例数 + 加权平均 confidence；无证据时不送
  //（主进程对 hasCases=false 会给 m({T})=0.1，那是没有数据时的 10% 凭空信念）
  if (evidences.length > 0) {
    const allVerified = evidences.filter((e) => e.verified)
    const allConfidence = clamp01(avgByField(evidences, () => true, 'confidence'))
    inputs.push({
      sourceId: 'history',
      fields: {
        hasCases: true,
        weightedSuccessRate:
          allVerified.length > 0
            ? clamp01(avgByField(allVerified, () => true, 'confidence'))
            : allConfidence,
      },
    })
  }

  // ===== S6 最佳实践证据 =====
  // 这两个 builder 的输入里都没有规则匹配数据（chat 工具轨迹/决策卡证据都不是最佳实践命中），
  // 而主进程对 hasMatches=false 仍给 m({T})=0.2 —— 送它等于塞一份 20% 的假信念，所以不送。
  // 将来真有 best-practice 源时，在这里按 hasMatches:true + 命中率补一条。

  return inputs
}

/**
 * 输入指纹（用于去重）
 *
 * 当 evidence 列表内容未变时，避免重复调用 credibilityAssess。
 */
export function fingerprint(ctx: DecisionContext): string {
  const evidenceSig = ctx.evidences
    .map((e) => `${e.id}:${e.confidence.toFixed(2)}:${e.verified ? 1 : 0}`)
    .join('|')
  // #82：自评分变可选（聊天路径没有真实自评），没给就用 '-' 占位，不能 .toFixed(undefined)
  const verbSig = ctx.llmVerbalized === undefined ? '-' : ctx.llmVerbalized.toFixed(2)
  return `${ctx.cardId}|${verbSig}|${evidenceSig}`
}
