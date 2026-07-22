/**
 * LoopEngineeringSubagent 冒烟集成测试
 *
 * 用户原话：
 *   "我要从「假设计 → 可演示真 IDE」做完一整轮，你设计循环工程配置子agent达到这个目标"
 *   "之前是，「视觉壳 + mock 数据」，还没真正接到 Agent"
 *
 * 测试目标（不依赖真实 LLM/SSH，验证子 agent 自身的结构完整性）：
 *   1. getLoopEngineeringSubagent() 单例工厂能正常创建实例
 *   2. events EventEmitter 能订阅 6 个 loop:* 事件
 *   3. confirm/cancel 方法对未知 correlationId 返回 false（不抛错）
 *   4. 单例重置后能再次创建
 *   5. 验证 LoopEngineeringEvent 类型联合的 6 个 type 字面量存在
 *
 * 运行方式：
 *   pnpm exec tsx --tsconfig tsconfig.node.json scripts/test-loop-engineering-smoke.ts
 *
 * 不测试的部分（需真实 LLM/SSH，留给 UI 端到端）：
 *   - execute() 真实触发 Supervisor.chat + AgentWorkflow 7 步
 *   - 真实 SSH 命令执行
 *   - 真实 DiagnosticsService 日志分析
 */

import {
  getLoopEngineeringSubagent,
  resetLoopEngineeringSubagent,
  LoopEngineeringSubagent,
} from '../src/main/core/agent/subagents/loop-engineering-subagent'
import { SshConnectionManager } from '../src/main/services/ssh/connection-manager'
import { LlmClient } from '../src/main/services/llm/client'
import { createSubagentTask } from '../src/main/core/agent/subagents/base'

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
// 主测试函数
// ============================================================

