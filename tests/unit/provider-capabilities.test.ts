/**
 * Provider 能力声明单元测试
 *
 * v0.9.7 P3 M1 新增：logprobs 能力字段（用于可信度模块的 CoT-shape 熵轨迹计算）
 *
 * 论文依据：Zhao 2026, arXiv:2603.18940 — token entropy 比 text-Shannon entropy
 * 更预测 LLM 推理可靠性。需要 provider 暴露 per-token logprobs 才能走真实路径，
 * 否则降级到 thinking-block / text-fallback。
 *
 * 测试目标：
 * - 8 个 ProviderType 默认能力字段全（streaming / toolCall / vision / contextWindow / logprobs）
 * - getProviderCapabilities 优先用户自定义
 * - 用户未设置 capabilities 时返回默认表
 * - 返回值是深拷贝（避免污染原对象）
 * - Claude / Google / claude-sdk 不支持 logprobs（兑底到 text-fallback）
 * - 5/8 OpenAI 兼容 provider 支持 logprobs
 */
import { describe, it, expect } from 'vitest'
import {
  PROVIDER_CAPABILITIES,
  getProviderCapabilities,
} from '../../src/main/core/agent/providers/provider-capabilities'
import type {
  ProviderType,
  PersistedProviderConfig,
  ProviderCapabilities,
} from '../../src/main/core/agent/providers/types'

// ============================================================================
// PROVIDER_CAPABILITIES 默认表完整性
// ============================================================================
describe('provider-capabilities — 默认表完整性（v0.9.7 P3 M1 加 logprobs）', () => {
  const allTypes: ProviderType[] = [
    'anthropic',
    'google',
    'openai-compatible',
    'deepseek',
    'qwen',
    'volcengine-ark',
    'ollama',
    'claude-sdk',
  ]

  it('8 个 ProviderType 全部注册到默认表', () => {
    for (const t of allTypes) {
      expect(PROVIDER_CAPABILITIES[t]).toBeDefined()
    }
  })

  it('每个 provider 的 5 个能力字段都存在且类型正确', () => {
    for (const t of allTypes) {
      const caps = PROVIDER_CAPABILITIES[t]
      expect(typeof caps.streaming).toBe('boolean')
      expect(typeof caps.toolCall).toBe('boolean')
      expect(typeof caps.vision).toBe('boolean')
      expect(typeof caps.contextWindow).toBe('number')
      expect(typeof caps.logprobs).toBe('boolean') // v0.9.7 新增
      expect(caps.contextWindow).toBeGreaterThanOrEqual(0)
    }
  })

  it('所有 provider 都支持 streaming（v0.9 baseline 假设）', () => {
    for (const t of allTypes) {
      expect(PROVIDER_CAPABILITIES[t].streaming).toBe(true)
    }
  })
})

// ============================================================================
// v0.9.7 P3 M1 新增：logprobs 能力分级（5/8 支持）
// ============================================================================
describe('provider-capabilities — logprobs 能力分级（5/8 支持）', () => {
  it('支持 logprobs：openai-compatible / deepseek / qwen / volcengine-ark / ollama', () => {
    const supported: ProviderType[] = [
      'openai-compatible',
      'deepseek',
      'qwen',
      'volcengine-ark',
      'ollama',
    ]
    for (const t of supported) {
      expect(PROVIDER_CAPABILITIES[t].logprobs).toBe(true)
    }
  })

  it('不支持 logprobs：anthropic / claude-sdk / google（兑底到 text-fallback）', () => {
    const unsupported: ProviderType[] = ['anthropic', 'claude-sdk', 'google']
    for (const t of unsupported) {
      expect(PROVIDER_CAPABILITIES[t].logprobs).toBe(false)
    }
  })

  it('5/8 = 62.5% 主流 provider 支持 logprobs（论文级 token entropy）', () => {
    const total = Object.keys(PROVIDER_CAPABILITIES).length
    const supported = Object.values(PROVIDER_CAPABILITIES).filter((c) => c.logprobs).length
    expect(supported).toBe(5) // openai-compatible / deepseek / qwen / volcengine-ark / ollama
    expect(supported / total).toBeGreaterThanOrEqual(0.5)
  })
})

