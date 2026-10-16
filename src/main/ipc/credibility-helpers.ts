/**
 * Credibility IPC 辅助函数（从 credibility.ts 抽出，保持主文件 ≤500 行）
 *
 * 包含：
 * - 字段提取工具（getRequiredNumber / getOptionalNumber / ...）
 * - Mass 函数创建分发（createMassFunctionFromInput / createMassFunctionsFromInputs）
 * - 序列化工具（serializeMassFunction）
 *
 * 详见主文件 credibility.ts 顶部注释。
 */

import type { MassFunction } from '../core/agent/credibility/ds-theory'
import { applyDiscount } from '../core/agent/credibility/ds-theory'
import { createLogMassFunction } from '../core/agent/credibility/mass-functions/log-source'
import { createKnowledgeMassFunction } from '../core/agent/credibility/mass-functions/knowledge-source'
import { createObservationMassFunction } from '../core/agent/credibility/mass-functions/observation-source'
import { createAiParamMassFunction } from '../core/agent/credibility/mass-functions/ai-param-source'
import { createHumanMassFunction } from '../core/agent/credibility/mass-functions/human-source'
import { createHistoryMassFunction } from '../core/agent/credibility/mass-functions/history-source'
import { createBestPracticeMassFunction } from '../core/agent/credibility/mass-functions/best-practice-source'
import { normalizeFusionSourceId } from '@shared/credibility'
import type {
  CredibilityEvidenceInput,
  SerializableMassFunction,
} from '@shared/agent-types'

// ============================================================================
// 辅助函数：字段提取
// ============================================================================

/**
 * 从 fields 中获取必填 number 字段
 * @throws {Error} 字段缺失或类型错误时抛出
 */
export function getRequiredNumber(fields: Record<string, number | boolean | number[]>, key: string): number {
  const val = fields[key]
  if (typeof val !== 'number') {
    throw new Error(`证据字段 "${key}" 缺失或类型错误（期望 number，实际 ${typeof val}）`)
  }
  return val
}

/**
 * 从 fields 中获取可选 number 字段
 */
export function getOptionalNumber(
  fields: Record<string, number | boolean | number[]>,
  key: string
): number | undefined {
  const val = fields[key]
  return typeof val === 'number' ? val : undefined
}

/**
 * 从 fields 中获取必填 boolean 字段
 * @throws {Error} 字段缺失或类型错误时抛出
 */
export function getRequiredBoolean(
  fields: Record<string, number | boolean | number[]>,
  key: string
): boolean {
  const val = fields[key]
  if (typeof val !== 'boolean') {
    throw new Error(`证据字段 "${key}" 缺失或类型错误（期望 boolean，实际 ${typeof val}）`)
  }
  return val
}

/**
 * 从 fields 中获取可选 number[] 字段（v0.9.6 P2 M5+ 新增）
 *
 * 用于 cotEntropyTrajectory 等序列证据。
 * 不存在返回 undefined；类型错误时抛错（区别于静默忽略）。
 */
export function getOptionalNumberArray(
  fields: Record<string, number | boolean | number[]>,
  key: string
): number[] | undefined {
  const val = fields[key]
  if (val === undefined) return undefined
  if (!Array.isArray(val) || !val.every((v) => typeof v === 'number')) {
    throw new Error(
      `证据字段 "${key}" 类型错误（期望 number[]，实际 ${typeof val}）`
    )
  }
  return val
}

// ============================================================================
// 辅助函数：Mass 函数创建分发
// ============================================================================

/**
 * 根据 CredibilityEvidenceInput 创建对应的 Mass 函数
 *
 * sourceId 先过 normalizeFusionSourceId（旧的 'kb'、审计侧 'S2-knowledge' 等
 * 历史写法归一到唯一一套 id），再按 id 分发到对应工厂：
 * - log → createLogMassFunction
 * - observation → createObservationMassFunction
 * - knowledge → createKnowledgeMassFunction
 * - ai-param → createAiParamMassFunction
 * - human → createHumanMassFunction
 * - history → createHistoryMassFunction
 * - best-practice → createBestPracticeMassFunction
 *
 * 每一档都接收 sourcePrior（可选）：不传则工厂自己按 @shared/credibility 的
 * SOURCE_PRIORS 取默认值。字段"存在但没人读"就是 #106 的原始缺陷，
 * 现在先验一律由工厂消费。
 *
 * @param input - 证据源输入
 * @returns 对应的 Mass 函数
 * @throws {Error} 未知 sourceId 或字段缺失时抛出
 */
