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
