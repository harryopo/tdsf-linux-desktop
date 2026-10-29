/**
 * 教程的内容管线收口（#211：抓取 / 回填 / 磁盘 / 断点 那 19 把键整删）
 *
 * 取证（2026-10-24）：教程页真在调的只有八把（列表、单篇、关键词、分类、混合检索、
 * 路径推荐、进度读、进度写）。其余十九把是"内容从哪来"这一侧的管理面：
 * 抓取（crawlStart/Status/Cancel/Progress/Done/listSources）、磁盘与孤儿清理（diskInfo /
 * cleanupOrphans）、断点续传（checkpoints / resetCheckpoint）、异步回填
 * （backfillStart/Cancel/Status/Progress 与旧的 backfill-embeddings）、
 * 种子版本与重载（seedVersion / seedReload）、检索状态（searchStatus）、统计（stats）。
 * 十九把在渲染层零调用，界面上从来没有"抓取管理"这一格。
 *
 * 教程内容不需要爬虫：现成的种子与知识库导入（#180）就是它的来源。
 * 所以这一批删的是整条抓取/回填链（含 crawler 目录、backfill-service、crawler-types
 * 与那批只能手工跑的一次性脚本），不是"先把入口藏起来"——留着就是 AGENTS.md 说的半态。
 *
 * 判据各钉一件事：
 * 1. 暴露面里那十九把不许回来，八把真在用的不许误砍（双向）
 * 2. 主进程只注册那八条 tutorial 通道
 * 3. 抓取与回填的实现体不许回来（目录、服务、共享类型、一次性脚本）
 * 4. 反过度砍：向量检索那条链的六个模块与它们各自的活消费者都还在
 * 5. 注册函数不再收窗口参数（窗口引用只为爬虫进度推送而存在）
 */
import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import * as ts from 'typescript'
import { TUTORIAL } from '@shared/ipc-channels'
import { listSourceFiles, readSourceFile } from '../helpers/source-scan'

const ROOT = path.resolve(__dirname, '../..')

/** 这十九把键是本轮判掉的，任何一把回来都算回涨 */
const BANNED_KEYS = [
  'tutorialSeedVersion',
  'tutorialSeedReload',
  'tutorialListSources',
  'tutorialCrawlStart',
  'tutorialCrawlStatus',
  'tutorialCrawlCancel',
  'onTutorialCrawlProgress',
  'onTutorialCrawlDone',
  'tutorialDiskInfo',
  'tutorialCleanupOrphans',
  'tutorialCheckpoints',
  'tutorialResetCheckpoint',
  'tutorialSearchStatus',
  'tutorialBackfillEmbeddings',
  'tutorialBackfillStart',
  'tutorialBackfillCancel',
  'tutorialBackfillStatus',
  'onTutorialBackfillProgress',
  'tutorialStats',
]

/** 教程页真在按的八把 */
const KEPT_KEYS = [
  'tutorialList',
  'tutorialGet',
  'tutorialSearch',
  'tutorialCategories',
  'tutorialHybridSearch',
  'tutorialRecommendPath',
  'tutorialProgress',
  'tutorialUpdateProgress',
]

const KEPT_CHANNELS = [
  'tutorial:categories',
  'tutorial:get',
  'tutorial:hybrid-search',
  'tutorial:list',
  'tutorial:progress',
  'tutorial:recommend-path',
  'tutorial:search',
  'tutorial:updateProgress',
]

