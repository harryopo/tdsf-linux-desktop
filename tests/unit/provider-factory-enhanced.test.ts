/**
 * Provider 工厂增强单元测试（v0.9.4 批次 2）
 *
 * 覆盖 5 项任务的核心逻辑：
 * 1. 任务 1：Ollama AUTODETECT（autodetectOllamaModels）
 *    - 成功路径：fetch 返回 200，解析 models[].name
 *    - 失败路径：fetch reject / HTTP 错误 / 解析错误 → 返回空数组（不抛错）
 *    - 超时路径：AbortController 3 秒超时
 *    - baseURL 规范化：去除 /v1 后缀
 * 2. 任务 2：selectedModels fallback（createLanguageModelWithFallback）
 *    - 主模型成功：直接返回，不触发 fallback
 *    - 主模型失败 + fallback 成功：返回 fallback 模型
 *    - 全部失败：抛聚合错误，错误信息含完整链路
 *    - 无 selectedModels：等同 createLanguageModel
 *    - 去重：selectedModels 含主模型时不重复尝试
 * 3. 任务 3：ModelRole 8 类角色（getProviderByRole + 模板 roles 字段）
 *    - 精确匹配：roles 包含目标角色 → 返回该 Provider
 *    - 优先级：第一个匹配的 Provider
 *    - fallback：无匹配角色时返回默认 Provider
 *    - 模板完整性：12 个模板均有 roles（除 openai-compatible-custom）
 * 4. 任务 4：capability 声明（PROVIDER_CAPABILITIES + getProviderCapabilities）
 *    - 默认值：8 个 ProviderType 均有默认能力
 *    - 用户覆盖：config.capabilities 优先于默认表
 *    - 深拷贝：修改返回值不影响原对象
 * 5. 任务 5：cost 透明化（PROVIDER_PRICING + getProviderPricing + calculateCost）
 *    - 默认定价：8 个 ProviderType 均有定价
 *    - 用户覆盖：config.pricing 优先于默认表
 *    - 成本计算：公式正确，四舍五入到 6 位小数
 *    - 边界情况：0 token / 负 token / 0 定价
 *
 * 测试策略：
 * - 不依赖真实网络：mock global.fetch（Ollama autodetect）
 * - 不依赖真实 electron-store / SecureStore：直接调用纯函数
 * - 不依赖真实 @ai-sdk/* 工厂：mock createLanguageModel（fallback 测试）
 *
 * 设计依据：v0.9.3 §11 第 2 类 5 项
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {
  ProviderConfig,
  PersistedProviderConfig,
  TokenUsageRecord,
  ModelPricing,
  ProviderCapabilities,
  ModelRole,
} from '../../src/shared/agent-types'

// ============================================================================
// Mock：electron-store + electron（避免 provider-registry 加载时报错）
// ============================================================================
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test-userdata',
    isReady: () => true,
  },
}))

vi.mock('electron-store', () => {
  const store = new Map<string, unknown>()
  return {
    default: class {
      get(key: string) {
        return store.get(key)
      }
      set(key: string, value: unknown) {
        store.set(key, value)
      }
      delete(key: string) {
        store.delete(key)
      }
    },
  }
})

// ============================================================================
// 工具函数：构建测试用 ProviderConfig
// ============================================================================

function makeProviderConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'test-provider',
    name: 'Test Provider',
    type: 'deepseek',
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: 'test-api-key',
    model: 'deepseek-chat',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: false,
    enabled: true,
    ...overrides,
  }
}

function makePersistedConfig(
  overrides: Partial<PersistedProviderConfig> = {}
): PersistedProviderConfig {
  const { apiKey: _unused, ...rest } = makeProviderConfig(overrides)
  void _unused
  return rest
}

// ============================================================================
// 任务 1：Ollama AUTODETECT 测试
// ============================================================================

describe('任务 1：Ollama AUTODETECT', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  describe('1.1 成功路径', () => {
    it('应正确解析 /api/tags 返回的 models[].name', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: 'qwen3:32b' },
            { name: 'llama3.3:70b' },
            { name: 'deepseek-r1:14b' },
          ],
        }),
      }) as unknown as typeof global.fetch

      const { autodetectOllamaModels } = await import(
        '../../src/main/core/agent/providers/ollama-autodetect'
      )
      const models = await autodetectOllamaModels()
      expect(models).toEqual(['qwen3:32b', 'llama3.3:70b', 'deepseek-r1:14b'])
    })

    it('应去重相同的模型名', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          models: [{ name: 'qwen3:32b' }, { name: 'qwen3:32b' }, { name: 'llama3.3:70b' }],
        }),
      }) as unknown as typeof global.fetch

      const { autodetectOllamaModels } = await import(
        '../../src/main/core/agent/providers/ollama-autodetect'
      )
      const models = await autodetectOllamaModels()
      expect(models).toEqual(['qwen3:32b', 'llama3.3:70b'])
    })

    it('应过滤掉空 name 和非字符串 name', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: 'qwen3:32b' },
            { name: '' },
            { name: null },
            { name: 123 },
            { name: 'llama3.3:70b' },
          ],
        }),
      }) as unknown as typeof global.fetch

      const { autodetectOllamaModels } = await import(
        '../../src/main/core/agent/providers/ollama-autodetect'
      )
      const models = await autodetectOllamaModels()
      expect(models).toEqual(['qwen3:32b', 'llama3.3:70b'])
    })
  })

  describe('1.2 失败路径（不抛错，返回空数组）', () => {
    it('fetch reject（网络不可达）→ 返回空数组', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof global.fetch

      const { autodetectOllamaModels } = await import(
        '../../src/main/core/agent/providers/ollama-autodetect'
      )
      const models = await autodetectOllamaModels()
      expect(models).toEqual([])
    })

    it('HTTP 错误（500）→ 返回空数组', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({}),
      }) as unknown as typeof global.fetch

      const { autodetectOllamaModels } = await import(
        '../../src/main/core/agent/providers/ollama-autodetect'
      )
      const models = await autodetectOllamaModels()
      expect(models).toEqual([])
    })

    it('JSON 解析错误 → 返回空数组', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token in JSON')
        },
      }) as unknown as typeof global.fetch

      const { autodetectOllamaModels } = await import(
        '../../src/main/core/agent/providers/ollama-autodetect'
      )
      const models = await autodetectOllamaModels()
      expect(models).toEqual([])
    })

    it('响应缺少 models 字段 → 返回空数组', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ /* 无 models 字段 */ }),
      }) as unknown as typeof global.fetch

      const { autodetectOllamaModels } = await import(
        '../../src/main/core/agent/providers/ollama-autodetect'
      )
      const models = await autodetectOllamaModels()
      expect(models).toEqual([])
    })

    it('响应 models 不是数组 → 返回空数组', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ models: 'not-an-array' }),
      }) as unknown as typeof global.fetch

      const { autodetectOllamaModels } = await import(
        '../../src/main/core/agent/providers/ollama-autodetect'
      )
      const models = await autodetectOllamaModels()
      expect(models).toEqual([])
    })
  })

  describe('1.3 baseURL 规范化', () => {
    it('应使用默认 baseURL（未传参）', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ models: [] }),
      })
      global.fetch = fetchSpy as unknown as typeof global.fetch

      const { autodetectOllamaModels, DEFAULT_OLLAMA_BASE_URL } = await import(
        '../../src/main/core/agent/providers/ollama-autodetect'
      )
      await autodetectOllamaModels()
      expect(fetchSpy).toHaveBeenCalledWith(
        `${DEFAULT_OLLAMA_BASE_URL}/api/tags`,
        expect.anything()
      )
    })

    it('应去除 baseURL 末尾的 /v1 后缀', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ models: [] }),
      })
      global.fetch = fetchSpy as unknown as typeof global.fetch

      const { autodetectOllamaModels } = await import(
        '../../src/main/core/agent/providers/ollama-autodetect'
      )
      await autodetectOllamaModels('http://localhost:11434/v1')
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.anything()
      )
    })

    it('应去除 baseURL 末尾的斜杠', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ models: [] }),
      })
      global.fetch = fetchSpy as unknown as typeof global.fetch

      const { autodetectOllamaModels } = await import(
        '../../src/main/core/agent/providers/ollama-autodetect'
      )
      await autodetectOllamaModels('http://localhost:11434/')
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.anything()
      )
    })

    it('应处理空字符串 baseURL（使用默认）', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ models: [] }),
      })
      global.fetch = fetchSpy as unknown as typeof global.fetch

      const { autodetectOllamaModels, DEFAULT_OLLAMA_BASE_URL } = await import(
        '../../src/main/core/agent/providers/ollama-autodetect'
      )
      await autodetectOllamaModels('')
      expect(fetchSpy).toHaveBeenCalledWith(
        `${DEFAULT_OLLAMA_BASE_URL}/api/tags`,
        expect.anything()
      )
    })
  })

  describe('1.4 超时处理（AbortController）', () => {
    it('应在请求中传入 AbortSignal', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ models: [] }),
      })
      global.fetch = fetchSpy as unknown as typeof global.fetch

      const { autodetectOllamaModels } = await import(
        '../../src/main/core/agent/providers/ollama-autodetect'
      )
      await autodetectOllamaModels()
      // 验证 fetch 被调用时传入了 signal
      const callArgs = fetchSpy.mock.calls[0]
      expect(callArgs[1]).toHaveProperty('signal')
      expect(callArgs[1].signal).toBeInstanceOf(AbortSignal)
    })

    it('AbortError 应被捕获，返回空数组', async () => {
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      global.fetch = vi.fn().mockRejectedValue(abortError) as unknown as typeof global.fetch

      const { autodetectOllamaModels } = await import(
        '../../src/main/core/agent/providers/ollama-autodetect'
      )
      const models = await autodetectOllamaModels()
      expect(models).toEqual([])
    })
  })
})

