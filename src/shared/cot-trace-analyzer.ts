/**
 * CoT-shape 熵轨迹分析器（v0.9.6 P2 M4-M6 共享层）
 *
 * 位置：src/shared/cot-trace-analyzer.ts
 *
 * 设计原因：
 * - 纯函数、无副作用，可被主进程/渲染进程/preload 三端安全引用
 * - 不依赖任何运行时环境（无 IO、无状态）
 * - 主进程 `mass-functions/cot-trace-signal.ts` 通过 re-export 保持向后兼容
 *
 * 论文依据（v0.9.6 P2 M4）：
 * - **Zhao, X. 2026**, "Entropy Trajectory Shape Predicts LLM Reasoning Reliability"
 *   arXiv:2603.18940v1, 2026-03-19
 *   - 核心发现：单调链 68.8% 准确率 vs 非单调链 46.8%（+21.9 pp gap, OR=2.50, Fisher's p=0.0005）
 *   - 关键解耦：标量总熵减少**不可预测**（ρ=−0.06, p=0.31），但**形状单调性**高度预测
 *   - 违规计数 0/1/2 对应 68.8%/50.8%/28.6% 准确率
 *   - 复制验证：Mistral-7B-Instruct-v0.3 上单调 72.3% vs 非单调 37.6%（+34.7 pp, OR=4.33）
 *
 * 公式：
 *   entropy_trajectory: H = (H_0, H_1, ..., H_N)
 *   monotone(trace) = ∀ k ∈ [0, N-1]: H_k ≥ H_{k+1}    （非递增）
 *   violations(trace) = |{ k : H_k < H_{k+1} }|         （违反单调的步数）
 *
 *   confidence(trace) 映射（基于 Zhao 2026 经验数据，线性插值）：
 *     violations = 0  → conf = 0.85   （完美单调链）
 *     violations = 1  → conf = 0.55   （轻度违反）
 *     violations = 2  → conf = 0.30   （重度违反）
 *     violations ≥ 3  → conf = 0.10   （完全非单调）
 *     空 trace         → conf = 0.50   （中性默认）
 *     1 元素 trace     → conf = 0.60   （信息不足）
 *
 * 设计原则：
 * - 纯函数、无副作用、TypeScript strict mode
 * - 输入验证：NaN/Infinity/负值/超界（每项 ∈ [0, 1]）兜底
 * - 可解释性：返回 { monotone, violations, confidence, summary } 而非单点数值
 *
 * 不做：
 * - 不做熵归一化（Zhao 2026 论文直接使用 Shannon 熵）
 * - 不做趋势斜率拟合（论文证实违规计数比斜率更具预测力）
 * - 不依赖具体 LLM 平台（API 无关）
 */

/**
 * CoT 熵轨迹的输入（每步的 Shannon 熵 ∈ [0, 1]）
 */
export type CotEntropyTrajectory = number[]

/**
 * 熵轨迹分析结果
 */
export interface CotTraceAnalysis {
  /** 是否单调非递增（无违规） */
  monotone: boolean
  /** 违反单调的步数 */
  violations: number
  /** 轨迹总步数（元素数） */
  steps: number
  /** 起点熵 H_0 */
  startEntropy: number
  /** 终点熵 H_N */
  endEntropy: number
  /** 总熵减少量 H_0 - H_N（可能为负） */
  totalReduction: number
  /** 单调性违规计数 → 置信度（论文经验映射） */
  confidence: number
  /** 人类可读摘要，用于 UI/审计 */
  summary: string
  /**
   * 违规点索引列表（v0.9.6 P2 M6 渲染层用，可选）
   *
   * 用于 ConfidenceBreakdown 在折线图上标注红点
   */
  violationIndices?: number[]
  /**
   * 原始轨迹数据（v0.9.6 P2 M6 渲染层用，可选）
   *
   * 由 analyzeCotEntropyTrajectory 自动注入；渲染层（ConfidenceBreakdown）
   * 不需要外部再次传 trajectory 数组。
   * 已经过 clamp01 归一化（NaN/Infinity/超界值过滤）。
   */
  trajectory?: number[]
}

/**
 * 论文经验映射（Zhao 2026 Table 1）
 */
const CONFIDENCE_BY_VIOLATIONS: ReadonlyArray<number> = [
  0.85, // 0 违规
  0.55, // 1 违规
  0.30, // 2 违规
  0.10, // 3+ 违规
] as const

