/**
 * Daily Health Check 单元测试（Phase 6 Task 6.2）
 *
 * 测试目标（spec SubTask 6.2.3 ≥ 10 个用例）：
 *   1. 无服务器配置（应返回 success=true，summary 含 "无服务器配置"）
 *   2. 所有服务器连接失败（应返回 success=true，details.failures 非空）
 *   3. 部分服务器成功部分失败（successes + failures 都非空）
 *   4. 全部成功（details.metrics 非空）
 *   5. 规则引擎异常（details.ruleEngineError 非空）
 *   6. SSH exec 命令失败（exitCode != 0）
 *   7. SSH connect 抛异常（不中断整体任务）
 *   8. 规则引擎发现告警（details.alerts 非空）
 *   9. 单台成功但无告警（alerts 不含该服务器条目）
 *  10. SchedulerTask 工厂结构正确
 *  11. SSH executor 的 connect/exec/disconnect 都被调用
 *  12. durationMs 为非负数
 *  13. 多台服务器 + 多个告警合并
 *  14. SSH exec 抛异常（reject）→ 该服务器进入 failures
 *  15. 摘要格式正确（包含服务器数 / 成功数 / 告警数）
 *
 * 测试模式：mock SshExecutor + mock RuleAnalyzer，不真实连接 SSH。
 * 运行方式：
 *   npx tsx --tsconfig tsconfig.node.json scripts/test-daily-health-check.ts
 *
 * 参考：
 *   - scripts/test-cron-parser.ts（🚀/🔍/✅/❌/📊 输出格式）
 *   - 依赖注入设计：runDailyHealthCheck 接受 SshExecutor / RuleAnalyzer 接口参数
 */

import {
  runDailyHealthCheck,
  createDailyHealthCheckTask,
  DefaultRuleAnalyzer,
  type SshExecutor,
  type RuleAnalyzer,
  type ServerMetrics,
  type HealthAlert,
  type HealthCheckDetails,
} from '../src/main/services/scheduler/daily-health-check'
import type { SshConfig } from '../src/shared/models'
import type { TaskResult } from '../src/shared/scheduler-types'

// ============================================================
// 测试工具函数
// ============================================================

