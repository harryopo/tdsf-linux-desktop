/**
 * 教程爬虫服务实例的生命周期（#95 的「crawler 实例替换」）
 *
 * 要钉住的那件事：`registerTutorialIpcHandlers` 会被调用**两次** ——
 * `src/main/index.ts` 的 `handleActivate()`（macOS dock 点击且窗口数为 0）会再走一遍
 * `registerAllIpcHandlers`。旧写法在函数体里 `new TutorialCrawlerService(...)`，
 * 于是第二次注册换了一只新实例：正在跑的那次抓取成了孤儿。
 *
 * 这里不拿"构造函数调用了几次"当结论（那是钉实现），而是断**界面读到的状态**：
 * 换了窗口之后，`tutorial:crawlStatus` 仍然报告那只在跑的爬虫，`tutorial:crawlCancel`
 * 真的能把那只停下。这两条在旧代码上必红。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TUTORIAL } from '@shared/ipc-channels'
import type { DatabaseManager } from '../../src/main/services/db/database'

type Listener = (event: unknown, ...args: unknown[]) => unknown
const handlers: Record<string, Listener> = {}

vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain: {
    handle: (channel: string, listener: Listener) => {
      handlers[channel] = listener
    },
    removeHandler: () => undefined
  }
}))

vi.mock('../../src/main/services/log/logger', () => ({
  logger: { error: () => undefined, warn: () => undefined, info: () => undefined }
}))

/** 替身实例对外暴露的那几项，够本文件断言用 */
interface FakeInstance {
  running: boolean
  cancelCount: number
  history: string[]
  getMainWindow: () => unknown
}

/**
 * 替身与登记簿都放在 vi.hoisted 里：`vi.mock` 的工厂会被提到文件最前面执行，
 * 类若写在下面，工厂运行时它还没初始化（实测报 "Cannot access before initialization"）。
 * 替身只保留本用例需要的行为：running 标志 + 取消计数 + 记住构造时拿到的窗口取函数。
 */
const { crawlerRegistry, FakeCrawlerService } = vi.hoisted(() => {
  const crawlerRegistry: FakeInstance[] = []
  class Fake {
    running = false
    cancelCount = 0
    history: string[] = []
    constructor(
      readonly _db: unknown,
      readonly getMainWindow: () => unknown
    ) {
      crawlerRegistry.push(this)
    }
    listSources() {
      return []
    }
    getStatus() {
      return { running: this.running, history: this.history }
    }
    async start() {
      this.running = true
      return []
    }
    cancel() {
      this.cancelCount += 1
      this.running = false
    }
    async getDiskInfo() {
      return { bytes: 0 }
    }
    async cleanupOrphans() {
      return 0
    }
    getCheckpoints() {
      return []
    }
    resetCheckpoint() {
      return undefined
    }
  }
  return { crawlerRegistry, FakeCrawlerService: Fake }
})

vi.mock('../../src/main/services/tutorial/crawler/tutorial-crawler-service', () => ({
  TutorialCrawlerService: FakeCrawlerService
}))
vi.mock('../../src/main/services/tutorial/tutorial-repo', () => ({
  TutorialRepository: class {
    listAll() {
      return []
    }
  }
}))
vi.mock('../../src/main/services/tutorial/embedding-service', () => ({
  EmbeddingService: { getInstance: () => ({ isLoaded: () => false }) },
  EMBEDDING_DIM: 512
}))
vi.mock('../../src/main/services/tutorial/backfill-service', () => ({
  EmbeddingBackfillService: {
    getInstance: () => ({
      start: async () => undefined,
      cancel: () => undefined,
      getStatus: () => ({ running: false })
    })
  },
  DEFAULT_PAGE_SIZE: 50,
  DEFAULT_INFERENCE_BATCH: 16
}))
vi.mock('../../src/main/services/tutorial/path-recommender', () => ({
  PathRecommender: class {
    recommend() {
      return []
    }
  }
}))
vi.mock('../../src/main/services/tutorial/seed-loader', () => ({
  loadTutorialSeeds: () => undefined,
  getSeedVersion: () => 'test'
}))

const db = {} as DatabaseManager
const win1 = { isDestroyed: () => false }
const win2 = { isDestroyed: () => false }

function invoke<T = unknown>(channel: string, ...args: unknown[]): T {
  const listener = handlers[channel]
  if (!listener) throw new Error(`通道 ${channel} 没有注册 handler`)
  return listener({}, ...args) as T
}

/**
 * `tutorial.ts` 的爬虫实例是**模块级**的（这正是本次修复要的性质），
 * 所以每条用例都要拿一个全新的模块，否则第二条开始读到的是上一条留下的实例。
 */
beforeEach(async () => {
  crawlerRegistry.length = 0
  for (const k of Object.keys(handlers)) delete handlers[k]
  vi.resetModules()
})

async function register(): Promise<typeof import('../../src/main/ipc/tutorial')['registerTutorialIpcHandlers']> {
  const mod = await import('../../src/main/ipc/tutorial')
  return mod.registerTutorialIpcHandlers
}

describe('二次注册不许换掉正在跑的爬虫', () => {
  it('换窗口之后 crawlStatus 仍报那只爬虫在跑（旧写法在这里会报 idle）', async () => {
    const reg = await register()
    reg(db, win1 as never)
    invoke(TUTORIAL.CRAWL_START, {})
    expect(crawlerRegistry[0].running).toBe(true)

    // 这就是 handleActivate 的路径：整批 handler 用新窗口再注册一次
    reg(db, win2 as never)

    expect(invoke<{ running: boolean }>(TUTORIAL.CRAWL_STATUS).running).toBe(true)
    expect(crawlerRegistry).toHaveLength(1)
  })

  it('crawlCancel 取消掉的就是那只正在跑的（旧写法会把取消送给空实例）', async () => {
    const reg = await register()
    reg(db, win1 as never)
    invoke(TUTORIAL.CRAWL_START, {})
    reg(db, win2 as never)

    invoke(TUTORIAL.CRAWL_CANCEL)
    expect(crawlerRegistry[0].cancelCount).toBe(1)
    expect(invoke<{ running: boolean }>(TUTORIAL.CRAWL_STATUS).running).toBe(false)
  })

  it('窗口引用会换绑到新窗口：孤儿实例不再对着已销毁的窗口推进度', async () => {
    const reg = await register()
    reg(db, win1 as never)
    const getter = crawlerRegistry[0].getMainWindow
    expect(getter()).toBe(win1)

    reg(db, win2 as never)
    expect(getter()).toBe(win2)

    win2.isDestroyed = () => true
    expect(getter()).toBeNull()
  })

  it('反向对照：单次注册的常规路径没被这次改动碰坏', async () => {
    const reg = await register()
    reg(db, win1 as never)
    expect(invoke(TUTORIAL.LIST_SOURCES)).toEqual([])
    expect(invoke(TUTORIAL.CRAWL_STATUS)).toEqual({ running: false, history: [] })
    expect(crawlerRegistry).toHaveLength(1)
  })
})