export function createMassFunctionFromInput(input: CredibilityEvidenceInput): MassFunction {
  const f = input.fields
  const sourceId = normalizeFusionSourceId(input.sourceId)

  switch (sourceId) {
    case 'log':
      return createLogMassFunction({
        drainMatch: getRequiredNumber(f, 'drainMatch'),
        sourcePrior: getOptionalNumber(f, 'sourcePrior'),
      })

    case 'observation':
      return createObservationMassFunction({
        hasObservations: getRequiredBoolean(f, 'hasObservations'),
        successRate: getOptionalNumber(f, 'successRate'),
        sourcePrior: getOptionalNumber(f, 'sourcePrior'),
      })

    case 'knowledge':
      return createKnowledgeMassFunction({
        hasResults: getRequiredBoolean(f, 'hasResults'),
        topScore: getOptionalNumber(f, 'topScore'),
        avgScore: getOptionalNumber(f, 'avgScore'),
        sourcePrior: getOptionalNumber(f, 'sourcePrior'),
      })

    case 'ai-param':
      return createAiParamMassFunction({
        verbalizedConfidence: getRequiredNumber(f, 'verbalizedConfidence'),
        logprobConfidence: getOptionalNumber(f, 'logprobConfidence'),
        consistency: getOptionalNumber(f, 'consistency'),
        sourcePrior: getOptionalNumber(f, 'sourcePrior'),
        // v0.9.6 P2 M5+：透传 CoT 熵轨迹
        cotEntropyTrajectory: getOptionalNumberArray(f, 'cotEntropyTrajectory'),
      })

    case 'human':
      return createHumanMassFunction({
        hasAnnotations: getRequiredBoolean(f, 'hasAnnotations'),
        positiveRate: getOptionalNumber(f, 'positiveRate'),
        agreement: getOptionalNumber(f, 'agreement'),
        sourcePrior: getOptionalNumber(f, 'sourcePrior'),
      })

    case 'history':
      return createHistoryMassFunction({
        hasCases: getRequiredBoolean(f, 'hasCases'),
        weightedSuccessRate: getOptionalNumber(f, 'weightedSuccessRate'),
        sourcePrior: getOptionalNumber(f, 'sourcePrior'),
      })

    case 'best-practice':
      return createBestPracticeMassFunction({
        hasMatches: getRequiredBoolean(f, 'hasMatches'),
        positiveRate: getOptionalNumber(f, 'positiveRate'),
        negativeRate: getOptionalNumber(f, 'negativeRate'),
        sourcePrior: getOptionalNumber(f, 'sourcePrior'),
      })

    default: {
      // 穷尽性检查（exhaustive check）
      const exhaustive: never = sourceId
      throw new Error(`未知的证据来源 ID: ${String(exhaustive)}`)
    }
  }
}

// ============================================================================
// 辅助函数：序列化
// ============================================================================

/**
 * 将内部 Mass 函数（Map-based）序列化为可 IPC 传输的形式（Array-based）
 *
 * @param mf - 内部 Mass 函数
 * @returns 序列化后的 Mass 函数
 */
export function serializeMassFunction(mf: MassFunction): SerializableMassFunction {
  return {
    sourceId: mf.sourceId,
    sourceName: mf.sourceName,
    confidence: mf.confidence,
    focalElements: Array.from(mf.focalElements.entries())
      .map(([elements, mass]) => ({ elements, mass }))
      .sort((a, b) => b.mass - a.mass), // 按质量降序
  }
}

/**
 * 将证据源输入列表转换为 Mass 函数列表
 *
 * @param inputs - 证据源输入列表
 * @returns Mass 函数列表
 */
export function createMassFunctionsFromInputs(inputs: CredibilityEvidenceInput[]): MassFunction[] {
  return inputs.map((input) => createMassFunctionFromInput(input))
}