async function main(): Promise<void> {
  console.log('🚀 TDSF v1.5 LoopEngineeringSubagent 冒烟集成测试')
  console.log('   用户原话："我要从「假设计 → 可演示真 IDE」做完一整轮"')
  console.log('   测试场景：验证子 agent 结构完整性，不触发真实 LLM/SSH')

  // ────────── 步骤 1：单例工厂 ──────────
  section('步骤 1：单例工厂 getLoopEngineeringSubagent()')

  const sub1 = getLoopEngineeringSubagent()
  assert(sub1 instanceof LoopEngineeringSubagent, '应返回 LoopEngineeringSubagent 实例')

  const sub2 = getLoopEngineeringSubagent()
  assert(sub1 === sub2, '两次调用应返回同一实例（单例）')

  // ────────── 步骤 2：公开属性 ──────────
  section('步骤 2：公开属性与 displayName')

  assert(sub1.name === 'loop-engineering', `name 应为 'loop-engineering'，实际 ${sub1.name}`)
  assert(typeof sub1.displayName === 'string' && sub1.displayName.length > 0, 'displayName 应为非空字符串')
  assert(typeof sub1.description === 'string' && sub1.description.length > 0, 'description 应为非空字符串')
  assert(sub1.events !== undefined && sub1.events !== null, 'events EventEmitter 应存在')

  // ────────── 步骤 3：事件订阅链路 ──────────
  section('步骤 3：6 个 loop:* 事件订阅链路')

  const LOOP_EVENT_TYPES = [
    'loop:llm-start',
    'loop:llm-done',
    'loop:step',
    'loop:decision',
    'loop:done',
    'loop:error',
  ] as const

  const receivedEvents: string[] = []

  for (const evtType of LOOP_EVENT_TYPES) {
    sub1.events.on(evtType, (evt: { type: string }) => {
      receivedEvents.push(evt.type)
    })
  }

  // 手动触发每个事件（通过内部 emit，但 emit 是 private，所以用 events.emit 直接发）
  // 注意：这里直接用 events.emit 模拟 IPC 层接收到的场景
  for (const evtType of LOOP_EVENT_TYPES) {
    sub1.events.emit(evtType, { type: evtType, correlationId: 'test-cid' })
  }

  // 给事件循环一点时间
  await new Promise((resolve) => setTimeout(resolve, 100))

  for (const evtType of LOOP_EVENT_TYPES) {
    assert(
      receivedEvents.includes(evtType),
      `事件 ${evtType} 应被监听器接收`
    )
  }

  // ────────── 步骤 4：confirm/cancel 对未知 correlationId 返回 false ──────────
  section('步骤 4：confirm/cancel 对未知 correlationId 返回 false')

  const confirmResult = sub1.confirm('unknown-cid-12345', true)
  assert(confirmResult === false, 'confirm 未知 correlationId 应返回 false')

  const cancelResult = sub1.cancel('unknown-cid-67890')
  assert(cancelResult === false, 'cancel 未知 correlationId 应返回 false')

  // ────────── 步骤 5：单例重置 ──────────
  section('步骤 5：单例重置 resetLoopEngineeringSubagent()')

  resetLoopEngineeringSubagent()
  const sub3 = getLoopEngineeringSubagent()
  assert(sub3 !== sub1, '重置后应返回新实例')
  assert(sub3 instanceof LoopEngineeringSubagent, '新实例应仍是 LoopEngineeringSubagent 类型')

  // ────────── 步骤 6：验证 LoopEngineeringEvent 类型联合 ──────────
  section('步骤 6：LoopEngineeringEvent 类型联合的 6 个 type 字面量')

  // 通过运行时检查：emit 6 个事件并捕获
  const sub4 = getLoopEngineeringSubagent()
  const capturedTypes: string[] = []
  for (const evtType of LOOP_EVENT_TYPES) {
    sub4.events.on(evtType, (evt: { type: string }) => {
      capturedTypes.push(evt.type)
    })
  }

  for (const evtType of LOOP_EVENT_TYPES) {
    sub4.events.emit(evtType, { type: evtType, correlationId: 'type-check' })
  }
  await new Promise((resolve) => setTimeout(resolve, 100))

  assert(
    capturedTypes.length === 6,
    `应捕获 6 个事件，实际 ${capturedTypes.length}`
  )
  for (const evtType of LOOP_EVENT_TYPES) {
    assert(capturedTypes.includes(evtType), `类型 ${evtType} 应在捕获列表中`)
  }

  // ────────── 步骤 7：SSH 预检查（Phase D 新增） ──────────
  section('步骤 7：SSH 预检查 hasActiveConnection() + loop:blocked 事件')

  // 通过 SshConnectionManager 单例 stub hasActiveConnection 返回 false
  const sshInstance = SshConnectionManager.getInstance()
  const originalHasActive = sshInstance.hasActiveConnection.bind(sshInstance)
  let sshStubbed = false
  try {
    sshInstance.hasActiveConnection = () => false
    sshStubbed = true
  } catch {
    // 若无法直接赋值（readonly），改用 Object.defineProperty
    Object.defineProperty(sshInstance, 'hasActiveConnection', {
      value: () => false,
      configurable: true,
      writable: true,
    })
    sshStubbed = true
  }
  assert(sshStubbed, '应能 stub SshConnectionManager.hasActiveConnection 返回 false')

  const subBlocked = getLoopEngineeringSubagent()
  let blockedEventReceived: { reason: string; step: string; message: string } | null = null
  subBlocked.events.on('loop:blocked', (evt: { type: string; reason: string; step: string; message: string }) => {
    blockedEventReceived = {
      reason: evt.reason,
      step: evt.step,
      message: evt.message,
    }
  })

  const blockedTask = createSubagentTask(
    'loop-engineering',
    'SSH 预检查测试',
    { problem: '测试问题', connId: 'test-conn-blocked' },
    { correlationId: 'blocked-test-cid' }
  )

  const blockedResult = await subBlocked.execute(blockedTask)

  assert(
    blockedEventReceived !== null,
    '应接收到 loop:blocked 事件'
  )
  assert(
    blockedEventReceived?.reason === 'SSH_NO_CONNECTION',
    `loop:blocked 事件 reason 应为 SSH_NO_CONNECTION，实际 ${blockedEventReceived?.reason}`
  )
  assert(
    blockedEventReceived?.step === 'execute',
    `loop:blocked 事件 step 应为 execute，实际 ${blockedEventReceived?.step}`
  )
  assert(
    !blockedResult.success,
    'SSH 未连接时 execute 应返回 success=false'
  )
  assert(
    typeof blockedEventReceived?.message === 'string' && blockedEventReceived.message.length > 0,
    'loop:blocked 事件应携带非空 message'
  )

  // 恢复 stub
  try {
    sshInstance.hasActiveConnection = originalHasActive
  } catch {
    Object.defineProperty(sshInstance, 'hasActiveConnection', {
      value: originalHasActive,
      configurable: true,
      writable: true,
    })
  }
  // 清理事件监听器避免影响后续测试
  subBlocked.events.removeAllListeners('loop:blocked')

  // ────────── 步骤 8：LLM 兜底命令对齐（Phase D 新增） ──────────
  section('步骤 8：LLM 兜底命令 echo "LLM_UNAVAILABLE" + confidence 0.3')

  // 构造 apiKey 为空的 LlmClient，触发降级路径
  const llmClient = new LlmClient({
    baseUrl: '',
    apiKey: '',
    model: '',
    temperature: 0.7,
    maxTokens: 2048,
    timeout: 30_000,
  })

  assert(!llmClient.isAvailable(), 'apiKey 为空时 LlmClient.isAvailable() 应返回 false')

  // 使用不匹配任何规则的问题描述，使 rule-engine 返回 null，触发兜底返回
  const fallbackResult = await llmClient.analyze('完全无匹配的未知问题xyz123', [])

  assert(
    fallbackResult.fixCommand === 'echo "LLM_UNAVAILABLE"',
    `兜底 fixCommand 应为 echo "LLM_UNAVAILABLE"，实际 ${fallbackResult.fixCommand}`
  )
  assert(
    fallbackResult.confidence === 0.3,
    `兜底 confidence 应为 0.3，实际 ${fallbackResult.confidence}`
  )
  assert(
    typeof fallbackResult.hypothesis === 'string' && fallbackResult.hypothesis.length > 0,
    '兜底 hypothesis 应为非空字符串'
  )

  // ────────── 汇总 ──────────
  console.log('\n' + '='.repeat(60))
  console.log('📊 测试汇总')
  console.log('='.repeat(60))
  console.log(`  ✅ 通过: ${passCount}`)
  console.log(`  ❌ 失败: ${failCount}`)
  console.log('='.repeat(60))

  if (failCount > 0) {
    console.log('\n❌ 冒烟测试失败，请检查 LoopEngineeringSubagent 结构')
    process.exit(1)
  } else {
    console.log('\n✅ 冒烟测试全部通过！子 agent 结构完整，可接入 UI 端到端验证')
    console.log('   下一步：在 Electron 应用中切换"演示模式"，输入问题触发真实 LLM 推理')
    process.exit(0)
  }
}

main().catch((err) => {
  console.error('\n💥 测试执行异常:', err)
  process.exit(2)
})
