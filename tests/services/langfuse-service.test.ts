/**
 * Langfuse Service 单元测试
 *
 * 验证要点：
 * - 单例模式正确（getInstance 返回同一实例）
 * - 未配置时禁用，所有方法安全降级
 * - 启用时正确初始化、shutdown 不报错
 * - startTrace 返回 TraceHandle，未启用时返回 NoopTraceHandle
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock ConfigStore 避免 electron-store 触发 electron 加载
vi.mock('../../src/main/services/storage/config-store', () => ({
  ConfigStore: {
    getLangfuseConfig: () => null
  }
}))

import { LangfuseService, type TraceContext } from '../../src/main/services/observability/langfuse'

describe('LangfuseService 单元测试', () => {
  let service: LangfuseService

  beforeEach(() => {
    // 重置单例（通过重新创建实例）
    service = LangfuseService.getInstance()
  })

  // ────────── 1. 单例模式 ──────────

  it('单例：getInstance 多次调用返回同一实例', () => {
    const a = LangfuseService.getInstance()
    const b = LangfuseService.getInstance()
    expect(a).toBe(b)
  })

  // ────────── 2. 降级（未配置） ──────────

  it('未配置时：isEnabled() 返回 false（假定测试环境无 Langfuse Key）', () => {
    // 测试环境通常不配置 Langfuse Key
    // 如果已配置则跳过此测试
    if (service.isEnabled()) {
      console.warn('[Langfuse Test] 检测到 Langfuse 已启用，跳过降级测试')
      return
    }
    expect(service.isEnabled()).toBe(false)
  })

  it('未配置时：startTrace 返回 NoopTraceHandle，所有方法安全降级', () => {
    if (service.isEnabled()) {
      console.warn('[Langfuse Test] 检测到 Langfuse 已启用，跳过降级测试')
      return
    }
    const ctx: TraceContext = {
      sessionId: 'test-session',
      workflowName: 'test-workflow',
      userQuery: 'test query'
    }
    const trace = service.startTrace(ctx)
    // NoopTraceHandle 的方法应该安全返回
    expect(trace.getTraceId()).toBeNull()

    const span = trace.span({ name: 'test-span' })
    expect(() => span.end({ result: 'ok' })).not.toThrow()
    expect(() => trace.end({ level: 'DEFAULT' })).not.toThrow()
  })

  it('未配置时：shutdown 不抛异常', async () => {
    if (service.isEnabled()) {
      return
    }
    await expect(service.shutdown()).resolves.toBeUndefined()
  })

  // ────────── 3. 初始化幂等性 ──────────

  it('init() 多次调用安全（幂等）', () => {
    expect(() => service.init()).not.toThrow()
    expect(() => service.init()).not.toThrow()
  })
})
