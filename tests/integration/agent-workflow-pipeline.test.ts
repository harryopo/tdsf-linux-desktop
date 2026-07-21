/**
 * Agent 工作流可信决策管线集成测试
 *
 * 验证方案书 §4.1-§4.3 三大核心机制在生产流程中的接线：
 *   - §4.1 Drain3 置信度公式：confidence = 0.7×drainMatch + 0.3×sourcePrior
 *   - §4.2 Ground-Check：证据必须可溯源到真实工具调用，否则标记"仅供参考"
 *   - §4.3 自适应自洽采样：置信度 < 0.7 时 3 次重采样 + 多数票
 */
import { describe, it, expect, vi } from 'vitest'
import { AgentWorkflow, WORKFLOW_EVENTS, type SshExecutor, type EvidenceCollector } from '../../src/main/core/agent-workflow'
import type { Evidence } from '../../src/shared/models'

// ─── 测试辅助 ───────────────────────────────────────────────

/** 模拟 SSH 执行器：返回预置输出 */
function makeMockSsh(outputs: Record<string, string> = {}): SshExecutor & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    execute: async (_connId: string, command: string) => {
      calls.push(command)
      for (const [key, output] of Object.entries(outputs)) {
        if (command.includes(key)) {
          return { exitCode: 0, stdout: output, stderr: '' }
        }
      }
      return { exitCode: 0, stdout: `mock output for: ${command}`, stderr: '' }
    }
  }
}

/** 创建证据 */
function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: `ev-${Math.random().toString(36).slice(2, 8)}`,
    source: 'log',
    sourceDetail: '/var/log/syslog',
    content: 'disk full error',
    drainMatch: 0.5,
    sourcePrior: 0.6,
    confidence: 0.5,
    timestamp: Date.now(),
    verified: false,
    ...overrides
  }
}

/**
 * 启动工作流并自动响应确认事件
 * 注意：必须在 start() 之前注册监听器，避免事件竞态
 */
async function runWorkflow(
  workflow: AgentWorkflow,
  params: Parameters<AgentWorkflow['start']>[0],
  approve: boolean
) {
  return new Promise<Awaited<ReturnType<AgentWorkflow['start']>>>((resolve, reject) => {
    workflow.on(WORKFLOW_EVENTS.CONFIRMATION_REQUIRED, () => {
      workflow.confirm(approve)
    })
    workflow.on(WORKFLOW_EVENTS.ERROR, (err: unknown) => {
      reject(new Error(`workflow error: ${String(err)}`))
    })
    workflow.start(params).then(resolve).catch(reject)
  })
}

// ─── 测试用例 ───────────────────────────────────────────────

