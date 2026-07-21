/**
 * 抓取所有源到生产数据库
 *
 * 用途：数据库被重置后，重新抓取 5 个 P0 源 + 1 个 Phase 2 源，
 * 把约 2578 条教程写入真实生产数据库（app.getPath('userData')/tdsf.db）。
 *
 * 用法：node scripts/run-script.cjs crawl-to-prod-db
 *
 * 源列表（参考 Sprint 6 报告）：
 *   - tldr-pages         (git clone, ~1767 条, ~30s)
 *   - linux-command      (git clone, ~592 条,  ~60s)
 *   - linux-journey      (git clone, ~186 条,  ~10s)
 *   - art-of-command-line(git clone, ~4 条,    ~10s)
 *   - ldp-howtos         (offline,   ~29 条,   ~5s)
 *
 * 总计约 2578 条，预计 2-3 分钟完成。
 *
 * 关键点：
 *   - 使用真实生产数据库路径（app.getPath('userData')/tdsf.db）
 *   - 用 upsertMany（同步版，不生成 embedding，留给 backfill-embeddings 脚本）
 *   - 不重复抓取已存在的条目（upsert 语义）
 */

import { app } from 'electron'
import { join } from 'node:path'
import { DatabaseManager } from '../src/main/services/db/database'
import { TutorialCrawlerService } from '../src/main/services/tutorial/crawler/tutorial-crawler-service'
import { TutorialRepository } from '../src/main/services/tutorial/tutorial-repo'

// 5 个 P0 源（按抓取速度排序，快的先跑）
// 注：art-of-command-line 和 linux-journey 数据库已有（200 条），会被去重
// 优先抓 tldr-pages + linux-command（最大的两个源，git clone 离线，不会卡网络）
const SOURCES = [
  'tldr-pages',          // ~30s, 1767 条（git clone 离线）
  'linux-command',       // ~60s, 592 条（git clone 离线）
  'ldp-howtos',          // ~5s,  29 条（offline dump，可能卡网络）
  'art-of-command-line', // ~10s, 4 条（已被去重，跳过）
  'linux-journey'        // ~10s, 186 条（已被去重，跳过）
] as const

/** 单源超时（毫秒），超过则跳过该源 */
const SOURCE_TIMEOUT_MS = 120000 // 2 分钟

async function main(): Promise<void> {
  console.log('[crawl] 初始化数据库...')
  const dbPath = join(app.getPath('userData'), 'tdsf.db')
  console.log(`[crawl] 数据库路径: ${dbPath}`)

  const db = DatabaseManager.getInstance(dbPath)
  console.log(`[crawl] DB 可用=${db.isAvailable()} 向量扩展=${db.isVectorEnabled()}`)

  if (!db.isAvailable()) {
    console.error('[crawl] 数据库不可用，退出')
    process.exit(1)
  }

  const repo = new TutorialRepository(db)
  const crawler = new TutorialCrawlerService(db, () => null)

  // 抓取前统计
  const beforeCount = repo.count()
  console.log(`[crawl] 抓取前 tutorial 总数: ${beforeCount}`)

  // 逐个源抓取（避免并发竞争 + 便于看到进度）
  console.log(`\n[crawl] 开始抓取 ${SOURCES.length} 个源...`)
  const startMs = Date.now()

  const allResults = []
  for (let i = 0; i < SOURCES.length; i++) {
    const sourceId = SOURCES[i]
    console.log(`\n[crawl] (${i + 1}/${SOURCES.length}) 抓取 ${sourceId}...`)

    const sourceStart = Date.now()
    try {
      // 加超时保护：如果单源超过 SOURCE_TIMEOUT_MS，跳过
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`源 ${sourceId} 超时 (${SOURCE_TIMEOUT_MS / 1000}s)`)), SOURCE_TIMEOUT_MS)
      )
      const results = await Promise.race([
        crawler.start({ sourceIds: [sourceId] }),
        timeoutPromise
      ])
      const elapsed = ((Date.now() - sourceStart) / 1000).toFixed(1)
      for (const r of results) {
        console.log(
          `  ${r.sourceId.padEnd(25)} ` +
          `inserted=${String(r.inserted).padStart(4)} ` +
          `updated=${String(r.updated).padStart(4)} ` +
          `skipped=${String(r.skipped).padStart(4)} ` +
          `failed=${String(r.failed).padStart(4)} ` +
          `time=${elapsed}s`
        )
        if (r.errors.length > 0) {
          console.log(`    ⚠️ 错误: ${r.errors.join('; ')}`)
        }
        allResults.push(r)
      }
    } catch (err) {
      const elapsed = ((Date.now() - sourceStart) / 1000).toFixed(1)
      console.error(`  ❌ ${sourceId} 抓取失败 (time=${elapsed}s):`, (err as Error).message)
    }
  }

  const totalElapsed = ((Date.now() - startMs) / 1000).toFixed(1)

  // 抓取后统计
  const afterCount = repo.count()
  const newCount = afterCount - beforeCount

  console.log('\n========== 抓取汇总 ==========')
  console.log(`总耗时: ${totalElapsed}s`)
  console.log(`抓取前总数: ${beforeCount}`)
  console.log(`抓取后总数: ${afterCount}`)
  console.log(`新增: ${newCount}`)

  // 分类统计
  const catSummary = repo.categorySummary()
  console.log('\n========== 分类统计 ==========')
  for (const c of catSummary) {
    if (c.count > 0) {
      console.log(`  ${c.label.padEnd(15)} ${c.count}`)
    }
  }

  // 检查 embedding 状态
  const pendingRow = db.prepare(
    "SELECT COUNT(*) as cnt FROM knowledge_entries WHERE type='tutorial' AND embedding IS NULL"
  ).get() as { cnt: number } | undefined
  console.log(`\n[crawl] 待回填 embedding 条目: ${pendingRow?.cnt ?? 0}`)

  console.log('\n[crawl] 完成。下一步：')
  console.log('  node scripts/run-script.cjs backfill-embeddings')

  process.exit(0)
}

main().catch((err) => {
  console.error('[crawl] 未捕获错误:', err)
  process.exit(1)
})
