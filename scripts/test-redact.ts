/**
 * 敏感信息脱敏工具单元测试
 *
 * 测试目标（9 个用例）：
 *   1. password=xxx        → password=[REDACTED]
 *   2. token=xxx           → token=[REDACTED]
 *   3. api_key=xxx         → api_key=[REDACTED]
 *   4. apiKey=xxx          → apiKey=[REDACTED]
 *   5. secret=xxx          → secret=[REDACTED]
 *   6. Bearer xxx          → Bearer [REDACTED]
 *   7. /home/user/.env     → [PATH_REDACTED]
 *   8. C:\Users\admin\.ssh\id_rsa → [PATH_REDACTED]
 *   9. 边界用例：空字符串、null、undefined 输入（返回原值）
 *
 * 运行方式：
 *   npx tsx --tsconfig tsconfig.node.json scripts/test-redact.ts
 */

import { redactSensitiveInfo } from '../src/main/services/security/redact'

// ============================================================
// 测试工具函数
// ============================================================

let passCount = 0
let failCount = 0
const TOTAL = 9

function test<T extends string | null | undefined>(
  name: string,
  input: T,
  expected: T
): void {
  const actual = redactSensitiveInfo(input)
  if (actual === expected) {
    console.log(`  ✅ ${name}`)
    passCount++
  } else {
    console.error(`  ❌ ${name}`)
    console.error(`    Expected: ${String(expected)}`)
    console.error(`    Actual:   ${String(actual)}`)
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

function main(): void {
  console.log('🚀 redactSensitiveInfo 脱敏工具单元测试')
  console.log('   测试场景：password / token / api_key / secret / Bearer / .env / .ssh / 边界')

  // ────────── key=value 模式 ──────────

  section('场景 1：key=value 模式脱敏')

  // 用例 1：password
  test(
    'password=secret123 → password=[REDACTED]',
    'Connection failed: password=secret123',
    'Connection failed: password=[REDACTED]'
  )

  // 用例 2：token
  test(
    'token=abc.def.ghi → token=[REDACTED]',
    'Auth error: token=abc.def.ghi expired',
    'Auth error: token=[REDACTED] expired'
  )

  // 用例 3：api_key
  test(
    'api_key=sk-xxxxx → api_key=[REDACTED]',
    'Request with api_key=sk-xxxxx rejected',
    'Request with api_key=[REDACTED] rejected'
  )

  // 用例 4：apiKey（驼峰）
  test(
    'apiKey=sk-xxxxx → apiKey=[REDACTED]',
    'Config apiKey=sk-xxxxx loaded',
    'Config apiKey=[REDACTED] loaded'
  )

  // 用例 5：secret
  test(
    'secret=mysecret → secret=[REDACTED]',
    'Missing secret=mysecret in env',
    'Missing secret=[REDACTED] in env'
  )

  // ────────── Bearer token 模式 ──────────

  section('场景 2：Bearer token 脱敏')

  // 用例 6：Bearer
  test(
    'Bearer eyJhbGciOiJIUzI1... → Bearer [REDACTED]',
    'Authorization: Bearer eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    'Authorization: Bearer [REDACTED]'
  )

  // ────────── 路径脱敏 ──────────

  section('场景 3：敏感路径脱敏')

  // 用例 7：.env 文件路径
  test(
    '/home/user/.env → [PATH_REDACTED]',
    'Loaded .env from /home/user/.env',
    'Loaded .env from [PATH_REDACTED]'
  )

  // 用例 8：.ssh 目录路径
  test(
    'C:\\Users\\admin\\.ssh\\id_rsa → [PATH_REDACTED]',
    'SSH key not found: C:\\Users\\admin\\.ssh\\id_rsa',
    'SSH key not found: [PATH_REDACTED]'
  )

  // ────────── 边界用例 ──────────

  section('场景 4：边界用例（空字符串 / null / undefined）')

  // 用例 9：边界用例（空字符串、null、undefined 返回原值）
  {
    const inputs: (string | null | undefined)[] = ['', null, undefined]
    let allPass = true
    for (const inp of inputs) {
      const actual = redactSensitiveInfo(inp)
      if (actual !== inp) {
        allPass = false
        console.error(
          `    输入 "${String(inp)}" 期望返回原值，实际 "${String(actual)}"`
        )
      }
    }
    if (allPass) {
      console.log('  ✅ 边界用例：空字符串、null、undefined 返回原值')
      passCount++
    } else {
      console.error('  ❌ 边界用例：空字符串、null、undefined 返回原值')
      failCount++
    }
  }

  // ────────── 汇总 ──────────

  console.log('\n' + '='.repeat(60))
  console.log('📊 测试汇总')
  console.log('='.repeat(60))
  console.log(`  ✅ 通过: ${passCount}`)
  console.log(`  ❌ 失败: ${failCount}`)
  console.log('='.repeat(60))

  if (failCount > 0) {
    console.log(`\n❌ ${failCount}/${TOTAL} failed`)
    process.exit(1)
  } else {
    console.log(`\n✅ ${passCount}/${TOTAL} passed`)
    process.exit(0)
  }
}

main()
