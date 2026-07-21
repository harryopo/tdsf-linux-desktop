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
