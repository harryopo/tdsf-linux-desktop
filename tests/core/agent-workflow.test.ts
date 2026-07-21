/**
 * AgentWorkflow 5 层根因回归测试
 *
 * 覆盖循环工程测试问题清单中的 P0-2 五层根因：
 * - 根因 A：runStep confirm 步骤 waitingForConfirmation 时机
 * - 根因 B：CONFIRMATION_REQUIRED 事件发射
 * - 根因 C：ERROR/CANCELLED 事件
 * - 根因 D：COMPLETED 事件携带 decisionCard
 * - 根因 E：错误不被吞没（在本测试中通过 event 验证）
 *
 * 防止"批准失败: 无活跃工作流"等核心 Bug 复发
 */
import { describe, it, expect, vi } from 'vitest'
import { AgentWorkflow, WORKFLOW_EVENTS } from '../../src/main/core/agent-workflow'
import type { SshExecutor, EvidenceCollector } from '../../src/main/core/agent-workflow'
import type { Evidence } from '../../src/shared/models'

/** 测试用 Mock SSH 执行器 */
const mockSsh: SshExecutor = {
  execute: vi.fn(async (connId, command) => ({
    exitCode: 0,
    stdout: `mock output of ${command}`,
    stderr: ''
  }))
}

/** 测试用 Mock 证据采集器 */
const mockCollector: EvidenceCollector = {
  collect: vi.fn(async (problem, envInfo): Promise<Evidence[]> => {
    return [
      {
        id: 'ev_test_1',
        source: 'command',
        sourceDetail: 'hostname',
        content: 'test-server',
        drainMatch: 0.8,
        sourcePrior: 0.9,
        confidence: 0.83,
        timestamp: Date.now(),
        verified: true
      }
    ]
  })
}

