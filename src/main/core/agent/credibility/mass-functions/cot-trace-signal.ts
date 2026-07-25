/**
 * CoT-shape 熵轨迹信号（v0.9.6 P2 M4 新增）
 *
 * 背景：
 * - 现代 LLM 在 Chain-of-Thought 推理中经常产生"看起来很自信但实际错误"的答案
 * - 单点置信度（verbalized / logprob）无法捕捉推理过程的"形状"
 * - Zhao 2026 (arXiv:2603.18940) 揭示：**熵轨迹的形状**（是否单调递减）比熵的标量大小更具预测力
 *
 * 论文依据（v0.9.6 P2 M4 新增）：
 * - **Zhao, X. 2026**, "Entropy Trajectory Shape Predicts LLM Reasoning Reliability"
 *   arXiv:2603.18940v1, 2026-03-19
 *   - 核心发现：单调链 68.8% 准确率 vs 非单调链 46.8%（+21.9 pp gap, OR=2.50, Fisher's p=0.0005）
 *   - 关键解耦：标量总熵减少**不可预测**（ρ=−0.06, p=0.31），但**形状单调性**高度预测
 *   - 违规计数 0/1/2 对应 68.8%/50.8%/28.6% 准确率
 *   - 复制验证：Mistral-7B-Instruct-v0.3 上单调 72.3% vs 非单调 37.6%（+34.7 pp, OR=4.33）
 *   - 计算成本：~1,500 tokens/question（远低于 40-chain self-consistency）
 *
 * - **Xu, T. et al. 2026 (ICML)**, "Unveiling the Entropy Dynamics of Chain-of-Thought Reasoning"
 *   - 两阶段结构：Uncertainty Region（高熵探索）→ Confidence Region（熵崩收敛）
 *   - CUSUM 检测转换点：可触发 Early Exit（节省 11.1% tokens）
 *   - 准确率在 Confidence Region 跃升至 > 60%
 *
 * - **Grünefeld et al. 2026**, "Tracing Uncertainty in Language Model Reasoning" (arXiv:2605.07776)
 *   - Uncertainty trace profile：少量特征描述不确定性信号的形状
 *   - 早期正确性检测：trace 早期特征可预测最终正确性
 *
 * - **Xu et al. ACL (OpenReview)**, "ETR: Entropy Trend Reward"
 *   - 熵趋势（downward trend）vs 标量熵抑制的差异
 *   - 推理效率与不确定性轨迹直接相关
 *
 * 公式（基于 Zhao 2026）：
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
 * - 与本模块按 Provider 分类的折扣策略兼容
 *
 * 不做：
 * - 不做熵归一化（Zhao 2026 论文直接使用 Shannon 熵）
 * - 不做趋势斜率拟合（论文证实违规计数比斜率更具预测力）
 * - 不依赖具体 LLM 平台（API 无关）
 */

/**
 * CoT 熵轨迹的输入（每步的 Shannon 熵 ∈ [0, 1]）
 *
 * 典型来源：
 * - LLM API 在每步推理后输出当前 step 的 answer-distribution entropy
 * - 由 `computeStepEntropy(samples)` 计算：H = -Σ p·log(p)
 *
 * 实际工程中：
 * - reasoning model（DeepSeek-R1 / o1）通过隐藏层或采样得到
 * - 非 reasoning model（GPT-4o / Claude）通过每步插入 prompt + 多次采样得到
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
}

/**
 * 论文经验映射（Zhao 2026 Table 1）：
 *   违规 0 → 68.8% 准确率 → conf 0.85（高信任）
 *   违规 1 → 50.8% 准确率 → conf 0.55（中信任）
 *   违规 2 → 28.6% 准确率 → conf 0.30（低信任）
 *   违规 ≥ 3 → 近似随机   → conf 0.10（不信任）
 *
 * 边界（论文未涉及，给出合理默认）：
 *   0 步（空 trace）  → conf 0.50（中性）
 *   1 步（单点）      → conf 0.60（信息不足）
 */
