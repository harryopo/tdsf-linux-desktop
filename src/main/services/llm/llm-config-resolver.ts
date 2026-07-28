/**
 * LlmClient 配置统一解析器（P0 修复：双 Key 存储残留）
 *
 * 问题背景：
 * - Provider 体系（SecureStore `provider:{id}` + electron-store agentProviders）
 *   上线后，旧 LLM 体系（ConfigStore.llmConfig + SecureStore 'llm'）未下线。
 * - llm.ts / agent.ts / llm-tools.ts / promptfoo.ts / loop-engineering-subagent.ts
 *   共 5 处仍只读旧 'llm' Key，用户在"设置 → 模型"配好 Provider 后，
 *   这些路径 `getApiKey('llm') ?? ''` 静默拿空 Key → 调用失败且不上屏。
 *
 * 统一策略（所有 LlmClient 消费点必须走本入口）：
 * 1. 优先用 Provider 体系：默认 Provider 若是 OpenAI 协议族且已配 Key，直接复用；
 *    否则找第一个 enabled 且有 Key 的 OpenAI 协议族 Provider。
 * 2. Provider 体系无可用项 → 回退旧 llmConfig + 'llm' Key（兼容旧设置页用户）。
 * 3. 两边都没有 → 返回空 Key 配置并记录 warn；调用方 isAvailable()=false 时
 *    必须向 UI 抛明确错误（"未配置 API Key"），禁止静默降级。
 */
import { ConfigStore } from '../storage/config-store'
import { SecureStore } from '../storage/secure-store'
import { logger } from '../log/logger'
import {
  ensureProvidersInitialized,
  getDefaultProviderId,
  getProviderWithApiKey,
  listProviders,
} from '../../core/agent/providers/provider-registry'
import type { ProviderConfig, ProviderType } from '@shared/agent-types'
import type { LlmConfig } from '@shared/models'

/** LlmClient 走 OpenAI SDK，只有 OpenAI 协议族 Provider 可复用 */
const OPENAI_PROTOCOL_TYPES: ReadonlySet<ProviderType> = new Set([
  'openai-compatible',
  'deepseek',
  'qwen',
  'volcengine-ark',
  'ollama',
])

/** 空配置兜底（isAvailable()=false，调用方负责向 UI 抛错） */
const EMPTY_CONFIG: LlmConfig = {
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0.7,
  maxTokens: 2048,
  timeout: 30_000,
}

/**
 * Provider 的 baseURL 归一化为 OpenAI SDK 需要的形式。
 * Provider 体系存的是 ai-sdk 风格（如 https://api.deepseek.com，自动追加 /v1），
 * 而 OpenAI SDK 直接拼 /chat/completions，缺 /v1 时需补上。
 */
function normalizeBaseUrl(baseURL: string): string {
  const trimmed = baseURL.replace(/\/+$/, '')
  if (/\/v\d+(?:beta)?$/i.test(trimmed) || /\/v\d+\//i.test(trimmed)) {
    return trimmed
  }
  return `${trimmed}/v1`
}

/** Provider 配置 → LlmConfig（温度/超时取默认参数或旧配置兜底） */
function providerToLlmConfig(provider: ProviderConfig, legacy: LlmConfig | null): LlmConfig {
  return {
    baseUrl: normalizeBaseUrl(provider.baseURL),
    apiKey: provider.apiKey ?? '',
    model: provider.model,
    temperature: provider.defaultParams?.temperature ?? legacy?.temperature ?? 0.7,
    maxTokens: provider.defaultParams?.maxTokens ?? legacy?.maxTokens ?? 2048,
    timeout: legacy?.timeout ?? 30_000,
  }
}

/** Provider 是否可被 LlmClient 复用（OpenAI 协议族 + 有 Key，ollama 免 Key） */
function isUsable(provider: ProviderConfig | null): provider is ProviderConfig {
  if (!provider || !OPENAI_PROTOCOL_TYPES.has(provider.type)) return false
  if (provider.type === 'ollama') return true
  return typeof provider.apiKey === 'string' && provider.apiKey.length > 0
}

/**
 * 解析当前生效的 LlmConfig（Provider 体系优先，旧 'llm' Key 兜底）。
 *
 * @param caller 调用方标识，用于无可用配置时的告警日志定位
 */
export function resolveLlmConfig(caller: string): LlmConfig {
  const legacy = ConfigStore.getLlmConfig()
  const legacyKey = SecureStore.getApiKey('llm') ?? ''

  // 1. Provider 体系：默认 Provider → 第一个可用的 OpenAI 协议族 Provider
  try {
    ensureProvidersInitialized()
    const defaultProvider = getProviderWithApiKey(getDefaultProviderId())
    if (isUsable(defaultProvider)) {
      return providerToLlmConfig(defaultProvider, legacy)
    }
    for (const p of listProviders(true)) {
      if (!p.hasApiKey && p.type !== 'ollama') continue
      const full = getProviderWithApiKey(p.id)
      if (isUsable(full)) {
        return providerToLlmConfig(full, legacy)
      }
    }
  } catch (err) {
    // Provider 体系异常（如存储损坏）不阻断，继续走旧配置兜底
    logger.warn('LLM.CONFIG', `Provider 体系解析失败，回退旧 llmConfig`, {
      caller,
      error: (err as Error).message,
    })
  }

  // 2. 旧体系兜底（兼容仍用旧 LLM 设置页的用户）
  if (legacy && legacyKey) {
    return { ...legacy, apiKey: legacyKey }
  }

  // 3. 全空：记录告警，调用方必须把"未配置"明确抛给 UI
  logger.warn('LLM.CONFIG', `无可用 LLM 配置（Provider 体系与旧 'llm' Key 均为空）`, { caller })
  return legacy ? { ...legacy, apiKey: '' } : EMPTY_CONFIG
}
