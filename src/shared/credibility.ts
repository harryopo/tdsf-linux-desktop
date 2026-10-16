/**
 * 可信度融合的唯一一张源表（#106 · B 方案）
 *
 * 改之前的现状（三套词表、一条假映射、一个随机兜底）：
 * - 主进程 mass 函数认 6 个 id：log / kb / ai-param / human / history / best-practice
 * - 业务侧证据分 5 类：log / metric / command / config / knowledge
 * - 审计侧又是第三套：S1-log / S2-knowledge / … / S6-best-practice
 * 于是"命令输出"被映射成 S4-human（注释写的是"命令通常由人工触发"），
 * "指标读数"被映射成 S3-ai-param（把系统读数当成模型自评），
 * 映射不到的按 `idx % 6` 随机塞进某个源。三份先验常量里五份从没进过计算，
 * 聊天链路自己手抄一份先验（知识 0.75 vs 表里 0.5），两边各说各话。
 *
 * 这里定一条唯一口径：
 * 1. 融合源只有一套 id，先验只有一张表，展示名也只有一处
 * 2. 证据类别 → 融合源是**显式全映射**，没有兜底循环；映射不到就是编程错误，抛出来
 * 3. 先验必须真的进计算（见 applySourcePrior），不再是写在注释里的装饰
 */
import type { EvidenceSource } from './models'

/** 融合源 id（唯一一套；旧的 'kb' 通过 normalize 归到 'knowledge'） */
export const FUSION_SOURCE_IDS = [
  'log',
  'observation',
  'knowledge',
  'ai-param',
  'human',
  'history',
  'best-practice',
] as const

export type FusionSourceId = (typeof FUSION_SOURCE_IDS)[number]

/**
 * 新增的 observation 档补的是原设计的洞：6 源里没有一个装得下"命令跑完了、退出码 0、
 * 输出就摆在这"这类**直接观测**——它既不是日志模板匹配，也不是历史案例。
 * 以前把命令塞给 human、指标塞给 ai-param，是把最强的一类证据改名成最弱的一类。
 */
export const FUSION_SOURCE_LABELS: Record<FusionSourceId, string> = {
  log: '日志证据',
  observation: '直接观测证据',
  knowledge: '知识库匹配',
  'ai-param': 'AI 参数证据',
  human: '人工证据',
  history: '历史证据',
  'best-practice': '最佳实践证据',
}

/**
 * 来源标不出来时用的档位（只给审计报告用，不参与融合）
 *
 * 以前映射不到的证据按 `idx % 6` 塞进某个源——审计报告于是宣称"这条证据来自人工标注"，
 * 而它其实只是没写来源。宁可让报告说"来源未标注"，也不要编一个来源。
 * 这个 id 没有先验、没有 mass 函数，喂进融合会直接被 normalizeFusionSourceId 拒掉。
 */
export const UNSPECIFIED_SOURCE_ID = 'unspecified' as const
export const UNSPECIFIED_SOURCE_LABEL = '来源未标注'

/**
 * 各源先验可信度 [0,1]
 *
 * 口径：这个源**在没有其它信息时**值多少分，用来折扣它给出的证据质量。
 * - observation 0.9：命令真实执行后的退出码与输出是系统给的事实，不是推断
 * - log 0.6：Drain3 模板匹配可能命中到错误模板
 * - knowledge 0.5：知识库需额外验证，可能过时或不完全匹配
 * - ai-param 0.7：模型自报置信度有系统性过度自信偏置
 * - human 0.9 / history 0.75 / best-practice 0.8：沿用原六个模块注释里各自的定标
 */
export const SOURCE_PRIORS: Record<FusionSourceId, number> = {
  log: 0.6,
  observation: 0.9,
  knowledge: 0.5,
  'ai-param': 0.7,
  human: 0.9,
  history: 0.75,
  'best-practice': 0.8,
}

