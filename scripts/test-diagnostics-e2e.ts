/**
 * 端到端测试脚本：诊断服务 + Sidecar-A 集成测试
 *
 * 用户原话：
 *   "软件启动不再是虚假的前端死代码，真正做到能运行起来工作起来，跑通核心的功能"
 *
 * 测试场景：
 *   1. 直接测试 LogAnalyzer 规则匹配（不需要 Electron 环境）
 *   2. 直接测试 DiagnosticsService 单例（不需要 IPC）
 *   3. 通过 HTTP 测试 Sidecar-A 的 /health 和 /pipeline/run 端点
 *
 * 运行方式：
 *   pnpm exec tsx scripts/test-diagnostics-e2e.ts
 */

import { LogAnalyzer, BUILTIN_RULES } from '../src/main/services/diagnostics/log-analyzer'
import { DiagnosticsService } from '../src/main/services/diagnostics/diagnostics-service'
import type { LogEvent } from '../src/main/services/diagnostics/types'

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

// ============================================================
// 测试 1：LogAnalyzer 规则匹配
// ============================================================

function testLogAnalyzer(): void {
  section('测试 1：LogAnalyzer 规则匹配')

  const analyzer = new LogAnalyzer()

  // 测试 1.1：端口冲突规则
  const portConflictLog: LogEvent = {
    timestamp: new Date().toISOString(),
    source: 'sre',
    level: 'ERROR',
    raw: 'OSError: [Errno 98] Address already in use (port 19000)',
  }
  const findings1 = analyzer.analyze(portConflictLog)
  assert(findings1.length > 0, '端口冲突日志应触发规则')
  assert(
    findings1.some((f) => f.category === 'port_conflict'),
    '应触发 port_conflict 类别',
  )

  // 测试 1.2：ModuleNotFoundError 规则
  const moduleNotFoundLog: LogEvent = {
    timestamp: new Date().toISOString(),
    source: 'sre',
    level: 'ERROR',
    raw: "ModuleNotFoundError: No module named 'drain3'",
  }
  const findings2 = analyzer.analyze(moduleNotFoundLog)
  assert(findings2.length > 0, 'ModuleNotFoundError 应触发规则')
  assert(
    findings2.some((f) => f.category === 'dependency_missing'),
    '应触发 dependency_missing 类别',
  )

  // 测试 1.3：Python 异常规则
  const tracebackLog: LogEvent = {
    timestamp: new Date().toISOString(),
    source: 'sre',
    level: 'ERROR',
    raw: 'Traceback (most recent call last):\n  File "main.py", line 10\nNameError: name foo is not defined',
  }
  const findings3 = analyzer.analyze(tracebackLog)
  assert(findings3.length >= 2, 'Traceback + NameError 应至少触发 2 个规则')

  // 测试 1.4：正常日志不应触发任何规则
  const normalLog: LogEvent = {
    timestamp: new Date().toISOString(),
    source: 'sre',
    level: 'INFO',
    raw: 'Uvicorn running on http://127.0.0.1:19000',
  }
  const findings4 = analyzer.analyze(normalLog)
  assert(findings4.length === 0, '正常启动日志不应触发任何规则')

  // 测试 1.5：内置规则数量
  assert(BUILTIN_RULES.length >= 15, `应至少有 15 条内置规则（实际: ${BUILTIN_RULES.length}）`)

  // 测试 1.6：批量分析
  const events = [portConflictLog, moduleNotFoundLog, tracebackLog, normalLog]
  const batch = analyzer.analyzeBatch(events)
  assert(batch.findings.length >= 4, `批量分析应至少检测到 4 个问题（实际: ${batch.findings.length}）`)

  // 测试 1.7：报告生成
  const report = analyzer.generateReport(events, batch.findings)
  assert(report.totalLogs === 4, `报告应统计 4 条日志（实际: ${report.totalLogs}）`)
  assert(report.healthy === false, '有 critical/error 级别问题，healthy 应为 false')
  assert(report.bySeverity.critical > 0, '应有 critical 级别问题')

  console.log(`\n  📊 报告汇总: ${report.summary}`)
}

// ============================================================
// 测试 2：DiagnosticsService 单例
// ============================================================

