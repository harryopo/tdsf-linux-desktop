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
import { createKbMassFunction } from '../core/agent/credibility/mass-functions/kb-source'
import { createAiParamMassFunction } from '../core/agent/credibility/mass-functions/ai-param-source'
import { createHumanMassFunction } from '../core/agent/credibility/mass-functions/human-source'
import { createHistoryMassFunction } from '../core/agent/credibility/mass-functions/history-source'
import { createBestPracticeMassFunction } from '../core/agent/credibility/mass-functions/best-practice-source'
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
 * 根据 sourceId 分发到对应的 mass function 工厂：
 * - log → createLogMassFunction
 * - kb → createKbMassFunction
 * - ai-param → createAiParamMassFunction
 * - human → createHumanMassFunction
 * - history → createHistoryMassFunction
 * - best-practice → createBestPracticeMassFunction
 *
 * @param input - 证据源输入
 * @returns 对应的 Mass 函数
 * @throws {Error} 未知 sourceId 或字段缺失时抛出
 */
export function createMassFunctionFromInput(input: CredibilityEvidenceInput): MassFunction {
  const f = input.fields

  switch (input.sourceId) {
    case 'log':
      return createLogMassFunction({
        drainMatch: getRequiredNumber(f, 'drainMatch'),
        sourcePrior: getOptionalNumber(f, 'sourcePrior'),
      })

    case 'kb':
      return createKbMassFunction({
        hasResults: getRequiredBoolean(f, 'hasResults'),
        topScore: getOptionalNumber(f, 'topScore'),
        avgScore: getOptionalNumber(f, 'avgScore'),
      })

    case 'ai-param':
      return createAiParamMassFunction({
        verbalizedConfidence: getRequiredNumber(f, 'verbalizedConfidence'),
        logprobConfidence: getOptionalNumber(f, 'logprobConfidence'),
        consistency: getOptionalNumber(f, 'consistency'),
        // v0.9.6 P2 M5+：透传 CoT 熵轨迹
        cotEntropyTrajectory: getOptionalNumberArray(f, 'cotEntropyTrajectory'),
      })

    case 'human':
      return createHumanMassFunction({
        hasAnnotations: getRequiredBoolean(f, 'hasAnnotations'),
        positiveRate: getOptionalNumber(f, 'positiveRate'),
        agreement: getOptionalNumber(f, 'agreement'),
      })

    case 'history':
      return createHistoryMassFunction({
        hasCases: getRequiredBoolean(f, 'hasCases'),
        weightedSuccessRate: getOptionalNumber(f, 'weightedSuccessRate'),
      })

    case 'best-practice':
      return createBestPracticeMassFunction({
        hasMatches: getRequiredBoolean(f, 'hasMatches'),
        positiveRate: getOptionalNumber(f, 'positiveRate'),
        negativeRate: getOptionalNumber(f, 'negativeRate'),
      })

    default: {
      // 穷尽性检查（exhaustive check）
      const exhaustive: never = input.sourceId
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
 * 6 源证据的默认权重映射（业务侧 ID → 算法侧 sourceId）
 *
 * 业务侧权重 key（ConfigStore decision.weights）：
 *   - system-metrics → log（系统指标来自日志）
 *   - knowledge-base → kb（知识库匹配）
 *   - ai-analysis → ai-param（AI 参数化分析）
 *   - human-input → human（人工标注）
 *   - history-match → history（历史案例匹配）
 *   - best-practice → best-practice（最佳实践）
 *
 * 说明：如果 ConfigStore 的权重 key 与此映射不匹配，
 * 会降级到均值权重（保持向后兼容）。
 */
const WEIGHT_KEY_TO_SOURCE_ID: Record<string, string> = {
  'system-metrics': 'log',
  'knowledge-base': 'kb',
  'ai-analysis': 'ai-param',
  'human-input': 'human',
  'history-match': 'history',
  'best-practice': 'best-practice',
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
