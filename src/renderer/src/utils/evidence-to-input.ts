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
 * 映射规则（#82 起"没有真实数据的源不送"；#106 B 起按融合源分组）：
 * - log：仅当证据里真有 source='log' 且有模板匹配度时送出，取 drainMatch/sourcePrior 均值
 * - observation：command/metric/config 这三类**直接观测**归这里（旧代码把它们当 history 的
 *   weightedSuccessRate 送，等于把"命令跑完了、退出码 0"改名成"历史案例成功率"），
 *   successRate 取真实观测到的 verified 比例
 * - knowledge：仅当有知识库证据时送出，topScore/avgScore 取该组证据的 confidence
 *   最高值与均值（这一档在聊天链路能拿到的真实分数就是证据自带的 confidence，
 *   不再冒充向量相似度里的 top-3）
 * - ai-param：仅当调用方给了真实 verbalizedConfidence 时送出，
 *   logprob/consistency 采到才带（不再默认 0.7）
 * - human：hasAnnotations=false → 真空 mass，保留占位意义
 * - history / best-practice：本链路没有历史案例库和规则库的命中数据，不送
 *   （融合层对"无数据"现在也返回真空 mass，不再凭空给 0.1 / 0.2 信念）
 *
 * 类别 → 源的那张表在 @shared/credibility（EVIDENCE_CATEGORY_TO_SOURCE），
 * 这里不另抄一份，也不写兜底。
 *
 * 方案书依据：v0.9 §可信度算法升级（D-S + PCR5 + 多源证据融合）
 */

import type { Evidence } from '@shared/models'
import type { CredibilityEvidenceInput } from '@shared/agent-types'
import { EVIDENCE_CATEGORY_TO_SOURCE, type FusionSourceId } from '@shared/credibility'

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
 *
 * 只把"真有这个数"的条目计进分母：`drainMatch` 现在允许 null（命令/指标类没有模板维度），
 * 按 0 计入等于凭空把该源的可信度拉低——那是量具自己造的偏差，不是证据弱。
 * 一条都没有时返回 0，由调用方决定送不送这个源。
 */
function avgByField(
  evidences: Evidence[],
  predicate: (e: Evidence) => boolean,
  field: keyof Evidence
): number {
  const values = evidences
    .filter(predicate)
    .map((e) => e[field])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (values.length === 0) return 0
  return values.reduce((acc, v) => acc + v, 0) / values.length
}

/**
 * 按融合源给证据分组
 *
 * 分组依据是 @shared/credibility 那张唯一映射表；库里存着认不出来的来源
 * （历史脏数据）直接跳过——不猜它属于哪个源，也不按序号塞。
 */
function groupByFusionSource(evidences: Evidence[]): Map<FusionSourceId, Evidence[]> {
  const groups = new Map<FusionSourceId, Evidence[]>()
  for (const e of evidences) {
    const sourceId = EVIDENCE_CATEGORY_TO_SOURCE[e.source]
    if (!sourceId) continue
    const list = groups.get(sourceId)
    if (list) list.push(e)
    else groups.set(sourceId, [e])
  }
  return groups
}

/**
 * 构造证据源输入（七源位，但只填真有数据的那几个）
 *
 * @param ctx 决策上下文
 * @returns CredibilityEvidenceInput[] 数组（按 log → observation → knowledge → ai-param → human 固定顺序）
 */