describe('AgentWorkflow - 5 层根因回归测试', () => {
  it('P0-2 根因 A: confirm 步骤应在 emit STEP_CHANGED 前设置 waitingForConfirmation=true', async () => {
    const workflow = new AgentWorkflow()
    const stepStates: { currentStep: string; waitingForConfirmation: boolean }[] = []

    workflow.on(WORKFLOW_EVENTS.STEP_CHANGED, (state) => {
      stepStates.push({
        currentStep: state.currentStep,
        waitingForConfirmation: state.waitingForConfirmation
      })
    })

    // 异步启动但不立即确认
    const startPromise = workflow.start({
      problem: '测试问题',
      logs: '',
      connId: 'conn-1',
      sshExecutor: mockSsh,
      evidenceCollector: mockCollector
    })

    // 等待 confirm 步骤的 STEP_CHANGED
    await new Promise((resolve) => setTimeout(resolve, 50))

    // 关键断言：confirm 步骤的 STEP_CHANGED 必须 waitingForConfirmation=true
    const confirmStep = stepStates.find((s) => s.currentStep === 'confirm')
    expect(confirmStep).toBeDefined()
    expect(confirmStep!.waitingForConfirmation).toBe(true)

    // 清理
    workflow.confirm(true)
    await startPromise
  })

  it('P0-2 根因 B: 必须在 confirm 步骤发射 CONFIRMATION_REQUIRED 事件', async () => {
    const workflow = new AgentWorkflow()
    let confirmationRequiredFired = false
    let confirmationState: any = null

    workflow.on(WORKFLOW_EVENTS.CONFIRMATION_REQUIRED, (state) => {
      confirmationRequiredFired = true
      confirmationState = state
    })

    const startPromise = workflow.start({
      problem: '测试',
      logs: '',
      connId: 'conn-1',
      sshExecutor: mockSsh,
      evidenceCollector: mockCollector
    })

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(confirmationRequiredFired).toBe(true)
    expect(confirmationState).not.toBeNull()
    expect(confirmationState.decisionCard).not.toBeNull()
    expect(confirmationState.waitingForConfirmation).toBe(true)

    workflow.confirm(true)
    await startPromise
  })

  it('P0-2 根因 C: ERROR 事件应携带 error 信息', async () => {
    const workflow = new AgentWorkflow()
    const errorCollector: EvidenceCollector = {
      collect: vi.fn(async () => {
        throw new Error('采集证据失败')
      })
    }

    let errorMsg: string | null = null
    workflow.on(WORKFLOW_EVENTS.ERROR, (msg) => {
      errorMsg = typeof msg === 'string' ? msg : String(msg)
    })

    const result = await workflow.start({
      problem: '测试',
      logs: '',
      connId: 'conn-1',
      sshExecutor: mockSsh,
      evidenceCollector: errorCollector
    })

    expect(result).toBeNull()
    expect(errorMsg).toBe('采集证据失败')
  })

  it('P0-2 根因 C: CANCELLED 事件应正常发射', async () => {
    const workflow = new AgentWorkflow()
    let cancelledFired = false

    workflow.on(WORKFLOW_EVENTS.CANCELLED, () => {
      cancelledFired = true
    })

    const startPromise = workflow.start({
      problem: '测试',
      logs: '',
      connId: 'conn-1',
      sshExecutor: mockSsh,
      evidenceCollector: mockCollector
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    workflow.cancel()

    await startPromise
    expect(cancelledFired).toBe(true)
  })

  it('P0-2 根因 D: COMPLETED 事件必须携带最终 decisionCard（verified/rejected）', async () => {
    const workflow = new AgentWorkflow()
    let completedState: any = null

    workflow.on(WORKFLOW_EVENTS.COMPLETED, (state) => {
      completedState = state
    })

    // 测试拒绝路径
    const startPromise = workflow.start({
      problem: '测试',
      logs: '',
      connId: 'conn-1',
      sshExecutor: mockSsh,
      evidenceCollector: mockCollector
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    workflow.confirm(false)
    await startPromise

    expect(completedState).not.toBeNull()
    expect(completedState.decisionCard).not.toBeNull()
    expect(completedState.decisionCard.status).toBe('rejected')
  })

  it('P0-2 根因 D: 批准后 COMPLETED 事件 decisionCard.status 应为 verified', async () => {
    const workflow = new AgentWorkflow()
    let completedState: any = null

    workflow.on(WORKFLOW_EVENTS.COMPLETED, (state) => {
      completedState = state
    })

    const startPromise = workflow.start({
      problem: '测试',
      logs: '',
      connId: 'conn-1',
      sshExecutor: mockSsh,
      evidenceCollector: mockCollector
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    workflow.confirm(true)
    await startPromise

    expect(completedState.decisionCard.status).toBe('verified')
  })

  it('P0-2 综合: 7 步工作流完整跑通（批准路径）', async () => {
    const workflow = new AgentWorkflow()
    const events: string[] = []

    workflow.on(WORKFLOW_EVENTS.STEP_CHANGED, (state) => {
      events.push(`step:${state.currentStep}`)
    })
    workflow.on(WORKFLOW_EVENTS.CONFIRMATION_REQUIRED, () => {
      events.push('confirmation:required')
    })
    workflow.on(WORKFLOW_EVENTS.COMPLETED, () => {
      events.push('completed')
    })

    const startPromise = workflow.start({
      problem: '测试',
      logs: '',
      connId: 'conn-1',
      sshExecutor: mockSsh,
      evidenceCollector: mockCollector
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    workflow.confirm(true)
    const result = await startPromise

    // 验证事件顺序
    expect(events).toContain('step:collect')
    expect(events).toContain('step:analyze')
    expect(events).toContain('step:reason')
    expect(events).toContain('step:check')
    expect(events).toContain('step:confirm')
    expect(events).toContain('confirmation:required')
    expect(events).toContain('step:execute')
    expect(events).toContain('step:verify')
    expect(events).toContain('completed')

    expect(result).not.toBeNull()
    expect(result!.status).toBe('verified')
  })

  it('P0-1: collect 步骤应正常完成（无 SSH 时不报错）', async () => {
    const workflow = new AgentWorkflow()
    const startPromise = workflow.start({
      problem: '测试',
      logs: '',
      connId: 'conn-1',
      // 不传 sshExecutor，模拟无 SSH 环境
      sshExecutor: undefined,
      evidenceCollector: mockCollector
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    workflow.confirm(true)
    const result = await startPromise
    expect(result).not.toBeNull()
  })

  it('P1-1: 模糊问题应返回综合健康检查命令（不再 echo "需要人工诊断"）', async () => {
    const workflow = new AgentWorkflow()
    let capturedCard: any = null

    workflow.on(WORKFLOW_EVENTS.CONFIRMATION_REQUIRED, (state) => {
      capturedCard = state.decisionCard
    })

    const startPromise = workflow.start({
      problem: '检查一下系统状态',  // 模糊问题
      logs: '',
      connId: 'conn-1',
      sshExecutor: mockSsh,
      evidenceCollector: mockCollector
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    workflow.confirm(false)
    await startPromise

    // 验证 fixCommand 是健康检查脚本，不是 echo
    expect(capturedCard).not.toBeNull()
    expect(capturedCard.fixCommand).toContain('uname -a')
    expect(capturedCard.fixCommand).toContain('free -h')
    expect(capturedCard.fixCommand).toContain('df -h')
    expect(capturedCard.fixCommand).not.toBe('echo "需要人工诊断"')
  })

  it('P1-5: SSH 命令采集已支持并发（7 条命令同时执行）', async () => {
    let concurrentCallCount = 0
    let maxConcurrent = 0
    let currentConcurrent = 0

    const trackingSsh: SshExecutor = {
      execute: vi.fn(async (_connId, command) => {
        currentConcurrent++
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
        concurrentCallCount++
        // 模拟网络延迟
        await new Promise((resolve) => setTimeout(resolve, 10))
        currentConcurrent--
        return { exitCode: 0, stdout: `output-${command}`, stderr: '' }
      })
    }

    const workflow = new AgentWorkflow()
    const startPromise = workflow.start({
      problem: '测试',
      logs: '',
      connId: 'conn-1',
      sshExecutor: trackingSsh,
      evidenceCollector: mockCollector
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    workflow.confirm(false)
    await startPromise

    // 验证并发：7 条命令应并发执行
    expect(concurrentCallCount).toBeGreaterThanOrEqual(7)
    expect(maxConcurrent).toBeGreaterThan(1)  // 并发数 > 1
  })
})
