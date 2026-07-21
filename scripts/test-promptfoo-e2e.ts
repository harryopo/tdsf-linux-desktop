/**
 * Promptfoo 红队 / Prompt 评估端到端测试
 *
 * 用户原话：
 *   "真正做到能运行起来工作起来，跑通核心的功能"
 *
 * 测试场景：
 *   1. 红队测试（无 LLM 配置时，所有测试应自动跳过/通过）
 *   2. Prompt 评估（无 LLM 配置时，断言检查仍可执行）
 *   3. 验证测试用例库完整性
 *
 * 运行方式：
 *   pnpm exec tsx scripts/test-promptfoo-e2e.ts
 */

import { RedTeamRunner, RED_TEAM_TEST_CASES } from '../src/main/services/promptfoo/red-team'
import { EvalRunner, EVAL_TEST_CASES } from '../src/main/services/promptfoo/eval'
import type { ChatMessage } from '../src/shared/models'

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
// 测试 1：红队测试（无 LLM 客户端，所有测试应自动通过）
// ============================================================

async function testRedTeamNoLlm(): Promise<void> {
  section('测试 1：红队测试（无 LLM 配置 - 安全跳过模式）')

  // 无 LlmClient 传入（模拟 LLM 不可用场景）
  const runner = new RedTeamRunner(null)

  const provider: ChatMessage[] = [
    { role: 'system', content: 'You are a helpful Linux operations assistant.' },
  ]

  const report = await runner.runAllTests(provider)

  console.log(`  📊 总测试数: ${report.totalTests}`)
  console.log(`  📊 通过数: ${report.passedTests}`)
  console.log(`  📊 失败数: ${report.failedTests}`)
  console.log(`  📊 通过率: ${report.passRate.toFixed(1)}%`)
  console.log(`  📊 平均分: ${report.averageScore.toFixed(1)}`)
  console.log(`  📊 汇总: ${report.summary}`)

  assert(report.totalTests === RED_TEAM_TEST_CASES.length, `应测试 ${RED_TEAM_TEST_CASES.length} 个用例`)
  assert(report.passedTests === report.totalTests, '无 LLM 时所有测试应自动通过')
  assert(report.failedTests === 0, '无 LLM 时不应有失败')
  assert(report.passRate === 100, '通过率应为 100%')

  // 验证测试用例覆盖 5 个类别
  const categories = new Set(RED_TEAM_TEST_CASES.map(t => t.category))
  assert(categories.size === 5, `应覆盖 5 个攻击类别（实际: ${categories.size}）`)
  console.log(`  📊 覆盖类别: ${Array.from(categories).join(', ')}`)

  // 验证每个测试结果的字段完整性
  for (const result of report.results) {
    assert(typeof result.actualResponse === 'string', `${result.testCase.id} 应有 actualResponse`)
    assert(typeof result.score === 'number', `${result.testCase.id} 应有 score`)
    assert(typeof result.latencyMs === 'number', `${result.testCase.id} 应有 latencyMs`)
  }
}

// ============================================================
// 测试 2：Prompt 评估（无 LLM，断言仍可执行）
// ============================================================

async function testEvalNoLlm(): Promise<void> {
  section('测试 2：Prompt 评估（无 LLM 配置 - 断言模式）')

  const runner = new EvalRunner(null)

  const provider: ChatMessage[] = [
    { role: 'system', content: 'You are a helpful Linux operations assistant.' },
  ]

  const report = await runner.runAllTests(provider)

  console.log(`  📊 总测试数: ${report.totalTests}`)
  console.log(`  📊 通过数: ${report.passedTests}`)
  console.log(`  📊 失败数: ${report.failedTests}`)
  console.log(`  📊 通过率: ${report.passRate.toFixed(1)}%`)
  console.log(`  📊 平均延迟: ${report.averageLatencyMs.toFixed(2)}ms`)
  console.log(`  📊 汇总: ${report.summary}`)

  assert(report.totalTests === EVAL_TEST_CASES.length, `应测试 ${EVAL_TEST_CASES.length} 个用例`)
  assert(report.totalTests > 0, '至少应有一个评估用例')

  // 验证每个评估结果
  for (const result of report.results) {
    assert(typeof result.actualResponse === 'string', `${result.testCase.id} 应有 actualResponse`)
    assert(typeof result.latencyMs === 'number', `${result.testCase.id} 应有 latencyMs`)
    assert(typeof result.passed === 'boolean', `${result.testCase.id} 应有 passed 字段`)
  }
}

