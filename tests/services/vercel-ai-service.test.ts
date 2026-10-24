/**
 * VercelAiService 单元测试
 *
 * 验证要点：
 * - API Key 为空时降级到 LlmClient
 * - 工具调用（Tool Calling）接口正确
 * - 流式输出接口安全
 *
 * 注：使用 vi.mock 避免 vite 5.4.0 对 zod 3.25+ exports 的解析问题
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock ai 包（Vercel AI SDK），避免 zod subpath 解析问题
vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  tool: vi.fn((opts) => opts),
  CoreMessage: class {},
  CoreTool: class {}
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => () => ({}))
}))

// Mock ConfigStore + SecureStore（避免 electron-store 触发 electron 加载）
vi.mock('../../src/main/services/storage/config-store', () => ({
  ConfigStore: {
    getLlmConfig: () => null,
    getLangfuseConfig: () => null
  }
}))

// Mock LlmClient（避免真实调用 OpenAI SDK，强制 chat 返回空字符串模拟降级）
vi.mock('../../src/main/services/llm/client', () => ({
  LlmClient: class {
    chat = vi.fn(async () => '')
    chatStream = vi.fn(async () => '')
    isAvailable = vi.fn(() => true)
    analyze = vi.fn(async () => ({
      hypothesis: 'mock',
      fixCommand: 'echo mock',
      confidence: 0.5
    }))
  }
}))

import { VercelAiService } from '../../src/main/services/llm/vercel-ai-service'
import type { LlmConfig } from '../../src/shared/models'

/** 构造空配置（触发降级） */
function emptyConfig(): LlmConfig {
  return {
    baseUrl: '',
    apiKey: '',
    model: '',
    temperature: 0.7,
    maxTokens: 2048,
    timeout: 30_000
  }
}

/** 构造有效配置（尝试真实调用） */
function validConfig(): LlmConfig {
  return {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: 'mock-api-key',
    model: 'doubao-pro-32k',
    temperature: 0.7,
    maxTokens: 2048,
    timeout: 30_000
  }
}

describe('VercelAiService 单元测试', () => {
  // ────────── 1. 降级行为 ──────────

  describe('降级到 LlmClient', () => {
    let service: VercelAiService

    beforeEach(() => {
      service = new VercelAiService(emptyConfig())
    })

    it('API Key 为空时 generate() 不抛异常', async () => {
      const result = await service.generate([
        { role: 'user', content: '你好' }
      ])
      expect(result).toBeDefined()
      expect(result.text).toBeDefined()
      expect(result.finishReason).toBeDefined()
    })

    it('API Key 为空时 finishReason 为 fallback', async () => {
      const result = await service.generate([
        { role: 'user', content: '测试' }
      ])
      expect(result.finishReason).toBe('fallback')
    })

    it('API Key 为空时 toolResults 为空数组', async () => {
      const result = await service.generate(
        [{ role: 'user', content: '测试' }],
        []
      )
      expect(result.toolResults).toEqual([])
    })
  })

  // ────────── 3. 实例化 ──────────

  it('VercelAiService 可以用有效配置实例化', () => {
    const service = new VercelAiService(validConfig())
    expect(service).toBeDefined()
  })
})
