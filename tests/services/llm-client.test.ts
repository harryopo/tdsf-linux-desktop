/**
 * LLM 客户端单元测试
 *
 * 测试重点：
 *   - 降级机制（API Key 为空时使用规则引擎）
 *   - isAvailable() 检查
 *   - testConnection()（mock OpenAI SDK）
 *   - chat()（mock OpenAI SDK）
 *   - analyze()（mock + 降级）
 *
 * 注意：openai SDK 通过 vi.mock 进行 mock，不发起真实网络请求。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LlmConfig, Evidence, EnvironmentContext } from '../../src/shared/models'

// ────────── Mock OpenAI SDK ──────────

/**
 * 使用 vi.hoisted 确保 mock 变量在 vi.mock 工厂函数中可访问。
 * vi.mock 会被提升到文件顶部，普通变量在工厂函数中不可用。
 */
const { mockCreate, MockOpenAI } = vi.hoisted(() => {
  const mockCreate = vi.fn()
  const MockOpenAI = vi.fn().mockImplementation((config: unknown) => ({
    config,
    chat: {
      completions: {
        create: mockCreate
      }
    }
  }))
  return { mockCreate, MockOpenAI }
})

vi.mock('openai', () => ({
  default: MockOpenAI
}))

// 导入 LlmClient（在 mock 之后）
import { LlmClient } from '../../src/main/services/llm/client'

// ────────── 测试辅助 ──────────

/** 创建测试用 LLM 配置 */
function makeConfig(overrides: Partial<LlmConfig> = {}): LlmConfig {
  return {
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'test-api-key',
    model: 'gpt-4',
    temperature: 0.7,
    maxTokens: 2048,
    timeout: 30_000,
    ...overrides
  }
}

/** 创建测试用证据 */
function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev-1',
    source: 'command',
    sourceDetail: 'df -h',
    content: 'No space left on device',
    drainMatch: 0.9,
    sourcePrior: 0.9,
    confidence: 0.9,
    timestamp: Date.now(),
    verified: true,
    ...overrides
  }
}

// ────────── 测试用例 ──────────

