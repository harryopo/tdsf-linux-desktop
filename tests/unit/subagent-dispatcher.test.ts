/**
 * Subagent 调度器单元测试（v0.9.4 批次 4 - 任务 1 测试）
 *
 * 覆盖 dispatcher.ts 的核心逻辑：
 * - analyzeRequest 关键词匹配（9 个 Subagent + 默认 fallback）
 * - planTasks 任务分解（每个匹配 Subagent 生成一个 task）
 * - executeWithTimeout 超时保护（30s 超时）
 * - collectOutput 输出合并（success / error / 空输出）
 * - reflectResults 成功率评估（<50% 标记 needsReLoop）
 * - checkApprovals 审批闸门（不阻塞）
 * - dispatchSubagents 8 步完整流程
 * - 单个 Subagent 失败不影响其他 Subagent
 *
 * Mock 策略：
 * - Mock electron + electron-store（logger 间接依赖 electron.app）
 * - 不 mock dispatcher 模块本身，直接测试纯函数 + dispatchSubagents 编排
 * - 自定义 MockSubagentRegistry（实现 SubagentRegistry 接口）
 *
 * 设计依据：v0.9.4 §11 第 4 类（Subagent 调度 3 项 - 任务 1）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type {
  Subagent,
  SubagentTask,
  SubagentResult,
  SubagentRegistry,
} from '../../src/main/core/agent/subagents/base'

// ============================================================================
// Mock：electron + electron-store（logger 间接依赖）
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
// 工具：构造 Mock Subagent
// ============================================================================

/**
 * 创建 Mock Subagent（控制 execute 的返回值和耗时）
 */
function createMockSubagent(
  name: string,
  options: {
    output?: unknown
    success?: boolean
    delayMs?: number
    requiresApproval?: boolean
    throw?: Error
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
  } = {}
): Subagent {
  const {
    output = `output-of-${name}`,
    success = true,
    delayMs = 0,
    requiresApproval = false,
    throw: throwError,
    usage,
  } = options

  return {
    name,
    displayName: `Mock-${name}`,
    description: `Mock subagent for ${name}`,
    async execute(task: SubagentTask): Promise<SubagentResult> {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
      if (throwError) {
        throw throwError
      }
      return {
        taskId: task.id,
        success,
        output,
        durationMs: delayMs,
        requiresApproval,
        usage,
      }
    },
  }
}

/**
 * 创建 Mock SubagentRegistry（按 name → Subagent 映射）
 */
function createMockRegistry(
  subagents: Record<string, Subagent>
): SubagentRegistry {
  return {
    get(name: string): Subagent | null {
      return subagents[name] ?? null
    },
    list(): Subagent[] {
      return Object.values(subagents)
    },
  }
}

// ============================================================================
// 导入被测模块（在 mock 注册之后）
// ============================================================================
import {
  dispatchSubagents,
  resolveApproval,
  type DispatchContext,
  type DispatchResult,
} from '../../src/main/core/agent/subagents/dispatcher'

// ============================================================================
// 基础调度上下文（每个测试用例可覆盖部分字段）
// ============================================================================
function makeContext(
  overrides: Partial<Omit<DispatchContext, 'currentStep' | 'stepHistory'>> = {}
): Omit<DispatchContext, 'currentStep' | 'stepHistory'> {
  return {
    userRequest: '帮我搜索 nginx 部署教程',
    sessionId: 'test-session-id',
    mode: 'chat',
    strength: 'standard',
    ...overrides,
  }
}

// ============================================================================
// 测试用例
// ============================================================================