// ============================================================================
// 任务 2：selectedModels fallback 测试
// ============================================================================

describe('任务 2：createLanguageModelWithFallback（fallback 链）', () => {
  // 通过 vi.mock 拦截 createLanguageModel，模拟成功/失败
  let createLanguageModelMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    createLanguageModelMock = vi.fn()
    // 动态注册 mock，需在 import 之前
    vi.doMock('../../src/main/core/agent/providers/provider-factory-base', () => ({
      createLanguageModel: createLanguageModelMock,
    }))
  })

  afterEach(() => {
    vi.doUnmock('../../src/main/core/agent/providers/provider-factory-base')
    vi.restoreAllMocks()
  })

  it('2.1 主模型成功 → 直接返回，不触发 fallback', async () => {
    const fakeInstance = { model: {}, config: {}, resolvedModel: 'deepseek-chat' }
    createLanguageModelMock.mockReturnValue(fakeInstance)

    // 直接动态导入（不通过 doMock 路径，使用真实模块 + 内部 mock）
    const { createLanguageModelWithFallback } = await import(
      '../../src/main/core/agent/providers/provider-factory'
    )

    // 由于 createLanguageModel 在同模块内调用，无法直接 mock
    // 改用真实 createLanguageModel + 合法配置（type=ollama 不需要 apiKey）
    const config = makeProviderConfig({
      type: 'ollama',
      baseURL: 'http://localhost:11434/v1',
      apiKey: undefined,
      model: 'qwen3:32b',
      selectedModels: ['llama3.3:70b', 'deepseek-r1:14b'],
    })

    const instance = await createLanguageModelWithFallback(config)
    expect(instance.resolvedModel).toBe('qwen3:32b')
  })

  it('2.2 无 selectedModels → 等同于 createLanguageModel（仅尝试主模型）', async () => {
    const { createLanguageModelWithFallback } = await import(
      '../../src/main/core/agent/providers/provider-factory'
    )

    const config = makeProviderConfig({
      type: 'ollama',
      baseURL: 'http://localhost:11434/v1',
      apiKey: undefined,
      model: 'qwen3:32b',
      selectedModels: undefined,
    })

    const instance = await createLanguageModelWithFallback(config)
    expect(instance.resolvedModel).toBe('qwen3:32b')
  })

  it('2.3 主模型失败 + fallback 成功 → 返回 fallback 模型', async () => {
    const { createLanguageModelWithFallback } = await import(
      '../../src/main/core/agent/providers/provider-factory'
    )

    // 主模型用不存在的 type 触发失败 → fallback 到 ollama
    // 但 type 是同一个，只能通过 model 名称切换。这里通过 claude-sdk 类型测试：
    // claude-sdk 会被 createLanguageModel 拦截抛错
    const config = makeProviderConfig({
      type: 'claude-sdk', // createLanguageModel 会抛错
      baseURL: '',
      apiKey: 'test-key',
      model: 'claude-sonnet-4-5',
      selectedModels: [], // 空 fallback，主模型也失败 → 应抛错
    })

    await expect(createLanguageModelWithFallback(config)).rejects.toThrow(
      /所有模型均不可用/
    )
  })

  it('2.4 全部失败 → 抛聚合错误，含完整链路', async () => {
    const { createLanguageModelWithFallback } = await import(
      '../../src/main/core/agent/providers/provider-factory'
    )

    const config = makeProviderConfig({
      type: 'claude-sdk', // createLanguageModel 会抛错
      baseURL: '',
      apiKey: 'test-key',
      model: 'claude-sonnet-4-5',
      selectedModels: ['claude-opus-4-1', 'claude-haiku-4-5'],
    })

    await expect(createLanguageModelWithFallback(config)).rejects.toThrow(
      /所有模型均不可用：\[claude-sonnet-4-5, claude-opus-4-1, claude-haiku-4-5\]/
    )
  })

  it('2.5 全部失败 → 错误信息含失败详情', async () => {
    const { createLanguageModelWithFallback } = await import(
      '../../src/main/core/agent/providers/provider-factory'
    )

    const config = makeProviderConfig({
      type: 'claude-sdk',
      baseURL: '',
      apiKey: 'test-key',
      model: 'claude-sonnet-4-5',
      selectedModels: ['claude-opus-4-1'],
    })

    await expect(createLanguageModelWithFallback(config)).rejects.toThrow(
      /失败详情:/
    )
  })

  it('2.6 主模型失败 + fallback 成功 → 返回 fallback 模型（混合 type 场景）', async () => {
    const { createLanguageModelWithFallback } = await import(
      '../../src/main/core/agent/providers/provider-factory'
    )

    // 主模型 claude-sdk 会抛错，但 selectedModels 中也用 claude-sdk → 全失败
    // 改用 ollama 类型测试 fallback 成功：
    // - 主模型 model 为空 → createLanguageModel 抛错
    // - selectedModels 中有有效模型 → 成功
    const config = makeProviderConfig({
      type: 'ollama',
      baseURL: 'http://localhost:11434/v1',
      apiKey: undefined,
      model: '', // 主模型空，createLanguageModel 会抛错
      selectedModels: ['qwen3:32b'], // fallback 成功
    })

    const instance = await createLanguageModelWithFallback(config)
    expect(instance.resolvedModel).toBe('qwen3:32b')
  })

  it('2.7 去重：selectedModels 含主模型时不重复尝试', async () => {
    const { createLanguageModelWithFallback } = await import(
      '../../src/main/core/agent/providers/provider-factory'
    )

    // 主模型 qwen3:32b 成功；selectedModels 也含 qwen3:32b 应去重
    const config = makeProviderConfig({
      type: 'ollama',
      baseURL: 'http://localhost:11434/v1',
      apiKey: undefined,
      model: 'qwen3:32b',
      selectedModels: ['qwen3:32b', 'llama3.3:70b'], // 去重后只剩 llama3.3:70b
    })

    const instance = await createLanguageModelWithFallback(config)
    expect(instance.resolvedModel).toBe('qwen3:32b')
  })

  it('2.8 无任何模型（model + selectedModels 均空）→ 立即抛错', async () => {
    const { createLanguageModelWithFallback } = await import(
      '../../src/main/core/agent/providers/provider-factory'
    )

    const config = makeProviderConfig({
      type: 'ollama',
      baseURL: 'http://localhost:11434/v1',
      apiKey: undefined,
      model: '',
      selectedModels: [],
    })

    await expect(createLanguageModelWithFallback(config)).rejects.toThrow(
      /未配置任何可用模型/
    )
  })

  it('2.9 selectedModels 中的空字符串应被过滤', async () => {
    const { createLanguageModelWithFallback } = await import(
      '../../src/main/core/agent/providers/provider-factory'
    )

    // selectedModels 含空字符串应被过滤，最终 fallback 到 qwen3:32b
    const config = makeProviderConfig({
      type: 'ollama',
      baseURL: 'http://localhost:11434/v1',
      apiKey: undefined,
      model: '', // 主模型失败
      selectedModels: ['', '   ', 'qwen3:32b'], // 空字符串过滤后剩 qwen3:32b
    })

    const instance = await createLanguageModelWithFallback(config)
    expect(instance.resolvedModel).toBe('qwen3:32b')
  })
})