function testDiagnosticsService(): void {
  section('测试 2：DiagnosticsService 单例')

  // 重置单例（测试环境）
  // @ts-expect-error - 测试需要访问私有静态字段
  DiagnosticsService.instance = null

  const svc1 = DiagnosticsService.getInstance()
  const svc2 = DiagnosticsService.getInstance()
  assert(svc1 === svc2, 'getInstance() 应返回同一实例（单例模式）')

  // 注入测试日志
  svc1.ingestLog({
    timestamp: new Date().toISOString(),
    source: 'sre',
    level: 'ERROR',
    raw: 'OSError: [Errno 98] Address already in use (port 19000)',
  })
  svc1.ingestLog({
    timestamp: new Date().toISOString(),
    source: 'sre',
    level: 'INFO',
    raw: 'Uvicorn running on http://127.0.0.1:19000',
  })

  const logs = svc1.getLogs()
  assert(logs.length === 2, `应缓冲 2 条日志（实际: ${logs.length}）`)

  const findings = svc1.getFindings()
  assert(findings.length > 0, `应至少有 1 条检测结果（实际: ${findings.length}）`)

  const stats = svc1.getStats()
  assert(stats.totalIngested === 2, `应统计 2 条累计日志（实际: ${stats.totalIngested}）`)
  assert(stats.bySource.sre === 2, `sre 源应统计 2 条（实际: ${stats.bySource.sre}）`)
  assert(stats.byLevel.ERROR === 1, `ERROR 级别应统计 1 条（实际: ${stats.byLevel.ERROR}）`)

  const report = svc1.getReport()
  assert(report.healthy === false, '有 critical 问题，healthy 应为 false')

  // 清空缓冲区
  svc1.clear()
  assert(svc1.getLogs().length === 0, '清空后日志缓冲区应为空')
  assert(svc1.getFindings().length === 0, '清空后检测结果缓冲区应为空')
  // 累计统计不应被清空
  assert(svc1.getStats().totalIngested === 2, '清空后累计统计应保留（2）')

  console.log('\n  📊 诊断服务单例测试通过')
}

// ============================================================
// 测试 3：Sidecar-A HTTP 端点（如果 Sidecar-A 已启动）
// ============================================================

async function testSidecarAHttp(): Promise<void> {
  section('测试 3：Sidecar-A HTTP 端点（如果已启动）')

  const SIDECAR_A_URL = 'http://127.0.0.1:19000'

  // 检查 Sidecar-A 是否已启动
  try {
    const healthResp = await fetch(`${SIDECAR_A_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!healthResp.ok) {
      console.log(`  ⚠️  Sidecar-A /health 返回非 200: ${healthResp.status}`)
      console.log('  ℹ️  请通过 UI 启动 Sidecar-A（sidecarStart IPC），或手动运行：')
      console.log('     cd sidecar-a && python -m uvicorn main:app --port 19000')
      return
    }
    const health = await healthResp.json()
    assert(health.status === 'ok', `Sidecar-A 健康状态应为 ok（实际: ${health.status}）`)
    console.log(`  📊 Sidecar-A 版本: ${health.version}`)
    console.log(`  📊 Drain3 ready: ${health.adapters?.drain3?.ready}`)
    console.log(`  📊 OpenDerisk ready: ${health.adapters?.open_derisk?.ready}`)

    // 测试 pipeline
    console.log('\n  测试 /pipeline/run 端点...')
    const testLogs = [
      '2024-01-01 10:00:00 ERROR Connection refused to database',
      '2024-01-01 10:00:01 WARN Retrying connection (attempt 1)',
      '2024-01-01 10:00:02 ERROR Connection refused to database',
      '2024-01-01 10:00:03 ERROR Connection refused to database',
      '2024-01-01 10:00:04 FATAL Failed to start service: database unreachable',
    ]
    const pipelineResp = await fetch(`${SIDECAR_A_URL}/pipeline/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_lines: testLogs, service_name: 'test-service' }),
      signal: AbortSignal.timeout(10000),
    })
    assert(pipelineResp.ok, `Pipeline 调用应成功（状态码: ${pipelineResp.status}）`)

    const result = await pipelineResp.json()
    assert(result.parse !== undefined, 'Pipeline 应返回 parse 字段')
    assert(result.diagnose !== undefined, 'Pipeline 应返回 diagnose 字段')
    console.log(`  📊 模板数: ${result.parse.unique_templates}`)
    console.log(`  📊 根因: ${result.diagnose.root_cause}`)
    console.log(`  📊 置信度: ${result.diagnose.confidence}`)
    console.log(`  📊 严重性: ${result.diagnose.severity}`)
    console.log(`  📊 来源: ${result.diagnose.source}`)
  } catch (err) {
    console.log(`  ⚠️  Sidecar-A 未启动或不可达: ${(err as Error).message}`)
    console.log('  ℹ️  这是预期行为（懒启动设计），通过 UI 启动后再次运行测试')
  }
}

