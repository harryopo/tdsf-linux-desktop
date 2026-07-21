/**
 * AttentionTracker + ExpectationMonitor + getCostStats 单元测试
 * （v0.9.4 批次 4 - 任务 4+5+6 测试）
 *
 * 覆盖 3 个模块的核心逻辑：
 *
 * 1. AttentionTracker（任务 4，单例 + 跟踪 + 历史归档）
 *    - 单例：getInstance 返回同一实例
 *    - trackFiles/trackCommands/trackErrors/trackKeywords：去重 + 累加
 *    - getCurrent：返回深拷贝（外部修改不污染内部）
 *    - getHistory：返回深拷贝列表
 *    - reset：归档非空 current 到 history + 创建新 current
 *    - clear：清空所有数据
 *    - setAttention：覆盖 current
 *    - isEmpty：判断 current 是否全空
 *    - resetAttentionTrackerInstance：测试用重置
 *
 * 2. checkExpectation（任务 5，预期回显对比）
 *    - forbidden-found：实际输出包含 mustNotContain 关键词
 *    - missing-required：实际输出未包含任一 mustContain 关键词
 *    - exit-code-mismatch：退出码不匹配
 *    - expectedExitCode = null → 跳过退出码检查
 *    - createTimeoutViolation：构造超时违规
 *    - isExpectationMet：便捷判断
 *    - formatViolations：格式化输出
 *
 * 3. getCostStats（任务 6，成本累计统计）
 *    - 空记录 → 全 0
 *    - record.cost 已设置 → 直接使用
 *    - record.cost 未设置 → 按 PROVIDER_PRICING['openai-compatible'] 计算
 *    - 时间窗口聚合（today/week/month/total）
 *    - bySubagent / byProvider 聚合
 *    - 6 位小数四舍五入
 *
 * Mock 策略：
 * - Mock electron + electron-store（logger + provider-registry 间接依赖）
 * - 不 mock 被测模块本身
 * - 使用 resetAttentionTrackerInstance 重置单例（beforeEach）
 * - 使用 resetTokenStats 清空 token 记录（beforeEach）
 *
 * 设计依据：v0.9.4 §11 第 7 类（其他 3 项 - 任务 4+5+6）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TokenUsageRecord } from '../../src/shared/agent-types'

// ============================================================================
// Mock：electron + electron-store（logger + provider-registry 间接依赖）
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
// 导入被测模块
// ============================================================================
import {
  AttentionTracker,
  resetAttentionTrackerInstance,
} from '../../src/main/core/agent/attention-tracker'
import {
  checkExpectation,
  createTimeoutViolation,
  isExpectationMet,
  formatViolations,
  type CommandExpectation,
  type ExpectationViolation,
} from '../../src/main/core/agent/expectation-monitor'
import {
  recordTokenUsage,
  resetTokenStats,
  getCostStats,
  type CostStats,
} from '../../src/main/core/agent/providers/token-stats'

// ============================================================================
// 工具函数：构造 TokenUsageRecord
// ============================================================================

function makeRecord(overrides: Partial<TokenUsageRecord> = {}): TokenUsageRecord {
  return {
    providerId: 'test-provider',
    model: 'test-model',
    inputTokens: 1000,
    outputTokens: 500,
    totalTokens: 1500,
    subagent: 'supervisor',
    strength: 'standard',
    timestamp: Date.now(),
    ...overrides,
  }
}

// ============================================================================
// 任务 4：AttentionTracker 测试
// ============================================================================

describe('[attention-tracker] AttentionTracker 单例 + 跟踪', () => {
  beforeEach(() => {
    resetAttentionTrackerInstance()
  })

  it('4.1 getInstance 返回同一实例（单例）', () => {
    const inst1 = AttentionTracker.getInstance()
    const inst2 = AttentionTracker.getInstance()
    expect(inst1).toBe(inst2)
  })

  it('4.2 初始状态 isEmpty() === true', () => {
    const tracker = AttentionTracker.getInstance()
    expect(tracker.isEmpty()).toBe(true)
  })

  it('4.3 trackFiles 累加 + 去重', () => {
    const tracker = AttentionTracker.getInstance()
    tracker.trackFiles(['/etc/nginx/nginx.conf'])
    tracker.trackFiles(['/etc/nginx/sites-enabled/default', '/etc/nginx/nginx.conf'])

    const current = tracker.getCurrent()
    expect(current.files).toHaveLength(2)
    expect(current.files).toContain('/etc/nginx/nginx.conf')
    expect(current.files).toContain('/etc/nginx/sites-enabled/default')
  })

  it('4.4 trackCommands 累加 + 去重', () => {
    const tracker = AttentionTracker.getInstance()
    tracker.trackCommands(['systemctl status nginx'])
    tracker.trackCommands(['systemctl status nginx', 'nginx -t'])

    const current = tracker.getCurrent()
    expect(current.commands).toHaveLength(2)
    expect(current.commands).toContain('systemctl status nginx')
    expect(current.commands).toContain('nginx -t')
  })

  it('4.5 trackErrors 累加 + 去重', () => {
    const tracker = AttentionTracker.getInstance()
    tracker.trackErrors(['nginx: config test failed'])
    tracker.trackErrors(['nginx: config test failed', 'permission denied'])

    const current = tracker.getCurrent()
    expect(current.errors).toHaveLength(2)
  })

  it('4.6 trackKeywords 累加 + 去重', () => {
    const tracker = AttentionTracker.getInstance()
    tracker.trackKeywords(['nginx', 'systemd'])
    tracker.trackKeywords(['nginx', 'deploy'])

    const current = tracker.getCurrent()
    expect(current.keywords).toHaveLength(3)
    expect(current.keywords).toContain('nginx')
    expect(current.keywords).toContain('systemd')
    expect(current.keywords).toContain('deploy')
  })

  it('4.7 getCurrent 返回深拷贝（修改返回值不污染内部）', () => {
    const tracker = AttentionTracker.getInstance()
    tracker.trackFiles(['/etc/nginx/nginx.conf'])

    const current1 = tracker.getCurrent()
    current1.files!.push('/injected/file')

    const current2 = tracker.getCurrent()
    expect(current2.files).toHaveLength(1)
    expect(current2.files).not.toContain('/injected/file')
  })

  it('4.8 isEmpty 在有数据时返回 false', () => {
    const tracker = AttentionTracker.getInstance()
    tracker.trackFiles(['/some/file'])
    expect(tracker.isEmpty()).toBe(false)
  })

  it('4.9 reset 归档非空 current 到 history', () => {
    const tracker = AttentionTracker.getInstance()
    tracker.trackFiles(['/file1'])
    tracker.trackCommands(['cmd1'])

    tracker.reset()

    // current 应为空
    expect(tracker.isEmpty()).toBe(true)
    // history 应有 1 条
    const history = tracker.getHistory()
    expect(history).toHaveLength(1)
    expect(history[0].files).toContain('/file1')
    expect(history[0].commands).toContain('cmd1')
  })

  it('4.10 reset 多次空 current 不归档（避免 history 充斥空记录）', () => {
    const tracker = AttentionTracker.getInstance()
    tracker.reset() // current 空，不应归档
    tracker.reset() // 同上

    const history = tracker.getHistory()
    expect(history).toHaveLength(0)
  })

  it('4.11 clear 清空 current + history', () => {
    const tracker = AttentionTracker.getInstance()
    tracker.trackFiles(['/file1'])
    tracker.reset() // 归档到 history
    tracker.trackCommands(['cmd1'])

    tracker.clear()

    expect(tracker.isEmpty()).toBe(true)
    expect(tracker.getHistory()).toHaveLength(0)
  })

  it('4.12 setAttention 覆盖 current', () => {
    const tracker = AttentionTracker.getInstance()
    tracker.trackFiles(['/old-file'])

    tracker.setAttention({
      files: ['/new-file1', '/new-file2'],
      commands: ['new-cmd'],
      since: Date.now(),
    })

    const current = tracker.getCurrent()
    expect(current.files).toEqual(['/new-file1', '/new-file2'])
    expect(current.commands).toEqual(['new-cmd'])
    expect(current.errors).toBeUndefined()
  })

  it('4.13 getHistory 返回深拷贝（修改不污染内部）', () => {
    const tracker = AttentionTracker.getInstance()
    tracker.trackFiles(['/file1'])
    tracker.reset()

    const history1 = tracker.getHistory()
    history1[0].files!.push('/injected')

    const history2 = tracker.getHistory()
    expect(history2[0].files).toHaveLength(1)
    expect(history2[0].files).not.toContain('/injected')
  })

  it('4.14 trackXxx 传入空数组 → 不修改状态', () => {
    const tracker = AttentionTracker.getInstance()
    tracker.trackFiles([])
    tracker.trackCommands([])
    tracker.trackErrors([])
    tracker.trackKeywords([])

    expect(tracker.isEmpty()).toBe(true)
  })
})

// ============================================================================
// 任务 5：checkExpectation 测试
// ============================================================================

describe('[expectation-monitor] checkExpectation 预期回显', () => {
  it('5.1 实际输出符合预期 → 返回空违规列表', () => {
    const expectation: CommandExpectation = {
      command: 'ls /etc/nginx',
      mustContain: ['nginx.conf'],
      mustNotContain: ['Permission denied'],
      expectedExitCode: 0,
    }

    const violations = checkExpectation(expectation, 'nginx.conf\nsites-enabled', 0)
    expect(violations).toEqual([])
  })

  it('5.2 forbidden-found：实际输出含 mustNotContain 关键词 → 违规', () => {
    const expectation: CommandExpectation = {
      command: 'cat /etc/shadow',
      mustNotContain: ['Permission denied'],
      // 不检查退出码（避免 extra violation 干扰测试）
      expectedExitCode: null,
    }

    const violations = checkExpectation(expectation, 'cat: /etc/shadow: Permission denied', 1)
    expect(violations).toHaveLength(1)
    expect(violations[0].type).toBe('forbidden-found')
    expect(violations[0].triggeredKeyword).toBe('Permission denied')
  })

  it('5.3 missing-required：实际输出未含任一 mustContain 关键词 → 违规', () => {
    const expectation: CommandExpectation = {
      command: 'systemctl status nginx',
      mustContain: ['active (running)', 'active (exited)'],
    }

    const violations = checkExpectation(expectation, 'inactive (dead)', 0)
    expect(violations).toHaveLength(1)
    expect(violations[0].type).toBe('missing-required')
  })

  it('5.4 mustContain 是"任一匹配即符合"', () => {
    const expectation: CommandExpectation = {
      command: 'systemctl status nginx',
      mustContain: ['active (running)', 'active (exited)'],
    }

    // 输出含 'active (exited)'，符合预期
    const violations = checkExpectation(expectation, 'active (exited)', 0)
    expect(violations).toEqual([])
  })

  it('5.5 exit-code-mismatch：退出码不匹配 → 违规', () => {
    const expectation: CommandExpectation = {
      command: 'nginx -t',
      expectedExitCode: 0,
    }

    const violations = checkExpectation(expectation, 'syntax error', 1)
    expect(violations).toHaveLength(1)
    expect(violations[0].type).toBe('exit-code-mismatch')
    expect(violations[0].actualExitCode).toBe(1)
  })

  it('5.6 expectedExitCode = null → 跳过退出码检查', () => {
    const expectation: CommandExpectation = {
      command: 'some-command',
      expectedExitCode: null,
    }

    const violations = checkExpectation(expectation, 'output', 999)
    expect(violations).toEqual([])
  })

  it('5.7 多种违规同时发生 → 全部记录', () => {
    const expectation: CommandExpectation = {
      command: 'dangerous-cmd',
      mustContain: ['success'],
      mustNotContain: ['error', 'failed'],
      expectedExitCode: 0,
    }

    // 输出含 forbidden 关键词（'error' 和 'failed' 都匹配，2 个 violation）
    // + 缺 must 关键词（1 个 violation）
    // + 退出码不匹配（1 个 violation）
    // = 4 个 violation
    const violations = checkExpectation(expectation, 'error: something failed', 1)
    expect(violations).toHaveLength(4)
    const types = violations.map((v) => v.type).sort()
    expect(types).toEqual([
      'exit-code-mismatch',
      'forbidden-found',
      'forbidden-found',
      'missing-required',
    ])
  })

  it('5.8 大小写不敏感匹配', () => {
    const expectation: CommandExpectation = {
      command: 'cmd',
      mustNotContain: ['Permission Denied'],
    }

    // 实际输出是小写，应仍触发违规
    const violations = checkExpectation(expectation, 'permission denied', 0)
    expect(violations).toHaveLength(1)
    expect(violations[0].triggeredKeyword).toBe('Permission Denied')
  })

  it('5.9 长输出截断到 500 字符', () => {
    const expectation: CommandExpectation = {
      command: 'cmd',
      mustNotContain: ['forbidden'],
      expectedExitCode: null,
    }

    const longOutput = 'x'.repeat(1000) + 'forbidden'
    const violations = checkExpectation(expectation, longOutput, 0)
    expect(violations).toHaveLength(1)
    // 截断后长度 = 500（slice） + 14（'...[truncated]' 后缀） = 514
    expect(violations[0].actualOutputSnippet.length).toBeLessThanOrEqual(514)
    expect(violations[0].actualOutputSnippet).toContain('...[truncated]')
  })

  it('5.10 createTimeoutViolation 构造超时违规', () => {
    const expectation: CommandExpectation = {
      command: 'long-running-cmd',
      timeoutMs: 5000,
    }

    const violation = createTimeoutViolation(expectation, 6000)
    expect(violation.type).toBe('timeout')
    expect(violation.reason).toContain('6000ms')
    expect(violation.reason).toContain('5000ms')
  })

  it('5.11 createTimeoutViolation 使用默认超时（30000ms）', () => {
    const expectation: CommandExpectation = {
      command: 'cmd',
      // 不设 timeoutMs
    }

    const violation = createTimeoutViolation(expectation, 31000)
    expect(violation.reason).toContain('30000ms')
  })

  it('5.12 isExpectationMet 符合预期 → true', () => {
    const expectation: CommandExpectation = {
      command: 'cmd',
      mustContain: ['ok'],
      expectedExitCode: 0,
    }

    expect(isExpectationMet(expectation, 'ok', 0)).toBe(true)
  })

  it('5.13 isExpectationMet 不符合预期 → false', () => {
    const expectation: CommandExpectation = {
      command: 'cmd',
      mustContain: ['ok'],
      expectedExitCode: 0,
    }

    expect(isExpectationMet(expectation, 'fail', 0)).toBe(false)
  })

  it('5.14 formatViolations 空列表 → "符合预期"', () => {
    const result = formatViolations([])
    expect(result).toContain('符合预期')
  })

  it('5.15 formatViolations 非空列表 → 包含违规详情', () => {
    const violations: ExpectationViolation[] = [
      {
        type: 'forbidden-found',
        actualOutputSnippet: 'permission denied',
        reason: '输出含禁止关键词',
        triggeredKeyword: 'Permission denied',
      },
      {
        type: 'exit-code-mismatch',
        actualExitCode: 1,
        actualOutputSnippet: '',
        reason: '退出码不匹配',
      },
    ]

    const result = formatViolations(violations)
    expect(result).toContain('发现 2 项违规')
    expect(result).toContain('[1] forbidden-found')
    expect(result).toContain('[2] exit-code-mismatch')
    expect(result).toContain('触发关键词: Permission denied')
    expect(result).toContain('实际退出码: 1')
  })
})

// ============================================================================
// 任务 6：getCostStats 测试
// ============================================================================

describe('[token-stats] getCostStats 成本累计统计', () => {
  beforeEach(() => {
    resetTokenStats()
  })

  it('6.1 空记录 → 全 0', () => {
    const stats = getCostStats()
    expect(stats.todayCost).toBe(0)
    expect(stats.weekCost).toBe(0)
    expect(stats.monthCost).toBe(0)
    expect(stats.totalCost).toBe(0)
    expect(stats.bySubagent).toEqual({})
    expect(stats.byProvider).toEqual({})
  })

  it('6.2 record.cost 已设置 → 直接使用', () => {
    recordTokenUsage(
      makeRecord({
        cost: 0.012,
        subagent: 'supervisor',
        providerId: 'test-provider',
      })
    )

    const stats = getCostStats()
    expect(stats.totalCost).toBe(0.012)
    expect(stats.todayCost).toBe(0.012)
    expect(stats.bySubagent.supervisor).toBe(0.012)
    expect(stats.byProvider['test-provider']).toBe(0.012)
  })

  it('6.3 record.cost 未设置 → 按 openai-compatible 默认定价计算', () => {
    // openai-compatible 默认定价：input $1/1M + output $3/1M
    // cost = (1000 * 1 + 500 * 3) / 1_000_000 = 0.0025
    recordTokenUsage(
      makeRecord({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cost: undefined,
        subagent: 'coding-subagent',
        providerId: 'unknown-provider',
      })
    )

    const stats = getCostStats()
    expect(stats.totalCost).toBeCloseTo(0.0025, 6)
  })

  it('6.4 多条记录累加正确', () => {
    recordTokenUsage(
      makeRecord({
        cost: 0.001,
        subagent: 'supervisor',
        providerId: 'provider-a',
      })
    )
    recordTokenUsage(
      makeRecord({
        cost: 0.002,
        subagent: 'coding-subagent',
        providerId: 'provider-b',
      })
    )
    recordTokenUsage(
      makeRecord({
        cost: 0.003,
        subagent: 'supervisor',
        providerId: 'provider-a',
      })
    )

    const stats = getCostStats()
    expect(stats.totalCost).toBeCloseTo(0.006, 6)
    expect(stats.bySubagent.supervisor).toBeCloseTo(0.004, 6)
    expect(stats.bySubagent['coding-subagent']).toBeCloseTo(0.002, 6)
    expect(stats.byProvider['provider-a']).toBeCloseTo(0.004, 6)
    expect(stats.byProvider['provider-b']).toBeCloseTo(0.002, 6)
  })

  it('6.5 时间窗口聚合 - 历史记录不计入 today 但计入 total', () => {
    // 历史记录（3 天前）
    const oldRecord = makeRecord({
      cost: 0.005,
      timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000,
      subagent: 'history-sub',
      providerId: 'old-provider',
    })
    // 今日记录
    const todayRecord = makeRecord({
      cost: 0.002,
      timestamp: Date.now(),
      subagent: 'today-sub',
      providerId: 'today-provider',
    })
    recordTokenUsage(oldRecord)
    recordTokenUsage(todayRecord)

    const stats = getCostStats()
    // total 含所有
    expect(stats.totalCost).toBeCloseTo(0.007, 6)
    // today 仅含今日
    expect(stats.todayCost).toBeCloseTo(0.002, 6)
    // month 应该都包含（3 天前仍在本月）
    // 注意：如果跨月了，oldRecord 可能不计入 month，这里仅验证 todayCost
  })

  it('6.6 cost 字段为 0 → 视为已设置（不重算）', () => {
    recordTokenUsage(
      makeRecord({
        cost: 0,
        inputTokens: 1000,
        outputTokens: 500,
        subagent: 'zero-cost-sub',
        providerId: 'zero-provider',
      })
    )

    const stats = getCostStats()
    expect(stats.totalCost).toBe(0)
    expect(stats.bySubagent['zero-cost-sub']).toBe(0)
  })

  it('6.7 cost 字段为负数 → 视为未设置，重算', () => {
    // computeRecordCost 的判断条件是 cost >= 0，负数应触发重算
    recordTokenUsage(
      makeRecord({
        cost: -1,
        inputTokens: 1000,
        outputTokens: 500,
        subagent: 'neg-cost-sub',
        providerId: 'neg-provider',
      })
    )

    const stats = getCostStats()
    // 重算后应为 0.0025（按 openai-compatible 默认定价）
    expect(stats.totalCost).toBeCloseTo(0.0025, 6)
  })

  it('6.8 bySubagent 不同 subagent 分别聚合', () => {
    recordTokenUsage(
      makeRecord({
        cost: 0.001,
        subagent: 'supervisor',
        providerId: 'p1',
      })
    )
    recordTokenUsage(
      makeRecord({
        cost: 0.002,
        subagent: 'coding-subagent',
        providerId: 'p1',
      })
    )
    recordTokenUsage(
      makeRecord({
        cost: 0.003,
        subagent: 'thinking-subagent',
        providerId: 'p1',
      })
    )

    const stats = getCostStats()
    expect(Object.keys(stats.bySubagent)).toHaveLength(3)
    expect(stats.bySubagent.supervisor).toBeCloseTo(0.001, 6)
    expect(stats.bySubagent['coding-subagent']).toBeCloseTo(0.002, 6)
    expect(stats.bySubagent['thinking-subagent']).toBeCloseTo(0.003, 6)
  })

  it('6.9 byProvider 不同 provider 分别聚合', () => {
    recordTokenUsage(
      makeRecord({
        cost: 0.001,
        subagent: 's1',
        providerId: 'provider-a',
      })
    )
    recordTokenUsage(
      makeRecord({
        cost: 0.002,
        subagent: 's1',
        providerId: 'provider-b',
      })
    )

    const stats = getCostStats()
    expect(Object.keys(stats.byProvider)).toHaveLength(2)
    expect(stats.byProvider['provider-a']).toBeCloseTo(0.001, 6)
    expect(stats.byProvider['provider-b']).toBeCloseTo(0.002, 6)
  })

  it('6.10 6 位小数四舍五入', () => {
    // 累计 0.0000001 * 10 = 0.000001（应保留）
    for (let i = 0; i < 10; i++) {
      recordTokenUsage(
        makeRecord({
          cost: 0.0000001,
          subagent: 'rounding-sub',
          providerId: 'rounding-provider',
        })
      )
    }

    const stats = getCostStats()
    // 0.0000001 * 10 = 0.000001，应四舍五入到 0.000001
    expect(stats.totalCost).toBeCloseTo(0.000001, 7)
  })

  it('6.11 resetTokenStats 后 getCostStats 返回全 0', () => {
    recordTokenUsage(makeRecord({ cost: 0.005 }))
    expect(getCostStats().totalCost).toBe(0.005)

    resetTokenStats()

    const stats = getCostStats()
    expect(stats.totalCost).toBe(0)
    expect(stats.todayCost).toBe(0)
    expect(stats.bySubagent).toEqual({})
  })
})
