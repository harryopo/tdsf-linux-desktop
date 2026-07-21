/**
 * DAG 可视化数据生成器
 *
 * 为 React Flow 生成证据融合过程的有向无环图（DAG）数据。
 *
 * DAG 结构：
 *   [Source S1] ─┐
 *   [Source S2] ─┤
 *   [Source S3] ─┼─→ [Fusion 1] ─→ [Fusion 2] ─→ ... ─→ [Result]
 *   [Source S4] ─┤
 *   [Source S5] ─┤
 *   [Source S6] ─┘
 *
 * 节点类型：
 * - source：证据源节点（6 个）
 * - fusion：融合步骤节点（每步一个）
 * - result：最终结果节点（1 个）
 *
 * 调研文档：§7 透明化与可视化方案
 */

import type { MassFunction } from './ds-theory'
import type { FusionStep } from './fusion-engine'

// P-7 修复：DagData / DagNode / DagEdge / DagNodeType 已迁移到 @shared/agent-types
// 主进程与渲染进程共享同一份类型定义，避免结构漂移。
// 此处用别名保留旧名（DagNodeData → DagNode、DagEdgeData → DagEdge），
// 让 generateDagData 函数体内的类型注解无需改动。
import type {
  DagData,
  DagNodeData as DagNode,
  DagEdgeData as DagEdge,
} from '@shared/agent-types'

// ============================================================================
// DAG 数据生成
// ============================================================================

/**
 * 将 Mass 函数的焦元转换为可序列化的数组形式
 */
function serializeFocalElements(mf: MassFunction): Array<{ elements: string; mass: number }> {
  return Array.from(mf.focalElements.entries())
    .map(([elements, mass]) => ({ elements, mass }))
    .sort((a, b) => b.mass - a.mass) // 按质量降序
}

/**
 * 生成 DAG 可视化数据
 *
 * 根据证据源 Mass 函数列表和融合结果，生成完整的 DAG 节点和边。
 *
 * 结构示例（3 源融合）：
 *   S1 ─┐
 *   S2 ─┼─→ F1 ─→ F2 ─→ Result
 *   S3 ─┘
 *
 * 其中 F1 = combine(S1, S2), F2 = combine(F1, S3), Result = F2
 *
 * @param massFunctions - 证据源 Mass 函数列表
 * @param fusionResult - 融合结果 Mass 函数
 * @param fusionSteps - 融合步骤追踪（来自 FusionEngine.getLastFusionSteps()）
 * @returns DAG 数据（节点 + 边）
 */
export function generateDagData(
  massFunctions: MassFunction[],
  fusionResult: MassFunction,
  fusionSteps: FusionStep[] = []
): DagData {
  const nodes: DagNode[] = []
  const edges: DagEdge[] = []

  // ------------------------------------------------------------------
  // 1. 创建证据源节点
  // ------------------------------------------------------------------
  for (const mf of massFunctions) {
    nodes.push({
      id: `source-${mf.sourceId}`,
      type: 'source',
      label: mf.sourceName,
      data: {
        sourceId: mf.sourceId,
        confidence: mf.confidence,
        focalElements: serializeFocalElements(mf),
      },
    })
  }

  // ------------------------------------------------------------------
  // 2. 创建融合步骤节点
  // ------------------------------------------------------------------
  for (const step of fusionSteps) {
    const nodeId = `fusion-${step.step}`
    nodes.push({
      id: nodeId,
      type: 'fusion',
      label: `融合步骤 ${step.step}`,
      data: {
        ruleUsed: step.ruleUsed,
        conflict: step.conflict,
        belief: step.resultBelief,
        plausibility: step.resultPlausibility,
      },
    })
  }

  // ------------------------------------------------------------------
  // 3. 创建最终结果节点
  // ------------------------------------------------------------------
  const resultNode: DagNode = {
    id: 'result',
    type: 'result',
    label: '融合结果',
    data: {
      focalElements: serializeFocalElements(fusionResult),
    },
  }

  // 计算最终结果的可信度（如果有融合步骤，从最后一步获取）
  if (fusionSteps.length > 0) {
    const lastStep = fusionSteps[fusionSteps.length - 1]
    resultNode.data.belief = lastStep.resultBelief
    resultNode.data.plausibility = lastStep.resultPlausibility
    resultNode.data.finalConfidence = (lastStep.resultBelief + lastStep.resultPlausibility) / 2
  }

  nodes.push(resultNode)

  // ------------------------------------------------------------------
  // 4. 生成边
  // ------------------------------------------------------------------
  if (fusionSteps.length === 0) {
    // 无融合步骤：所有源直接连接到结果（单源或空源场景）
    for (const mf of massFunctions) {
      edges.push({
        id: `edge-${mf.sourceId}-result`,
        source: `source-${mf.sourceId}`,
        target: 'result',
        label: '直接传递',
      })
    }
  } else {
    // 有融合步骤：按步骤连接
    // 第一步：前两个源 → fusion-1
    if (massFunctions.length >= 2) {
      const firstStep = fusionSteps[0]
      // 第一个源 → fusion-1
      edges.push({
        id: `edge-${massFunctions[0].sourceId}-fusion-1`,
        source: `source-${massFunctions[0].sourceId}`,
        target: 'fusion-1',
        label: firstStep.ruleUsed === 'dempster' ? 'Dempster' : 'PCR5',
      })
      // 第二个源 → fusion-1
      edges.push({
        id: `edge-${massFunctions[1].sourceId}-fusion-1`,
        source: `source-${massFunctions[1].sourceId}`,
        target: 'fusion-1',
        label: `k=${firstStep.conflict.toFixed(3)}`,
      })
    }

    // 后续步骤：fusion-(i) → fusion-(i+1)，并接入下一个源
    for (let i = 1; i < fusionSteps.length; i++) {
      const step = fusionSteps[i]
      const prevNodeId = `fusion-${i}`
      const currNodeId = `fusion-${i + 1}`

      // 上一步融合结果 → 当前步骤
      edges.push({
        id: `edge-${prevNodeId}-${currNodeId}`,
        source: prevNodeId,
        target: currNodeId,
        label: step.ruleUsed === 'dempster' ? 'Dempster' : 'PCR5',
      })

      // 下一个源 → 当前步骤
      const sourceIdx = i + 1
      if (sourceIdx < massFunctions.length) {
        edges.push({
          id: `edge-${massFunctions[sourceIdx].sourceId}-${currNodeId}`,
          source: `source-${massFunctions[sourceIdx].sourceId}`,
          target: currNodeId,
          label: `k=${step.conflict.toFixed(3)}`,
        })
      }
    }

    // 最后一步 → result
    const lastFusionNodeId = `fusion-${fusionSteps.length}`
    edges.push({
      id: `edge-${lastFusionNodeId}-result`,
      source: lastFusionNodeId,
      target: 'result',
      label: '最终结果',
    })
  }

  return { nodes, edges }
}

