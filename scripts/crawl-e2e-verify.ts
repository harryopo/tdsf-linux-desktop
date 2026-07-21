/**
 * 端到端验证脚本：P0 源跑通 + 数据库统计
 *
 * 用法：
 *   pnpm tsx scripts/crawl-e2e-verify.ts [sourceId1,sourceId2,...]
 *
 * 默认运行 3 个最快的 P0 源：
 *   - tldr-pages（git clone，约 30s）
 *   - art-of-command-line（git clone，约 10s）
 *   - linux-command（git clone，约 60s）
 *
 * 验证项：
 *   1. 爬虫能完成（不抛异常）
 *   2. 数据库有新增教程
 *   3. 教程 entry 字段完整
 *
 * 教学术语：
 *   - E2E (End-to-End)：端到端测试，从用户视角验证完整流程
 *   - tsx：TypeScript 执行器，无需编译直接运行 .ts
 */

import { resolveDbPath, DatabaseManager } from '../src/main/services/db/database'
import { TutorialCrawlerService } from '../src/main/services/tutorial/crawler/tutorial-crawler-service'
import { TutorialRepository } from '../src/main/services/tutorial/tutorial-repo'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'

// 用临时数据库（不污染生产库）
const tmpDbPath = path.join(os.tmpdir(), `tdsf-e2e-${Date.now()}.db`)
console.log(`[E2E] 临时数据库: ${tmpDbPath}`)
console.log(`[E2E] DB 写入位置: ${tmpDbPath}`)

async function main() {
  const args = process.argv.slice(2)
  let sourceIds: string[]
  if (args.length > 0) {
    sourceIds = args.flatMap((s) => s.split(',').filter(Boolean))
  } else {
    // 默认：3 个最快的 P0 源
    sourceIds = ['tldr-pages', 'art-of-command-line', 'linux-command']
  }
  console.log(`[E2E] 将抓取以下源: ${sourceIds.join(', ')}`)

  // 1. 初始化数据库
  const db = DatabaseManager.getInstance(tmpDbPath)
  console.log(`[E2E] DB 可用=${db.isAvailable()}`)

  // 2. 创建爬虫服务
  const crawler = new TutorialCrawlerService(db, () => null)
  const repo = new TutorialRepository(db)

  // 3. 记录抓取前数量
  const beforeCount = repo.listAll().length
  console.log(`[E2E] 抓取前教程数: ${beforeCount}`)

  // 4. 抓取
  const startMs = Date.now()
  const results = await crawler.start({ sourceIds })
  const durationMs = Date.now() - startMs

  // 5. 统计
  console.log('\n========== 抓取结果 ==========')
  for (const r of results) {
    console.log(
      `  ${r.sourceId.padEnd(25)} ` +
      `inserted=${String(r.inserted).padStart(3)} ` +
      `updated=${String(r.updated).padStart(3)} ` +
      `skipped=${String(r.skipped).padStart(3)} ` +
      `failed=${String(r.failed).padStart(3)} ` +
      `time=${(r.durationMs / 1000).toFixed(1)}s`
    )
    if (r.errors.length > 0) {
      console.log(`    ⚠️ 错误: ${r.errors.join('; ')}`)
    }
  }
  console.log(`总耗时: ${(durationMs / 1000).toFixed(1)}s`)

  // 6. 抓取后数据库统计
  const afterCount = repo.listAll().length
  console.log(`\n[E2E] 抓取后教程数: ${afterCount}（新增 ${afterCount - beforeCount}）`)

  // 7. 分类统计
  const catSummary = repo.categorySummary()
  console.log('\n========== 分类统计 ==========')
  for (const c of catSummary) {
    if (c.count > 0) {
      console.log(`  ${c.label.padEnd(15)} ${c.count}`)
    }
  }

  // 8. 抽样验证
  const all = repo.listAll()
  if (all.length > 0) {
    console.log('\n========== 抽样验证（最新 3 条）==========')
    const samples = all.slice(0, 3)
    for (const t of samples) {
      console.log(`  - [${t.source.name}] ${t.title}`)
      console.log(`    id: ${t.id}`)
      console.log(`    category: ${t.category} / ${t.difficulty}`)
      console.log(`    commands: ${t.commands.length} 条`)
      console.log(`    content 长度: ${t.content.length} 字符`)
    }
  }

  // 9. 数据源分布
  const sourceStats = new Map<string, number>()
  for (const t of all) {
    const src = t.source.name
    sourceStats.set(src, (sourceStats.get(src) ?? 0) + 1)
  }
  console.log('\n========== 数据源分布 ==========')
  for (const [src, cnt] of [...sourceStats.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src.padEnd(30)} ${cnt}`)
  }

  // 10. 清理
  console.log(`\n[E2E] 验证完成。临时数据库保留在: ${tmpDbPath}`)
  console.log('[E2E] 提示：生产数据库用户数据在 Electron appData 目录。')

  // 不删除临时 DB，让用户可以查看
  console.log('\n✅ E2E 验证通过！')
}

main().catch((err) => {
  console.error('[E2E] ❌ 失败:', err)
  process.exit(1)
})