describe('LlmClient — LLM 客户端', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ────────── isAvailable ──────────

  it('isAvailable: API Key 非空时返回 true', () => {
    const client = new LlmClient(makeConfig({ apiKey: 'valid-key' }))
    expect(client.isAvailable()).toBe(true)
  })

  it('isAvailable: API Key 为空时返回 false', () => {
    const client = new LlmClient(makeConfig({ apiKey: '' }))
    expect(client.isAvailable()).toBe(false)
  })

  it('isAvailable: API Key 为空白字符时返回 false', () => {
    const client = new LlmClient(makeConfig({ apiKey: '   ' }))
    expect(client.isAvailable()).toBe(false)
  })

  // ────────── 降级机制 ──────────

  it('analyze: API Key 为空时降级到规则引擎（OOM 场景）', async () => {
    const client = new LlmClient(makeConfig({ apiKey: '' }))
    const evidences = [makeEvidence({ content: 'Out of memory: Kill process 1234' })]

    const result = await client.analyze('进程被杀死', evidences)

    // 应来自 rule-engine 的 OOM 规则
    expect(result.hypothesis).toContain('内存')
    expect(result.fixCommand).toContain('free')
    expect(result.confidence).toBe(0.7)
  })

  it('analyze: API Key 为空时降级到规则引擎（磁盘满场景）', async () => {
    const client = new LlmClient(makeConfig({ apiKey: '' }))
    const evidences = [makeEvidence({ content: 'No space left on device' })]

    const result = await client.analyze('写入失败', evidences)

    expect(result.hypothesis).toContain('磁盘')
    expect(result.fixCommand).toContain('df')
  })

  it('analyze: 规则引擎无匹配时返回默认低置信度结果', async () => {
    const client = new LlmClient(makeConfig({ apiKey: '' }))
    const evidences = [makeEvidence({ content: '今天天气不错' })]

    const result = await client.analyze('天气怎么样', evidences)

    expect(result.confidence).toBeLessThanOrEqual(0.2)
    expect(result.hypothesis).toContain('人工')
  })

  // ────────── testConnection ──────────

  it('testConnection: API Key 为空时返回 false', async () => {
    const client = new LlmClient(makeConfig({ apiKey: '' }))
    const result = await client.testConnection()
    expect(result).toBe(false)
  })

  it('testConnection: API 调用成功时返回 true', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'pong' } }]
    })

    const client = new LlmClient(makeConfig({ apiKey: 'valid-key' }))
    const result = await client.testConnection()
    expect(result).toBe(true)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('testConnection: API 调用失败时返回 false', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Network error'))

    const client = new LlmClient(makeConfig({ apiKey: 'valid-key' }))
    const result = await client.testConnection()
    expect(result).toBe(false)
  })

  // ────────── chat ──────────

  it('chat: API Key 为空时抛出错误', async () => {
    const client = new LlmClient(makeConfig({ apiKey: '' }))
    await expect(
      client.chat([{ role: 'user', content: 'hello' }])
    ).rejects.toThrow('LLM 不可用')
  })

  it('chat: 正常调用返回 LLM 回复', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '你好，我是运维助手' } }]
    })

    const client = new LlmClient(makeConfig({ apiKey: 'valid-key' }))
    const reply = await client.chat([{ role: 'user', content: '你好' }])

    expect(reply).toBe('你好，我是运维助手')
    // 验证系统提示词被注入
    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.messages[0].role).toBe('system')
  })

  it('chat: API 调用失败时抛出错误', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API Error'))

    const client = new LlmClient(makeConfig({ apiKey: 'valid-key' }))
    await expect(
      client.chat([{ role: 'user', content: 'hello' }])
    ).rejects.toThrow('LLM 调用失败')
  })

  // ────────── analyze（LLM 模式） ──────────

  it('analyze: LLM 返回有效 JSON 时使用 LLM 结果', async () => {
    const llmResponse = JSON.stringify({
      hypothesis: '内存泄漏导致 OOM',
      fixCommand: 'systemctl restart myapp',
      confidence: 0.85
    })
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: llmResponse } }]
    })

    const client = new LlmClient(makeConfig({ apiKey: 'valid-key' }))
    const result = await client.analyze('服务崩溃', [makeEvidence()])

    expect(result.hypothesis).toBe('内存泄漏导致 OOM')
    expect(result.fixCommand).toBe('systemctl restart myapp')
    expect(result.confidence).toBe(0.85)
  })

  it('analyze: LLM 返回带 Markdown 代码块的 JSON 也能解析', async () => {
    const llmResponse = '```json\n{"hypothesis":"磁盘满","fixCommand":"df -h","confidence":0.8}\n```'
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: llmResponse } }]
    })

    const client = new LlmClient(makeConfig({ apiKey: 'valid-key' }))
    const result = await client.analyze('磁盘问题', [makeEvidence()])

    expect(result.hypothesis).toBe('磁盘满')
    expect(result.confidence).toBe(0.8)
  })

  it('analyze: LLM 返回无效 JSON 时降级到规则引擎', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '这不是 JSON 格式的回复' } }]
    })

    const client = new LlmClient(makeConfig({ apiKey: 'valid-key' }))
    const evidences = [makeEvidence({ content: 'out of memory' })]
    const result = await client.analyze('OOM', evidences)

    // 应回降到规则引擎
    expect(result.hypothesis).toContain('内存')
  })

  it('analyze: LLM 调用失败时降级到规则引擎', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Network error'))

    const client = new LlmClient(makeConfig({ apiKey: 'valid-key' }))
    const evidences = [makeEvidence({ content: 'out of memory' })]
    const result = await client.analyze('OOM', evidences)

    // 应回降到规则引擎
    expect(result.hypothesis).toContain('内存')
  })

  it('analyze: 置信度超出范围时被限制到 [0, 1]', async () => {
    const llmResponse = JSON.stringify({
      hypothesis: '测试',
      fixCommand: 'echo test',
      confidence: 1.5 // 超出范围
    })
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: llmResponse } }]
    })

    const client = new LlmClient(makeConfig({ apiKey: 'valid-key' }))
    const result = await client.analyze('测试', [makeEvidence()])

    expect(result.confidence).toBe(1) // 被限制为 1
  })

  // ────────── chatStream ──────────

  it('chatStream: 逐 token 回调并返回完整文本', async () => {
    // mock 流式响应
    const chunks = [
      { choices: [{ delta: { content: '你' } }] },
      { choices: [{ delta: { content: '好' } }] },
      { choices: [{ delta: { content: '！' } }] }
    ]
    mockCreate.mockResolvedValueOnce(asyncIterable(chunks))

    const client = new LlmClient(makeConfig({ apiKey: 'valid-key' }))
    const tokens: string[] = []
    const fullText = await client.chatStream(
      [{ role: 'user', content: 'hi' }],
      (token) => tokens.push(token)
    )

    expect(tokens).toEqual(['你', '好', '！'])
    expect(fullText).toBe('你好！')
  })

  // ────────── validateConfig ──────────

  it('validateConfig: 有效配置返回 valid=true', () => {
    const client = new LlmClient(makeConfig({ apiKey: 'valid-key' }))
    const result = client.validateConfig()
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('validateConfig: API Key 为空时返回错误', () => {
    const client = new LlmClient(makeConfig({ apiKey: '' }))
    const result = client.validateConfig()
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('API Key 不能为空')
  })

  it('validateConfig: Base URL 为空时返回错误', () => {
    const client = new LlmClient(makeConfig({ baseUrl: '' }))
    const result = client.validateConfig()
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Base URL 不能为空')
  })

  it('validateConfig: Base URL 格式无效时返回错误', () => {
    const client = new LlmClient(makeConfig({ baseUrl: 'not-a-url' }))
    const result = client.validateConfig()
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Base URL 格式无效')
  })

  it('validateConfig: 模型名称为空时返回错误', () => {
    const client = new LlmClient(makeConfig({ model: '' }))
    const result = client.validateConfig()
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('模型名称不能为空')
  })

  it('validateConfig: temperature 超范围时返回错误', () => {
    const client = new LlmClient(makeConfig({ temperature: 3 }))
    const result = client.validateConfig()
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('temperature'))).toBe(true)
  })

  // ────────── chatWithContext ──────────

  it('chatWithContext: API Key 为空时抛出错误', async () => {
    const client = new LlmClient(makeConfig({ apiKey: '' }))
    await expect(
      client.chatWithContext([{ role: 'user', content: 'hi' }], makeEnvContext())
    ).rejects.toThrow('LLM 不可用')
  })

  it('chatWithContext: 将环境上下文注入 system message', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '磁盘使用率偏高' } }]
    })

    const client = new LlmClient(makeConfig({ apiKey: 'valid-key' }))
    const reply = await client.chatWithContext(
      [{ role: 'user', content: '系统状态如何' }],
      makeEnvContext({ diskUsage: 95 })
    )

    expect(reply).toBe('磁盘使用率偏高')
    // 验证 system message 包含环境上下文
    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.messages[0].role).toBe('system')
    expect(callArgs.messages[0].content).toContain('当前系统环境')
    expect(callArgs.messages[0].content).toContain('95.0%')
  })

  // ────────── analyze 降级标注 ──────────

  it('analyze: LLM 调用失败时降级到规则引擎并标注错误信息', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Network error'))

    const client = new LlmClient(makeConfig({ apiKey: 'valid-key' }))
    const evidences = [makeEvidence({ content: 'out of memory' })]
    const result = await client.analyze('OOM', evidences)

    // 应回降到规则引擎
    expect(result.hypothesis).toContain('内存')
    // 应标注 LLM 调用失败
    expect(result.hypothesis).toContain('LLM 调用失败')
    // 置信度应被降低（<=0.3）
    expect(result.confidence).toBeLessThanOrEqual(0.3)
  })

  // ────────── chatStream 重试 ──────────

  it('chatStream: 不可重试错误（401）不重试，直接抛出', async () => {
    mockCreate.mockRejectedValueOnce(new Error('401 Unauthorized: invalid api key'))

    const client = new LlmClient(makeConfig({ apiKey: 'valid-key' }))
    await expect(
      client.chatStream([{ role: 'user', content: 'hi' }], () => {})
    ).rejects.toThrow('LLM 流式调用失败')
    // 只调用 1 次（不重试）
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('chatStream: 网络错误时自动重试并最终成功', async () => {
    vi.useFakeTimers()
    try {
      // 第一次失败（网络错误），第二次成功
      mockCreate
        .mockRejectedValueOnce(new Error('fetch failed: network error'))
        .mockResolvedValueOnce(asyncIterable([{ choices: [{ delta: { content: 'ok' } }] }]))

      const client = new LlmClient(makeConfig({ apiKey: 'valid-key', timeout: 60_000 }))
      const promise = client.chatStream(
        [{ role: 'user', content: 'hi' }],
        () => {}
      )
      // 立即附加 handler 防止 unhandled rejection 警告（万一重试也失败）
      const settled = promise.then(
        (text: string) => ({ ok: true as const, text }),
        (e: Error) => ({ ok: false as const, err: e })
      )

      // 推进重试延迟（1s）及可能的中断 timer
      await vi.advanceTimersByTimeAsync(2000)
      await vi.runAllTimersAsync()

      const result = await settled
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.text).toBe('ok')
      }
      expect(mockCreate).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('chatStream: 持续失败重试 3 次后抛出', async () => {
    vi.useFakeTimers()
    try {
      // 明确指定 4 次 reject（初始 + 3 次重试）
      const err = new Error('fetch failed: network error')
      mockCreate
        .mockRejectedValueOnce(err)
        .mockRejectedValueOnce(err)
        .mockRejectedValueOnce(err)
        .mockRejectedValueOnce(err)

      const client = new LlmClient(makeConfig({ apiKey: 'valid-key', timeout: 60_000 }))
      const promise = client.chatStream(
        [{ role: 'user', content: 'hi' }],
        () => {}
      )
      // 立即附加 catch handler 防止 unhandled rejection 警告
      // （reject 发生在 advanceTimers 期间，若不立即 catch 会触发 Node 警告）
      const caughtPromise = promise.catch((e: Error) => e)

      // 推进所有重试延迟（1s + 2s + 4s = 7s）及中断 timer
      await vi.advanceTimersByTimeAsync(10000)
      await vi.runAllTimersAsync()

      const thrown = await caughtPromise
      expect(thrown).toBeInstanceOf(Error)
      expect(thrown.message).toContain('LLM 流式调用失败')
      // 初始 + 3 次重试 = 4 次
      expect(mockCreate).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })
})

// ────────── 环境上下文辅助 ──────────

/** 创建测试用环境上下文 */
function makeEnvContext(overrides: Partial<EnvironmentContext> = {}): EnvironmentContext {
  return {
    hostname: 'test-host',
    os: 'Ubuntu 22.04',
    kernel: '5.15.0',
    cpuModel: 'Intel i7',
    cpuCores: 8,
    totalMemory: 16 * 1024 * 1024 * 1024,
    totalDisk: 500 * 1024 * 1024 * 1024,
    cpuUsage: 30,
    memoryUsage: 50,
    diskUsage: 60,
    uptime: 3600,
    processCount: 100,
    loadAverage: 1.5,
    ...overrides
  }
}

// ────────── 辅助函数 ──────────

/**
 * 将数组转换为异步可迭代对象（模拟 OpenAI SDK 的流式响应）
 */
async function* asyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item
  }
}
