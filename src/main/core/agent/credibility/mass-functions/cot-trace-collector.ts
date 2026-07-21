/**
 * CoT 熵轨迹收集器（v0.9.6 P2 M5+ 新增）
 *
 * 职责：
 * 从 LLM Provider 输出流中收集推理过程信号，构建 Shannon 熵轨迹 H = (H_0, H_1, ..., H_N)，
 * 供 `analyzeCotEntropyTrajectory` 做形状单调性分析。
 *
 * 论文依据（v0.9.6 P2 M5+）：
 * - **Zhao 2026, arXiv:2603.18940** §3（实验）：熵轨迹在 LLM 推理的**每步**测量 answer-distribution entropy
 * - **Xu, T. et al. 2026 ICML**：两阶段 Uncertainty/Confidence Region，转换点检测
 * - **Grünefeld et al. 2026, arXiv:2605.07776**：trace-level profile 特征
 *
 * 三优先级降级（Trace Source Priority）：
 *
 * 1. **显式 ThinkingBlock** (Anthropic Claude with `thinking: { type: 'adaptive' }`)
 *    - SDKAssistantMessage.message.content 包含 `type: 'thinking'` 块
 *    - 每个 thinking block 是一段独立推理（已暴露 step 边界）
 *    - 收集：`recordThinkingBlock(text)` 调用一次 = 一个 trace point
 *    - 熵计算：text-feature entropy（字符级 Shannon 熵归一化到 [0, 1]）
 *
 * 2. **多 turn 累积** (Reasoning models like DeepSeek-R1 / o1)
 *    - 每个 SDKAssistantMessage 是一个 agent loop 的 turn
 *    - 每个 turn 累积 assistant 文本
 *    - 收集：`recordTurnText(text)` 调用一次 = 一个 trace point（取 turn 结束时的累积）
 *    - 熵计算：text-feature entropy
 *
 * 3. **文本启发式 fallback** (GPT-4o / Claude 无 thinking / 闭源不暴露)
 *    - 累积完整文本后按"句子/段落/章节标记"切分
 *    - 收集：`recordFinalText(text)` 在 finalize() 时一次性切分
 *    - 熵计算：text-feature entropy（每段一句）
 *    - 论文支撑：即便启发式代理，单调性仍有预测力（Zhao 2026 §4 验证）
 *
 * 不做：
 * - 不计算 logprob-based 精确熵（SDK 不暴露 per-step logprobs，留作 v1.1）
 * - 不调用 LLM 重新评分（成本 + 延迟不可接受）
 * - 不依赖具体 LLM 平台（API 无关）
 *
 * 关键设计：
 * - 状态机：`init → recording → finalized`（不可重复 finalize）
 * - 优先级互斥：一旦有过显式 ThinkingBlock 或 turn 记录，fallback 切分不再生效
 * - 纯函数工具：textShannonEntropy / splitBySentences 与状态无关
 * - 与 cot-trace-signal.ts 解耦：collector 只产出 number[]，由 analyzeCotEntropyTrajectory 消费
 */

import type { CotEntropyTrajectory } from './cot-trace-signal'

/**
 * Trace 收集来源类型（按优先级）
 */
export type TraceSource = 'thinking-block' | 'turn-text' | 'text-fallback' | 'unknown'

/**
 * Trace 收集器状态
 */
type CollectorState = 'init' | 'recording' | 'finalized'

/**
 * 收集器内部数据结构
 */
interface TracePoint {
  /** 文本内容（用于调试/审计） */
  text: string
  /** 该点的 Shannon 熵（归一化 [0, 1]） */
  entropy: number
  /** 来源类型 */
  source: Exclude<TraceSource, 'unknown'>
}

/**
 * 收集器结果（finalize 返回）
 */
export interface CotTraceCollectionResult {
  /** 最终熵轨迹（每步 Shannon 熵 ∈ [0, 1]） */
  trajectory: CotEntropyTrajectory
  /** 各 trace point 的来源分布（用于审计） */
  sourceBreakdown: Record<Exclude<TraceSource, 'unknown'>, number>
  /** 收集到的 trace point 总数（包含 fallback 切分） */
  totalSteps: number
  /** 是否使用了文本启发式 fallback */
  usedFallback: boolean
  /** 收集是否成功（false 时 trajectory 为空数组） */
  collected: boolean
}

// ============================================================================
// 纯函数工具：text-feature entropy
// ============================================================================

