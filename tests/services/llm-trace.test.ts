/**
 * LLM Trace 装饰器单元测试
 *
 * 验证要点：
 * - 包装函数不改变原函数行为
 * - Langfuse 未启用时无副作用
 * - 错误时正确传递异常
 */
import { describe, it, expect, vi } from 'vitest'

// Mock langfuse service（避免链式加载 electron-store）
vi.mock('../../src/main/services/observability/langfuse', () => ({
  LangfuseService: {
    getInstance: () => ({
      isEnabled: () => false,
      startTrace: () => ({
        span: () => ({ end: vi.fn() }),
        end: vi.fn(),
        getTraceId: () => null
      })
    })
  }
}))

import { withLlmTrace, TracedLlmClient, getTracedLlmClient } from '../../src/main/services/observability/llm-trace'

describe('LLM Trace 装饰器单元测试', () => {
  // ────────── 1. 基础包装 ──────────

  it('withLlmTrace 包装函数并传递结果', async () => {
    const original = vi.fn().mockResolvedValue('AI 回复内容')
    const wrapped = withLlmTrace(original, 'test-workflow')

    const result = await wrapped(
      [{ role: 'user', content: '测试问题' }],
      { sessionId: 's-1', workflowName: 'test-workflow' }
    )

    expect(result).toBe('AI 回复内容')
    expect(original).toHaveBeenCalledTimes(1)
  })

  // ────────── 2. 异常传递 ──────────

  it('原函数抛错时，包装函数也抛错', async () => {
    const error = new Error('LLM API 失败')
    const original = vi.fn().mockRejectedValue(error)
    const wrapped = withLlmTrace(original, 'test-workflow')

    await expect(
      wrapped(
        [{ role: 'user', content: '测试' }],
        { sessionId: 's-1', workflowName: 'test-workflow' }
      )
    ).rejects.toThrow('LLM API 失败')
  })

  // ────────── 3. TracedLlmClient 类 ──────────

  it('TracedLlmClient.call() 调用包装函数', async () => {
    const client = getTracedLlmClient()
    const original = vi.fn().mockResolvedValue('response text')

    const result = await client.call(
      original,
      [{ role: 'user', content: 'hi' }],
      { sessionId: 's-2', workflowName: 'chat' }
    )

    expect(result).toBe('response text')
  })

  // ────────── 4. 单例模式 ──────────

  it('getTracedLlmClient 单例', () => {
    const a = getTracedLlmClient()
    const b = getTracedLlmClient()
    expect(a).toBe(b)
  })

  // ────────── 5. isTraceEnabled 不抛错 ──────────

  it('isTraceEnabled() 不抛错（返回 boolean）', () => {
    const client = getTracedLlmClient()
    const enabled = client.isTraceEnabled()
    expect(typeof enabled).toBe('boolean')
  })
})
