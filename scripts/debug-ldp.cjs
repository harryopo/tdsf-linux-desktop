// 单独跑 ldp-howtos 实时打印所有进度事件
const path = require('node:path')
const os = require('node:os')
const { DatabaseManager } = require('../src/main/services/db/database')
const { TutorialCrawlerService } = require('../src/main/services/tutorial/crawler/tutorial-crawler-service')

async function main() {
  const tmpDbPath = path.join(os.tmpdir(), `tdsf-ldp-${Date.now()}.db`)
  console.log(`[LDP] DB: ${tmpDbPath}`)
  const db = DatabaseManager.getInstance(tmpDbPath)
  const crawler = new TutorialCrawlerService(db, () => null)

  let lastProgress = ''
  crawler.onProgress((p) => {
    const line = `[${p.phase}] ${p.message}`
    if (line !== lastProgress) {
      console.log(line)
      lastProgress = line
    }
  })
  crawler.onDone((r) => {
    console.log(`\n[done] ${r.sourceId}: inserted=${r.inserted}, updated=${r.updated}, skipped=${r.skipped}, failed=${r.failed}, errors=${JSON.stringify(r.errors)}`)
  })

  console.log('[LDP] 启动抓取...')
  const start = Date.now()
  try {
    const results = await crawler.start({ sourceIds: ['ldp-howtos'] })
    console.log(`\n[LDP] 完成，耗时 ${(Date.now()-start)/1000}s`)
    console.log(JSON.stringify(results, null, 2))
  } catch (err) {
    console.error('[LDP] 异常:', err)
  }
}

main().catch(console.error)