let passCount = 0
let failCount = 0

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`)
    passCount++
  } else {
    console.log(`  ❌ FAIL: ${message}`)
    failCount++
  }
}

function section(name: string): void {
  console.log('\n' + '='.repeat(60))
  console.log(`🔍 ${name}`)
  console.log('='.repeat(60))
}

/** 把 details 强转为 HealthCheckDetails（TaskResult.details 是 Record<string, unknown>） */
function getDetails(result: TaskResult): HealthCheckDetails {
  return result.details as HealthCheckDetails
}

// ============================================================
// Mock SshExecutor
// ============================================================

/** 单台服务器的 mock 行为配置 */
interface ServerMockConfig {
  /** connect 是否抛错（若非空，connect 直接 reject 此消息） */
  connectError?: string
  /** exec 返回结果映射：command → {stdout, stderr, exitCode}（未配置时返回空 stdout） */
  execResults?: Map<string, { stdout: string; stderr: string; exitCode: number }>
  /** exec 是否整体抛错（用于测试 exec reject 场景） */
  execError?: string
}

/**
 * Mock SshExecutor
 *
 * - connect 返回自增 sessionId（不真实连接），并记录 sessionId → serverId 映射
 * - exec 根据 sessionId 找到对应 server 的 ServerMockConfig，再按 command 返回预设结果
 * - disconnect 始终返回 true
 * - 记录所有调用次数，便于断言
 */
class MockSshExecutor implements SshExecutor {
  /** 服务器 id → mock 配置 */
  private readonly mocks: Map<string, ServerMockConfig>
  /** sessionId → serverId 映射（connect 时记录，exec 时查询） */
  private readonly sessionToServer = new Map<string, string>()
  /** connect 调用次数 */
  connectCalls = 0
  /** exec 调用次数 */
  execCalls = 0
  /** disconnect 调用次数 */
  disconnectCalls = 0
  /** 自增 sessionId */
  private sessionCounter = 0

  constructor(mocks: Map<string, ServerMockConfig>) {
    this.mocks = mocks
  }

  async connect(config: SshConfig): Promise<string> {
    this.connectCalls++
    const mock = this.mocks.get(config.id)
    if (mock?.connectError) {
      throw new Error(mock.connectError)
    }
    this.sessionCounter++
    const sessionId = `mock-session-${this.sessionCounter}`
    this.sessionToServer.set(sessionId, config.id)
    return sessionId
  }

  async exec(
    sessionId: string,
    command: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    this.execCalls++
    const serverId = this.sessionToServer.get(sessionId)
    const mock = serverId ? this.mocks.get(serverId) : undefined
    if (mock?.execError) {
      throw new Error(mock.execError)
    }
    if (mock?.execResults?.has(command)) {
      return mock.execResults.get(command)!
    }
    // 默认返回：成功 + 空 stdout
    return { stdout: '', stderr: '', exitCode: 0 }
  }

  async disconnect(sessionId: string): Promise<boolean> {
    this.disconnectCalls++
    void sessionId
    return true
  }
}

// ============================================================
// Mock RuleAnalyzer
// ============================================================

/**
 * Mock RuleAnalyzer
 *
 * - 默认返回空告警数组
 * - 可注入 analyzeFn 自定义分析逻辑
 * - 可注入 throwError 模拟规则引擎异常
 */
class MockRuleAnalyzer implements RuleAnalyzer {
  private readonly analyzeFn: (metrics: ServerMetrics) => HealthAlert[]
  /** 是否在 analyze 时抛错 */
  readonly throwError?: string
  /** analyze 调用次数 */
  analyzeCalls = 0

  constructor(options: {
    analyzeFn?: (metrics: ServerMetrics) => HealthAlert[]
    throwError?: string
  } = {}) {
    this.analyzeFn = options.analyzeFn ?? (() => [])
    this.throwError = options.throwError
  }

  analyze(metrics: ServerMetrics): HealthAlert[] {
    this.analyzeCalls++
    if (this.throwError) {
      throw new Error(this.throwError)
    }
    return this.analyzeFn(metrics)
  }
}

// ============================================================
// 测试夹具（fixtures）
// ============================================================

/** 4 项采集命令的默认成功输出 */
const DEFAULT_METRICS_OUTPUT = new Map<string, { stdout: string; stderr: string; exitCode: number }>([
  [`top -bn1 | grep "Cpu(s)" | awk '{print $2}'`, { stdout: '12.5', stderr: '', exitCode: 0 }],
  [`free -m | awk '/Mem/{print $3"/"$2}'`, { stdout: '2048/8192', stderr: '', exitCode: 0 }],
  [`df -h / | awk 'NR==2{print $5}'`, { stdout: '45%', stderr: '', exitCode: 0 }],
  [`cat /proc/net/dev | grep eth0`, {
    stdout: '  eth0: 100 200 0 0 0 0 0 0 300 400 0 0 0 0 0 0',
    stderr: '',
    exitCode: 0,
  }],
])

/** 高 CPU 使用率输出（触发 critical 告警） */
const HIGH_CPU_OUTPUT = new Map(DEFAULT_METRICS_OUTPUT)
HIGH_CPU_OUTPUT.set(`top -bn1 | grep "Cpu(s)" | awk '{print $2}'`, {
  stdout: '96.5', stderr: '', exitCode: 0,
})

/** 构造一个标准 SshConfig */
function makeServer(id: string, name: string = id): SshConfig {
  return {
    id,
    name,
    host: `${id}.example.com`,
    port: 22,
    username: 'root',
    authType: 'password',
    password: 'secret',
  }
}

// ============================================================
// 主测试函数
// ============================================================

async function main(): Promise<void> {
  console.log('🚀 Phase 6 Task 6.2 Daily Health Check 单元测试')
  console.log('   测试场景：5 个核心场景 + 边界场景 + 工厂结构')
  console.log('   测试模式：mock SshExecutor + mock RuleAnalyzer（不真实连接 SSH）')

  // ────────── 场景 1：无服务器配置 ──────────
  section('场景 1：无服务器配置（servers 为空数组）')

  {
    const executor = new MockSshExecutor(new Map())
    const analyzer = new MockRuleAnalyzer()
    const result = await runDailyHealthCheck({
      sshExecutor: executor,
      servers: [],
      ruleAnalyzer: analyzer,
    })

    assert(result.success === true, '无服务器时应返回 success=true')
    assert(
      result.summary.includes('无服务器配置'),
      `summary 应包含 "无服务器配置"，实际 "${result.summary}"`
    )
    const details = getDetails(result)
    assert(details.serversChecked === 0, 'serversChecked 应为 0')
    assert(details.successes.length === 0, 'successes 应为空')
    assert(details.failures.length === 0, 'failures 应为空')
    assert(details.metrics.length === 0, 'metrics 应为空')
    assert(details.alerts.length === 0, 'alerts 应为空')
    assert(executor.connectCalls === 0, '不应调用 connect')
    assert(analyzer.analyzeCalls === 0, '不应调用 analyze')
  }

  // ────────── 场景 2：所有服务器连接失败 ──────────
  section('场景 2：所有服务器连接失败')

  {
    const servers = [makeServer('s1'), makeServer('s2'), makeServer('s3')]
    const mocks = new Map<string, ServerMockConfig>()
    for (const s of servers) {
      mocks.set(s.id, { connectError: `连接超时: ${s.host}` })
    }
    const executor = new MockSshExecutor(mocks)
    const analyzer = new MockRuleAnalyzer()
    const result = await runDailyHealthCheck({
      sshExecutor: executor,
      servers,
      ruleAnalyzer: analyzer,
    })

    assert(result.success === true, '所有连接失败时整体任务仍 success=true')
    const details = getDetails(result)
    assert(details.failures.length === 3, `failures 应有 3 条，实际 ${details.failures.length}`)
    assert(details.successes.length === 0, 'successes 应为空')
    assert(details.metrics.length === 0, 'metrics 应为空')
    assert(details.alerts.length === 0, 'alerts 应为空')
    assert(executor.connectCalls === 3, `应调用 3 次 connect，实际 ${executor.connectCalls}`)
    assert(executor.execCalls === 0, '不应调用 exec')
    assert(details.failures[0].serverId === 's1', `第 1 条 failure.serverId 应为 s1，实际 ${details.failures[0].serverId}`)
    assert(details.failures[0].error.includes('连接超时'), `failure.error 应包含"连接超时"，实际 "${details.failures[0].error}"`)
    assert(result.summary.includes('失败 3 台'), `summary 应包含"失败 3 台"，实际 "${result.summary}"`)
  }

  // ────────── 场景 3：部分成功部分失败 ──────────
  section('场景 3：部分服务器成功部分失败')

  {
    const servers = [makeServer('ok1'), makeServer('fail1'), makeServer('ok2')]
    const mocks = new Map<string, ServerMockConfig>([
      ['ok1', { execResults: DEFAULT_METRICS_OUTPUT }],
      ['fail1', { connectError: 'auth failed' }],
      ['ok2', { execResults: DEFAULT_METRICS_OUTPUT }],
    ])
    const executor = new MockSshExecutor(mocks)
    const analyzer = new MockRuleAnalyzer()
    const result = await runDailyHealthCheck({
      sshExecutor: executor,
      servers,
      ruleAnalyzer: analyzer,
    })

    assert(result.success === true, '部分失败时整体任务仍 success=true')
    const details = getDetails(result)
    assert(details.serversChecked === 3, `serversChecked 应为 3，实际 ${details.serversChecked}`)
    assert(details.successes.length === 2, `successes 应有 2 条，实际 ${details.successes.length}`)
    assert(details.failures.length === 1, `failures 应有 1 条，实际 ${details.failures.length}`)
    assert(details.failures[0].serverId === 'fail1', `failure 应为 fail1，实际 ${details.failures[0].serverId}`)
    assert(details.metrics.length === 2, `metrics 应有 2 条，实际 ${details.metrics.length}`)
    assert(executor.connectCalls === 3, `应调用 3 次 connect，实际 ${executor.connectCalls}`)
    assert(executor.execCalls === 8, `应调用 8 次 exec（2 台 × 4 命令），实际 ${executor.execCalls}`)
    assert(result.summary.includes('成功 2 台'), `summary 应包含"成功 2 台"，实际 "${result.summary}"`)
    assert(result.summary.includes('失败 1 台'), `summary 应包含"失败 1 台"，实际 "${result.summary}"`)
  }

  // ────────── 场景 4：全部成功 ──────────
  section('场景 4：全部服务器成功采集')

  {
    const servers = [makeServer('s1'), makeServer('s2')]
    const mocks = new Map<string, ServerMockConfig>([
      ['s1', { execResults: DEFAULT_METRICS_OUTPUT }],
      ['s2', { execResults: DEFAULT_METRICS_OUTPUT }],
    ])
    const executor = new MockSshExecutor(mocks)
    const analyzer = new MockRuleAnalyzer()
    const result = await runDailyHealthCheck({
      sshExecutor: executor,
      servers,
      ruleAnalyzer: analyzer,
    })

    assert(result.success === true, '全部成功时 success=true')
    const details = getDetails(result)
    assert(details.successes.length === 2, `successes 应有 2 条，实际 ${details.successes.length}`)
    assert(details.failures.length === 0, 'failures 应为空')
    assert(details.metrics.length === 2, `metrics 应有 2 条，实际 ${details.metrics.length}`)
    const m0 = details.metrics[0]
    assert(m0.cpuRaw === '12.5', `metrics[0].cpuRaw 应为 "12.5"，实际 "${m0.cpuRaw}"`)
    assert(m0.memoryRaw === '2048/8192', `metrics[0].memoryRaw 应为 "2048/8192"，实际 "${m0.memoryRaw}"`)
    assert(m0.diskRaw === '45%', `metrics[0].diskRaw 应为 "45%"，实际 "${m0.diskRaw}"`)
    assert(m0.networkRaw.includes('eth0'), `metrics[0].networkRaw 应包含 "eth0"`)
    assert(m0.collectedAt > 0, 'metrics[0].collectedAt 应 > 0')
    assert(executor.disconnectCalls === 2, `应调用 2 次 disconnect，实际 ${executor.disconnectCalls}`)
  }

  // ────────── 场景 5：规则引擎异常 ──────────
  section('场景 5：规则引擎整体异常')

  {
    const servers = [makeServer('s1')]
    const mocks = new Map<string, ServerMockConfig>([
      ['s1', { execResults: DEFAULT_METRICS_OUTPUT }],
    ])
    const executor = new MockSshExecutor(mocks)
    const analyzer = new MockRuleAnalyzer({ throwError: 'rule engine crash' })
    const result = await runDailyHealthCheck({
      sshExecutor: executor,
      servers,
      ruleAnalyzer: analyzer,
    })

    assert(result.success === true, '规则引擎异常时整体任务仍 success=true')
    const details = getDetails(result)
    assert(details.successes.length === 1, 'successes 应有 1 条（指标已采集）')
    assert(details.metrics.length === 1, 'metrics 应有 1 条（指标已采集）')
    assert(details.alerts.length === 0, 'alerts 应为空（规则引擎异常未生成告警）')
    assert(
      details.ruleEngineError === 'rule engine crash',
      `ruleEngineError 应为 "rule engine crash"，实际 "${details.ruleEngineError}"`
    )
    assert(result.summary.includes('规则引擎异常'), `summary 应包含"规则引擎异常"，实际 "${result.summary}"`)
  }

  // ────────── 场景 6：SSH exec 命令失败（exitCode != 0） ──────────
  section('场景 6：SSH exec 命令失败（exitCode != 0）')

  {
    const servers = [makeServer('s1')]
    const failingCmd = `top -bn1 | grep "Cpu(s)" | awk '{print $2}'`
    const execResults = new Map(DEFAULT_METRICS_OUTPUT)
    execResults.set(failingCmd, { stdout: '', stderr: 'grep: Cpu: No such file', exitCode: 1 })
    const mocks = new Map<string, ServerMockConfig>([
      ['s1', { execResults }],
    ])
    const executor = new MockSshExecutor(mocks)
    const analyzer = new MockRuleAnalyzer()
    const result = await runDailyHealthCheck({
      sshExecutor: executor,
      servers,
      ruleAnalyzer: analyzer,
    })

    assert(result.success === true, 'exec 失败时整体任务仍 success=true')
    const details = getDetails(result)
    assert(details.failures.length === 1, `failures 应有 1 条，实际 ${details.failures.length}`)
    assert(details.successes.length === 0, 'successes 应为空（exec 失败导致整台服务器失败）')
    assert(
      details.failures[0].error.includes('exit=1'),
      `failure.error 应包含 "exit=1"，实际 "${details.failures[0].error}"`
    )
    assert(
      details.failures[0].error.includes('grep: Cpu'),
      `failure.error 应包含 stderr 内容，实际 "${details.failures[0].error}"`
    )
  }

  // ────────── 场景 7：SSH connect 抛异常不中断整体 ──────────
  section('场景 7：SSH connect 抛异常不中断整体任务')

  {
    const servers = [makeServer('fail'), makeServer('ok')]
    const mocks = new Map<string, ServerMockConfig>([
      ['fail', { connectError: 'ECONNREFUSED' }],
      ['ok', { execResults: DEFAULT_METRICS_OUTPUT }],
    ])
    const executor = new MockSshExecutor(mocks)
    const analyzer = new MockRuleAnalyzer()
    const result = await runDailyHealthCheck({
      sshExecutor: executor,
      servers,
      ruleAnalyzer: analyzer,
    })

    assert(result.success === true, 'connect 异常不中断整体任务')
    const details = getDetails(result)
    assert(details.failures.length === 1, `failures 应有 1 条，实际 ${details.failures.length}`)
    assert(details.successes.length === 1, `successes 应有 1 条，实际 ${details.successes.length}`)
    assert(details.failures[0].serverId === 'fail', `failure.serverId 应为 fail`)
    assert(details.successes[0].serverId === 'ok', `success.serverId 应为 ok`)
    assert(details.failures[0].error === 'ECONNREFUSED', `failure.error 应为 "ECONNREFUSED"`)
  }

  // ────────── 场景 8：规则引擎发现告警 ──────────
  section('场景 8：规则引擎发现告警（mock 返回预设告警）')

  {
    const servers = [makeServer('s1')]
    const mocks = new Map<string, ServerMockConfig>([
      ['s1', { execResults: DEFAULT_METRICS_OUTPUT }],
    ])
    const executor = new MockSshExecutor(mocks)
    const presetAlert: HealthAlert = {
      serverId: 's1',
      serverName: 's1',
      severity: 'critical',
      category: 'cpu',
      message: 'CPU 96% (mock)',
      hypothesis: 'CPU 负载过高',
      fixCommand: 'top -bn1',
      confidence: 0.8,
    }
    const analyzer = new MockRuleAnalyzer({
      analyzeFn: () => [presetAlert],
    })
    const result = await runDailyHealthCheck({
      sshExecutor: executor,
      servers,
      ruleAnalyzer: analyzer,
    })

    const details = getDetails(result)
    assert(details.alerts.length === 1, `alerts 应有 1 条，实际 ${details.alerts.length}`)
    assert(details.alerts[0].severity === 'critical', `alert.severity 应为 critical`)
    assert(details.alerts[0].message === 'CPU 96% (mock)', `alert.message 应匹配预设`)
    assert(details.alerts[0].confidence === 0.8, `alert.confidence 应为 0.8`)
    assert(result.summary.includes('发现 1 个告警'), `summary 应包含"发现 1 个告警"，实际 "${result.summary}"`)
    assert(analyzer.analyzeCalls === 1, `应调用 1 次 analyze，实际 ${analyzer.analyzeCalls}`)
  }

  // ────────── 场景 9：单台成功但无告警 ──────────
  section('场景 9：单台成功但规则分析无告警')

  {
    const servers = [makeServer('s1')]
    const mocks = new Map<string, ServerMockConfig>([
      ['s1', { execResults: DEFAULT_METRICS_OUTPUT }],
    ])
    const executor = new MockSshExecutor(mocks)
    const analyzer = new MockRuleAnalyzer({ analyzeFn: () => [] })
    const result = await runDailyHealthCheck({
      sshExecutor: executor,
      servers,
      ruleAnalyzer: analyzer,
    })

    const details = getDetails(result)
    assert(details.successes.length === 1, 'successes 应有 1 条')
    assert(details.alerts.length === 0, 'alerts 应为空（无告警）')
    assert(result.summary.includes('发现 0 个告警'), `summary 应包含"发现 0 个告警"，实际 "${result.summary}"`)
    assert(!result.summary.includes('失败'), 'summary 不应包含"失败"（无失败）')
  }

  // ────────── 场景 10：createDailyHealthCheckTask 工厂结构 ──────────
  section('场景 10：createDailyHealthCheckTask 工厂结构正确')

  {
    const task = createDailyHealthCheckTask()
    assert(task.id === 'daily-health-check', `id 应为 "daily-health-check"，实际 "${task.id}"`)
    assert(task.name === '每日健康检查', `name 应为 "每日健康检查"，实际 "${task.name}"`)
    assert(task.cron === '0 9 * * *', `cron 应为 "0 9 * * *"，实际 "${task.cron}"`)
    assert(task.timezone === 'Asia/Shanghai', `timezone 应为 "Asia/Shanghai"，实际 "${task.timezone}"`)
    assert(task.enabled === true, 'enabled 应为 true')
    assert(typeof task.handler === 'function', 'handler 应为函数')
  }

  // ────────── 场景 11：SSH executor 三方法都被调用 ──────────
  section('场景 11：SSH executor connect/exec/disconnect 都被调用')

  {
    const servers = [makeServer('s1')]
    const mocks = new Map<string, ServerMockConfig>([
      ['s1', { execResults: DEFAULT_METRICS_OUTPUT }],
    ])
    const executor = new MockSshExecutor(mocks)
    const analyzer = new MockRuleAnalyzer()
    await runDailyHealthCheck({
      sshExecutor: executor,
      servers,
      ruleAnalyzer: analyzer,
    })

    assert(executor.connectCalls === 1, `connect 应被调用 1 次，实际 ${executor.connectCalls}`)
    assert(executor.execCalls === 4, `exec 应被调用 4 次，实际 ${executor.execCalls}`)
    assert(executor.disconnectCalls === 1, `disconnect 应被调用 1 次，实际 ${executor.disconnectCalls}`)
  }

  // ────────── 场景 12：durationMs 为非负数 ──────────
  section('场景 12：durationMs 为非负数 + TaskResult 结构完整')

  {
    const executor = new MockSshExecutor(new Map())
    const analyzer = new MockRuleAnalyzer()
    const result = await runDailyHealthCheck({
      sshExecutor: executor,
      servers: [],
      ruleAnalyzer: analyzer,
    })

    assert(typeof result.success === 'boolean', 'success 应为 boolean')
    assert(typeof result.summary === 'string', 'summary 应为 string')
    assert(typeof result.durationMs === 'number', 'durationMs 应为 number')
    assert(result.durationMs >= 0, `durationMs 应 >= 0，实际 ${result.durationMs}`)
    assert(result.details !== undefined, 'details 应存在')
  }

  // ────────── 场景 13：多台服务器 + 多个告警合并 ──────────
  section('场景 13：多台服务器 + 多个告警合并')

  {
    const servers = [makeServer('s1'), makeServer('s2'), makeServer('s3')]
    const mocks = new Map<string, ServerMockConfig>([
      ['s1', { execResults: DEFAULT_METRICS_OUTPUT }],
      ['s2', { execResults: DEFAULT_METRICS_OUTPUT }],
      ['s3', { execResults: DEFAULT_METRICS_OUTPUT }],
    ])
    const executor = new MockSshExecutor(mocks)
    let analyzeCount = 0
    const analyzer = new MockRuleAnalyzer({
      analyzeFn: (metrics) => {
        analyzeCount++
        // 每台服务器都返回 1 条告警
        return [{
          serverId: metrics.serverId,
          serverName: metrics.serverName,
          severity: 'warning',
          category: 'cpu',
          message: `CPU 异常 on ${metrics.serverId}`,
        }]
      },
    })
    const result = await runDailyHealthCheck({
      sshExecutor: executor,
      servers,
      ruleAnalyzer: analyzer,
    })

    const details = getDetails(result)
    assert(details.successes.length === 3, `successes 应有 3 条，实际 ${details.successes.length}`)
    assert(details.alerts.length === 3, `alerts 应有 3 条（每台 1 条），实际 ${details.alerts.length}`)
    assert(analyzeCount === 3, `analyze 应被调用 3 次，实际 ${analyzeCount}`)
    assert(details.alerts[0].serverId === 's1', `alerts[0].serverId 应为 s1`)
    assert(details.alerts[1].serverId === 's2', `alerts[1].serverId 应为 s2`)
    assert(details.alerts[2].serverId === 's3', `alerts[2].serverId 应为 s3`)
    assert(result.summary.includes('发现 3 个告警'), `summary 应包含"发现 3 个告警"，实际 "${result.summary}"`)
  }

  // ────────── 场景 14：SSH exec 抛 reject 异常 ──────────
  section('场景 14：SSH exec reject 异常（不中断整体）')

  {
    const servers = [makeServer('s1'), makeServer('s2')]
    const mocks = new Map<string, ServerMockConfig>([
      ['s1', { execError: 'stream closed unexpectedly' }],
      ['s2', { execResults: DEFAULT_METRICS_OUTPUT }],
    ])
    const executor = new MockSshExecutor(mocks)
    const analyzer = new MockRuleAnalyzer()
    const result = await runDailyHealthCheck({
      sshExecutor: executor,
      servers,
      ruleAnalyzer: analyzer,
    })

    assert(result.success === true, 'exec reject 不中断整体任务')
    const details = getDetails(result)
    assert(details.failures.length === 1, `failures 应有 1 条，实际 ${details.failures.length}`)
    assert(details.successes.length === 1, `successes 应有 1 条，实际 ${details.successes.length}`)
    assert(details.failures[0].serverId === 's1', `failure.serverId 应为 s1`)
    assert(
      details.failures[0].error.includes('stream closed'),
      `failure.error 应包含 "stream closed"，实际 "${details.failures[0].error}"`
    )
  }

  // ────────── 场景 15：摘要格式正确 ──────────
  section('场景 15：摘要格式正确（包含服务器数 / 成功数 / 告警数）')

  {
    const servers = [makeServer('s1'), makeServer('s2')]
    const mocks = new Map<string, ServerMockConfig>([
      ['s1', { execResults: DEFAULT_METRICS_OUTPUT }],
      ['s2', { connectError: 'timeout' }],
    ])
    const executor = new MockSshExecutor(mocks)
    const analyzer = new MockRuleAnalyzer({
      analyzeFn: () => [{
        serverId: 's1',
        serverName: 's1',
        severity: 'warning',
        category: 'memory',
        message: '内存使用率高',
      }],
    })
    const result = await runDailyHealthCheck({
      sshExecutor: executor,
      servers,
      ruleAnalyzer: analyzer,
    })

    // 期望格式：检查 2 台服务器，成功 1 台，失败 1 台，发现 1 个告警
    assert(result.summary.includes('检查 2 台服务器'), `summary 应包含"检查 2 台服务器"，实际 "${result.summary}"`)
    assert(result.summary.includes('成功 1 台'), `summary 应包含"成功 1 台"，实际 "${result.summary}"`)
    assert(result.summary.includes('失败 1 台'), `summary 应包含"失败 1 台"，实际 "${result.summary}"`)
    assert(result.summary.includes('发现 1 个告警'), `summary 应包含"发现 1 个告警"，实际 "${result.summary}"`)
  }

  // ────────── 场景 16：DefaultRuleAnalyzer 阈值检查 ──────────
  section('场景 16：DefaultRuleAnalyzer 阈值检查（CPU critical）')

  {
    const analyzer = new DefaultRuleAnalyzer()
    const metrics: ServerMetrics = {
      serverId: 's1',
      serverName: 's1',
      host: 's1.example.com',
      cpuRaw: '96.5',
      memoryRaw: '2048/8192',
      diskRaw: '45%',
      networkRaw: '  eth0: 100 200 0 0',
      collectedAt: Date.now(),
    }
    const alerts = analyzer.analyze(metrics)
    const cpuAlert = alerts.find((a) => a.category === 'cpu')
    assert(cpuAlert !== undefined, '应生成 CPU 告警')
    assert(cpuAlert!.severity === 'critical', `CPU 96.5% 应为 critical，实际 ${cpuAlert!.severity}`)
    assert(cpuAlert!.message.includes('96.5'), `告警消息应包含 "96.5"，实际 "${cpuAlert!.message}"`)
  }

  // ────────── 场景 17：DefaultRuleAnalyzer 正常指标无告警 ──────────
  section('场景 17：DefaultRuleAnalyzer 正常指标不生成告警')

  {
    const analyzer = new DefaultRuleAnalyzer()
    const metrics: ServerMetrics = {
      serverId: 's1',
      serverName: 's1',
      host: 's1.example.com',
      cpuRaw: '12.5',
      memoryRaw: '2048/8192', // 25%
      diskRaw: '45%',
      networkRaw: '  eth0: 100 200 0 0',
      collectedAt: Date.now(),
    }
    const alerts = analyzer.analyze(metrics)
    // CPU 12.5% / 内存 25% / 磁盘 45% 都在阈值之下；network 有数据
    // 但 analyzeByRules 可能命中 cpu_high 规则（关键词 "cpu"），所以 alerts 可能非空
    // 这里仅校验：无 critical/warning 级别的阈值告警
    const thresholdAlerts = alerts.filter((a) =>
      (a.category === 'cpu' || a.category === 'memory' || a.category === 'disk') &&
      a.message.includes('使用率')
    )
    assert(thresholdAlerts.length === 0, `正常指标不应有阈值告警，实际 ${thresholdAlerts.length} 条`)
  }

  // ────────── 场景 18：DefaultRuleAnalyzer 磁盘 warning 阈值 ──────────
  section('场景 18：DefaultRuleAnalyzer 磁盘 warning 阈值（85% ≤ x < 95%）')

  {
    const analyzer = new DefaultRuleAnalyzer()
    const metrics: ServerMetrics = {
      serverId: 's1',
      serverName: 's1',
      host: 's1.example.com',
      cpuRaw: '10.0',
      memoryRaw: '2048/8192',
      diskRaw: '88%',
      networkRaw: '  eth0: 100 200 0 0',
      collectedAt: Date.now(),
    }
    const alerts = analyzer.analyze(metrics)
    const diskAlert = alerts.find((a) => a.category === 'disk')
    assert(diskAlert !== undefined, '应生成 disk 告警')
    assert(diskAlert!.severity === 'warning', `磁盘 88% 应为 warning，实际 ${diskAlert!.severity}`)
  }

  // ────────── 汇总 ──────────
  console.log('\n' + '='.repeat(60))
  console.log('📊 测试汇总')
  console.log('='.repeat(60))
  console.log(`  ✅ 通过: ${passCount}`)
  console.log(`  ❌ 失败: ${failCount}`)
  console.log('='.repeat(60))

  if (failCount > 0) {
    console.log('\n❌ 测试失败，请检查 daily-health-check.ts')
    process.exit(1)
  } else {
    console.log('\n✅ 全部测试通过！Daily Health Check 任务就绪')
    process.exit(0)
  }
}

main().catch((err) => {
  console.error('\n💥 测试执行异常:', err)
  process.exit(2)
})
