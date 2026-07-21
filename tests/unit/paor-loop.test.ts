/**
 * PAOR 自动循环编排单元测试（方案书 v0.9 §3.2）
 *
 * 覆盖 runPaorLoop 的核心控制流：
 * - 多步计划逐步执行（continue → 步骤递增）
 * - 所有步骤完成后状态为 done
 * - 失败步骤触发 retry（最多 maxRetriesPerStep 次）
 * - 重试耗尽后跳到下一步（避免死循环）
 * - HIGH/CRITICAL 命令被风险闸门拦截（无人工审批时自动跳过）
 * - approveRisk 回调批准后高危命令可执行
 * - maxIterations 上限保护
 * - 迭代轨迹完整可审计 + onIteration 回调
 *
 * Mock 策略：
 * - Mock electron + electron-store（logger 依赖）
 * - Mock provider-registry（callLlm 的 Provider 解析）
 * - Mock 'ai' generateText（返回预设 JSON 计划）
 * - Mock SshConnectionManager（exec 返回预设输出）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mock：electron + electron-store ────────────────────────
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

// ─── Mock：SSH 连接管理器 ───────────────────────────────────
const mockExec = vi.fn()
vi.mock('../../src/main/services/ssh/connection-manager', () => ({
  SshConnectionManager: {
    getInstance: () => ({
      getConnectionState: () => 'connected',
      exec: (...args: unknown[]) => mockExec(...args),
    }),
  },
}))

// ─── Mock：Provider 注册表（让 callLlm 有可用 Provider） ────
vi.mock('../../src/main/core/agent/providers/provider-registry', () => ({
  getProviderWithApiKey: () => ({
    id: 'test-provider',
    name: 'Test',
    type: 'openai-compatible',
    baseUrl: 'http://localhost',
    apiKey: 'sk-test',
    enabled: true,
  }),
  getDefaultProviderId: () => 'test-provider',
  ensureProvidersInitialized: () => {},
}))

// ─── Mock：AI SDK generateText（返回预设计划 JSON） ─────────
const mockGenerateText = vi.fn()
vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  streamText: vi.fn(),
  tool: vi.fn(),
  isStepCount: vi.fn(),
}))

// ─── Mock：provider-factory ─────────────────────────────────
vi.mock('../../src/main/core/agent/providers/provider-factory', () => ({
  createLanguageModel: () => ({
    model: 'test-model',
    config: {},
    resolvedModel: 'test-model',
  }),
  getDefaultParams: () => ({ temperature: 0.7 }),
}))

import { getSupervisor, resetSupervisor } from '../../src/main/core/agent/supervisor'

/** 构造 generateText 返回指定计划文本 */
function planResponse(planJson: string) {
  return { text: planJson, usage: { inputTokens: 10, outputTokens: 20 } }
}

/** 三步诊断计划 */
const THREE_STEP_PLAN = JSON.stringify({
  goal: '诊断磁盘空间不足',
  steps: ['df -h', 'du -sh /var/log', 'echo done'],
  risks: [],
  verification: '确认磁盘使用率下降',
})

