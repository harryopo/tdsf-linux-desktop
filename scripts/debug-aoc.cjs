/**
 * 单源调试：只跑 art-of-command-line 看具体错误
 */
const { DatabaseManager } = require('../src/main/services/db/database')
const { TutorialCrawlerService } = require('../src/main/services/tutorial/crawler/tutorial-crawler-service')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')

async function main() {
  const tmpDbPath = path.join(os.tmpdir(), `tdsf-debug-aoc-${Date.now()}.db`)
  console.log(`[Debug] DB: ${tmpDbPath}`)

  const db = DatabaseManager.getInstance(tmpDbPath)
  const crawler = new TutorialCrawlerService(db, () => null)

  // 监听进度事件
  const events = []
  crawler.onProgress((p) => {
    events.push(p)
    console.log(`  [progress] ${p.phase}: ${p.message}`)
  })
  crawler.onDone((r) => {
    console.log(`  [done] ${r.sourceId}: inserted=${r.inserted}, errors=${JSON.stringify(r.errors)}`)
  })

  try {
    const results = await crawler.start({ sourceIds: ['art-of-command-line'] })
    console.log('\n========== Final ==========')
    console.log(JSON.stringify(results, null, 2))
  } catch (err) {
    console.error('Failed:', err)
  }
}

main().catch(console.error)
