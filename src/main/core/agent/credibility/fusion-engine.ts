/**
 * 证据融合引擎（Fusion Engine）
 *
 * 实现 D-S 证据理论 + PCR5 冲突融合的自适应组合策略：
 * - 冲突系数 k < 0.3 时使用 Dempster 组合规则（低冲突场景，计算高效）
 * - 冲突系数 k ≥ 0.3 时使用 PCR5 规则（高冲突场景，避免 Zadeh 悖论）
 *
 * 冲突阈值 0.3 参考 sift-kernel（数字取证 MCP 服务器）的经验值。
 *
 * 调研文档：d:\ai\linux教学一体\idea-to-dev-output\22-可信度算法论文支撑调研.md §6.4 + §4
 *
 * 融合流程：
 * 1. 接收 6 源证据的 Mass 函数列表
 * 2. 两两迭代组合：m_12 = combine(m_1, m_2), m_123 = combine(m_12, m_3), ...
 * 3. 每步根据冲突系数自适应选择 Dempster 或 PCR5
 * 4. 对最终融合结果计算 Bel({T}) / Pl({T}) / 综合可信度
 */

import {
  type MassFunction,
  TRUSTED_SET,
  computeConflict,
  dempsterCombine,
  computeBelief,
  computePlausibility,
  createVacuousMassFunction,
} from './ds-theory'
import { pcr5Combine } from './pcr5'

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 融合步骤追踪（用于可视化与审计）
 */
export interface FusionStep {
  /** 步骤序号（从 1 开始） */
  step: number
  /** 使用的组合规则 */
  ruleUsed: 'dempster' | 'pcr5'
  /** 左操作数来源 ID（可能是复合来源） */
  leftSourceId: string
  /** 右操作数来源 ID */
  rightSourceId: string
  /** 该步骤的冲突系数 k ∈ [0, 1] */
  conflict: number
  /** 组合结果的 Bel({T}) */
  resultBelief: number
  /** 组合结果的 Pl({T}) */
  resultPlausibility: number
}

/**
 * 可信度评估结果
 *
 * 包含信任区间、综合可信度、冲突程度、来源追溯和融合步骤。
 */
export interface ConfidenceAssessment {
  /** 信任度下界 Bel({T}) ∈ [0, 1] */
  belief: number
  /** 似真度上界 Pl({T}) ∈ [0, 1] */
  plausibility: number
  /** 综合可信度 = (Bel + Pl) / 2 ∈ [0, 1]（中点策略） */
  confidence: number
  /** 不确定性区间宽度 = Pl - Bel ∈ [0, 1] */
  uncertainty: number
  /** 冲突程度：融合过程中遇到的最大成对冲突 k ∈ [0, 1] */
  conflictLevel: number
  /** 最终使用的规则（dempster / pcr5 / mixed） */
  ruleUsed: 'dempster' | 'pcr5' | 'mixed'
  /** 参与融合的证据来源列表 */
  sources: Array<{
    sourceId: string
    sourceName: string
    /** 该来源的原始置信度 [0, 1] */
    confidence: number
  }>
  /** 融合步骤追踪（用于 DAG 可视化） */
  fusionSteps: FusionStep[]
  /** 融合后的 Mass 函数（用于进一步分析或 DAG 可视化） */
  fusedMassFunction: MassFunction
}

// ============================================================================
// 融合引擎
// ============================================================================

/**
 * 证据融合引擎
 *
 * 自适应组合策略：根据冲突系数自动选择 Dempster 或 PCR5 规则。
 *
 * 使用示例：
 * ```typescript
 * const engine = new FusionEngine()
 * const massFunctions = [logMf, kbMf, aiMf, humanMf, historyMf, bpMf]
 * const assessment = engine.fuseAndAssess(massFunctions)
 * console.log(`可信度: ${assessment.confidence}, 冲突: ${assessment.conflictLevel}`)
 * ```
 */
export class FusionEngine {
  /** 冲突阈值：k < threshold 用 Dempster，k ≥ threshold 用 PCR5 */
  private readonly conflictThreshold: number

  /** 上一次融合的步骤追踪（供可视化使用） */
  private lastFusionSteps: FusionStep[] = []

  /**
   * @param conflictThreshold - 冲突阈值，默认 0.3（参考 sift-kernel 经验值）
   */
  constructor(conflictThreshold = 0.3) {
    this.conflictThreshold = conflictThreshold
  }