// ============================================================================
// 公式展示生成
// ============================================================================

/**
 * 生成 LaTeX 风格的公式展示文本
 *
 * 将融合步骤转换为可读的公式文本，用于 UI 展示。
 *
 * @param fusionSteps - 融合步骤追踪
 * @returns 公式文本数组（每步一个公式字符串）
 */
export function generateFormulaDisplay(fusionSteps: FusionStep[]): string[] {
  const formulas: string[] = []

  for (const step of fusionSteps) {
    const ruleName = step.ruleUsed === 'dempster' ? 'Dempster' : 'PCR5'
    const ruleFormula =
      step.ruleUsed === 'dempster'
        ? 'm₁₂(C) = (1/K) · Σ_{A∩B=C} m₁(A)·m₂(B),  K = 1 - k'
        : 'm_PCR5(X) = m_Conj(X) + Σ_{Y∩X=∅} [m₁(X)²·m₂(Y)/(m₁(X)+m₂(Y)) + m₂(X)²·m₁(Y)/(m₂(X)+m₁(Y))]'

    formulas.push(
      `步骤 ${step.step} [${ruleName} 规则]：\n` +
        `  左源: ${step.leftSourceId}\n` +
        `  右源: ${step.rightSourceId}\n` +
        `  冲突系数 k = ${step.conflict.toFixed(4)}\n` +
        `  公式: ${ruleFormula}\n` +
        `  结果: Bel({T}) = ${step.resultBelief.toFixed(4)}, ` +
        `Pl({T}) = ${step.resultPlausibility.toFixed(4)}, ` +
        `可信度 = ${((step.resultBelief + step.resultPlausibility) / 2).toFixed(4)}`
    )
  }

  return formulas
}

/**
 * 生成融合过程的汇总摘要
 *
 * @param fusionSteps - 融合步骤追踪
 * @returns 汇总摘要文本
 */
export function generateSummary(fusionSteps: FusionStep[]): string {
  if (fusionSteps.length === 0) {
    return '无融合步骤（单源或空证据集）'
  }

  const totalSteps = fusionSteps.length
  const dempsterCount = fusionSteps.filter((s) => s.ruleUsed === 'dempster').length
  const pcr5Count = fusionSteps.filter((s) => s.ruleUsed === 'pcr5').length
  const maxConflict = Math.max(...fusionSteps.map((s) => s.conflict))
  const avgConflict =
    fusionSteps.reduce((sum, s) => sum + s.conflict, 0) / fusionSteps.length

  const lastStep = fusionSteps[fusionSteps.length - 1]
  const finalConfidence = (lastStep.resultBelief + lastStep.resultPlausibility) / 2

  return (
    `融合汇总：\n` +
    `  总步骤数: ${totalSteps}\n` +
    `  Dempster 规则使用次数: ${dempsterCount}\n` +
    `  PCR5 规则使用次数: ${pcr5Count}\n` +
    `  最大冲突系数: ${maxConflict.toFixed(4)}\n` +
    `  平均冲突系数: ${avgConflict.toFixed(4)}\n` +
    `  最终可信度: ${finalConfidence.toFixed(4)}\n` +
    `  最终信任区间: [${lastStep.resultBelief.toFixed(4)}, ${lastStep.resultPlausibility.toFixed(4)}]`
  )
}
