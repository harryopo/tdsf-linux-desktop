/**
 * visual.spec.ts —— 界面视觉基线对比（本机尺子，不进 CI）
 *
 * 与 acceptance-screenshots 的分工：那份只「拍下来给人看」，这一份「和历史基线比像素」，
 * 用来拦住改了样式自己没发现的情况。
 *
 * 基线不入库（.gitignore 已忽略 visual.spec.ts-snapshots/）：截图带了操作系统字体渲染，
 * 换台机器就会误报。所以基线是本机生成的尺子，不是仓库资产。
 * 一条基线都没有时整份跳过并打印生成命令，不让首次检出的人收到一排红；
 * 只缺某一页的基线则那一条会红，意思就是"这页要重新生成基线"。
 *
 * 启动页（boot）与系统日志页不在这里比：前者是一帧 shader 动画，同页两次截图就不一致；
 * 后者显示的是真实日志，每跑一次就多几条，像素尺子量它必然抖（实测 2288 像素差）。
 * 日志页的内容正确性由 shell-stability 的 logStats/logRead 负责，画面由 acceptance 截图负责。
 *
 * 用法：
 *   pnpm build
 *   pnpm test:e2e:visual --update-snapshots   # 生成/更新本机基线
 *   pnpm test:e2e:visual                       # 与基线对比
 */
import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp } from './ssh-fixture-helpers'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')
const SNAP_DIR = path.join(__dirname, 'visual.spec.ts-snapshots')

/** 与设计稿画布一致，保证不同页面的截图可比 */
const VIEWPORT = { width: 1440, height: 900 }

interface Shot {
  /** 基线文件名主干，也是快照里的标识 */
  key: string
  /** 路由 */
  hash: string
  /** 这条路由就绪的钩子（必须是源码里存在的类名或 data-dom-id） */
  wait: string
  /**
   * 页面上"由当前时刻算出来"的文本，比对时遮掉。
   * 不加宽容比：整体容差会把真回归一起放过（见下面 toHaveScreenshot 的注释），
   * 而按元素遮罩只吃掉这一小块。锚点丢了会直接红，不会退化成"明天又红在日期上"。
   */
  volatile?: string[]
}

const SHOTS: Shot[] = [
  { key: 'workbench', hash: '#/workbench', wait: '.wb-main-layout' },
  { key: 'tutorial', hash: '#/tutorial', wait: '.tut-page' },
  { key: 'decision', hash: '#/decision', wait: '[data-dom-id="page-title"]' },
  { key: 'history', hash: '#/history', wait: '.hist-page' },
  { key: 'monitor', hash: '#/monitor', wait: '[data-dom-id="page-title"]' },
  { key: 'knowledge', hash: '#/knowledge', wait: '.kb-page' },
  {
    key: 'settings',
    hash: '#/settings/general',
    wait: '.set-page',
    volatile: ['[data-dom-id="scheduler-task-list"] .scheduler-time-cell'],
  },
]

function hasBaseline(key: string): boolean {
  if (!fs.existsSync(SNAP_DIR)) return false
  return fs.readdirSync(SNAP_DIR).some((f) => f.startsWith(`${key}-electron-`) && f.endsWith('.png'))
}

const BUILD_READY = fs.existsSync(MAIN_ENTRY)
const ANY_BASELINE = SHOTS.some((s) => hasBaseline(s.key))

const SKIP_REASON = !BUILD_READY
  ? '缺 out/main/index.js：视觉基线跑的是构建产物，先 pnpm build'
  : !ANY_BASELINE
    ? '本机还没有基线：先跑 pnpm test:e2e:visual --update-snapshots 生成，再跑本条做对比'
    : ''

// 跳过原因要出现在终端里：只在 HTML 报告里写原因，跑全量 e2e 的人只会看到一排 skipped 而不知道为什么。
if (SKIP_REASON) console.log(`[visual] 跳过：${SKIP_REASON}`)

test.describe('视觉基线对比', () => {
  test.skip(!!SKIP_REASON, SKIP_REASON)

  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    const launched = await launchApp()
    app = launched.app
    page = launched.page
    await page.setViewportSize(VIEWPORT)
  })

  test.afterAll(async () => {
    await app?.close()
  })

  for (const shot of SHOTS) {
    test(`视觉 ${shot.key}`, async () => {
      // 逐条查基线，不能只看"本机至少有一条"：少的那一条会被 Playwright 顺手生成并当场判绿，
      // 而基线目录在 .gitignore 第 86 行里，别的机器上根本没有对照物。
      if (!hasBaseline(shot.key)) {
        console.log(`[visual] 跳过 ${shot.key}：本机没有这条基线（基线未入库，生成用 --update-snapshots）`)
        test.skip(true, `本机没有 ${shot.key} 的基线，没有可比对象`)
      }
      await page.evaluate((hash) => {
        window.location.hash = hash
      }, shot.hash)
      await page.waitForSelector(shot.wait, { timeout: 20000 })
      // 等 page-enter 动画走完，否则截到淡入中途
      await page.waitForTimeout(1200)
      const masks: Locator[] = []
      for (const anchor of shot.volatile ?? []) {
        if ((await page.locator(anchor).count()) === 0) {
          throw new Error(`视觉遮罩锚点不见了：${anchor} —— 元素被改名/删掉就会退化成"隔天红在日期上"`)
        }
        masks.push(page.locator(anchor))
      }
      await expect(page).toHaveScreenshot(`${shot.key}.png`, {
        // 不设宽容比。2026-10-07 实测：这些页面彼此整体只差 3%~9%（外壳占大头，路由区很小），
        // 原来写的 0.1 等于把闸调成摆设——互换两页基线照样报绿。
        // 光标与动画会制造无意义抖动，所以按像素对齐把它们关掉。
        caret: 'hide',
        animations: 'disabled',
        mask: masks
      })
    })
  }
})