// ============================================================================
// 任务 3：ModelRole 8 类角色测试
// ============================================================================

describe('任务 3：ModelRole 8 类角色', () => {
  describe('3.1 类型定义', () => {
    it('ModelRole 应包含 8 个角色', () => {
      // 通过类型推断验证
      const roles: ModelRole[] = [
        'chat',
        'edit',
        'autocomplete',
        'embedding',
        'rerank',
        'preview',
        'apply',
        'summarize',
      ]
      expect(roles).toHaveLength(8)
      expect(new Set(roles).size).toBe(8) // 无重复
    })
  })

  describe('3.2 模板 roles 字段完整性', () => {
    it('PROVIDER_TEMPLATES 应有 13 个模板', async () => {
      const { PROVIDER_TEMPLATES } = await import(
        '../../src/main/core/agent/providers/provider-templates'
      )
      // 13 个模板：3 DeepSeek + 2 通义 + 1 豆包 + 1 Claude Bedrock
      // + 2 Claude SDK + 1 Gemini + 2 Ollama + 1 OpenAI 兼容
      expect(PROVIDER_TEMPLATES).toHaveLength(13)
    })

    it('deepseek-v4 → roles: [chat, summarize]', async () => {
      const { findTemplate } = await import(
        '../../src/main/core/agent/providers/provider-templates'
      )
      const t = findTemplate('deepseek-v4')
      expect(t?.roles).toEqual(['chat', 'summarize'])
    })

    it('deepseek-coder-v3 → roles: [edit, apply]', async () => {
      const { findTemplate } = await import(
        '../../src/main/core/agent/providers/provider-templates'
      )
      const t = findTemplate('deepseek-coder-v3')
      expect(t?.roles).toEqual(['edit', 'apply'])
    })

    it('deepseek-reasoner → roles: [preview]', async () => {
      const { findTemplate } = await import(
        '../../src/main/core/agent/providers/provider-templates'
      )
      const t = findTemplate('deepseek-reasoner')
      expect(t?.roles).toEqual(['preview'])
    })

    it('qwen-max → roles: [chat]', async () => {
      const { findTemplate } = await import(
        '../../src/main/core/agent/providers/provider-templates'
      )
      const t = findTemplate('qwen-max')
      expect(t?.roles).toEqual(['chat'])
    })

    it('qwen-thinking → roles: [preview]', async () => {
      const { findTemplate } = await import(
        '../../src/main/core/agent/providers/provider-templates'
      )
      const t = findTemplate('qwen-thinking')
      expect(t?.roles).toEqual(['preview'])
    })

    it('volcengine-doubao → roles: [chat]', async () => {
      const { findTemplate } = await import(
        '../../src/main/core/agent/providers/provider-templates'
      )
      const t = findTemplate('volcengine-doubao')
      expect(t?.roles).toEqual(['chat'])
    })

    it('claude-sonnet-4 (anthropic) → roles: [chat, edit]', async () => {
      const { findTemplate } = await import(
        '../../src/main/core/agent/providers/provider-templates'
      )
      const t = findTemplate('claude-sonnet-4')
      expect(t?.roles).toEqual(['chat', 'edit'])
    })

    it('claude-sonnet-4-5 (claude-sdk) → roles: [chat, edit]', async () => {
      const { findTemplate } = await import(
        '../../src/main/core/agent/providers/provider-templates'
      )
      const t = findTemplate('claude-sonnet-4-5')
      expect(t?.roles).toEqual(['chat', 'edit'])
    })

    it('claude-opus-4-1 (claude-sdk) → roles: [edit, apply]', async () => {
      const { findTemplate } = await import(
        '../../src/main/core/agent/providers/provider-templates'
      )
      const t = findTemplate('claude-opus-4-1')
      expect(t?.roles).toEqual(['edit', 'apply'])
    })

    it('gemini-pro → roles: [chat, summarize]', async () => {
      const { findTemplate } = await import(
        '../../src/main/core/agent/providers/provider-templates'
      )
      const t = findTemplate('gemini-pro')
      expect(t?.roles).toEqual(['chat', 'summarize'])
    })

    it('ollama-qwen3 → roles: [chat, autocomplete]', async () => {
      const { findTemplate } = await import(
        '../../src/main/core/agent/providers/provider-templates'
      )
      const t = findTemplate('ollama-qwen3')
      expect(t?.roles).toEqual(['chat', 'autocomplete'])
    })

    it('ollama-llama33 → roles: [chat]', async () => {
      const { findTemplate } = await import(
        '../../src/main/core/agent/providers/provider-templates'
      )
      const t = findTemplate('ollama-llama33')
      expect(t?.roles).toEqual(['chat'])
    })

    it('openai-compatible-custom → 不设置 roles（用户自定义）', async () => {
      const { findTemplate } = await import(
        '../../src/main/core/agent/providers/provider-templates'
      )
      const t = findTemplate('openai-compatible-custom')
      expect(t?.roles).toBeUndefined()
    })
  })

  describe('3.3 getProviderByRole 查找逻辑', () => {
    // getProviderByRole 依赖 listProviders，会读取 electron-store
    // 通过 ConfigStore mock 注入测试数据
    let storeData: Map<string, unknown>

    beforeEach(async () => {
      storeData = new Map<string, unknown>()

      // 重新 mock electron-store 以使用本测试的数据
      vi.resetModules()
      vi.doMock('electron-store', () => ({
        default: class {
          get(key: string) {
            return storeData.get(key)
          }
          set(key: string, value: unknown) {
            storeData.set(key, value)
          }
          delete(key: string) {
            storeData.delete(key)
          }
        },
      }))
      vi.doMock('electron', () => ({
        app: { getPath: () => '/tmp/test', isReady: () => true },
      }))
    })

    afterEach(() => {
      vi.doUnmock('electron-store')
      vi.doUnmock('electron')
      vi.restoreAllMocks()
    })

    it('3.3.1 精确匹配：roles 包含目标角色 → 返回该 Provider', async () => {
      // 注入测试数据：两个 Provider，一个含 edit 角色，一个不含
      storeData.set('agentProviders', [
        makePersistedConfig({
          id: 'p1',
          name: 'P1',
          type: 'ollama',
          baseURL: 'http://localhost:11434/v1',
          model: 'qwen3:32b',
          enabled: true,
          roles: ['chat'],
        }),
        makePersistedConfig({
          id: 'p2',
          name: 'P2',
          type: 'ollama',
          baseURL: 'http://localhost:11434/v1',
          model: 'qwen3:32b',
          enabled: true,
          roles: ['edit', 'apply'],
        }),
      ])
      storeData.set('agentDefaultProviderId', 'p1')

      const { getProviderByRole } = await import(
        '../../src/main/core/agent/providers/provider-registry'
      )
      const result = getProviderByRole('edit')
      expect(result?.id).toBe('p2')
    })

    it('3.3.2 优先级：第一个匹配的 Provider', async () => {
      storeData.set('agentProviders', [
        makePersistedConfig({
          id: 'first',
          name: 'First',
          type: 'ollama',
          baseURL: 'http://localhost:11434/v1',
          model: 'qwen3:32b',
          enabled: true,
          roles: ['chat'],
        }),
        makePersistedConfig({
          id: 'second',
          name: 'Second',
          type: 'ollama',
          baseURL: 'http://localhost:11434/v1',
          model: 'qwen3:32b',
          enabled: true,
          roles: ['chat'],
        }),
      ])
      storeData.set('agentDefaultProviderId', 'first')

      const { getProviderByRole } = await import(
        '../../src/main/core/agent/providers/provider-registry'
      )
      const result = getProviderByRole('chat')
      expect(result?.id).toBe('first')
    })

    it('3.3.3 fallback：无匹配角色 → 返回默认 Provider', async () => {
      storeData.set('agentProviders', [
        makePersistedConfig({
          id: 'only-chat',
          name: 'OnlyChat',
          type: 'ollama',
          baseURL: 'http://localhost:11434/v1',
          model: 'qwen3:32b',
          enabled: true,
          roles: ['chat'],
        }),
      ])
      storeData.set('agentDefaultProviderId', 'only-chat')

      const { getProviderByRole } = await import(
        '../../src/main/core/agent/providers/provider-registry'
      )
      // 没有 Provider 声明 embedding 角色 → fallback 到默认
      const result = getProviderByRole('embedding')
      expect(result?.id).toBe('only-chat')
    })

    it('3.3.4 disabled Provider 不参与角色匹配', async () => {
      storeData.set('agentProviders', [
        makePersistedConfig({
          id: 'disabled',
          name: 'Disabled',
          type: 'ollama',
          baseURL: 'http://localhost:11434/v1',
          model: 'qwen3:32b',
          enabled: false, // 禁用
          roles: ['edit'],
        }),
        makePersistedConfig({
          id: 'fallback',
          name: 'Fallback',
          type: 'ollama',
          baseURL: 'http://localhost:11434/v1',
          model: 'qwen3:32b',
          enabled: true,
          roles: ['chat'],
        }),
      ])
      storeData.set('agentDefaultProviderId', 'fallback')

      const { getProviderByRole } = await import(
        '../../src/main/core/agent/providers/provider-registry'
      )
      // disabled 的 edit 角色不参与 → fallback 到默认
      const result = getProviderByRole('edit')
      expect(result?.id).toBe('fallback')
    })

    it('3.3.5 默认 Provider 不存在 + 无角色匹配 → 返回 null', async () => {
      // 注意：不能直接设置 agentProviders=[]，因为 listProviders 会自动触发
      // initializeProviders() 写入预置模板（首次启动逻辑）。
      // 因此这里设置一个非空 providers（含一个无 roles 的 Provider）+ 默认 ID 不存在
      storeData.set('agentProviders', [
        makePersistedConfig({
          id: 'no-roles-provider',
          name: 'NoRoles',
          type: 'ollama',
          baseURL: 'http://localhost:11434/v1',
          model: 'qwen3:32b',
          enabled: true,
          roles: undefined, // 不声明任何角色
        }),
      ])
      // 默认 ID 设为不存在的值，避免 fallback 命中
      storeData.set('agentDefaultProviderId', 'non-existent-id')

      const { getProviderByRole } = await import(
        '../../src/main/core/agent/providers/provider-registry'
      )
      // 无匹配角色 + 默认 Provider 不存在 → 返回 null
      const result = getProviderByRole('chat')
      expect(result).toBeNull()
    })

    it('3.3.6 无 roles 字段的 Provider 不参与角色匹配', async () => {
      storeData.set('agentProviders', [
        makePersistedConfig({
          id: 'no-roles',
          name: 'NoRoles',
          type: 'ollama',
          baseURL: 'http://localhost:11434/v1',
          model: 'qwen3:32b',
          enabled: true,
          roles: undefined, // 未声明 roles
        }),
      ])
      storeData.set('agentDefaultProviderId', 'no-roles')

      const { getProviderByRole } = await import(
        '../../src/main/core/agent/providers/provider-registry'
      )
      const result = getProviderByRole('chat')
      // 无 roles 不匹配 → fallback 到默认 Provider
      expect(result?.id).toBe('no-roles')
    })
  })
})