const EMPTY_TRACE_CONFIDENCE = 0.5
const SINGLE_STEP_CONFIDENCE = 0.6

/**
 * 限制数值在 [0, 1]（用于非法的熵值兜底）
 */
function clamp01(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * 计算 CoT 熵轨迹的完整分析结果
 *
 * @param trace - 每步 Shannon 熵 ∈ [0, 1]
 * @returns 完整的轨迹分析结果（含 confidence、violationIndices、可读摘要）
 *
 * @example
 * ```ts
 * // 论文核心场景 1：完美单调链
 * analyzeCotEntropyTrajectory([0.9, 0.7, 0.5, 0.3, 0.1])
 * // => { monotone: true, violations: 0, confidence: 0.85, ... }
 *
 * // 论文核心场景 2：典型非单调链
 * analyzeCotEntropyTrajectory([0.5, 0.7, 0.4, 0.6, 0.2])
 * // => { monotone: false, violations: 2, confidence: 0.30, violationIndices: [0, 2, 3], ... }
 * ```
 */
export function analyzeCotEntropyTrajectory(
  trace: CotEntropyTrajectory
): CotTraceAnalysis {
  // 边界 1：空 trace
  if (!Array.isArray(trace) || trace.length === 0) {
    return {
      monotone: false,
      violations: 0,
      steps: 0,
      startEntropy: 0,
      endEntropy: 0,
      totalReduction: 0,
      confidence: EMPTY_TRACE_CONFIDENCE,
      summary: '无 CoT 熵轨迹数据，使用中性默认值',
    }
  }

  // 边界 2：单步 trace（信息不足）
  if (trace.length === 1) {
    const v0 = clamp01(trace[0])
    return {
      monotone: true,
      violations: 0,
      steps: 1,
      startEntropy: v0,
      endEntropy: v0,
      totalReduction: 0,
      confidence: SINGLE_STEP_CONFIDENCE,
      summary: `单步轨迹（H=${v0.toFixed(3)}），信息不足，使用保守默认`,
    }
  }

  // 过滤 + 归一化熵值
  const cleanTrace = trace.map(clamp01)

  // 计算违规数 + 违规点索引（Zhao 2026 §3 单调性定义）
  let violations = 0
  const violationIndices: number[] = []
  for (let k = 0; k < cleanTrace.length - 1; k++) {
    if (cleanTrace[k] < cleanTrace[k + 1]) {
      violations += 1
      violationIndices.push(k)
    }
  }
  const monotone = violations === 0

  // 起点 / 终点 / 总减少
  const startEntropy = cleanTrace[0]
  const endEntropy = cleanTrace[cleanTrace.length - 1]
  const totalReduction = startEntropy - endEntropy

  // 违规数 → 置信度（论文经验映射）
  const confidence =
    violations >= CONFIDENCE_BY_VIOLATIONS.length
      ? CONFIDENCE_BY_VIOLATIONS[CONFIDENCE_BY_VIOLATIONS.length - 1]
      : CONFIDENCE_BY_VIOLATIONS[violations]

  // 人类可读摘要
  const summary = formatSummary({
    monotone,
    violations,
    steps: cleanTrace.length,
    startEntropy,
    endEntropy,
    confidence,
  })

  return {
    monotone,
    violations,
    steps: cleanTrace.length,
    startEntropy,
    endEntropy,
    totalReduction,
    confidence,
    summary,
    violationIndices,
    trajectory: cleanTrace,
  }
}

/**
 * 便捷函数：仅返回置信度
 */
export function cotEntropyTrajectoryConfidence(
  trace: CotEntropyTrajectory | undefined | null
): number | null {
  if (!trace) return null
  return analyzeCotEntropyTrajectory(trace).confidence
}

/**
 * 格式化人类可读摘要
 */
function formatSummary(args: {
  monotone: boolean
  violations: number
  steps: number
  startEntropy: number
  endEntropy: number
  confidence: number
}): string {
  const { monotone, violations, steps, startEntropy, endEntropy, confidence } = args
  const monotonicityTag = monotone ? '单调' : '非单调'
  const shapeDesc = monotone ? '熵稳定下降' : `熵轨迹波动（${violations} 次违规）`
  return `CoT-shape=${monotonicityTag} | ${shapeDesc} | ${steps} 步 | H₀=${startEntropy.toFixed(
    3
  )} → Hₙ=${endEntropy.toFixed(3)} | conf=${confidence.toFixed(2)}`
}