  /**
   * 融合多个 Mass 函数
   *
   * 采用两两迭代组合策略：
   *   m_12 = combine(m_1, m_2)
   *   m_123 = combine(m_12, m_3)
   *   ...
   *   m_final = combine(m_12345, m_6)
   *
   * 每步根据冲突系数自适应选择规则：
   * - k < 0.3：Dempster 规则（满足结合律，计算高效）
   * - k ≥ 0.3：PCR5 规则（高冲突鲁棒，避免 Zadeh 悖论）
   *
   * 融合步骤会记录到 this.lastFusionSteps，可通过 getLastFusionSteps() 获取。
   *
   * @param massFunctions - 待融合的 Mass 函数列表
   * @returns 融合后的 Mass 函数（空列表返回无信息函数 VBF）
   */
  fuse(massFunctions: MassFunction[]): MassFunction {
    this.lastFusionSteps = []

    if (massFunctions.length === 0) {
      return createVacuousMassFunction('empty', '空证据集')
    }

    if (massFunctions.length === 1) {
      return massFunctions[0]
    }

    let result = massFunctions[0]
    let stepNum = 1
    let usedDempster = false
    let usedPcr5 = false

    for (let i = 1; i < massFunctions.length; i++) {
      const current = massFunctions[i]
      const conflict = computeConflict(result, current)

      let combined: MassFunction
      let ruleUsed: 'dempster' | 'pcr5'

      if (conflict < this.conflictThreshold) {
        // 低冲突：使用 Dempster 规则
        combined = dempsterCombine(result, current)
        ruleUsed = 'dempster'
        usedDempster = true
      } else {
        // 高冲突：使用 PCR5 规则
        combined = pcr5Combine(result, current)
        ruleUsed = 'pcr5'
        usedPcr5 = true
      }

      // 记录融合步骤
      const trustedSet = new Set<string>(TRUSTED_SET)
      this.lastFusionSteps.push({
        step: stepNum,
        ruleUsed,
        leftSourceId: result.sourceId,
        rightSourceId: current.sourceId,
        conflict,
        resultBelief: computeBelief(combined, trustedSet),
        resultPlausibility: computePlausibility(combined, trustedSet),
      })

      result = combined
      stepNum++
    }

    // 记录最终使用的规则类型（用于 ruleUsed 字段）
    this.lastRuleUsed = usedDempster && usedPcr5 ? 'mixed' : usedPcr5 ? 'pcr5' : 'dempster'

    return result
  }

  /** 上一次融合最终使用的规则类型 */
  private lastRuleUsed: 'dempster' | 'pcr5' | 'mixed' = 'dempster'

  /**
   * 获取上一次 fuse 操作的步骤追踪
   *
   * @returns 融合步骤列表（每次 fuse 调用会重置）
   */
  getLastFusionSteps(): FusionStep[] {
    return [...this.lastFusionSteps]
  }

  /**
   * 获取上一次 fuse 操作最终使用的规则类型
   */
  getLastRuleUsed(): 'dempster' | 'pcr5' | 'mixed' {
    return this.lastRuleUsed
  }

  /**
   * 评估单个 Mass 函数的可信度
   *
   * 计算 Bel({T}) / Pl({T}) / 综合可信度等指标。
   *
   * 公式：
   *   Bel({T}) = m({T})
   *   Pl({T})  = m({T}) + m(Θ)
   *   confidence = (Bel + Pl) / 2    （中点策略）
   *   uncertainty = Pl - Bel          （区间宽度）
   *
   * @param massFunction - 待评估的 Mass 函数
   * @returns 可信度评估结果（不含融合步骤，sources 仅含自身）
   */
  assess(massFunction: MassFunction): ConfidenceAssessment {
    const trustedSet = new Set<string>(TRUSTED_SET)
    const belief = computeBelief(massFunction, trustedSet)
    const plausibility = computePlausibility(massFunction, trustedSet)
    const confidence = (belief + plausibility) / 2
    const uncertainty = plausibility - belief

    return {
      belief,
      plausibility,
      confidence,
      uncertainty,
      conflictLevel: 0, // 单个 Mass 函数无冲突
      ruleUsed: 'dempster',
      sources: [
        {
          sourceId: massFunction.sourceId,
          sourceName: massFunction.sourceName,
          confidence: massFunction.confidence,
        },
      ],
      fusionSteps: [],
      fusedMassFunction: massFunction,
    }
  }

  /**
   * 融合并评估（便捷方法）
   *
   * 等价于先调用 fuse() 再调用 assess()，但会填充完整的融合步骤追踪
   * 和冲突程度信息。
   *
   * @param massFunctions - 待融合的 Mass 函数列表
   * @returns 完整的可信度评估结果（含融合步骤、冲突程度、来源列表）
   */
  fuseAndAssess(massFunctions: MassFunction[]): ConfidenceAssessment {

    // 融合
    const fused = this.fuse(massFunctions)
    const steps = this.getLastFusionSteps()
    const ruleUsed = this.getLastRuleUsed()

    // 计算最大冲突程度
    const maxConflict = steps.length > 0
      ? Math.max(...steps.map((s) => s.conflict))
      : 0

    // 基础评估
    const baseAssessment = this.assess(fused)

    const result: ConfidenceAssessment = {
      ...baseAssessment,
      conflictLevel: maxConflict,
      ruleUsed,
      sources: massFunctions.map((mf) => ({
        sourceId: mf.sourceId,
        sourceName: mf.sourceName,
        confidence: mf.confidence,
      })),
      fusionSteps: steps,
    }

    return result
  }
}

// ============================================================================
// 单例实例（便于全局使用）
// ============================================================================

/** 默认融合引擎实例（冲突阈值 0.3） */
let defaultEngine: FusionEngine | null = null

/**
 * 获取默认融合引擎单例
 *
 * @returns FusionEngine 单例（冲突阈值 0.3）
 */
export function getFusionEngine(): FusionEngine {
  if (defaultEngine === null) {
    defaultEngine = new FusionEngine()
  }
  return defaultEngine
}