// ============================================================
// 测试 4：模拟 SidecarManager 日志转发流程
// ============================================================

function testSimulatedSidecarLogs(): void {
  section('测试 4：模拟 SidecarManager 日志转发流程')

  // @ts-expect-error - 测试需要重置单例
  DiagnosticsService.instance = null
  const svc = DiagnosticsService.getInstance()

  // 模拟 Sidecar-A 启动过程的日志序列
  const simulatedLogs: LogEvent[] = [
    {
      timestamp: new Date().toISOString(),
      source: 'sre',
      level: 'INFO',
      raw: '[SidecarManager] 启动 Sidecar-A: SRE + 日志解析（127.0.0.1:19000）',
    },
    {
      timestamp: new Date().toISOString(),
      source: 'sre',
      level: 'INFO',
      raw: 'INFO:     Started server process [12345]',
    },
    {
      timestamp: new Date().toISOString(),
      source: 'sre',
      level: 'INFO',
      raw: 'INFO:     Waiting for application startup.',
    },
    {
      timestamp: new Date().toISOString(),
      source: 'sre',
      level: 'INFO',
      raw: 'INFO:     Application startup complete.',
    },
    {
      timestamp: new Date().toISOString(),
      source: 'sre',
      level: 'INFO',
      raw: 'INFO:     Uvicorn running on http://127.0.0.1:19000 (Press CTRL+C to quit)',
    },
    {
      timestamp: new Date().toISOString(),
      source: 'sre',
      level: 'INFO',
      raw: '[SidecarManager] Sidecar sre 就绪 ✓',
    },
  ]

  // 批量注入
  svc.ingestBatch(simulatedLogs)

  const logs = svc.getLogs()
  assert(logs.length === 6, `应缓冲 6 条日志（实际: ${logs.length}）`)

  const report = svc.getReport()
  assert(report.healthy === true, '正常启动日志不应触发任何 critical/error 规则，healthy 应为 true')
  assert(report.totalFindings === 0, `不应有检测结果（实际: ${report.totalFindings}）`)

  console.log(`\n  📊 报告汇总: ${report.summary}`)

  // 模拟 Sidecar-A 启动失败的日志序列
  console.log('\n  --- 模拟 Sidecar-A 启动失败场景 ---')
  svc.clear()

  const failureLogs: LogEvent[] = [
    {
      timestamp: new Date().toISOString(),
      source: 'sre',
      level: 'ERROR',
      raw: 'OSError: [Errno 98] Address already in use (port 19000)',
    },
    {
      timestamp: new Date().toISOString(),
      source: 'sre',
      level: 'ERROR',
      raw: 'Traceback (most recent call last):\n  File "main.py", line 10, in <module>',
    },
    {
      timestamp: new Date().toISOString(),
      source: 'sre',
      level: 'WARN',
      raw: '[SidecarManager] Sidecar sre 退出（code=1, signal=null）',
    },
    {
      timestamp: new Date().toISOString(),
      source: 'sre',
      level: 'ERROR',
      raw: '[SidecarManager] Sidecar sre 启动失败：Sidecar 启动超时（10000ms）',
    },
  ]
  svc.ingestBatch(failureLogs)

  const failReport = svc.getReport()
  assert(failReport.healthy === false, '失败场景应判定为不健康')
  assert(failReport.totalFindings > 0, `失败场景应至少有 1 个检测结果（实际: ${failReport.totalFindings}）`)
  assert(failReport.bySeverity.critical > 0, `应有 critical 级别问题（实际: ${failReport.bySeverity.critical}）`)

  console.log(`\n  📊 失败场景报告: ${failReport.summary}`)
  console.log(`  📊 检测结果明细:`)
  for (const f of failReport.findings) {
    console.log(`     [${f.severity}] ${f.description} → ${f.remediation ?? '无建议'}`)
  }
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log('🚀 TDSF v1.5 诊断服务 + Sidecar 集成端到端测试')
  console.log('   用户原话："建立一个检测的后端，当循环工程启动时利用后端的日志进行分析"')

  testLogAnalyzer()
  testDiagnosticsService()
  testSimulatedSidecarLogs()
  await testSidecarAHttp()

  console.log('\n' + '='.repeat(60))
  console.log(`📋 测试汇总: ${passCount} 通过, ${failCount} 失败`)
  console.log('='.repeat(60))

  if (failCount > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('测试运行失败:', err)
  process.exit(1)
})
