/**
 * Task Protocol 步骤 6-10 单元测试（v2.0 Phase D）
 *
 * 覆盖 task-protocol-steps-mid.ts 的 5 个步骤函数：
 * - step 6: select-provider（解析 providerId + createLanguageModel）
 * - step 7: select-mode（input.mode / getCurrentMode / MODE_CONFIGS）
 * - step 8: build-prompt（systemPrompt + userPrompt + compactIfNeeded）
 * - step 9: invoke-subagent（claude-sdk / streamText 两条路径）
 * - step 10: stream-output（提取 chatResult.text + cancelled 标记）
 *
 * Mock 策略：
 * - electron + electron-store（logger 间接依赖）
 * - 'ai' 模块 streamText（避免真实网络调用）
 * - provider-registry / provider-factory（避免触发 electron-store）
 * - mode-registry（提供可控 MODE_CONFIGS）
 * - context.compactIfNeeded（直接返回 messages 透传）
 * - ClaudeSdkProvider（避免 SDK 依赖）
 * - task-protocol-helpers（保留纯函数实现）
 *
 * 设计依据：v2.0 Phase D（task-protocol-steps-mid.ts §6-10）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TaskProtocolContext } from '../../src/main/core/agent/subagents/task-protocol-types'
import type { ProviderConfig, ModeConfig, ChatResult } from '../../src/shared/agent-types'

// ============================================================================
// Mock：electron + electron-store
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
// Mock：provider-registry（getProviderWithApiKey / getDefaultProviderId / ensureProvidersInitialized）
// ============================================================================
const mockGetProviderWithApiKey = vi.hoisted(() => vi.fn<(id: string) => ProviderConfig | null>())
vi.mock('../../src/main/core/agent/providers/provider-registry', () => ({
  getProviderWithApiKey: (id: string) => mockGetProviderWithApiKey(id),
  getDefaultProviderId: () => 'default-provider-id',
  ensureProvidersInitialized: vi.fn(),
}))

// ============================================================================
// Mock：provider-factory（createLanguageModel / getDefaultParams）
// ============================================================================
const mockCreateLanguageModel = vi.hoisted(() => vi.fn())
vi.mock('../../src/main/core/agent/providers/provider-factory', () => ({
  createLanguageModel: (...args: unknown[]) => mockCreateLanguageModel(...args),
  getDefaultParams: () => ({ temperature: 0.7, maxTokens: 2048 }),
}))

// ============================================================================
// Mock：mode-registry（MODE_CONFIGS / isValidMode / getCurrentMode / DEFAULT_MODE）
// 用 vi.hoisted 提升 mockChatModeConfig / mockCodeModeConfig，避免 hoisting 引用错误
// ============================================================================
const { mockChatModeConfig, mockCodeModeConfig } = vi.hoisted(() => {
  const chat: ModeConfig = {
    mode: 'chat',
    displayName: '普通对话',
    systemPrompt: 'You are a chat assistant.',
    allowedTools: ['search', 'kb'],
    canWriteFiles: false,
    canExecuteCommands: false,
    canModifySandbox: false,
    description: 'chat mode',
  }
  const code: ModeConfig = {
    mode: 'code',
    displayName: '代码模式',
    systemPrompt: 'You are a code assistant.',
    allowedTools: ['*'],
    canWriteFiles: true,
    canExecuteCommands: true,
    canModifySandbox: false,
    description: 'code mode',
  }
  return { mockChatModeConfig: chat, mockCodeModeConfig: code }
})

vi.mock('../../src/main/core/agent/modes/mode-registry', () => ({
  MODE_CONFIGS: {
    chat: mockChatModeConfig,
    ask: { ...mockChatModeConfig, mode: 'ask' },
    plan: { ...mockChatModeConfig, mode: 'plan' },
    code: mockCodeModeConfig,
    debug: { ...mockChatModeConfig, mode: 'debug' },
  },
  isValidMode: (mode: string): boolean =>
    ['chat', 'ask', 'plan', 'code', 'debug'].includes(mode),
  getCurrentMode: () => 'chat' as const,
  DEFAULT_MODE: 'chat',
}))

// ============================================================================
// Mock：context.compactIfNeeded（直接透传 messages）
// ============================================================================
vi.mock('../../src/main/core/agent/context', () => ({
  compactIfNeeded: (messages: unknown[]) => ({
    messages,
    level: 'none' as const,
    beforeTokens: 100,
    afterTokens: 100,
    truncatedCount: 0,
  }),
}))

// ============================================================================
// Mock：ClaudeSdkProvider（避免 SDK 依赖）
// ============================================================================
const mockClaudeSdkGenerate = vi.hoisted(() => vi.fn())
vi.mock('../../src/main/core/agent/claude-sdk/claude-sdk-provider', () => ({
  ClaudeSdkProvider: class {
    constructor(_config: unknown) {}
    generate = (...args: unknown[]) => mockClaudeSdkGenerate(...args)
  },
}))

// ============================================================================
// Mock：ai 模块 streamText（避免真实网络调用）
// ============================================================================
const mockStreamText = vi.hoisted(() => vi.fn())
vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
}))

// ============================================================================
// Mock：task-protocol-helpers（保留纯函数实现）
// ============================================================================
vi.mock('../../src/main/core/agent/subagents/task-protocol-helpers', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  readInputField: (input: unknown, field: string): unknown => {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      return (input as Record<string, unknown>)[field]
    }
    return undefined
  },
  extractStringField: (input: unknown, field: string): string | undefined => {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      const v = (input as Record<string, unknown>)[field]
      return typeof v === 'string' && v.length > 0 ? v : undefined
    }
    return undefined
  },
  createBuiltinRegistry: () => ({ get: () => null, list: () => [] }),
}))

// ============================================================================
// 导入被测模块（必须在 mock 注册之后）
// ============================================================================
import {
  stepSelectProvider,
  stepSelectMode,
  stepBuildPrompt,
  stepInvokeSubagent,
  stepStreamOutput,
} from '../../src/main/core/agent/subagents/task-protocol-steps-mid'

// ============================================================================
// 工具函数
// ============================================================================
function makeCtx(overrides: Partial<TaskProtocolContext> = {}): TaskProtocolContext {
  return {
    taskId: 'task-001',
    subagentName: 'coding',
    input: '帮我搜索 nginx 部署',
    completedSteps: [],
    currentStep: 0,
    cancelled: false,
    ...overrides,
  }
}

function makeProviderConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'deepseek-v4',
    name: 'DeepSeek V4',
    type: 'deepseek',
    baseURL: 'https://api.deepseek.com',
    apiKey: 'sk-test-key',
    model: 'deepseek-chat',
    defaultParams: { temperature: 0.7, maxTokens: 4096 },
    builtin: false,
    enabled: true,
    ...overrides,
  }
}

function makeChatResult(overrides: Partial<ChatResult> = {}): ChatResult {
  return {
    text: '这是 LLM 返回的文本',
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    finishReason: 'stop',
    providerId: 'deepseek-v4',
    model: 'deepseek-chat',
    strength: 'standard',
    durationMs: 200,
    compactionLevel: 'none',
    ...overrides,
  }
}

// ============================================================================
// 测试用例
// ============================================================================

describe('[task-protocol-step-6] select-provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('6.1 成功路径：使用默认 providerId 且 type 非 claude-sdk → 创建 modelInstance', async () => {
    const config = makeProviderConfig({ type: 'deepseek' })
    mockGetProviderWithApiKey.mockReturnValue(config)
    mockCreateLanguageModel.mockReturnValue({
      model: 'mock-model',
      config: { ...config, apiKey: undefined },
      resolvedModel: 'deepseek-chat',
    })

    const ctx = makeCtx({ input: { prompt: 'hello' } })
    const result = await stepSelectProvider(ctx)

    expect(result.success).toBe(true)
    expect(result.step).toBe('select-provider')
    expect(ctx.providerConfig).toBe(config)
    expect(ctx.providerType).toBe('deepseek')
    expect(ctx.modelInstance).toBeDefined()
    expect(result.output).toMatchObject({
      providerId: 'deepseek-v4',
      providerType: 'deepseek',
      source: 'default',
    })
    expect(mockGetProviderWithApiKey).toHaveBeenCalledWith('default-provider-id')
  })

  it('6.2 成功路径：input.providerId 指定 → 优先使用且 source=input', async () => {
    const config = makeProviderConfig({ id: 'custom-p1', type: 'qwen' })
    mockGetProviderWithApiKey.mockReturnValue(config)
    mockCreateLanguageModel.mockReturnValue({
      model: 'mock-qwen',
      config: { ...config, apiKey: undefined },
      resolvedModel: 'qwen-max',
    })

    const ctx = makeCtx({ input: { providerId: 'custom-p1', prompt: 'hi' } })
    const result = await stepSelectProvider(ctx)

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      providerId: 'custom-p1',
      source: 'input',
    })
    expect(mockGetProviderWithApiKey).toHaveBeenCalledWith('custom-p1')
  })

  it('6.3 失败路径：providerId 对应 Provider 不存在 → success=false', async () => {
    mockGetProviderWithApiKey.mockReturnValue(null)

    const ctx = makeCtx()
    const result = await stepSelectProvider(ctx)

    expect(result.success).toBe(false)
    expect(result.error).toContain('不存在')
    expect(ctx.providerConfig).toBeUndefined()
  })

  it('6.4 边界：type=claude-sdk 时不创建 modelInstance（走 ClaudeSdkProvider 路径）', async () => {
    const config = makeProviderConfig({ type: 'claude-sdk', model: 'claude-sonnet-4' })
    mockGetProviderWithApiKey.mockReturnValue(config)

    const ctx = makeCtx()
    const result = await stepSelectProvider(ctx)

    expect(result.success).toBe(true)
    expect(ctx.providerType).toBe('claude-sdk')
    expect(ctx.modelInstance).toBeUndefined()
    expect(mockCreateLanguageModel).not.toHaveBeenCalled()
  })

  it('6.5 失败路径：createLanguageModel 抛错 → success=false 且错误信息含创建失败', async () => {
    const config = makeProviderConfig({ type: 'ollama' })
    mockGetProviderWithApiKey.mockReturnValue(config)
    mockCreateLanguageModel.mockImplementation(() => {
      throw new Error('Ollama 服务不可用')
    })

    const ctx = makeCtx()
    const result = await stepSelectProvider(ctx)

    expect(result.success).toBe(false)
    expect(result.error).toContain('创建 LanguageModel 失败')
    expect(result.error).toContain('Ollama 服务不可用')
  })
})

describe('[task-protocol-step-7] select-mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('7.1 成功路径：input.mode 合法 → 使用 input mode 且 source=input', async () => {
    const ctx = makeCtx({ input: { mode: 'code', prompt: 'hi' } })
    const result = await stepSelectMode(ctx)

    expect(result.success).toBe(true)
    expect(result.step).toBe('select-mode')
    expect(ctx.mode).toBe('code')
    expect(ctx.modeConfig).toBe(mockCodeModeConfig)
    expect(result.output).toMatchObject({
      mode: 'code',
      displayName: '代码模式',
      source: 'input',
    })
  })

  it('7.2 成功路径：input.mode 未指定 → 使用 getCurrentMode 默认值 chat', async () => {
    const ctx = makeCtx({ input: 'hello' })
    const result = await stepSelectMode(ctx)

    expect(result.success).toBe(true)
    expect(ctx.mode).toBe('chat')
    expect(result.output).toMatchObject({
      mode: 'chat',
      source: 'current',
    })
  })

  it('7.3 边界：input.mode 为非法字符串 → 回退到 getCurrentMode', async () => {
    const ctx = makeCtx({ input: { mode: 'invalid-mode', prompt: 'hi' } })
    const result = await stepSelectMode(ctx)

    expect(result.success).toBe(true)
    expect(ctx.mode).toBe('chat')
  })

  it('7.4 边界：input.mode 字段非字符串类型 → 回退到 getCurrentMode', async () => {
    const ctx = makeCtx({ input: { mode: 123, prompt: 'hi' } })
    const result = await stepSelectMode(ctx)

    expect(result.success).toBe(true)
    expect(ctx.mode).toBe('chat')
  })
})

describe('[task-protocol-step-8] build-prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('8.1 成功路径：input 为字符串 → userPrompt=字符串本身', async () => {
    const ctx = makeCtx({
      input: '请帮我搜索 nginx 配置',
      modeConfig: mockChatModeConfig,
      attentionContext: '',
    })
    const result = await stepBuildPrompt(ctx)

    expect(result.success).toBe(true)
    expect(result.step).toBe('build-prompt')
    expect(ctx.userPrompt).toBe('请帮我搜索 nginx 配置')
    expect(ctx.systemPrompt).toBe(mockChatModeConfig.systemPrompt)
    expect(ctx.messages).toHaveLength(2)
    expect(ctx.messages?.[0]).toMatchObject({ role: 'system' })
    expect(ctx.messages?.[1]).toMatchObject({ role: 'user' })
  })

  it('8.2 失败路径：缺少 modeConfig → success=false', async () => {
    const ctx = makeCtx()
    delete ctx.modeConfig

    const result = await stepBuildPrompt(ctx)

    expect(result.success).toBe(false)
    expect(result.error).toContain('modeConfig')
    expect(ctx.messages).toBeUndefined()
  })

  it('8.3 边界：attentionContext 有值时拼接到 systemPrompt', async () => {
    const ctx = makeCtx({
      input: 'hi',
      modeConfig: mockChatModeConfig,
      attentionContext: '关注文件：nginx.conf',
    })
    const result = await stepBuildPrompt(ctx)

    expect(result.success).toBe(true)
    expect(ctx.systemPrompt).toContain(mockChatModeConfig.systemPrompt)
    expect(ctx.systemPrompt).toContain('[当前注意力上下文]')
    expect(ctx.systemPrompt).toContain('关注文件：nginx.conf')
  })

  it('8.4 边界：input 为对象且无 prompt/description → userPrompt=JSON.stringify(input)', async () => {
    const ctx = makeCtx({
      input: { foo: 'bar', count: 42 },
      modeConfig: mockChatModeConfig,
    })
    const result = await stepBuildPrompt(ctx)

    expect(result.success).toBe(true)
    expect(ctx.userPrompt).toContain('"foo"')
    expect(ctx.userPrompt).toContain('"bar"')
    expect(ctx.userPrompt).toContain('"count":42')
  })

  it('8.5 边界：input 为对象含 description → userPrompt=description 字段值', async () => {
    const ctx = makeCtx({
      input: { description: '描述文本', data: 'xxx' },
      modeConfig: mockChatModeConfig,
    })
    const result = await stepBuildPrompt(ctx)

    expect(result.success).toBe(true)
    expect(ctx.userPrompt).toBe('描述文本')
  })
})

describe('[task-protocol-step-9] invoke-subagent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('9.1 成功路径：claude-sdk 路径 → 调用 ClaudeSdkProvider.generate', async () => {
    const config = makeProviderConfig({ type: 'claude-sdk', model: 'claude-sonnet-4' })
    const ctx = makeCtx({
      input: 'hi',
      providerConfig: config,
      providerType: 'claude-sdk',
      systemPrompt: 'sys',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
    })

    const chatResult = makeChatResult({
      text: 'claude-sdk output',
      providerId: config.id,
      model: 'claude-sonnet-4',
    })
    mockClaudeSdkGenerate.mockResolvedValue(chatResult)

    const result = await stepInvokeSubagent(ctx)

    expect(result.success).toBe(true)
    expect(result.step).toBe('invoke-subagent')
    expect(ctx.chatResult).toBe(chatResult)
    expect(ctx.abortController).toBeInstanceOf(AbortController)
    expect(ctx.correlationId).toContain(ctx.taskId)
    expect(mockClaudeSdkGenerate).toHaveBeenCalledTimes(1)
    expect(result.output).toMatchObject({
      invoked: true,
      providerId: config.id,
      model: 'claude-sonnet-4',
    })
  })

  it('9.2 成功路径：非 claude-sdk 路径 → 调用 streamText 消费 textStream', async () => {
    const config = makeProviderConfig({ type: 'deepseek' })
    const ctx = makeCtx({
      input: 'hi',
      providerConfig: config,
      providerType: 'deepseek',
      systemPrompt: 'sys',
      messages: [
        { role: 'user', content: 'hi' },
      ],
      modelInstance: {
        model: { id: 'mock-model' } as never,
        config: { ...config, apiKey: undefined },
        resolvedModel: 'deepseek-chat',
      },
    })

    const fakeResult = {
      textStream: (async function* () {
        yield 'hello '
        yield 'world'
      })(),
      usage: Promise.resolve({ inputTokens: 100, outputTokens: 50 }),
      finishReason: Promise.resolve('stop'),
    }
    mockStreamText.mockReturnValue(fakeResult)

    const result = await stepInvokeSubagent(ctx)

    expect(result.success).toBe(true)
    expect(ctx.chatResult?.text).toBe('hello world')
    expect(ctx.chatResult?.usage.inputTokens).toBe(100)
    expect(ctx.chatResult?.usage.outputTokens).toBe(50)
    expect(ctx.chatResult?.finishReason).toBe('stop')
    expect(mockStreamText).toHaveBeenCalledTimes(1)
    expect(result.output).toMatchObject({
      invoked: true,
      inputTokens: 100,
      outputTokens: 50,
    })
  })

  it('9.3 失败路径：缺少 providerConfig → success=false', async () => {
    const ctx = makeCtx()
    delete ctx.providerConfig
    delete ctx.providerType

    const result = await stepInvokeSubagent(ctx)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Provider')
    expect(mockClaudeSdkGenerate).not.toHaveBeenCalled()
    expect(mockStreamText).not.toHaveBeenCalled()
  })

  it('9.4 失败路径：缺少 messages → success=false', async () => {
    const ctx = makeCtx({
      providerConfig: makeProviderConfig(),
      providerType: 'deepseek',
    })
    delete ctx.messages

    const result = await stepInvokeSubagent(ctx)

    expect(result.success).toBe(false)
    expect(result.error).toContain('messages')
  })

  it('9.5 边界：strength=deep 时 maxTokens 翻倍（透传给 streamText）', async () => {
    const config = makeProviderConfig({ type: 'deepseek' })
    const ctx = makeCtx({
      providerConfig: config,
      providerType: 'deepseek',
      strength: 'deep',
      messages: [{ role: 'user', content: 'hi' }],
      modelInstance: {
        model: { id: 'mock' } as never,
        config: { ...config, apiKey: undefined },
        resolvedModel: 'deepseek-chat',
      },
    })

    const fakeResult = {
      textStream: (async function* () {
        yield ''
      })(),
      usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
      finishReason: Promise.resolve('stop'),
    }
    mockStreamText.mockReturnValue(fakeResult)

    const result = await stepInvokeSubagent(ctx)

    expect(result.success).toBe(true)
    const streamTextArgs = mockStreamText.mock.calls[0][0] as {
      maxOutputTokens: number
    }
    // deep 翻倍：2048 * 2 = 4096
    expect(streamTextArgs.maxOutputTokens).toBe(4096)
  })
})

describe('[task-protocol-step-10] stream-output', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('10.1 成功路径：从 chatResult.text 提取输出并写入 ctx.output', async () => {
    const ctx = makeCtx({
      chatResult: makeChatResult({ text: '完整输出文本' }),
    })
    const result = await stepStreamOutput(ctx)

    expect(result.success).toBe(true)
    expect(result.step).toBe('stream-output')
    expect(ctx.output).toBe('完整输出文本')
    expect(result.output).toMatchObject({
      chunksCount: 1,
      totalLength: 6,
      isCancelled: false,
      finishReason: 'stop',
    })
  })

  it('10.2 失败路径：缺少 chatResult → success=false', async () => {
    const ctx = makeCtx()
    delete ctx.chatResult

    const result = await stepStreamOutput(ctx)

    expect(result.success).toBe(false)
    expect(result.error).toContain('chatResult')
    expect(ctx.output).toBeUndefined()
  })

  it('10.3 边界：finishReason=cancelled → isCancelled=true 但 success 仍为 true', async () => {
    const ctx = makeCtx({
      chatResult: makeChatResult({
        text: '部分输出',
        finishReason: 'cancelled',
      }),
    })
    const result = await stepStreamOutput(ctx)

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      isCancelled: true,
      finishReason: 'cancelled',
    })
  })

  it('10.4 边界：ctx.cancelled=true 时 isCancelled=true', async () => {
    const ctx = makeCtx({
      cancelled: true,
      chatResult: makeChatResult({ finishReason: 'stop' }),
    })
    const result = await stepStreamOutput(ctx)

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({ isCancelled: true })
  })
})