/**
 * 计算文本的字符级 Shannon 熵（归一化到 [0, 1]）
 *
 * 算法：
 *   H_raw = -Σ p(c) · log₂(p(c))       for c in unique chars
 *   H_norm = H_raw / log₂(N)            N = min(unique chars, 36) ≈ 26 letters + 10 digits
 *   归一化使英文/中文文本都在 [0, 1]
 *
 * 注意：
 * - 论文 Zhao 2026 用的是 token-level answer-distribution entropy
 * - 本实现是 text-level proxy，论文 §4 验证了即便代理，**单调性**仍有预测力
 * - 空字符串返回 0（最确定）
 * - 单字符重复（如 "aaaaa"）返回 0
 * - 完全随机字符串返回 ~1
 *
 * @param text 文本内容
 * @returns 归一化熵 ∈ [0, 1]
 */
export function textShannonEntropy(text: string): number {
  if (!text || text.length === 0) return 0

  // 1. 统计字符频率
  const freq = new Map<string, number>()
  for (const ch of text) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1)
  }

  const n = text.length
  const uniqueCount = freq.size

  // 2. 计算 Shannon 熵
  let hRaw = 0
  for (const count of freq.values()) {
    const p = count / n
    if (p > 0) {
      hRaw -= p * Math.log2(p)
    }
  }

  // 3. 归一化：最大熵 = log₂(min(uniqueCount, 36))
  //    36 = 26 letters + 10 digits（实际英文/数字可观察字符集）
  //    中文/特殊字符超出时仍然以 36 为上界（保守归一化）
  const maxEntropy = Math.log2(Math.min(Math.max(uniqueCount, 2), 36))
  if (maxEntropy === 0) return 0

  const hNorm = hRaw / maxEntropy

  // 4. clamp 到 [0, 1]（防御性兜底）
  if (Number.isNaN(hNorm) || !Number.isFinite(hNorm)) return 0
  return Math.min(1, Math.max(0, hNorm))
}

// ============================================================================
// 纯函数工具：句子切分（用于 fallback）
// ============================================================================

/**
 * 按句子边界切分文本
 *
 * 启发式：识别 . ! ? \n\n 之后跟大写字母/中文段落
 *
 * 注意：
 * - 仅用于 fallback 路径（不依赖 SDK 暴露 step 边界）
 * - 中文以"。" / "！" / "？" 切分
 * - 英文以 "." / "!" / "?" 切分
 * - 段间空行也作为切分点
 * - 太短的句（< `MIN_SENTENCE_LEN` 字符）合并到上一句——但仅当上一句本身也过短时
 *   才合并，避免长句被反复吸入（fallback 路径要保留下层粒度）
 *
 * 阈值选 4 的原因：英文 4 字符 ≈ "OK." / "Yes." 这种几乎无熵的垃圾；
 *                 中文 4 字符 ≈ 4 个汉字，已经能稳定计算 Shannon 熵。
 *
 * @param text 完整文本
 * @returns 切分后的字符串数组
 */
export function splitBySentences(text: string): string[] {
  if (!text || text.length === 0) return []

  // 统一换行符
  const normalized = text.replace(/\r\n/g, '\n')

  // 第一步：按段（连续空行）切分
  const paragraphs = normalized.split(/\n{2,}/).filter((p) => p.trim().length > 0)

  // 第二步：每段内按"标点+空白"切分
  // 匹配：句末标点 + 后续空白（包括换行）
  // capture group 包含标点 + 后续空白，保留结构信息
  const sentenceSplitter = /([.!?。！？][\s\n]*)/

  const sentences: string[] = []
  for (const para of paragraphs) {
    const parts = para.split(sentenceSplitter)
    // 切分结果形如：['text1', '. ', 'text2', '! ', 'text3', '?', 'text4', '.']
    // 偶数索引（0, 2, 4, ...）= 文本片段
    // 奇数索引（1, 3, 5, ...）= 标点+空白
    let buffer = ''
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (part === undefined) continue
      if (i % 2 === 0) {
        // 文本片段：累积到 buffer
        buffer += part
      } else {
        // 标点+空白：合并到 buffer，然后提交
        buffer += part
        if (buffer.trim().length > 0) {
          sentences.push(buffer.trim())
        }
        buffer = ''
      }
    }
    // 收尾（无标点的最后一段）
    if (buffer.trim().length > 0) {
      sentences.push(buffer.trim())
    }
  }

  // 第三步：合并过短片段（< MIN_SENTENCE_LEN 字符）
  // 规则：只在前一句本身也过短时合并，避免长句被反复吸入
  //       这样既过滤了 "OK." / "Yes." 这类几乎无熵的垃圾，
  //       又保留了 "第一句。第二句！第三句？第四句。" 这种 4 字中文短句的粒度
  const merged: string[] = []
  for (const s of sentences) {
    if (s.length < MIN_SENTENCE_LEN && merged.length > 0) {
      const last = merged[merged.length - 1]!
      // 只在上一句本身也过短时才合并；长句不参与合并
      if (last.length < MIN_SENTENCE_LEN) {
        merged[merged.length - 1] = last + ' ' + s
        continue
      }
    }
    merged.push(s)
  }

  return merged
}