const CONFIDENCE_BY_VIOLATIONS: ReadonlyArray<number> = [
  0.85, // 0 违规
  0.55, // 1 违规
  0.30, // 2 违规
  0.10, // 3+ 违规（取最后一个）
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
 * 计算 CoT 熵轨迹的置信度信号
 *
 * 核心算法（Zhao 2026 §3）：
 * 1. 过滤非法值：NaN/Infinity/负数 → 0；> 1 → 1
 * 2. 计算单调性：H_k ≥ H_{k+1} 对所有 k
 * 3. 计数违规：违反单调的步数
 * 4. 映射置信度：基于论文经验数据
 *
 * @param trace - 每步 Shannon 熵 ∈ [0, 1]
 * @returns 完整的轨迹分析结果（含 confidence 和可读摘要）
 *
 * @example
 * ```ts
 * // 论文核心场景 1：完美单调链
 * analyzeCotEntropyTrajectory([0.9, 0.7, 0.5, 0.3, 0.1])
 * // => { monotone: true, violations: 0, confidence: 0.85, summary: '...' }
 *
 * // 论文核心场景 2：典型非单调链
 * analyzeCotEntropyTrajectory([0.5, 0.7, 0.4, 0.6, 0.2])
 * // => { monotone: false, violations: 2, confidence: 0.30, summary: '...' }
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
      monotone: true, // 1 元素总是"单调"
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

  // 计算违规数（Zhao 2026 §3 单调性定义）
  let violations = 0
  for (let k = 0; k < cleanTrace.length - 1; k++) {
    if (cleanTrace[k] < cleanTrace[k + 1]) {
      violations += 1
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
  }
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

/**
 * 便捷函数：仅返回置信度（不返回完整分析）
 *
 * 用于 ai-param-source.ts 等只需要标量信号的场景。
 */
export function cotEntropyTrajectoryConfidence(
  trace: CotEntropyTrajectory | undefined
): number | null {
  if (!trace) return null
  return analyzeCotEntropyTrajectory(trace).confidence
}

/**
 * 计算 token logprobs 的 Shannon 熵（v0.9.7 P3 M1 新增）
 *
 * 论文依据：Zhao 2026, arXiv:2603.18940 §3 — token-level answer-distribution entropy
 *
 * 输入：单个 token 的 top-N logprobs（自然对数 log(p)）
 * 输出：归一化到 [0, 1] 的 Shannon 熵
 *
 * 算法：
 *   1. logprobs → probabilities：p_i = exp(lp_i) / Σ exp(lp_j)
 *   2. Shannon 熵：H = -Σ p_i · log₂(p_i)
 *   3. 归一化：H_norm = H / log₂(N)，N = 有效 logprobs 数
 *
 * 注意：
 * - 空数组或单元素数组返回 0（完全确定）
 * - logprobs 为自然对数，转换为概率时不需要换底
 * - 结果 clamp 到 [0, 1]
 *
 * @param logprobs - 单个 token 的 top-N logprobs 数组（log(p) 值，通常为负）
 * @returns 归一化 Shannon 熵 ∈ [0, 1]
 */
export function tokenLogprobShannonEntropy(logprobs: number[]): number {
  if (!Array.isArray(logprobs) || logprobs.length < 2) return 0

  // 1. 过滤非法值
  const validLps = logprobs.filter((lp) => typeof lp === 'number' && Number.isFinite(lp))
  if (validLps.length === 0) return 0
  if (validLps.length === 1) return 0

  // 2. 数值稳定性：减去最大值避免 exp 溢出
  const maxLp = Math.max(...validLps)
  const exps = validLps.map((lp) => Math.exp(lp - maxLp))
  const sumExp = exps.reduce((acc, v) => acc + v, 0)
  if (sumExp === 0 || !Number.isFinite(sumExp)) return 0

  // 3. 计算概率分布
  const probs = exps.map((v) => v / sumExp)

  // 4. Shannon 熵（以 2 为底）
  let h = 0
  for (const p of probs) {
    if (p > 0) {
      h -= p * Math.log2(p)
    }
  }

  // 5. 归一化到 [0, 1]
  const maxEntropy = Math.log2(validLps.length)
  if (maxEntropy === 0 || !Number.isFinite(maxEntropy)) return 0
  const hNorm = h / maxEntropy

  if (Number.isNaN(hNorm) || !Number.isFinite(hNorm)) return 0
  return Math.min(1, Math.max(0, hNorm))
}