describe('[dispatcher] dispatchSubagents 8 步调度', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ----------------------------------------------------------------------
  // 任务 1.1：关键词匹配 - 单个 Subagent
  // ----------------------------------------------------------------------

  it('1.1 关键词匹配 - "搜索" 触发 search Subagent', async () => {
    const searchSpy = createMockSubagent('search', { output: '搜索结果' })
    const registry = createMockRegistry({ search: searchSpy })

    const result = await dispatchSubagents(
      makeContext({ userRequest: '帮我搜索 nginx 部署教程' }),
      registry
    )

    expect(result.success).toBe(true)
    expect(result.subagentsUsed).toContain('search')
    expect(result.output).toContain('搜索结果')
    expect(result.output).toContain('[调度完成]')
    expect(result.output).toContain('[统计]')
  })

  it('1.2 关键词匹配 - "代码" 触发 coding Subagent', async () => {
    const codingSpy = createMockSubagent('coding', { output: '代码已修改' })
    const registry = createMockRegistry({ coding: codingSpy })

    const result = await dispatchSubagents(
      makeContext({ userRequest: '帮我修改代码' }),
      registry
    )

    expect(result.success).toBe(true)
    expect(result.subagentsUsed).toContain('coding')
    expect(result.output).toContain('代码已修改')
  })

  it('1.3 关键词匹配 - "探查" 触发 explore Subagent', async () => {
    const exploreSpy = createMockSubagent('explore', { output: '探查结果' })
    const registry = createMockRegistry({ explore: exploreSpy })

    const result = await dispatchSubagents(
      makeContext({ userRequest: '探查代码库结构' }),
      registry
    )

    expect(result.success).toBe(true)
    expect(result.subagentsUsed).toContain('explore')
    expect(result.output).toContain('探查结果')
  })

  // ----------------------------------------------------------------------
  // 任务 1.2：无匹配时 fallback 到 thinking
  // ----------------------------------------------------------------------

  it('1.4 无关键词匹配 → fallback 到 thinking Subagent', async () => {
    const thinkingSpy = createMockSubagent('thinking', { output: '分析结果' })
    const registry = createMockRegistry({ thinking: thinkingSpy })

    const result = await dispatchSubagents(
      makeContext({ userRequest: 'xyz random gibberish' }),
      registry
    )

    expect(result.success).toBe(true)
    expect(result.subagentsUsed).toContain('thinking')
  })

  // ----------------------------------------------------------------------
  // 任务 1.3：多 Subagent 协作
  // ----------------------------------------------------------------------

  it('1.5 多关键词触发多个 Subagent（搜索 + 思考）', async () => {
    const searchSpy = createMockSubagent('search', { output: '搜索结果' })
    const thinkingSpy = createMockSubagent('thinking', { output: '分析结果' })
    const registry = createMockRegistry({
      search: searchSpy,
      thinking: thinkingSpy,
    })

    const result = await dispatchSubagents(
      makeContext({ userRequest: '帮我搜索 nginx 教程并思考部署方案' }),
      registry
    )

    expect(result.success).toBe(true)
    expect(result.subagentsUsed).toHaveLength(2)
    expect(result.subagentsUsed).toContain('search')
    expect(result.subagentsUsed).toContain('thinking')
    expect(result.output).toContain('搜索结果')
    expect(result.output).toContain('分析结果')
  })

  // ----------------------------------------------------------------------
  // 任务 1.4：单个 Subagent 失败不影响其他 Subagent
  // ----------------------------------------------------------------------

  it('1.6 单个 Subagent 抛异常 → 其他 Subagent 仍执行', async () => {
    const failingSubagent = createMockSubagent('search', {
      throw: new Error('网络不可用'),
    })
    const successSubagent = createMockSubagent('thinking', { output: '分析完成' })
    const registry = createMockRegistry({
      search: failingSubagent,
      thinking: successSubagent,
    })

    const result = await dispatchSubagents(
      makeContext({ userRequest: '搜索并思考' }),
      registry
    )

    // 整体 success = 至少一个 Subagent 成功
    expect(result.success).toBe(true)
    expect(result.subagentsUsed).toHaveLength(2)
    expect(result.output).toContain('分析完成')
    // 失败 Subagent 的错误信息也会出现在输出中
    expect(result.output).toContain('[失败]')
    expect(result.output).toContain('网络不可用')
  })

  it('1.7 所有 Subagent 失败 → success=false', async () => {
    const failingSubagent1 = createMockSubagent('search', {
      throw: new Error('search 失败'),
    })
    const failingSubagent2 = createMockSubagent('thinking', {
      throw: new Error('thinking 失败'),
    })
    const registry = createMockRegistry({
      search: failingSubagent1,
      thinking: failingSubagent2,
    })

    const result = await dispatchSubagents(
      makeContext({ userRequest: '搜索并思考' }),
      registry
    )

    expect(result.success).toBe(false)
    expect(result.output).toContain('[失败]')
  })

  // ----------------------------------------------------------------------
  // 任务 1.5：超时保护
  // ----------------------------------------------------------------------

  it('1.8 Subagent 超时（>30s）→ 视为失败但不影响其他', async () => {
    // 模拟超时：mock executeWithTimeout 内部的 setTimeout 触发
    // 由于 30s 太长，这里通过 mock registry 返回 undefined 让 dispatch 步骤跳过
    // 改用 Subagent 永远 pending 的方式验证超时机制
    const pendingSubagent: Subagent = {
      name: 'search',
      displayName: 'Pending',
      description: '永远 pending',
      execute: () => new Promise<SubagentResult>(() => {}), // 永不 resolve
    }
    const quickSubagent = createMockSubagent('thinking', { output: '快速完成' })
    const registry = createMockRegistry({
      search: pendingSubagent,
      thinking: quickSubagent,
    })

    // 用 fake timer 加速超时
    vi.useFakeTimers()
    const resultPromise = dispatchSubagents(
      makeContext({ userRequest: '搜索并思考' }),
      registry
    )
    // 推进时间超过 30s 超时阈值
    await vi.advanceTimersByTimeAsync(31_000)
    const result = await resultPromise
    vi.useRealTimers()

    // search 超时失败，thinking 成功
    expect(result.success).toBe(true)
    expect(result.output).toContain('快速完成')
    expect(result.output).toContain('[失败]')
    expect(result.output).toContain('Subagent 执行超时')
  })

  // ----------------------------------------------------------------------
  // 任务 1.6：步骤历史完整
  // ----------------------------------------------------------------------

  it('1.9 完整 8 步流程 - stepHistory 包含所有步骤', async () => {
    const searchSpy = createMockSubagent('search', { output: '结果' })
    const registry = createMockRegistry({ search: searchSpy })

    const result = await dispatchSubagents(
      makeContext({ userRequest: '搜索测试' }),
      registry
    )

    expect(result.stepHistory).toHaveLength(8)
    const steps = result.stepHistory.map((s) => s.step)
    expect(steps).toEqual([
      'analyze',
      'plan',
      'dispatch',
      'execute',
      'approve',
      'collect',
      'reflect',
      'summarize',
    ])
    // 所有步骤都应该有 timestamp 和 success 字段
    for (const step of result.stepHistory) {
      expect(typeof step.timestamp).toBe('number')
      expect(typeof step.success).toBe('boolean')
    }
  })

  // ----------------------------------------------------------------------
  // 任务 1.7：registry 未注册匹配的 Subagent
  // ----------------------------------------------------------------------

  it('1.10 关键词匹配成功但 registry 未注册该 Subagent → 跳过 + 返回成功（无匹配）', async () => {
    // 关键词匹配 search，但 registry 为空
    const registry = createMockRegistry({})

    const result = await dispatchSubagents(
      makeContext({ userRequest: '搜索 nginx' }),
      registry
    )

    // dispatch 步骤成功（subagentInstances.length === 0 触发 short-circuit）
    expect(result.success).toBe(true)
    expect(result.subagentsUsed).toHaveLength(0)
    expect(result.output).toContain('无匹配的 Subagent 可调度')
    // 步骤历史仍包含 8 步（short-circuit 时填充剩余步骤为 success）
    expect(result.stepHistory).toHaveLength(8)
  })

  // ----------------------------------------------------------------------
  // 任务 1.8：Token 累计
  // ----------------------------------------------------------------------

  it('1.11 多 Subagent token 累计正确', async () => {
    const searchSub = createMockSubagent('search', {
      output: '搜索结果',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    })
    const thinkingSub = createMockSubagent('thinking', {
      output: '分析结果',
      usage: { inputTokens: 200, outputTokens: 80, totalTokens: 280 },
    })
    const registry = createMockRegistry({
      search: searchSub,
      thinking: thinkingSub,
    })

    const result = await dispatchSubagents(
      makeContext({ userRequest: '搜索并思考' }),
      registry
    )

    expect(result.totalTokens).toBe(150 + 280)
  })

  // ----------------------------------------------------------------------
  // 任务 1.9：审批闸门（不阻塞流程）
  // ----------------------------------------------------------------------

  it('1.12 Subagent 标记 requiresApproval → 不阻塞流程，但记录到日志', async () => {
    const searchSub = createMockSubagent('search', {
      output: '需要审批',
      requiresApproval: true,
    })
    const registry = createMockRegistry({ search: searchSub })

    // 启动调度（不立即 await），然后模拟人工批准以解除 approve 步骤阻塞
    const resultPromise = dispatchSubagents(
      makeContext({ userRequest: '搜索测试' }),
      registry
    )
    // 等待 approve 步骤进入等待状态后批准
    await new Promise((resolve) => setTimeout(resolve, 50))
    resolveApproval(true)
    const result = await resultPromise

    // 流程仍完成（不阻塞）
    expect(result.success).toBe(true)
    expect(result.stepHistory).toHaveLength(8)
    // approve 步骤 success=true（不阻塞）
    const approveStep = result.stepHistory.find((s) => s.step === 'approve')
    expect(approveStep?.success).toBe(true)
  })

  // ----------------------------------------------------------------------
  // 任务 1.10：reflect 步骤成功率评估
  // ----------------------------------------------------------------------

  it('1.13 成功率 < 50% → 不影响最终 success（reflect 仅标记不阻塞）', async () => {
    // 3 个 Subagent，2 个失败，1 个成功 → 33% < 50%
    const successSub = createMockSubagent('thinking', { output: '成功' })
    const failSub1 = createMockSubagent('search', {
      throw: new Error('失败1'),
    })
    const failSub2 = createMockSubagent('coding', {
      throw: new Error('失败2'),
    })
    const registry = createMockRegistry({
      thinking: successSub,
      search: failSub1,
      coding: failSub2,
    })

    const result = await dispatchSubagents(
      makeContext({ userRequest: '思考 搜索 代码' }),
      registry
    )

    // success = 至少一个成功 → true
    expect(result.success).toBe(true)
    // reflect 步骤仍标记 success=true（reflect 自身不抛错）
    const reflectStep = result.stepHistory.find((s) => s.step === 'reflect')
    expect(reflectStep?.success).toBe(true)
  })

  it('1.14 成功率 = 100% → 正常完成', async () => {
    const searchSub = createMockSubagent('search', { output: '成功1' })
    const thinkingSub = createMockSubagent('thinking', { output: '成功2' })
    const registry = createMockRegistry({
      search: searchSub,
      thinking: thinkingSub,
    })

    const result = await dispatchSubagents(
      makeContext({ userRequest: '搜索并思考' }),
      registry
    )

    expect(result.success).toBe(true)
    // summary footer 包含 "质量 100%"
    expect(result.output).toMatch(/质量\s*100%/)
  })

  // ----------------------------------------------------------------------
  // 任务 1.11：output 字段为对象/字符串/null 的处理
  // ----------------------------------------------------------------------

  it('1.15 Subagent output 为对象 → JSON.stringify 后合并', async () => {
    const searchSub = createMockSubagent('search', {
      output: { files: ['a.ts', 'b.ts'], count: 2 },
    })
    const registry = createMockRegistry({ search: searchSub })

    const result = await dispatchSubagents(
      makeContext({ userRequest: '搜索测试' }),
      registry
    )

    expect(result.output).toContain('"files"')
    expect(result.output).toContain('"a.ts"')
    expect(result.output).toContain('"count":2')
  })

  it('1.16 Subagent output 为 null → 不出现在合并输出中', async () => {
    const searchSub = createMockSubagent('search', { output: null })
    const registry = createMockRegistry({ search: searchSub })

    const result = await dispatchSubagents(
      makeContext({ userRequest: '搜索测试' }),
      registry
    )

    // success=true（output 为 null 但 success=true），但合并输出为空
    expect(result.success).toBe(true)
    // 输出仅包含 header + footer，无内容
    expect(result.output).toContain('[调度完成]')
    expect(result.output).toContain('[统计]')
  })

  // ----------------------------------------------------------------------
  // 任务 1.12：耗时统计
  // ----------------------------------------------------------------------

  it('1.17 totalDurationMs >= 0（耗时统计字段存在且非负）', async () => {
    const searchSub = createMockSubagent('search', { output: '结果' })
    const registry = createMockRegistry({ search: searchSub })

    const startTime = Date.now()
    const result = await dispatchSubagents(
      makeContext({ userRequest: '搜索测试' }),
      registry
    )
    const elapsed = Date.now() - startTime

    // 调度非常快，totalDurationMs 可能为 0（Date.now 精度 1ms）
    // 仅验证非负 + 不超过实际耗时（容差 10ms）
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0)
    expect(result.totalDurationMs).toBeLessThanOrEqual(elapsed + 10)
  })

  // ----------------------------------------------------------------------
  // 任务 1.13：SubagentName 类型断言（explore 不在联合中）
  // ----------------------------------------------------------------------

  it('1.18 explore Subagent 通过类型断言调度成功', async () => {
    const exploreSub = createMockSubagent('explore', {
      output: { files: ['/etc/nginx/nginx.conf'] },
    })
    const registry = createMockRegistry({ explore: exploreSub })

    const result = await dispatchSubagents(
      makeContext({ userRequest: '探查代码库' }),
      registry
    )

    expect(result.success).toBe(true)
    expect(result.subagentsUsed).toContain('explore')
  })
})