/**
 * 句子最小长度阈值（fallback 切分）
 *
 * - < 4 字符的英文片段（"OK." / "Yes."）几乎无信息量
 * - < 4 字符的中文片段（"嗯。" / "好。"）同理
 * - ≥ 4 字符的中文（如"第一句。"）已能稳定计算 Shannon 熵
 */
const MIN_SENTENCE_LEN = 4

// ============================================================================
// CoT Trace Collector 主类
// ============================================================================

/**
 * CoT 熵轨迹收集器
 *
 * 用法：
 * ```ts
 * const collector = createCotTraceCollector()
 * for await (const msg of sdkGenerator) {
 *   if (isAssistantMessage(msg)) {
 *     const thinking = extractThinkingBlock(msg)
 *     if (thinking) collector.recordThinkingBlock(thinking)
 *     else collector.recordTurnText(extractAssistantText(msg))
 *   }
 * }
 * const result = collector.finalize()
 * // result.trajectory: number[] = [H_0, H_1, ..., H_N]
 * ```
 *
 * 线程安全：单实例内部状态可变，但 finalize() 是 read-only。
 * 多次调用 finalize() 返回相同结果。
 */
export class CotTraceCollector {
  private state: CollectorState = 'init'
  private readonly points: TracePoint[] = []
  private finalText: string = ''
  private usedFallback: boolean = false

  /**
   * 记录一个 thinking block（最高优先级，Anthropic Claude with thinking）
   *
   * @param text thinking block 文本内容
   */
  recordThinkingBlock(text: string): void {
    if (this.state === 'finalized') {
      throw new Error('CotTraceCollector 已 finalized，不可再记录')
    }
    if (!text || text.trim().length === 0) return

    this.state = 'recording'
    this.points.push({
      text: text.trim(),
      entropy: textShannonEntropy(text),
      source: 'thinking-block',
    })
  }

  /**
   * 记录一个 turn 的累积文本（次高优先级，reasoning model 多 turn）
   *
   * 每次 SDKAssistantMessage 到达时调用一次（传该 turn 的完整 assistant 文本）。
   * 每个 turn 对应一个 trace point。
   *
   * @param text turn 完整文本
   */
  recordTurnText(text: string): void {
    if (this.state === 'finalized') {
      throw new Error('CotTraceCollector 已 finalized，不可再记录')
    }
    if (!text || text.trim().length === 0) return

    this.state = 'recording'
    this.points.push({
      text: text.trim(),
      entropy: textShannonEntropy(text),
      source: 'turn-text',
    })
  }

  /**
   * 累积最终文本（fallback 模式使用，init/recording 期间一直可调用）
   *
   * 与 recordTurnText 互斥：一旦调用过 recordTurnText 或 recordThinkingBlock，
   * 累积的 finalText 不会被使用（finalize 时仍能拿到，但不会被切分）。
   *
   * @param text 累积的文本片段
   */
  accumulateFinalText(text: string): void {
    if (this.state === 'finalized') return
    if (text) this.finalText += text
  }

  /**
   * 完成收集，返回最终熵轨迹
   *
   * 行为：
   * 1. 已有显式 points（thinking-block / turn-text）→ 直接返回 points 熵序列
   * 2. 否则对 finalText 切分 + 计算熵（fallback）
   * 3. 既无 points 也无 finalText → 返回空轨迹（collected=false）
   *
   * @returns 收集结果（含 trajectory + 审计元数据）
   */
  finalize(): CotTraceCollectionResult {
    if (this.state === 'finalized') {
      // 重复调用：返回缓存的 trajectory
      return this.buildResult()
    }
    this.state = 'finalized'

    if (this.points.length === 0 && this.finalText.trim().length > 0) {
      // Fallback 模式：按句子切分
      const sentences = splitBySentences(this.finalText)
      for (const sent of sentences) {
        this.points.push({
          text: sent,
          entropy: textShannonEntropy(sent),
          source: 'text-fallback',
        })
      }
      this.usedFallback = true
    }

    return this.buildResult()
  }

  /**
   * 构造结果（私有，避免 finalize 重复切分）
   */
  private buildResult(): CotTraceCollectionResult {
    const breakdown: Record<Exclude<TraceSource, 'unknown'>, number> = {
      'thinking-block': 0,
      'turn-text': 0,
      'text-fallback': 0,
    }
    for (const p of this.points) {
      breakdown[p.source] += 1
    }

    return {
      trajectory: this.points.map((p) => p.entropy),
      sourceBreakdown: breakdown,
      totalSteps: this.points.length,
      usedFallback: this.usedFallback,
      collected: this.points.length > 0,
    }
  }
}

/**
 * 创建 CoT 熵轨迹收集器（工厂函数）
 *
 * @returns 新的收集器实例
 */
export function createCotTraceCollector(): CotTraceCollector {
  return new CotTraceCollector()
}