// ============================================================================
// getProviderCapabilities 函数行为
// ============================================================================
describe('provider-capabilities — getProviderCapabilities() 行为', () => {
  const baseConfig = (type: ProviderType, overrides: Partial<PersistedProviderConfig> = {}): PersistedProviderConfig => ({
    id: `test-${type}`,
    name: `Test ${type}`,
    type,
    baseURL: 'https://example.com',
    model: 'test-model',
    enabled: true,
    ...overrides,
  })

  it('用户未设置 capabilities → 返回默认表（按 type 推断）', () => {
    const config = baseConfig('anthropic')
    const caps = getProviderCapabilities(config)
    expect(caps).toEqual(PROVIDER_CAPABILITIES.anthropic)
  })

  it('用户设置 capabilities → 优先返回用户值', () => {
    const customCaps: ProviderCapabilities = {
      streaming: false,
      toolCall: false,
      vision: false,
      contextWindow: 100,
      logprobs: true, // 即使 anthropic 默认 false，用户可覆盖
    }
    const config = baseConfig('anthropic', { capabilities: customCaps })
    const caps = getProviderCapabilities(config)
    expect(caps).toEqual(customCaps)
    expect(caps.logprobs).toBe(true)
  })

  it('返回值是深拷贝（修改返回对象不影响默认表）', () => {
    const config = baseConfig('deepseek')
    const caps = getProviderCapabilities(config)
    caps.streaming = false
    caps.logprobs = false
    // 默认表应保持原值
    expect(PROVIDER_CAPABILITIES.deepseek.streaming).toBe(true)
    expect(PROVIDER_CAPABILITIES.deepseek.logprobs).toBe(true)
  })

  it('用户自定义 capabilities 也会深拷贝（避免污染用户原对象）', () => {
    const customCaps: ProviderCapabilities = {
      streaming: true,
      toolCall: true,
      vision: false,
      contextWindow: 1000,
      logprobs: false,
    }
    const config = baseConfig('openai-compatible', { capabilities: customCaps })
    const caps = getProviderCapabilities(config)
    caps.contextWindow = 99999
    expect(customCaps.contextWindow).toBe(1000) // 原对象未被修改
  })
})

// ============================================================================
// 业务场景：可信度模块的 logprobs 选路
// ============================================================================
describe('provider-capabilities — 业务场景：可信度模块 logprobs 选路', () => {
  const baseConfig = (type: ProviderType): PersistedProviderConfig => ({
    id: `test-${type}`,
    name: `Test ${type}`,
    type,
    baseURL: 'https://example.com',
    model: 'test-model',
  })

  it('OpenAI 兼容 provider（deepseek）→ 启用 logprobs 直采', () => {
    const caps = getProviderCapabilities(baseConfig('deepseek'))
    expect(caps.logprobs).toBe(true)
    // supervisor.ts 会透传 providerOptions.openai.logprobs=true
  })

  it('Claude（anthropic）→ 关闭 logprobs，走 thinking-block / text-fallback', () => {
    const caps = getProviderCapabilities(baseConfig('anthropic'))
    expect(caps.logprobs).toBe(false)
    // supervisor.ts 不传 providerOptions.openai.logprobs
    // traceCollector 仅 accumulateFinalText（fallback 路径）
  })

  it('Claude Agent SDK（claude-sdk）→ 关闭 logprobs，走 fallback', () => {
    const caps = getProviderCapabilities(baseConfig('claude-sdk'))
    expect(caps.logprobs).toBe(false)
  })

  it('Google Gemini（google）→ 关闭 logprobs，走 fallback', () => {
    const caps = getProviderCapabilities(baseConfig('google'))
    expect(caps.logprobs).toBe(false)
  })

  it('Ollama（本地）→ 启用 logprobs（Ollama 协议支持）', () => {
    const caps = getProviderCapabilities(baseConfig('ollama'))
    expect(caps.logprobs).toBe(true)
  })
})