// ============================================================================
// 6 源权重应用（Shafer Discounting）
// ============================================================================
//
// 论文支撑：Shafer, G. 1976, "A Mathematical Theory of Evidence",
//           Princeton University Press, Chapter 9 §Discounting
//
// 在融合前对每个证据源独立应用权重折扣，符合 D-S 公理。
// 替代旧版"在融合结果上叠加线性调整"的降级方案（P1-7 修复）。
// ============================================================================

/**
 * 各源权重映射（业务侧权重 key → 融合源 sourceId）
 *
 * 业务侧权重 key 以唯一写入方 `DecisionSettings` 的 EVIDENCE_SOURCES 为准：
 *   - system-metrics  → observation（命令/指标/配置读数）
 *   - log-analysis    → log（日志模板匹配）
 *   - knowledge-base  → knowledge（知识库检索）
 *   - model-inference → ai-param（模型自评等参数证据）
 *   - human-experience→ human（人工标注）
 *   - history-match   → history（历史案例）
 *
 * #106 修的洞：这张表原来写的是 'ai-analysis' / 'human-input' / 'best-practice'，
 * 而界面只写 system-metrics / history-match / knowledge-base / log-analysis /
 * human-experience / model-inference —— 六个滑条里有三个改了没人在读，
 * 两个读的名字从来没人写过，剩下全靠"均值权重"兜底。
 *
 * 说明：仍留在映射表外的 key 会降级到均值权重（保持向后兼容）。
 */
const WEIGHT_KEY_TO_SOURCE_ID: Record<string, string> = {
  'system-metrics': 'observation',
  'log-analysis': 'log',
  'knowledge-base': 'knowledge',
  'model-inference': 'ai-param',
  'human-experience': 'human',
  'history-match': 'history',
}

/**
 * 对 Mass 函数列表应用 Shafer Discounting 权重折扣
 *
 * 读取 ConfigStore 的 decision.weights 配置，按业务侧 ID 映射到算法侧 sourceId，
 * 对每个 Mass 函数应用对应的权重折扣。
 *
 * 论文支撑：Shafer 1976 §Discounting
 *
 * 权重归一化：ConfigStore 中权重值为 0-100（业务侧刻度），
 *            除以 100 归一化到 [0, 1]（算法侧刻度）。
 *
 * 降级策略：
 *   1. 若 weightsConfig 无有效数值权重，返回原列表（不折扣）
 *   2. 若某 sourceId 在映射表中找不到对应权重 key，使用均值权重（保持向后兼容）
 *
 * @param massFunctions - 原始 Mass 函数列表
 * @param weightsConfig - 权重配置（业务侧 ID → 权重值 0-100）
 * @returns 折扣后的 Mass 函数列表（原列表不变，返回新数组）
 */
export function applyWeightsToMassFunctions(
  massFunctions: MassFunction[],
  weightsConfig: Record<string, unknown>,
): MassFunction[] {
  // 1) 提取数值权重并归一化到 [0, 1]（ConfigStore 权重刻度为 0-100）
  const numericWeights: Record<string, number> = {}
  for (const [key, value] of Object.entries(weightsConfig)) {
    if (typeof value === 'number' && value >= 0) {
      numericWeights[key] = Math.min(value / 100, 1)
    }
  }

  // 2) 如果没有有效权重，返回原列表（不折扣，保持向后兼容）
  if (Object.keys(numericWeights).length === 0) {
    return massFunctions
  }

  // 3) 预计算均值权重（用于 sourceId 未在映射表中的降级场景）
  const weightValues = Object.values(numericWeights)
  const avgWeight = weightValues.reduce((s, w) => s + w, 0) / weightValues.length

  // 4) 对每个 Mass 函数应用对应权重
  return massFunctions.map((mf) => {
    // 查找该 sourceId 对应的业务侧权重 key
    const weightKey = Object.entries(WEIGHT_KEY_TO_SOURCE_ID).find(
      ([, sourceId]) => sourceId === mf.sourceId,
    )?.[0]

    if (weightKey && numericWeights[weightKey] !== undefined) {
      // 命中映射：用对应权重
      return applyDiscount(mf, numericWeights[weightKey])
    }

    // 未命中映射：降级到均值权重（保持向后兼容）
    return applyDiscount(mf, avgWeight)
  })
}