export function buildCredibilityInputs(ctx: DecisionContext): CredibilityEvidenceInput[] {
  const { evidences, llmVerbalized, llmConsistency, llmLogprob, cotEntropyTrajectory } = ctx
  const groups = groupByFusionSource(evidences)

  const inputs: CredibilityEvidenceInput[] = []

  // ===== 日志证据 =====
  // 只在真有日志证据时送出：聊天工具轨迹的来源多是 command/metric/knowledge，
  // 旧代码在这种情况下补 0.5/0.5 当一个日志源，等于凭空造一份带权重的"假证据"。
  const logEvidences = groups.get('log') ?? []
  if (logEvidences.length > 0) {
    inputs.push({
      sourceId: 'log',
      fields: {
        drainMatch: clamp01(avgByField(logEvidences, () => true, 'drainMatch')),
        sourcePrior: clamp01(avgByField(logEvidences, () => true, 'sourcePrior')),
      },
    })
  }

  // ===== 直接观测证据 =====
  // command / metric / config 归这一档。旧实现把它们整包改名叫 history 的
  // weightedSuccessRate（"本次证据的 confidence 均值"），于是融合里出现的
  // "历史案例成功率"其实是"这条命令跑成功了"——数字没错，名字和权重全错。
  // 这里送的是真实测到的量：verified（退出码 0 / 读到数）占了几成。
  const observations = groups.get('observation') ?? []
  if (observations.length > 0) {
    const verifiedCount = observations.filter((e) => e.verified).length
    inputs.push({
      sourceId: 'observation',
      fields: {
        hasObservations: true,
        successRate: verifiedCount / observations.length,
      },
    })
  }

  // ===== 知识库证据 =====
  // 只把"真的回了东西"的那几条算进来：空返回的 knowledge 证据在 hasResults 这一维上
  // 就是 false，凑成一个"有结果"的源等于把没查到说成查到了。
  // topScore/avgScore 取该组证据自带的 confidence（最高 / 均值）。
  // 口径说清楚：这一路没有向量相似度分数，能送的只有"这条检索被评了多少分"，
  // 所以 knowledge 档的先验（0.5）会把它折到融合里的占比压住。
  const kbEvidences = (groups.get('knowledge') ?? []).filter((e) => e.verified)
  if (kbEvidences.length > 0) {
    const scores = kbEvidences.map((e) => clamp01(e.confidence))
    inputs.push({
      sourceId: 'knowledge',
      fields: {
        hasResults: true,
        topScore: Math.max(...scores),
        avgScore: clamp01(avgByField(kbEvidences, () => true, 'confidence')),
      },
    })
  }

  // ===== AI 参数证据 =====
  // verbalizedConfidence 是主进程必填项，也是"模型自报置信度"——只有调用方真的给过才送。
  // logprob / consistency 同理：没采到就不带字段（主进程按可选处理），不写 0.7 兜底。
  if (llmVerbalized !== undefined) {
    const aiFields: Record<string, number | boolean | number[]> = {
      verbalizedConfidence: clamp01(llmVerbalized),
    }
    if (llmLogprob !== undefined) aiFields.logprobConfidence = clamp01(llmLogprob)
    if (llmConsistency !== undefined) aiFields.consistency = clamp01(llmConsistency)
    // v0.9.6 P2 M5+：有轨迹时叠加 CoT-shape（第 4 路信号）
    // 注意：轨迹单独不构成 AI 参数源（主进程要求 verbalizedConfidence 必填），
    //     没有自评只有轨迹时，轨迹仍由 ChatCredibility 的 CoT 分析块单独展示。
    if (cotEntropyTrajectory !== undefined && cotEntropyTrajectory.length > 0) {
      aiFields.cotEntropyTrajectory = cotEntropyTrajectory
    }
    inputs.push({ sourceId: 'ai-param', fields: aiFields })
  }

  // ===== 人工证据 =====
  // Chat 流程默认无标注，hasAnnotations=false → 主进程返回真空 mass（不产生信念，安全）
  inputs.push({
    sourceId: 'human',
    fields: {
      hasAnnotations: false,
    },
  })

  // ===== 历史 / 最佳实践 =====
  // 本链路既没有历史案例库的命中，也没有 YAML 规则库的命中，所以两档都不送。
  // #106 B 之后主进程对 hasCases=false / hasMatches=false 也返回真空 mass，
  // 但既然连输入都没有，就不必再占一个源位。

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