/**
 * 证据类别级先验（另一层，别和上面那张混用）
 *
 * 两张表回答的是两个问题：
 * - SOURCE_PRIORS：**这一类源**在融合里值多少权重（融合出口打折用）
 * - EVIDENCE_CATEGORY_PRIORS：**这一条证据**本身值多少分
 *   （单条证据没有"模板匹配度"那一维时，界面上的置信度就直接取它，见 src/main/core/confidence.ts）
 *
 * 同一个观测档里三个类别分数不同（命令 0.9 / 指标 0.8 / 配置 0.7），
 * 是因为"读到的是什么"影响单条证据的分量；进融合时它们同属观测源，按源打折。
 *
 * #106 修的洞：这张表原来只存在于主进程（src/main/core/confidence.ts），
 * 渲染层拿不到就手抄一份（知识类抄成 0.75，表里是 0.5），两份数分叉且无人对账。
 * 现在两边都从这里读，抄不了也分不了。
 */
export const EVIDENCE_CATEGORY_PRIORS: Record<EvidenceSource, number> = {
  log: 0.6,
  metric: 0.8,
  command: 0.9,
  config: 0.7,
  knowledge: 0.5,
}

/** 取某证据类别的先验（类别不认识就抛错，不返回 undefined 让调用方自己兜底） */
export function evidencePriorOf(source: EvidenceSource): number {
  const prior = EVIDENCE_CATEGORY_PRIORS[source]
  if (prior === undefined) {
    throw new Error(`未知证据类别：${String(source)}（新增类别要同时补类别先验表与源映射表）`)
  }
  return prior
}

/**
 * 业务侧证据类别 → 融合源（显式全覆盖，缺一个类型 TS 就报错）
 *
 * metric / command / config 都归 observation：三者共同点是"系统直接给出的读数"，
 * 差别只在读的是什么，不影响它在融合里的身份。
 */
export const EVIDENCE_CATEGORY_TO_SOURCE: Record<EvidenceSource, FusionSourceId> = {
  log: 'log',
  metric: 'observation',
  command: 'observation',
  config: 'observation',
  knowledge: 'knowledge',
}

/** 历史写进库/审计的旧 id，读进来时归一；不给未知值兜底 */
const LEGACY_SOURCE_ALIASES: Record<string, FusionSourceId> = {
  kb: 'knowledge',
  // 审计侧带 S 前缀的那套也收敛回来
  'S1-log': 'log',
  'S2-knowledge': 'knowledge',
  'S3-ai-param': 'ai-param',
  'S4-human': 'human',
  'S5-history': 'history',
  'S6-best-practice': 'best-practice',
}

/**
 * 归一化源 id（旧数据与旧通道都用它）
 *
 * 未知 id 抛错而不是"按序号塞进某个源"：随机兜底会把一份不认识的证据
 * 变成某个源的信念，而那正是这套算法最该避免的错误。
 */
export function normalizeFusionSourceId(raw: string): FusionSourceId {
  const alias = LEGACY_SOURCE_ALIASES[raw]
  if (alias) return alias
  if ((FUSION_SOURCE_IDS as readonly string[]).includes(raw)) return raw as FusionSourceId
  throw new Error(`未知证据源 id：${raw}（新增源要同时补先验表与质量算法）`)
}

/** 取某源先验（未知 id 走 normalize，同样抛错） */
export function sourcePriorOf(raw: string): number {
  return SOURCE_PRIORS[normalizeFusionSourceId(raw)]
}

/**
 * 先验折扣：证据质量 × 该源先验
 *
 * 唯一例外是 log 档——它的先验已经在自己那条定标过的加法式里
 * （strength = 0.7×模板匹配 + 0.3×先验），再乘一次就是把同一个先验数两遍。
 * 除此之外每一档都必须经过这里，"有先验这个字段"和"先验参与计算"是两件事。
 */
export function applySourcePrior(quality: number, prior: number): number {
  const q = Number.isFinite(quality) ? Math.min(1, Math.max(0, quality)) : 0
  const p = Number.isFinite(prior) ? Math.min(1, Math.max(0, prior)) : 0
  return q * p
}