describe('AgentWorkflow 可信决策管线（方案书 §4.1-4.3）', () => {
  it('§4.2 Ground-Check：来自真实 SSH 输出的证据通过溯源验证', async () => {
    const workflow = new AgentWorkflow()
    const sshOutput = 'Filesystem Size Used Avail Use% Mounted on\n/dev/sda1 50G 49G 1G 98% /'
    const ssh = makeMockSsh({ 'df -h': sshOutput })

    // 证据采集器：返回内容确实来自 SSH 输出的证据
    const collector: EvidenceCollector = {
      collect: async () => [
        makeEvidence({
          source: 'metric',
          sourceDetail: 'df -h',
          content: '/dev/sda1 50G 49G 1G 98% /',
          timestamp: Date.now() + 1000 // 晚于工具调用时间
        })
      ]
    }

    const card = await runWorkflow(workflow, {
      problem: '磁盘空间不足',
      logs: '',
      connId: 'test-conn',
      sshExecutor: ssh,
      evidenceCollector: collector
    }, true)

    expect(card).not.toBeNull()

    // Ground-Check 统计：证据应通过验证
    const state = workflow.getState()
    expect(state.groundCheck).toBeDefined()
    expect(state.groundCheck!.verified).toBeGreaterThanOrEqual(1)
    expect(state.groundCheck!.rejected).toBe(0)

    // 决策卡片中的证据 verified=true
    expect(card!.evidences.every((e) => e.verified)).toBe(true)
  })

  it('§4.2 Ground-Check：LLM 编造的证据被标记为未验证（仅供参考）', async () => {
    const workflow = new AgentWorkflow()
    const ssh = makeMockSsh()

    // 证据采集器：返回一条 fabricated 证据（内容不在任何 SSH 输出中）
    const collector: EvidenceCollector = {
      collect: async () => [
        makeEvidence({
          source: 'log',
          sourceDetail: '/var/log/fake.log',
          content: 'THIS IS FABRICATED CONTENT THAT NEVER APPEARED IN ANY TOOL OUTPUT 12345',
          timestamp: Date.now() + 1000
        }),
        // 一条 knowledge 类型证据（不依赖工具调用，直接通过）
        makeEvidence({
          source: 'knowledge',
          sourceDetail: 'knowledge-base',
          content: '磁盘满通常需要清理 /var/log',
          timestamp: Date.now() + 1000
        })
      ]
    }

    await runWorkflow(workflow, {
      problem: '磁盘空间不足',
      logs: '',
      connId: 'test-conn',
      sshExecutor: ssh,
      evidenceCollector: collector
    }, false)

    const state = workflow.getState()

    // fabricated 证据应被 Ground-Check 拒绝
    expect(state.groundCheck).toBeDefined()
    expect(state.groundCheck!.rejected).toBeGreaterThanOrEqual(1)
    // knowledge 证据通过
    expect(state.groundCheck!.verified).toBeGreaterThanOrEqual(1)
  })

  it('§4.1 Drain3：日志证据的置信度按公式 0.7×drainMatch + 0.3×sourcePrior 重算', async () => {
    const workflow = new AgentWorkflow()
    const ssh = makeMockSsh()

    const logContent = 'ERROR connection timeout to upstream database server port 3306'
    const collector: EvidenceCollector = {
      collect: async () => [
        makeEvidence({
          source: 'log',
          sourceDetail: 'tail -20 /var/log/nginx/error.log',
          content: logContent,
          drainMatch: 0, // 初始为 0，应由 Drain3 管线重算
          timestamp: Date.now() + 1000
        })
      ]
    }

    const card = await runWorkflow(workflow, {
      problem: 'Nginx 502 错误',
      logs: [
        'ERROR connection timeout to upstream database server port 3306',
        'ERROR connection timeout to upstream database server port 3307',
        'INFO request completed status 200'
      ].join('\n'),
      connId: 'test-conn',
      sshExecutor: ssh,
      evidenceCollector: collector
    }, false)

    expect(card).not.toBeNull()

    // 日志证据的 drainMatch 应被重算（>0，因为日志模板存在）
    const logEvidence = card!.evidences.find((e) => e.source === 'log')
    expect(logEvidence).toBeDefined()
    expect(logEvidence!.drainMatch).toBeGreaterThan(0)
    // 置信度应符合公式范围
    expect(logEvidence!.confidence).toBeGreaterThan(0)
    expect(logEvidence!.confidence).toBeLessThanOrEqual(1)
    // sourcePrior 对 log 类型应为 0.6
    expect(logEvidence!.sourcePrior).toBeCloseTo(0.6)
  })

  it('§4.3 Self-Consistency：低置信度触发 3 次采样 + 多数票', async () => {
    const workflow = new AgentWorkflow()
    const ssh = makeMockSsh()
    const collector: EvidenceCollector = {
      collect: async () => [makeEvidence({ source: 'knowledge', content: 'test' })]
    }

    // llmReasoner：返回低置信度（<0.7），应触发重采样
    let reasonerCalls = 0
    const llmReasoner = vi.fn(async () => {
      reasonerCalls++
      // 奇数次返回假设A，偶数次返回假设B → A 获得 2 票
      return reasonerCalls % 2 === 1
        ? { hypothesis: '假设A：MySQL 慢查询导致连接池耗尽', confidence: 0.4 }
        : { hypothesis: '假设B：Nginx 配置错误', confidence: 0.4 }
    })

    const card = await runWorkflow(workflow, {
      problem: '网站 502 错误',
      logs: '',
      connId: 'test-conn',
      sshExecutor: ssh,
      evidenceCollector: collector,
      llmReasoner
    }, false)

    expect(card).not.toBeNull()

    // 应调用 3 次（1 次初始 + 2 次重采样）
    expect(llmReasoner).toHaveBeenCalledTimes(3)
    // 多数票：假设A 获得 2 票
    expect(card!.hypothesis).toBe('假设A：MySQL 慢查询导致连接池耗尽')
  })

  it('§4.3 Self-Consistency：高置信度仅单次推理（省 token）', async () => {
    const workflow = new AgentWorkflow()
    const ssh = makeMockSsh()
    const collector: EvidenceCollector = {
      collect: async () => [makeEvidence({ source: 'knowledge', content: 'test' })]
    }

    const llmReasoner = vi.fn(async () => ({
      hypothesis: '高置信度假设：OOM Killer 终止了 MySQL 进程',
      confidence: 0.9 // ≥0.7，不应重采样
    }))

    const card = await runWorkflow(workflow, {
      problem: 'MySQL 进程被杀',
      logs: '',
      connId: 'test-conn',
      sshExecutor: ssh,
      evidenceCollector: collector,
      llmReasoner
    }, false)

    expect(card).not.toBeNull()
    expect(llmReasoner).toHaveBeenCalledTimes(1)
    expect(card!.hypothesis).toBe('高置信度假设：OOM Killer 终止了 MySQL 进程')
  })

  it('完整 7 步流程：无 LLM 时规则引擎降级路径正常', async () => {
    const workflow = new AgentWorkflow()
    const ssh = makeMockSsh({
      'df -h': '/dev/sda1 50G 49G 1G 98% /',
      'free -m': 'Mem: 3944 3500 444'
    })
    const collector: EvidenceCollector = {
      collect: async () => [
        makeEvidence({ source: 'knowledge', content: '磁盘满案例' })
      ]
    }

    const steps: string[] = []
    workflow.on(WORKFLOW_EVENTS.STEP_CHANGED, (state) => {
      steps.push(state.currentStep)
    })

    const card = await runWorkflow(workflow, {
      problem: '磁盘空间不足，服务写入失败',
      logs: '',
      connId: 'test-conn',
      sshExecutor: ssh,
      evidenceCollector: collector
    }, true)

    expect(card).not.toBeNull()
    expect(card!.status).toBe('verified')

    // 7 步全部完成
    expect(steps).toContain('collect')
    expect(steps).toContain('analyze')
    expect(steps).toContain('reason')
    expect(steps).toContain('check')
    expect(steps).toContain('confirm')
    expect(steps).toContain('execute')
    expect(steps).toContain('verify')

    // SSH 工具调用被记录（Ground-Check 输入）
    expect(ssh.calls.length).toBeGreaterThan(0)
  })
})