function exposedKeys(): string[] {
  return readSourceFile(path.join(ROOT, 'tests/unit/__fixtures__/preload-api-surface.txt'))
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/** 抓 src/main/ipc/tutorial.ts 里每个 ipcMain.handle 的通道名（字面量或 TUTORIAL.X 常量） */
function registeredChannels(): string[] {
  const rel = 'src/main/ipc/tutorial.ts'
  const src = readSourceFile(path.join(ROOT, rel))
  const file = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true)
  const out: string[] = []
  const walk = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'handle' &&
      node.arguments.length > 0
    ) {
      const a = node.arguments[0]
      if (ts.isStringLiteral(a)) out.push(a.text)
      else if (ts.isPropertyAccessExpression(a) && a.name.text) {
        // 常量名一律回单源取真值（TUTORIAL.UPDATE_PROGRESS → tutorial:updateProgress），
        // 不许在这里照名字猜——猜出来的形状与通道真值分叉，这条判据就成了假红/假绿源
        const value = TUTORIAL[a.name.text as keyof typeof TUTORIAL]
        out.push(value ?? `未知常量 TUTORIAL.${a.name.text}`)
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(file)
  return out.sort()
}

describe('教程内容管线收口（#211）', () => {
  it('1. 十九把键不许回来，八把真在用的还在（双向：不许误砍）', () => {
    const keys = exposedKeys()
    const back = BANNED_KEYS.filter((k) => keys.includes(k))
    expect(back, '这些 tutorial 键又回来了').toEqual([])
    for (const kept of KEPT_KEYS) {
      expect(keys, `误砍了真在用的 ${kept}，教程页会直接坏`).toContain(kept)
    }
  })

  it('2. 主进程只注册那八条 tutorial 通道', () => {
    expect(registeredChannels()).toEqual(KEPT_CHANNELS)
  })

  it('3. 抓取与回填的实现体不许回来', () => {
    const gone = [
      'src/main/services/tutorial/crawler/tutorial-crawler-service.ts',
      'src/main/services/tutorial/crawler/polite-fetch.ts',
      'src/main/services/tutorial/backfill-service.ts',
      'src/shared/crawler-types.ts',
      'scripts/crawl-to-prod-db.ts',
      'scripts/crawl-e2e-verify.ts',
    ]
    for (const rel of gone) {
      expect(readSourceFile(path.join(ROOT, rel)), `${rel} 又出现在盘上`).toBe('')
    }
    // 任何还在源码里 import 它们的地方都是悬空引用。
    // 只按 import 取数，不按"正文里有没有这几个词"——注释里讲删了什么不该被判成引用。
    const hits: string[] = []
    const importRe = /(?:from|require\()\s*['"][^'"]*(?:tutorial\/crawler|backfill-service|crawler-types)['"]/
    for (const abs of listSourceFiles(path.join(ROOT, 'src'))) {
      if (importRe.test(readSourceFile(abs))) {
        hits.push(path.relative(ROOT, abs).split(path.sep).join('/'))
      }
    }
    expect(hits, '这些文件还 import 着抓取/回填链').toEqual([])
  })

  it('4. 反过度砍：向量检索那条链的模块与活消费者都还在', () => {
    const keep = [
      'src/main/services/tutorial/embedding-service.ts',
      'src/main/services/tutorial/embedding-model.ts',
      'src/main/services/tutorial/hybrid-search.ts',
      'src/main/services/tutorial/seed-loader.ts',
      'src/main/services/tutorial/tutorial-repo.ts',
      'src/main/services/tutorial/path-recommender.ts',
    ]
    for (const rel of keep) {
      expect(readSourceFile(path.join(ROOT, rel)), `${rel} 被一起带走了`).not.toBe('')
    }
    // 各自的真消费者：知识库向量、混合检索、启动种子、AI 工具与教程页那八条通道
    for (const [file, needle] of [
      ['src/main/services/knowledge/kb-embedding.ts', 'embedding-service'],
      ['src/main/services/knowledge/kb-search.ts', 'hybrid-search'],
      ['src/main/index.ts', 'seed-loader'],
      ['src/main/core/agent/supervisor.ts', 'tutorial-repo'],
      ['src/main/ipc/tutorial.ts', 'path-recommender'],
    ] as const) {
      expect(
        readSourceFile(path.join(ROOT, file)),
        `${file} 不再引 ${needle}：这条链断了，上面那句"还在"就是假的`
      ).toContain(needle)
    }
  })

  it('5. 注册函数不再收窗口参数（窗口引用只为爬虫推送而存在）', () => {
    const rel = 'src/main/ipc/tutorial.ts'
    const src = readSourceFile(path.join(ROOT, rel))
    const file = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true)
    let params: string[] = []
    let found = false
    const walk = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'registerTutorialIpcHandlers') {
        found = true
        params = node.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : '?'))
      }
      ts.forEachChild(node, walk)
    }
    walk(file)
    expect(found, '没扫到 registerTutorialIpcHandlers').toBe(true)
    expect(params, '窗口参数还在——爬虫推送走了，它没有别的用处').toEqual(['db'])
    expect(readSourceFile(path.join(ROOT, 'src/main/ipc/index.ts'))).toContain(
      'registerTutorialIpcHandlers(db)'
    )
  })
})