describe('PAOR 自动循环编排（runPaorLoop）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSupervisor()
    // 默认 SSH 执行成功
    mockExec.mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' })
  })

  it('多步计划逐步执行，全部成功后状态为 done', async () => {
    mockGenerateText.mockResolvedValue(planResponse(THREE_STEP_PLAN))
    const supervisor = getSupervisor()

    const result = await supervisor.runPaorLoop('诊断磁盘', 'session-1')

    expect(result.status).toBe('done')
    expect(result.plan.steps).toHaveLength(3)
    expect(result.iterations).toHaveLength(3)
    // 每轮迭代对应不同步骤
    expect(result.iterations[0].stepIndex).toBe(0)
    expect(result.iterations[1].stepIndex).toBe(1)
    expect(result.iterations[2].stepIndex).toBe(2)
    // SSH 被调用 3 次
    expect(mockExec).toHaveBeenCalledTimes(3)
    expect(mockExec).toHaveBeenCalledWith('session-1', 'df -h')
  })

  it('失败步骤触发重试，重试成功后继续', async () => {
    mockGenerateText.mockResolvedValue(
      planResponse(JSON.stringify({ goal: 'test', steps: ['cmd-a', 'cmd-b'], risks: [], verification: 'v' })
    ))
    // 第一次执行失败，之后成功
    mockExec
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error: failed' })
      .mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' })

    const supervisor = getSupervisor()
    const result = await supervisor.runPaorLoop('test task', 'session-1', { maxRetriesPerStep: 1 })

    // cmd-a 失败→重试→成功→cmd-b → done
    expect(result.status).toBe('done')
    // 迭代：cmd-a(fail) + cmd-a(retry,success) + cmd-b = 3 轮
    expect(result.iterations).toHaveLength(3)
    expect(result.iterations[0].stepIndex).toBe(0)
    expect(result.iterations[0].observe.status).toBe('failed')
    expect(result.iterations[1].stepIndex).toBe(0) // 重试同一步
    expect(result.iterations[2].stepIndex).toBe(1)
  })

  it('重试耗尽后跳到下一步，不会死循环', async () => {
    mockGenerateText.mockResolvedValue(
      planResponse(JSON.stringify({ goal: 'test', steps: ['bad-cmd', 'good-cmd'], risks: [], verification: 'v' })
    ))
    // bad-cmd 永远失败
    mockExec.mockImplementation(async (_s: string, cmd: string) => {
      if (cmd === 'bad-cmd') return { exitCode: 1, stdout: '', stderr: 'error' }
      return { exitCode: 0, stdout: 'ok', stderr: '' }
    })

    const supervisor = getSupervisor()
    const result = await supervisor.runPaorLoop('test', 'session-1', {
      maxRetriesPerStep: 1,
      maxIterations: 10,
    })

    // bad-cmd(失败) + bad-cmd(重试失败) → 跳到 good-cmd → done
    expect(result.status).toBe('done')
    expect(result.iterations.length).toBeLessThanOrEqual(4)
    // 最后一步是 good-cmd
    const lastIter = result.iterations[result.iterations.length - 1]
    expect(lastIter.act.command).toBe('good-cmd')
  })

  it('HIGH/CRITICAL 命令被风险闸门拦截（无审批回调时自动跳过）', async () => {
    mockGenerateText.mockResolvedValue(
      planResponse(JSON.stringify({ goal: '清理', steps: ['df -h', 'rm -rf /var/log/*'], risks: [], verification: 'v' })
    ))

    const supervisor = getSupervisor()
    const result = await supervisor.runPaorLoop('清理磁盘', 'session-1')

    // rm -rf 是 CRITICAL，应被拦截
    const blockedIter = result.iterations.find((i) => i.riskBlocked)
    expect(blockedIter).toBeDefined()
    expect(blockedIter!.act.command).toContain('rm -rf')
    // 被拦截的命令不应真正执行（SSH 只调用 df -h 一次）
    expect(mockExec).toHaveBeenCalledTimes(1)
    expect(mockExec).toHaveBeenCalledWith('session-1', 'df -h')
    // 摘要中提及风控拦截
    expect(result.summary).toContain('风控拦截')
  })

  it('approveRisk 回调批准后，高危命令可以执行', async () => {
    mockGenerateText.mockResolvedValue(
      planResponse(JSON.stringify({ goal: '清理', steps: ['rm -rf /tmp/cache'], risks: [], verification: 'v' })
    ))
    const approveRisk = vi.fn().mockResolvedValue(true)

    const supervisor = getSupervisor()
    const result = await supervisor.runPaorLoop('清理缓存', 'session-1', { approveRisk })

    expect(approveRisk).toHaveBeenCalledTimes(1)
    expect(result.iterations[0].riskBlocked).toBeUndefined()
    expect(mockExec).toHaveBeenCalledWith('session-1', 'rm -rf /tmp/cache')
  })

  it('maxIterations 上限保护，防止无限循环', async () => {
    mockGenerateText.mockResolvedValue(
      planResponse(JSON.stringify({ goal: 'test', steps: ['s1', 's2', 's3', 's4', 's5', 's6'], risks: [], verification: 'v' })
    ))

    const supervisor = getSupervisor()
    const result = await supervisor.runPaorLoop('test', 'session-1', { maxIterations: 2 })

    // 只执行 2 轮就停止
    expect(result.iterations).toHaveLength(2)
    expect(result.status).toBe('max_iterations')
  })

  it('onIteration 回调在每轮迭代时被调用', async () => {
    mockGenerateText.mockResolvedValue(planResponse(THREE_STEP_PLAN))
    const onIteration = vi.fn()

    const supervisor = getSupervisor()
    const result = await supervisor.runPaorLoop('诊断磁盘', 'session-1', { onIteration })

    expect(onIteration).toHaveBeenCalledTimes(3)
    expect(onIteration).toHaveBeenCalledWith(result.iterations[0])
  })

  it('LLM 不可用时降级为单步计划，循环仍可执行', async () => {
    // generateText 抛错 → callLlm 返回 '' → plan 降级为单步
    mockGenerateText.mockRejectedValue(new Error('LLM unavailable'))

    const supervisor = getSupervisor()
    const result = await supervisor.runPaorLoop('检查系统状态', 'session-1')

    expect(result.planConfidence).toBe(0.3) // 降级置信度
    expect(result.plan.steps).toHaveLength(1)
    expect(result.plan.steps[0]).toBe('检查系统状态')
    expect(result.iterations.length).toBeGreaterThanOrEqual(1)
  })

  it('迭代轨迹包含完整的 act/observe/reflect 结构（可审计）', async () => {
    mockGenerateText.mockResolvedValue(planResponse(THREE_STEP_PLAN))

    const supervisor = getSupervisor()
    const result = await supervisor.runPaorLoop('诊断磁盘', 'session-1')

    for (const iter of result.iterations) {
      expect(iter.iteration).toBeGreaterThan(0)
      expect(iter.act).toHaveProperty('command')
      expect(iter.act).toHaveProperty('output')
      expect(iter.act).toHaveProperty('success')
      expect(iter.observe).toHaveProperty('status')
      expect(iter.observe).toHaveProperty('observations')
      expect(iter.reflect).toHaveProperty('decision')
      expect(iter.reflect).toHaveProperty('reasoning')
    }
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.summary.length).toBeGreaterThan(0)
  })
})