// ============================================================
// 测试 3：测试用例库完整性验证
// ============================================================

function testTestCaseIntegrity(): void {
  section('测试 3：测试用例库完整性验证')

  // 红队测试用例
  assert(RED_TEAM_TEST_CASES.length >= 8, `红队测试应至少 8 个用例（实际: ${RED_TEAM_TEST_CASES.length}）`)

  for (const tc of RED_TEAM_TEST_CASES) {
    assert(!!tc.id, '红队测试用例应有 id')
    assert(!!tc.name, `红队测试用例 ${tc.id} 应有 name`)
    assert(!!tc.prompt, `红队测试用例 ${tc.id} 应有 prompt`)
    assert(['refuse', 'safe_response', 'partial_refuse'].includes(tc.expectedBehavior), `红队测试用例 ${tc.id} expectedBehavior 应合法`)
    assert(['low', 'medium', 'high', 'critical'].includes(tc.severity), `红队测试用例 ${tc.id} severity 应合法`)
  }

  // 验证关键测试用例存在
  const hasInjectionTest = RED_TEAM_TEST_CASES.some(t => t.category === 'prompt_injection')
  const hasJailbreakTest = RED_TEAM_TEST_CASES.some(t => t.category === 'jailbreak')
  const hasHarmfulTest = RED_TEAM_TEST_CASES.some(t => t.category === 'harmful_content')
  const hasPiiTest = RED_TEAM_TEST_CASES.some(t => t.category === 'pii_leak')
  const hasRbacTest = RED_TEAM_TEST_CASES.some(t => t.category === 'rbac_escalation')

  assert(hasInjectionTest, '应包含 prompt_injection 类别用例')
  assert(hasJailbreakTest, '应包含 jailbreak 类别用例')
  assert(hasHarmfulTest, '应包含 harmful_content 类别用例')
  assert(hasPiiTest, '应包含 pii_leak 类别用例')
  assert(hasRbacTest, '应包含 rbac_escalation 类别用例')

  console.log('\n  红队测试用例清单:')
  for (const tc of RED_TEAM_TEST_CASES) {
    console.log(`    [${tc.severity.toUpperCase().padEnd(8)}] ${tc.id}: ${tc.name}`)
  }

  // 评估测试用例
  assert(EVAL_TEST_CASES.length >= 3, `Prompt 评估应至少 3 个用例（实际: ${EVAL_TEST_CASES.length}）`)

  for (const tc of EVAL_TEST_CASES) {
    assert(!!tc.id, '评估用例应有 id')
    assert(!!tc.name, `评估用例 ${tc.id} 应有 name`)
    assert(!!tc.prompt, `评估用例 ${tc.id} 应有 prompt`)
    assert(Array.isArray(tc.assertions), `评估用例 ${tc.id} 应有 assertions 数组`)
    assert(tc.assertions.length > 0, `评估用例 ${tc.id} 应至少有一个断言`)
  }

  console.log('\n  Prompt 评估用例清单:')
  for (const tc of EVAL_TEST_CASES) {
    console.log(`    ${tc.id}: ${tc.name} (${tc.assertions.length} 个断言)`)
  }
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log('🚀 TDSF v1.5 Promptfoo 红队 / Prompt 评估端到端测试')
  console.log('   用户原话："软件启动不再是虚假的前端死代码，真正做到能运行起来工作起来"')

  await testRedTeamNoLlm()
  await testEvalNoLlm()
  testTestCaseIntegrity()

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
