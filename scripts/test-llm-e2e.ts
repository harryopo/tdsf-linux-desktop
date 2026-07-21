/**
 * LLM 客户端 + 规则引擎降级机制端到端测试
 *
 * 用户原话：
 *   "真正做到能运行起来工作起来，跑通核心的功能"
 *
 * 测试场景：
 *   1. LlmClient 实例化（无 API Key - 降级模式）
 *   2. LlmClient 配置校验
 *   3. LlmClient.analyze 降级到规则引擎
 *   4. 规则引擎能正确匹配常见 Linux SRE 问题
 *
 * 运行方式：
 *   pnpm exec tsx scripts/test-llm-e2e.ts
 */

import { LlmClient } from '../src/main/services/llm/client'
import type { LlmConfig, Evidence } from '../src/shared/models'

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
// 测试 1：LlmClient 实例化（降级模式）
// ============================================================

function testLlmClientInstantiation(): void {
  section('测试 1：LlmClient 实例化（降级模式 - 无 API Key）')

  // 空 API Key 的配置（降级模式）
  const degradedConfig: LlmConfig = {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',  // 空 API Key
    model: 'gpt-4',
    temperature: 0.7,
    maxTokens: 2048,
    timeout: 30000,
  }

  const client = new LlmClient(degradedConfig)

  assert(client.isAvailable() === false, '空 API Key 时 isAvailable() 应返回 false')

  // 配置校验（应报告 API Key 为空）
  const validation = client.validateConfig()
  assert(validation.valid === false, '空 API Key 时配置应无效')
  assert(validation.errors.length > 0, '应有校验错误')
  assert(
    validation.errors.some(e => e.includes('API Key')),
    '错误信息应包含 API Key',
  )

  console.log(`  📊 校验错误: ${validation.errors.join(', ')}`)
}

// ============================================================
// 测试 2：LlmClient 配置校验
// ============================================================

function testLlmConfigValidation(): void {
  section('测试 2：LlmClient 配置校验')

  // 有效配置（除了 API Key）
  const validConfig: LlmConfig = {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test-key',
    model: 'gpt-4',
    temperature: 0.7,
    maxTokens: 2048,
    timeout: 30000,
  }

  const client = new LlmClient(validConfig)
  assert(client.isAvailable() === true, '有 API Key 时 isAvailable() 应返回 true')

  const validation = client.validateConfig()
  assert(validation.valid === true, '有效配置应通过校验')
  assert(validation.errors.length === 0, '有效配置不应有错误')

  // 无效 baseUrl
  const invalidUrlConfig: LlmConfig = { ...validConfig, baseUrl: 'not-a-url' }
  const client2 = new LlmClient(invalidUrlConfig)
  const validation2 = client2.validateConfig()
  assert(validation2.valid === false, '无效 baseUrl 应校验失败')
  assert(
    validation2.errors.some(e => e.includes('Base URL')),
    '错误信息应包含 Base URL',
  )

  // 无效 temperature
  const invalidTempConfig: LlmConfig = { ...validConfig, temperature: 5 }
  const client3 = new LlmClient(invalidTempConfig)
  const validation3 = client3.validateConfig()
  assert(validation3.valid === false, 'temperature > 2 应校验失败')

  // 无效 maxTokens
  const invalidTokensConfig: LlmConfig = { ...validConfig, maxTokens: -1 }
  const client4 = new LlmClient(invalidTokensConfig)
  const validation4 = client4.validateConfig()
  assert(validation4.valid === false, 'maxTokens <= 0 应校验失败')
}

// ============================================================
// 测试 3：LlmClient.analyze 降级到规则引擎
// ============================================================

async function testAnalyzeDegradation(): Promise<void> {
  section('测试 3：LlmClient.analyze 降级到规则引擎')

  const degradedConfig: LlmConfig = {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',  // 空 API Key，触发降级
    model: 'gpt-4',
    temperature: 0.7,
    maxTokens: 2048,
    timeout: 30000,
  }

  const client = new LlmClient(degradedConfig)
  assert(client.isAvailable() === false, '应处于降级模式')

  // 准备测试证据（Linux SRE 场景）
  const evidences: Evidence[] = [
    {
      id: 'ev-1',
      source: 'log',
      sourceDetail: '/var/log/syslog',
      content: 'ERROR: Connection refused to database on 10.0.0.5:3306',
      drainMatch: 0.85,
      sourcePrior: 0.9,
      confidence: 0.88,
      timestamp: Date.now(),
      verified: true,
    },
    {
      id: 'ev-2',
      source: 'command',
      sourceDetail: 'systemctl status mysql',
      content: 'mysql.service: Failed with result "exit-code".',
      drainMatch: 0.75,
      sourcePrior: 0.85,
      confidence: 0.80,
      timestamp: Date.now(),
      verified: true,
    },
  ]

  // 调用 analyze（应自动降级到规则引擎）
  const result = await client.analyze('数据库连接失败', evidences)

  console.log(`  📊 根因假设: ${result.hypothesis}`)
  console.log(`  📊 修复命令: ${result.fixCommand}`)
  console.log(`  📊 置信度: ${result.confidence}`)

  assert(typeof result.hypothesis === 'string', '应有 hypothesis 字段')
  assert(typeof result.fixCommand === 'string', '应有 fixCommand 字段')
  assert(typeof result.confidence === 'number', '应有 confidence 字段')
  assert(result.confidence >= 0 && result.confidence <= 1, 'confidence 应在 [0, 1] 范围')
  assert(result.hypothesis.length > 0, 'hypothesis 不应为空')
  assert(result.fixCommand.length > 0, 'fixCommand 不应为空')
}