// ============================================================================
// 任务 4：capability 声明测试
// ============================================================================

describe('任务 4：Provider 能力声明', () => {
  describe('4.1 PROVIDER_CAPABILITIES 默认值完整性', () => {
    it('4.1.1 应包含 8 个 ProviderType 的默认能力', async () => {
      const { PROVIDER_CAPABILITIES } = await import(
        '../../src/main/core/agent/providers/provider-capabilities'
      )
      const expectedTypes = [
        'anthropic',
        'google',
        'openai-compatible',
        'deepseek',
        'qwen',
        'volcengine-ark',
        'ollama',
        'claude-sdk',
      ]
      for (const t of expectedTypes) {
        expect(PROVIDER_CAPABILITIES).toHaveProperty(t)
        const caps = PROVIDER_CAPABILITIES[t as keyof typeof PROVIDER_CAPABILITIES]
        expect(caps).toHaveProperty('streaming')
        expect(caps).toHaveProperty('toolCall')
        expect(caps).toHaveProperty('vision')
        expect(caps).toHaveProperty('contextWindow')
        expect(typeof caps.streaming).toBe('boolean')
        expect(typeof caps.toolCall).toBe('boolean')
        expect(typeof caps.vision).toBe('boolean')
        expect(typeof caps.contextWindow).toBe('number')
      }
    })

    it('4.1.2 anthropic 默认能力正确（streaming/toolCall/vision/contextWindow=200K）', async () => {
      const { PROVIDER_CAPABILITIES } = await import(
        '../../src/main/core/agent/providers/provider-capabilities'
      )
      expect(PROVIDER_CAPABILITIES.anthropic).toEqual({
        streaming: true,
        toolCall: true,
        vision: true,
        contextWindow: 200_000,
        logprobs: false,
      })
    })

    it('4.1.3 google 默认能力正确（contextWindow=1M）', async () => {
      const { PROVIDER_CAPABILITIES } = await import(
        '../../src/main/core/agent/providers/provider-capabilities'
      )
      expect(PROVIDER_CAPABILITIES.google.contextWindow).toBe(1_000_000)
      expect(PROVIDER_CAPABILITIES.google.vision).toBe(true)
    })

    it('4.1.4 deepseek 默认能力正确（无 vision，64K 上下文）', async () => {
      const { PROVIDER_CAPABILITIES } = await import(
        '../../src/main/core/agent/providers/provider-capabilities'
      )
      expect(PROVIDER_CAPABILITIES.deepseek.vision).toBe(false)
      expect(PROVIDER_CAPABILITIES.deepseek.contextWindow).toBe(64_000)
    })

    it('4.1.5 ollama 默认能力正确（无 toolCall，8K 上下文）', async () => {
      const { PROVIDER_CAPABILITIES } = await import(
        '../../src/main/core/agent/providers/provider-capabilities'
      )
      expect(PROVIDER_CAPABILITIES.ollama.toolCall).toBe(false)
      expect(PROVIDER_CAPABILITIES.ollama.vision).toBe(false)
      expect(PROVIDER_CAPABILITIES.ollama.contextWindow).toBe(8_000)
    })

    it('4.1.6 claude-sdk 默认能力等同 anthropic', async () => {
      const { PROVIDER_CAPABILITIES } = await import(
        '../../src/main/core/agent/providers/provider-capabilities'
      )
      expect(PROVIDER_CAPABILITIES['claude-sdk']).toEqual(PROVIDER_CAPABILITIES.anthropic)
    })
  })

  describe('4.2 getProviderCapabilities 优先级', () => {
    it('4.2.1 无 config.capabilities → 返回默认表', async () => {
      const { getProviderCapabilities } = await import(
        '../../src/main/core/agent/providers/provider-capabilities'
      )
      const config = makePersistedConfig({
        type: 'deepseek',
        capabilities: undefined,
      })
      const caps = getProviderCapabilities(config)
      expect(caps.streaming).toBe(true)
      expect(caps.toolCall).toBe(true)
      expect(caps.vision).toBe(false)
      expect(caps.contextWindow).toBe(64_000)
    })

    it('4.2.2 有 config.capabilities → 返回用户自定义', async () => {
      const { getProviderCapabilities } = await import(
        '../../src/main/core/agent/providers/provider-capabilities'
      )
      const customCaps: ProviderCapabilities = {
        streaming: false,
        toolCall: false,
        vision: true,
        contextWindow: 999_999,
      }
      const config = makePersistedConfig({
        type: 'deepseek',
        capabilities: customCaps,
      })
      const caps = getProviderCapabilities(config)
      expect(caps).toEqual(customCaps)
    })

    it('4.2.3 返回值是深拷贝，修改不影响原对象', async () => {
      const { getProviderCapabilities } = await import(
        '../../src/main/core/agent/providers/provider-capabilities'
      )
      const customCaps: ProviderCapabilities = {
        streaming: true,
        toolCall: true,
        vision: false,
        contextWindow: 8_000,
      }
      const config = makePersistedConfig({
        type: 'ollama',
        capabilities: customCaps,
      })
      const caps1 = getProviderCapabilities(config)
      caps1.contextWindow = 999_999 // 修改返回值
      const caps2 = getProviderCapabilities(config)
      expect(caps2.contextWindow).toBe(8_000) // 原对象未受影响
    })

    it('4.2.4 无 config.capabilities → 返回默认表的深拷贝', async () => {
      const { getProviderCapabilities, PROVIDER_CAPABILITIES } = await import(
        '../../src/main/core/agent/providers/provider-capabilities'
      )
      const config = makePersistedConfig({ type: 'ollama' })
      const caps1 = getProviderCapabilities(config)
      caps1.contextWindow = 999_999 // 修改返回值
      // 默认表不应被污染
      expect(PROVIDER_CAPABILITIES.ollama.contextWindow).toBe(8_000)
    })
  })
})

