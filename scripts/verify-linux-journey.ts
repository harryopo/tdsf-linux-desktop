/**
 * linux-journey 抓取验证脚本（完整跑，预计 1-2 分钟）
 *
 * 教学术语：
 * - Linux Journey：原 linuxjourney.com，现由 LabEx 维护的免费 Linux 教学课程
 * - sparse-checkout：只克隆仓库指定子目录，节省空间
 * - YAML frontmatter：MD 文件开头的元信息（--- 包围）
 */
import { resolveDbPath, DatabaseManager } from '../src/main/services/db/database'
import { crawlLinuxJourney } from '../src/main/services/tutorial/crawler/linux-journey-offline'
import { TutorialRepository } from '../src/main/services/tutorial/tutorial-repo'
import * as os from 'node:os'
import * as path from 'node:path'

const tmpDbPath = path.join(os.tmpdir(), `tdsf-lj-${Date.now()}.db`)
console.log(`[LJ] 临时数据库: ${tmpDbPath}`)

async function main() {
  const db = DatabaseManager.getInstance(tmpDbPath)
  console.log(`[LJ] DB 可用=${db.isAvailable()}`)

  const repo = new TutorialRepository(db)
  const beforeCount = repo.listAll().length
  console.log(`[LJ] 抓取前教程数: ${beforeCount}`)

  const ac = new AbortController()
  setTimeout(() => ac.abort(), 300_000)  // 5 分钟总超时

  const startMs = Date.now()
  let lastProgress = ''

  const entries = await crawlLinuxJourney((p) => {
    const msg = `[${p.phase}] ${p.message}`
    if (msg !== lastProgress) {
      console.log(msg)
      lastProgress = msg
    }
  }, ac.signal).catch((err) => {
    console.error('[LJ] 抓取异常:', err.message)
    return []
  })

  console.log(`[LJ] 抓取到 ${entries.length} 篇`)

  // 入库
  const insertResult = repo.upsertMany(entries)
  const durationMs = Date.now() - startMs

  console.log('\n========== 结果 ==========')
  console.log(`  inserted=${insertResult.inserted} updated=${insertResult.updated} skipped=${insertResult.skipped}`)
  console.log(`  时长: ${(durationMs / 1000).toFixed(1)}s`)

  const all = repo.listAll()
  console.log(`\n[LJ] 当前 DB 教程总数: ${all.length}`)

  // 分类统计
  const catSummary = repo.categorySummary()
  console.log('\n========== 分类统计 ==========')
  for (const c of catSummary) {
    if (c.count > 0) {
      console.log(`  ${c.label.padEnd(15)} ${c.count}`)
    }
  }

  // 抽样
  console.log('\n========== 抽样（前 5 条）==========')
  for (const t of all.slice(0, 5)) {
    console.log(`  - [${t.source.name}] ${t.title}`)
    console.log(`    category: ${t.category} / commands: ${t.commands.length} 条 / content: ${t.content.length} 字符`)
  }

  // 数据源分布
  const sourceStats = new Map<string, number>()
  for (const t of all) {
    const src = t.source.name
    sourceStats.set(src, (sourceStats.get(src) ?? 0) + 1)
  }
  console.log('\n========== 数据源分布 ==========')
  for (const [src, cnt] of [...sourceStats.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src.padEnd(40)} ${cnt}`)
  }

  console.log(`\n✅ linux-journey 验证完成。临时 DB: ${tmpDbPath}`)
}

main().catch((err) => {
  console.error('[LJ] ❌ 失败:', err)
  process.exit(1)
})
