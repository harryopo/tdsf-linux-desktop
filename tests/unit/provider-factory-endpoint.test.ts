/**
 * provider-factory-endpoint.test.ts — Provider 工厂端点回归测试
 *
 * 锁死 v2.4 修复的两个真实 bug：
 *   1. @ai-sdk/openai v2 的 openai(model) 默认走 Responses API（/responses），
 *      而 DeepSeek/Qwen/Volcengine/Ollama 等国产兼容端只实现 /chat/completions。
 *      → 所有 OpenAI 兼容 Provider 必须用 openai.chat(model)，否则端点不存在、空输出。
 *   2. DeepSeek 类型需注入自定义 fetch（关闭思考模式），createOpenAI 必须收到 fetch 选项。
 *
 * 策略：mock @ai-sdk/openai 的 createOpenAI，断言：
 *   - 返回的 provider 被以 .chat(model) 方式调用（而非默认 provider(model)）
 *   - deepseek 类型创建时传入了自定义 fetch
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ProviderConfig } from '../../src/shared/agent-types'

// ============================================================================
// Mock：electron / electron-store（provider-registry 依赖，避免加载报错）
// ============================================================================
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-userdata', isReady: () => true },
}))
vi.mock('electron-store', () => {
  const store = new Map<string, unknown>()
  return {
    default: class {
      get(k: string) {
        return store.get(k)
      }
      set(k: string, v: unknown) {
        store.set(k, v)
      }
    },
  }
})

// ============================================================================
// Mock：@ai-sdk/openai — 记录 createOpenAI 入参 + 区分 provider(model) vs provider.chat(model)
// ============================================================================
/** 记录每次 createOpenAI 的调用参数与后续方法调用 */
const openaiCalls: Array<{
  options: Record<string, unknown>
  defaultCalledWith: string[]
  chatCalledWith: string[]
}> = []

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: (options: Record<string, unknown>) => {
    const record = { options, defaultCalledWith: [] as string[], chatCalledWith: [] as string[] }
    openaiCalls.push(record)
    // provider 既可被当函数调用（默认 = Responses API），也有 .chat 方法（chat/completions）
    const provider = (modelId: string) => {
      record.defaultCalledWith.push(modelId)
      return { __kind: 'responses-model', modelId }
    }
    provider.chat = (modelId: string) => {
      record.chatCalledWith.push(modelId)
      return { __kind: 'chat-model', modelId }
    }
    return provider
  },
}))
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: () => (m: string) => ({ modelId: m }) }))
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: () => (m: string) => ({ modelId: m }) }))

// 动态 import（确保 mock 生效后再加载被测模块）
const { createLanguageModel } = await import('../../src/main/core/agent/providers/provider-factory')

function makeConfig(overrides: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: 'test',
    name: 'Test',
    type: 'deepseek',
    baseURL: 'https://api.deepseek.com',
    apiKey: 'sk-test',
    model: 'deepseek-v4-flash',
    ...overrides,
  }
}

describe('provider-factory 端点回归（v2.4 修复锁死）', () => {
  beforeEach(() => {
    openaiCalls.length = 0
  })

  it('deepseek 必须走 .chat() 而非默认 Responses API', () => {
    createLanguageModel(makeConfig({ type: 'deepseek', model: 'deepseek-v4-flash' }))
    expect(openaiCalls).toHaveLength(1)
    // 关键断言：用 chat(model)，绝不用默认 provider(model)（后者 = Responses API）
    expect(openaiCalls[0].chatCalledWith).toEqual(['deepseek-v4-flash'])
    expect(openaiCalls[0].defaultCalledWith).toEqual([])
  })

  it('deepseek 创建时必须注入自定义 fetch（用于关闭思考模式）', () => {
    createLanguageModel(makeConfig({ type: 'deepseek' }))
    expect(typeof openaiCalls[0].options.fetch).toBe('function')
  })

  it('qwen / volcengine-ark / ollama / openai-compatible 都必须走 .chat()', () => {
    const types: ProviderConfig['type'][] = [
      'qwen',
      'volcengine-ark',
      'ollama',
      'openai-compatible',
    ]
    for (const type of types) {
      openaiCalls.length = 0
      createLanguageModel(makeConfig({ type, model: `${type}-model` }))
      expect(openaiCalls[0].chatCalledWith, `${type} 应走 .chat()`).toEqual([`${type}-model`])
      expect(openaiCalls[0].defaultCalledWith, `${type} 不应走默认 Responses API`).toEqual([])
    }
  })

  it('自定义 fetch 应向 JSON body 注入 thinking:disabled', async () => {
    createLanguageModel(makeConfig({ type: 'deepseek' }))
    const injectedFetch = openaiCalls[0].options.fetch as typeof fetch
    // 用一个假 fetch 捕获最终 body（拦截真实网络）
    const globalFetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))
    try {
      await injectedFetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'deepseek-v4-flash', messages: [] }),
      })
      const passedInit = globalFetchSpy.mock.calls[0][1] as RequestInit
      const passedBody = JSON.parse(passedInit.body as string)
      expect(passedBody.thinking).toEqual({ type: 'disabled' })
    } finally {
      globalFetchSpy.mockRestore()
    }
  })

  it('v2.11 deepThinking=true 时自定义 fetch 应注入 thinking:enabled + reasoning_effort:high', async () => {
    createLanguageModel(makeConfig({ type: 'deepseek' }), { deepThinking: true })
    const injectedFetch = openaiCalls[0].options.fetch as typeof fetch
    const globalFetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))
    try {
      await injectedFetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'deepseek-v4-flash', messages: [] }),
      })
      const passedInit = globalFetchSpy.mock.calls[0][1] as RequestInit
      const passedBody = JSON.parse(passedInit.body as string)
      // 关键断言：deep 模式开启真实思考（此前恒为 disabled 的回归锁死）
      expect(passedBody.thinking).toEqual({ type: 'enabled' })
      expect(passedBody.reasoning_effort).toBe('high')
    } finally {
      globalFetchSpy.mockRestore()
    }
  })
})