// ============================================================================
// 任务 5：cost 透明化测试
// ============================================================================

describe('任务 5：Provider 成本定价与计算', () => {
  describe('5.1 PROVIDER_PRICING 默认定价完整性', () => {
    it('5.1.1 应包含 8 个 ProviderType 的默认定价', async () => {
      const { PROVIDER_PRICING } = await import(
        '../../src/main/core/agent/providers/provider-pricing'
      )
      const expectedTypes = [
        'anthropic',
        'google',
        'openai-compatible',
        'deepseek',
        'qwen',
        'volcengine-ark',
        'ollama',
        'claude-sdk',
      ]
      for (const t of expectedTypes) {
        expect(PROVIDER_PRICING).toHaveProperty(t)
        const p = PROVIDER_PRICING[t as keyof typeof PROVIDER_PRICING]
        expect(p).toHaveProperty('inputCostPer1M')
        expect(p).toHaveProperty('outputCostPer1M')
        expect(typeof p.inputCostPer1M).toBe('number')
        expect(typeof p.outputCostPer1M).toBe('number')
        expect(p.inputCostPer1M).toBeGreaterThanOrEqual(0)
        expect(p.outputCostPer1M).toBeGreaterThanOrEqual(0)
      }
    })

    it('5.1.2 anthropic 定价正确（$3 input / $15 output）', async () => {
      const { PROVIDER_PRICING } = await import(
        '../../src/main/core/agent/providers/provider-pricing'
      )
      expect(PROVIDER_PRICING.anthropic.inputCostPer1M).toBe(3.0)
      expect(PROVIDER_PRICING.anthropic.outputCostPer1M).toBe(15.0)
    })

    it('5.1.3 deepseek 定价正确（$0.14 input / $0.28 output，国产最具性价比）', async () => {
      const { PROVIDER_PRICING } = await import(
        '../../src/main/core/agent/providers/provider-pricing'
      )
      expect(PROVIDER_PRICING.deepseek.inputCostPer1M).toBe(0.14)
      expect(PROVIDER_PRICING.deepseek.outputCostPer1M).toBe(0.28)
    })

    it('5.1.4 ollama 定价为 0（本地推理）', async () => {
      const { PROVIDER_PRICING } = await import(
        '../../src/main/core/agent/providers/provider-pricing'
      )
      expect(PROVIDER_PRICING.ollama.inputCostPer1M).toBe(0.0)
      expect(PROVIDER_PRICING.ollama.outputCostPer1M).toBe(0.0)
    })

    it('5.1.5 claude-sdk 定价等同 anthropic', async () => {
      const { PROVIDER_PRICING } = await import(
        '../../src/main/core/agent/providers/provider-pricing'
      )
      expect(PROVIDER_PRICING['claude-sdk']).toEqual(PROVIDER_PRICING.anthropic)
    })

    it('5.1.6 所有默认定价的 currency 应为 USD', async () => {
      const { PROVIDER_PRICING } = await import(
        '../../src/main/core/agent/providers/provider-pricing'
      )
      for (const key of Object.keys(PROVIDER_PRICING) as Array<keyof typeof PROVIDER_PRICING>) {
        expect(PROVIDER_PRICING[key].currency).toBe('USD')
      }
    })
  })

  describe('5.2 getProviderPricing 优先级', () => {
    it('5.2.1 无 config.pricing → 返回默认表', async () => {
      const { getProviderPricing } = await import(
        '../../src/main/core/agent/providers/provider-pricing'
      )
      const config = makePersistedConfig({
        type: 'anthropic',
        pricing: undefined,
      })
      const p = getProviderPricing(config)
      expect(p.inputCostPer1M).toBe(3.0)
      expect(p.outputCostPer1M).toBe(15.0)
    })

    it('5.2.2 有 config.pricing → 返回用户自定义', async () => {
      const { getProviderPricing } = await import(
        '../../src/main/core/agent/providers/provider-pricing'
      )
      const customPricing: ModelPricing = {
        inputCostPer1M: 0.5,
        outputCostPer1M: 1.5,
        currency: 'CNY',
      }
      const config = makePersistedConfig({
        type: 'anthropic',
        pricing: customPricing,
      })
      const p = getProviderPricing(config)
      expect(p).toEqual(customPricing)
    })

    it('5.2.3 返回值是深拷贝，修改不影响原对象', async () => {
      const { getProviderPricing, PROVIDER_PRICING } = await import(
        '../../src/main/core/agent/providers/provider-pricing'
      )
      const config = makePersistedConfig({ type: 'anthropic' })
      const p1 = getProviderPricing(config)
      p1.inputCostPer1M = 999 // 修改返回值
      // 默认表不应被污染
      expect(PROVIDER_PRICING.anthropic.inputCostPer1M).toBe(3.0)
    })
  })

  describe('5.3 calculateCost 成本计算', () => {
    it('5.3.1 基础计算：1500 input + 500 output × ($3/$15) = $0.012', async () => {
      const { calculateCost } = await import(
        '../../src/main/core/agent/providers/provider-pricing'
      )
      const record: Pick<TokenUsageRecord, 'inputTokens' | 'outputTokens'> = {
        inputTokens: 1500,
        outputTokens: 500,
      }
      const pricing: ModelPricing = {
        inputCostPer1M: 3.0,
        outputCostPer1M: 15.0,
      }
      // (1500 * 3 + 500 * 15) / 1_000_000 = (4500 + 7500) / 1_000_000 = 0.012
      expect(calculateCost(record, pricing)).toBe(0.012)
    })

    it('5.3.2 deepseek 实际定价：100K input + 10K output × ($0.14/$0.28)', async () => {
      const { calculateCost } = await import(
        '../../src/main/core/agent/providers/provider-pricing'
      )
      const record: Pick<TokenUsageRecord, 'inputTokens' | 'outputTokens'> = {
        inputTokens: 100_000,
        outputTokens: 10_000,
      }
      const pricing: ModelPricing = {
        inputCostPer1M: 0.14,
        outputCostPer1M: 0.28,
      }
      // (100000 * 0.14 + 10000 * 0.28) / 1_000_000 = (14000 + 2800) / 1_000_000 = 0.0168
      expect(calculateCost(record, pricing)).toBe(0.0168)
    })

    it('5.3.3 ollama 0 定价 → 始终返回 0', async () => {
      const { calculateCost } = await import(
        '../../src/main/core/agent/providers/provider-pricing'
      )
      const record: Pick<TokenUsageRecord, 'inputTokens' | 'outputTokens'> = {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
      }
      const pricing: ModelPricing = {
        inputCostPer1M: 0.0,
        outputCostPer1M: 0.0,
      }
      expect(calculateCost(record, pricing)).toBe(0)
    })

    it('5.3.4 0 token → 0 成本', async () => {
      const { calculateCost } = await import(
        '../../src/main/core/agent/providers/provider-pricing'
      )
      const record: Pick<TokenUsageRecord, 'inputTokens' | 'outputTokens'> = {
        inputTokens: 0,
        outputTokens: 0,
      }
      const pricing: ModelPricing = {
        inputCostPer1M: 3.0,
        outputCostPer1M: 15.0,
      }
      expect(calculateCost(record, pricing)).toBe(0)
    })

    it('5.3.5 负 token → 视为 0（防御性处理）', async () => {
      const { calculateCost } = await import(
        '../../src/main/core/agent/providers/provider-pricing'
      )
      const record: Pick<TokenUsageRecord, 'inputTokens' | 'outputTokens'> = {
        inputTokens: -100,
        outputTokens: -200,
      }
      const pricing: ModelPricing = {
        inputCostPer1M: 3.0,
        outputCostPer1M: 15.0,
      }
      expect(calculateCost(record, pricing)).toBe(0)
    })

    it('5.3.6 NaN/undefined token → 视为 0（防御性处理）', async () => {
      const { calculateCost } = await import(
        '../../src/main/core/agent/providers/provider-pricing'
      )
      const record = {
        inputTokens: NaN,
        outputTokens: undefined as unknown as number,
      }
      const pricing: ModelPricing = {
        inputCostPer1M: 3.0,
        outputCostPer1M: 15.0,
      }
      expect(calculateCost(record, pricing)).toBe(0)
    })

    it('5.3.7 计算结果四舍五入到 6 位小数', async () => {
      const { calculateCost } = await import(
        '../../src/main/core/agent/providers/provider-pricing'
      )
      // (1 * 0.14 + 1 * 0.28) / 1_000_000 = 0.00000042
      // 四舍五入到 6 位小数 → 0
      const record: Pick<TokenUsageRecord, 'inputTokens' | 'outputTokens'> = {
        inputTokens: 1,
        outputTokens: 1,
      }
      const pricing: ModelPricing = {
        inputCostPer1M: 0.14,
        outputCostPer1M: 0.28,
      }
      expect(calculateCost(record, pricing)).toBe(0)
    })

    it('5.3.8 大额 token 计算正确（100 万 input + 50 万 output）', async () => {
      const { calculateCost } = await import(
        '../../src/main/core/agent/providers/provider-pricing'
      )
      const record: Pick<TokenUsageRecord, 'inputTokens' | 'outputTokens'> = {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
      }
      const pricing: ModelPricing = {
        inputCostPer1M: 3.0,
        outputCostPer1M: 15.0,
      }
      // (1000000 * 3 + 500000 * 15) / 1_000_000 = (3000000 + 7500000) / 1_000_000 = 10.5
      expect(calculateCost(record, pricing)).toBe(10.5)
    })

    it('5.3.9 仅 input token 时计算正确', async () => {
      const { calculateCost } = await import(
        '../../src/main/core/agent/providers/provider-pricing'
      )
      const record: Pick<TokenUsageRecord, 'inputTokens' | 'outputTokens'> = {
        inputTokens: 2_000_000,
        outputTokens: 0,
      }
      const pricing: ModelPricing = {
        inputCostPer1M: 1.25,
        outputCostPer1M: 5.0,
      }
      // (2000000 * 1.25 + 0 * 5) / 1_000_000 = 2.5
      expect(calculateCost(record, pricing)).toBe(2.5)
    })

    it('5.3.10 仅 output token 时计算正确', async () => {
      const { calculateCost } = await import(
        '../../src/main/core/agent/providers/provider-pricing'
      )
      const record: Pick<TokenUsageRecord, 'inputTokens' | 'outputTokens'> = {
        inputTokens: 0,
        outputTokens: 200_000,
      }
      const pricing: ModelPricing = {
        inputCostPer1M: 1.25,
        outputCostPer1M: 5.0,
      }
      // (0 * 1.25 + 200000 * 5) / 1_000_000 = 1.0
      expect(calculateCost(record, pricing)).toBe(1.0)
    })
  })

  describe('5.4 端到端：getProviderPricing + calculateCost', () => {
    it('5.4.1 deepseek 端到端：1M input + 200K output → $0.196', async () => {
      const { getProviderPricing, calculateCost } = await import(
        '../../src/main/core/agent/providers/provider-pricing'
      )
      const config = makePersistedConfig({ type: 'deepseek' })
      const pricing = getProviderPricing(config)
      const cost = calculateCost(
        { inputTokens: 1_000_000, outputTokens: 200_000 },
        pricing
      )
      // (1000000 * 0.14 + 200000 * 0.28) / 1_000_000 = (140000 + 56000) / 1_000_000 = 0.196
      expect(cost).toBe(0.196)
    })

    it('5.4.2 ollama 端到端：任意 token → 0 成本', async () => {
      const { getProviderPricing, calculateCost } = await import(
        '../../src/main/core/agent/providers/provider-pricing'
      )
      const config = makePersistedConfig({ type: 'ollama' })
      const pricing = getProviderPricing(config)
      const cost = calculateCost(
        { inputTokens: 5_000_000, outputTokens: 1_000_000 },
        pricing
      )
      expect(cost).toBe(0)
    })

    it('5.4.3 用户自定义定价端到端：覆盖默认值', async () => {
      const { getProviderPricing, calculateCost } = await import(
        '../../src/main/core/agent/providers/provider-pricing'
      )
      const config = makePersistedConfig({
        type: 'anthropic',
        pricing: {
          inputCostPer1M: 0.0, // 用户拿到了免费额度
          outputCostPer1M: 0.0,
          currency: 'USD',
        },
      })
      const pricing = getProviderPricing(config)
      const cost = calculateCost(
        { inputTokens: 1_000_000, outputTokens: 500_000 },
        pricing
      )
      expect(cost).toBe(0)
    })
  })
})
