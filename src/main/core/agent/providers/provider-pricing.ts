/**
 * Provider 成本定价与计算（v0.9.4 批次 2 - 任务 5）
 *
 * 职责：
 * - 为每个 ProviderType 提供默认定价（inputCostPer1M / outputCostPer1M，单位 USD）
 * - 提供 getProviderPricing(config) 函数：优先用 config.pricing，否则用默认表
 * - 提供 calculateCost(record, pricing) 函数：根据 token 用量 + 定价计算成本
 *
 * 借鉴：
 * - ContinueDev SessionUsage（token 累计统计）
 * - Aider 成本累计展示（每次执行后展示 token + 成本）
 *
 * Hard Constraint：Token 消耗必须透明（v0.9.3 §11 第 2.5 项）
 *
 * 方案书依据：v0.9.3 §11 第 2 类（Provider 工厂增强）第 2.5 项
 */
import type {
  ModelPricing,
  ProviderType,
  PersistedProviderConfig,
  TokenUsageRecord,
} from './types'

/**
 * 默认 Provider 定价表（按 ProviderType 给默认值，单位 USD / 1M tokens）
 *
 * 数据来源（公开文档 2024-2025）：
 * - anthropic：Claude Sonnet 4/Opus 4，$3/1M input + $15/1M output
 * - google：Gemini Pro，$1.25/1M input + $5/1M output
 * - openai-compatible：保守默认 $1/1M input + $3/1M output（实际看具体服务）
 * - deepseek：DeepSeek Chat $0.14/1M input + $0.28/1M output（国产最具性价比）
 * - qwen：通义千问 Max $1.6/1M input + $6.4/1M output
 * - volcengine-ark：豆包 Pro $0.8/1M input + $2/1M output
 * - ollama：本地推理，0 成本（仅电费）
 * - claude-sdk：等同 anthropic，$3/1M input + $15/1M output
 *
 * 注意：定价可能随厂商调整而变化，建议每季度 review 一次。
 * 用户可通过 ProviderConfig.pricing 显式覆盖（如代理服务有折扣）。
 */
export const PROVIDER_PRICING: Record<ProviderType, ModelPricing> = {
  anthropic: {
    inputCostPer1M: 3.0,
    outputCostPer1M: 15.0,
    currency: 'USD',
  },
  google: {
    inputCostPer1M: 1.25,
    outputCostPer1M: 5.0,
    currency: 'USD',
  },
  'openai-compatible': {
    inputCostPer1M: 1.0,
    outputCostPer1M: 3.0,
    currency: 'USD',
  },
  deepseek: {
    inputCostPer1M: 0.14,
    outputCostPer1M: 0.28,
    currency: 'USD',
  },
  qwen: {
    inputCostPer1M: 1.6,
    outputCostPer1M: 6.4,
    currency: 'USD',
  },
  'volcengine-ark': {
    inputCostPer1M: 0.8,
    outputCostPer1M: 2.0,
    currency: 'USD',
  },
  ollama: {
    inputCostPer1M: 0.0,
    outputCostPer1M: 0.0,
    currency: 'USD',
  },
  'claude-sdk': {
    inputCostPer1M: 3.0,
    outputCostPer1M: 15.0,
    currency: 'USD',
  },
}

/**
 * 获取 Provider 的定价
 *
 * 优先级：
 * 1. config.pricing（用户自定义）→ 直接返回（深拷贝避免污染原对象）
 * 2. PROVIDER_PRICING[config.type]（默认表）→ 返回默认值
 *
 * 使用场景：
 * - 主进程在记录 TokenUsageRecord 时计算 cost 字段
 * - UI 显示累计成本（如本月已消费 $X.XX）
 * - 成本告警（超过阈值提示用户）
 *
 * @param config Provider 配置（PersistedProviderConfig 或 ProviderConfig 均可）
 * @returns 模型定价（始终非空）
 *
 * @example
 * ```ts
 * const pricing = getProviderPricing(provider)
 * const cost = calculateCost(usageRecord, pricing)
 * // cost = (inputTokens * inputCostPer1M + outputTokens * outputCostPer1M) / 1_000_000
 * ```
 */
export function getProviderPricing(
  config: PersistedProviderConfig
): ModelPricing {
  // 优先用用户自定义 pricing
  if (config.pricing) {
    return { ...config.pricing }
  }
  // 否则用默认表
  const defaults = PROVIDER_PRICING[config.type]
  return { ...defaults }
}

/**
 * 根据单次调用的 token 用量计算成本
 *
 * 计算公式：
 * ```
 * cost = (inputTokens * inputCostPer1M + outputTokens * outputCostPer1M) / 1_000_000
 * ```
 *
 * 边界情况处理：
 * - inputTokens / outputTokens 为 0 或负数 → 视为 0（防御性处理）
 * - 定价为 0（如 Ollama 本地）→ 返回 0
 * - 计算结果四舍五入到 6 位小数（避免浮点精度问题）
 *
 * @param record token 使用记录（仅需 inputTokens / outputTokens 字段）
 * @param pricing 模型定价
 * @returns 成本（USD），四舍五入到 6 位小数
 *
 * @example
 * ```ts
 * const record: TokenUsageRecord = {
 *   inputTokens: 1500,
 *   outputTokens: 500,
 *   // ... 其他字段
 * }
 * const pricing: ModelPricing = { inputCostPer1M: 3.0, outputCostPer1M: 15.0 }
 * const cost = calculateCost(record, pricing)
 * // cost = (1500 * 3.0 + 500 * 15.0) / 1_000_000 = 0.012 (USD)
 * ```
 */
export function calculateCost(
  record: Pick<TokenUsageRecord, 'inputTokens' | 'outputTokens'>,
  pricing: ModelPricing
): number {
  const inputTokens = Math.max(0, record.inputTokens || 0)
  const outputTokens = Math.max(0, record.outputTokens || 0)
  const inputCost = (inputTokens * pricing.inputCostPer1M) / 1_000_000
  const outputCost = (outputTokens * pricing.outputCostPer1M) / 1_000_000
  const total = inputCost + outputCost
  // 四舍五入到 6 位小数（避免浮点精度问题，0.000001 USD = 0.001 cent 已足够精确）
  return Math.round(total * 1_000_000) / 1_000_000
}