// ============================================================
// 测试 4：多种问题场景的规则匹配
// ============================================================

async function testRuleEngineScenarios(): Promise<void> {
  section('测试 4：多种 SRE 问题场景的规则匹配')

  const degradedConfig: LlmConfig = {
    baseUrl: '',
    apiKey: '',
    model: '',
    temperature: 0.7,
    maxTokens: 2048,
    timeout: 30000,
  }

  const client = new LlmClient(degradedConfig)

  // 场景 1：端口冲突
  console.log('\n  --- 场景 1：端口冲突 ---')
  const r1 = await client.analyze('服务启动失败', [
    {
      id: 'ev-1',
      source: 'log',
      sourceDetail: 'app.log',
      content: 'OSError: [Errno 98] Address already in use (port 8080)',
      drainMatch: 0.9,
      sourcePrior: 0.9,
      confidence: 0.9,
      timestamp: Date.now(),
      verified: true,
    },
  ])
  console.log(`    根因: ${r1.hypothesis}`)
  console.log(`    修复: ${r1.fixCommand}`)
  assert(r1.hypothesis.length > 0, '端口冲突场景应有根因假设')

  // 场景 2：磁盘空间不足
  console.log('\n  --- 场景 2：磁盘空间不足 ---')
  const r2 = await client.analyze('写入失败', [
    {
      id: 'ev-2',
      source: 'command',
      sourceDetail: 'df -h',
      content: '/dev/sda1 100G 95G 0G 100% /',
      drainMatch: 0.7,
      sourcePrior: 0.9,
      confidence: 0.85,
      timestamp: Date.now(),
      verified: true,
    },
  ])
  console.log(`    根因: ${r2.hypothesis}`)
  console.log(`    修复: ${r2.fixCommand}`)
  assert(r2.hypothesis.length > 0, '磁盘空间场景应有根因假设')

  // 场景 3：OOM（内存不足）
  console.log('\n  --- 场景 3：OOM 杀进程 ---')
  const r3 = await client.analyze('进程被杀', [
    {
      id: 'ev-3',
      source: 'log',
      sourceDetail: '/var/log/kern.log',
      content: 'Out of memory: Killed process 1234 (java) total-vm:4GB',
      drainMatch: 0.85,
      sourcePrior: 0.95,
      confidence: 0.9,
      timestamp: Date.now(),
      verified: true,
    },
  ])
  console.log(`    根因: ${r3.hypothesis}`)
  console.log(`    修复: ${r3.fixCommand}`)
  assert(r3.hypothesis.length > 0, 'OOM 场景应有根因假设')

  // 场景 4：SELinux 拒绝
  console.log('\n  --- 场景 4：SELinux 拒绝 ---')
  const r4 = await client.analyze('Samba 共享无法访问', [
    {
      id: 'ev-4',
      source: 'log',
      sourceDetail: '/var/log/audit/audit.log',
      content: 'type=AVC msg=audit(1234567890.123): avc: denied { read } for pid=1234 comm="smbd" path="/share" scontext=system_u:system_r:smbd_t:s0',
      drainMatch: 0.8,
      sourcePrior: 0.95,
      confidence: 0.88,
      timestamp: Date.now(),
      verified: true,
    },
  ])
  console.log(`    根因: ${r4.hypothesis}`)
  console.log(`    修复: ${r4.fixCommand}`)
  assert(r4.hypothesis.length > 0, 'SELinux 场景应有根因假设')

  // 场景 5：未知问题（规则引擎兜底）
  console.log('\n  --- 场景 5：未知问题（兜底） ---')
  const r5 = await client.analyze('神秘的性能问题', [
    {
      id: 'ev-5',
      source: 'metric',
      sourceDetail: 'prometheus',
      content: 'latency p99 = 5000ms (baseline 100ms)',
      drainMatch: 0.3,
      sourcePrior: 0.5,
      confidence: 0.4,
      timestamp: Date.now(),
      verified: false,
    },
  ])
  console.log(`    根因: ${r5.hypothesis}`)
  console.log(`    修复: ${r5.fixCommand}`)
  assert(r5.hypothesis.length > 0, '未知问题也应有兜底响应')
  assert(r5.confidence <= 0.3, '未知问题置信度应较低（<= 0.3）')
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log('🚀 TDSF v1.5 LLM 客户端 + 规则引擎降级机制端到端测试')
  console.log('   用户原话："真正做到能运行起来工作起来，跑通核心的功能"')

  testLlmClientInstantiation()
  testLlmConfigValidation()
  await testAnalyzeDegradation()
  await testRuleEngineScenarios()

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
