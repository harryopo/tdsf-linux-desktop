/**
 * thinking-router — 快慢思考自动路由（v2.10）
 *
 * 背景：思考强度此前是用户手动开关（standard/deep）。参考 AI Agent 架构"快慢思考结合"，
 * 新增 'auto' 档：按查询复杂度本地启发式评分（零 token），自动解析为 standard 或 deep。
 *
 * 设计约束：
 * - 纯函数、无副作用、可单测（不依赖 LLM / DB / 网络）
 * - 解析结果只落 standard / deep 二值（绝不返回 auto，否则下游 DeepSeek thinking
 *   disabled 注入逻辑会失配，复现"No output generated"——见 supervisor providerOptions）
 * - 保守：证据不足时默认 standard（省 token 优先），仅明确复杂信号才升 deep
 */

/** 内部实际执行的三档强度（与 ThinkingStrength 一致，避免循环依赖此处独立声明） */
export type ResolvedStrength = 'fast' | 'standard' | 'deep'

/** 复杂度评分结果（可视化 + 调试用） */
export interface ComplexityScore {
  /** 解析后的实际强度 */
  strength: ResolvedStrength
  /** 复杂度分值（越高越复杂） */
  score: number
  /** 命中的信号（人类可读，用于可视化"为什么升 deep"） */
  signals: string[]
}

/** 升 deep 的分值阈值 */
const DEEP_THRESHOLD = 3

/**
 * 复杂信号：深度排查 / 方案设计 / 多步推理类关键词（命中权重较高）
 */
const COMPLEX_PATTERNS: Array<{ re: RegExp; weight: number; label: string }> = [
  { re: /为什么|原因|root\s*cause|根因|排查|定位|诊断|分析一下|深入分析/i, weight: 2, label: '根因分析' },
  { re: /方案|设计|架构|规划|对比|权衡|利弊|选型|最佳实践/i, weight: 2, label: '方案设计' },
  { re: /优化|调优|性能瓶颈|压测|扩容|高可用|容灾/i, weight: 2, label: '性能/架构优化' },
  { re: /排障|故障|宕机|崩溃|不可用|间歇性|偶发|复现/i, weight: 2, label: '故障排查' },
  { re: /多个|批量|依次|逐步|然后|接着|之后再|分步骤|端到端/i, weight: 1, label: '多步任务' },
  { re: /安全|加固|渗透|漏洞|审计|合规/i, weight: 1, label: '安全评估' },
]

/**
 * 简单信号：明显的单步/查询类（命中则倾向 fast/standard，抑制升级）
 */
const SIMPLE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /^(什么是|是什么|怎么读|如何查看|查看|列出|显示|看下|看一下|check|show|list)\b/i, label: '简单查询' },
  { re: /^(你好|hi|hello|在吗|谢谢|好的|收到)/i, label: '寒暄' },
]

/**
 * 评估查询复杂度，自动解析思考强度
 *
 * 评分规则（本地启发式，零 token）：
 * - 复杂关键词命中累加权重
 * - 文本较长（>120 字）+1；含多个问号/多句 +1
 * - 命中简单信号则扣分（抑制升级）
 * - 总分 ≥ DEEP_THRESHOLD → deep；否则 standard
 *
 * @param userText 最后一条用户消息
 */
export function scoreComplexity(userText: string): ComplexityScore {
  const text = (userText || '').trim()
  const signals: string[] = []
  let score = 0

  // 空/极短 → 直接 standard（不浪费判断）
  if (text.length < 4) {
    return { strength: 'standard', score: 0, signals: [] }
  }

  for (const p of COMPLEX_PATTERNS) {
    if (p.re.test(text)) {
      score += p.weight
      signals.push(p.label)
    }
  }

  // 篇幅信号：长文本通常意图更复杂
  if (text.length > 120) {
    score += 1
    signals.push('长文本')
  }
  // 多问句：一次问多个问题
  const questionCount = (text.match(/[?？]/g) ?? []).length
  if (questionCount >= 2) {
    score += 1
    signals.push('多问题')
  }

  // 简单信号：抑制升级
  for (const p of SIMPLE_PATTERNS) {
    if (p.re.test(text)) {
      score -= 2
      signals.push(`（简单：${p.label}）`)
    }
  }

  const strength: ResolvedStrength = score >= DEEP_THRESHOLD ? 'deep' : 'standard'
  return { strength, score, signals }
}

/**
 * 解析用户传入的强度：'auto' 走复杂度评分，其余原样返回
 *
 * @param requested 用户请求的强度（可能是 'auto'）
 * @param userText 用于评分的用户消息
 * @returns { resolved: 实际执行的三档, auto: 是否走了自动路由, score?: 评分详情 }
 */
export function resolveThinkingStrength(
  requested: string | undefined,
  userText: string,
): { resolved: ResolvedStrength; auto: boolean; score?: ComplexityScore } {
  if (requested === 'fast' || requested === 'standard' || requested === 'deep') {
    // 用户显式指定 → 尊重，不覆盖（不破坏现有手动 deep 行为）
    return { resolved: requested, auto: false }
  }
  // auto 或未指定 → 自动评分
  const score = scoreComplexity(userText)
  return { resolved: score.strength, auto: true, score }
}
