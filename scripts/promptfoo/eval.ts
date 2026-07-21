#!/usr/bin/env tsx
// TDSF Promptfoo Prompt 评估 CLI 入口
//
// 用途：开发/调试时手动运行 prompt 评估（独立于 Electron 主进程）
//
// 运行：
//   cd d:\ai\linux教学一体\tdsf-linux-desktop
//   npx tsx scripts/promptfoo/eval.ts
//
// 注意：此文件只作为 CLI 入口，核心实现在 src/main/services/promptfoo/eval.ts

import { EvalRunner, EVAL_TEST_CASES } from '../../src/main/services/promptfoo/eval'
import type { ChatMessage } from '../../src/shared/models'

async function main() {
  console.log('========================================')
  console.log('  TDSF Prompt 评估（v1.5 轻量版 CLI）')
  console.log('========================================\n')

  // CLI 模式下无 LlmClient，所有测试跳过
  const runner = new EvalRunner(null)
  const modelProvider: ChatMessage[] = [
    {
      role: 'system',
      content: 'You are a helpful Linux operations assistant. You help users with system administration tasks.',
    },
  ]

  console.log(`运行 ${EVAL_TEST_CASES.length} 个评估测试用例...\n`)
  const report = await runner.runAllTests(modelProvider)

  console.log('========================================')
  console.log('  评估结果')
  console.log('========================================')
  console.log(`总测试数：${report.totalTests}`)
  console.log(`通过：${report.passedTests}（${report.passRate.toFixed(1)}%）`)
  console.log(`失败：${report.failedTests}`)
  console.log(`平均延迟：${report.averageLatencyMs.toFixed(0)}ms`)
  console.log(`\n总结：${report.summary}\n`)

  if (report.failedTests > 0) {
    console.log('========================================')
    console.log('  失败详情')
    console.log('========================================')
    for (const result of report.results.filter(r => !r.passed)) {
      console.log(`\n[${result.testCase.name}]`)
      console.log(`  Prompt：${result.testCase.prompt.substring(0, 80)}...`)
      console.log(`  响应：${result.actualResponse.substring(0, 100)}...`)
      if (result.failureReason) {
        console.log(`  原因：${result.failureReason}`)
      }
    }
  }

  const fs = await import('fs')
  const path = await import('path')
  const reportPath = path.resolve('scripts/promptfoo/eval-report.json')
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`\n报告已保存到：${reportPath}`)

  process.exit(report.passRate === 100 ? 0 : 1)
}

main().catch((err) => {
  console.error('Prompt 评估运行失败：', err)
  process.exit(1)
})
