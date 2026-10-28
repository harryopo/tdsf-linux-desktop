/**
 * fresh-install-empty.spec.ts —— 全新装机（空库）不许有任何"看起来像数据"的占位（2026-10-28，#256）
 *
 * 用户原话：「我一个全新的软件的日志应该是空白的而不是展示占位符吧」。
 * 这条用**全新的临时档位**起一次真窗口，逐页验收"空就是空"：
 *   1. 决策页：出现「暂无决策记录」，0 张决策卡
 *   2. 历史页：四个统计是 0 / —，**统计卡里一条 sparkline 都不许画**
 *      （改前会画 `0,24 100,24` 的贴底基线，看起来像"有数据、全是 0"）
 *   3. 系统日志页：显示的是**本进程自己写的启动日志**（有真实时间戳），
 *      且全页不出现"示例 / prod-web / demo-"这类设计稿残留
 *   4. 三页都不出现"假主机名"（prod-web-01 / demo-host 之类）
 *
 * 为什么单开一条：视觉基线只比像素、单测只测纯函数，"空库第一屏"这一面一直没人真起过。
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, type ElectronApplication } from '@playwright/test'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')
const BUILD_READY = fs.existsSync(MAIN_ENTRY)
if (!BUILD_READY) console.log('[fresh-empty] 跳过：缺 out/main/index.js，先 pnpm build')
const testOrSkip = BUILD_READY ? test : test.skip

/** 设计稿里曾经出现过的假主机名；任何一页出现都说明有示例数据漏回来了 */
const FAKE_HOSTS = /prod-web|demo-host|example\.com|示例数据/

async function goto(page: Page, hash: string, wait: string): Promise<void> {
  await page.evaluate((h) => (window.location.hash = h), hash)
  await page.waitForSelector(wait, { timeout: 20_000 })
  await page.waitForTimeout(800)
}

test.describe('全新档位的空态', () => {
  let app: ElectronApplication
  let page: Page
  let profile: string

  test.beforeAll(async () => {
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-e2e-fresh-'))
    app = await electron.launch({
      args: [MAIN_ENTRY, `--user-data-dir=${profile}`],
      env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
    })
    page = await app.firstWindow()
    await page.waitForSelector('body', { timeout: 30_000 })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForSelector('.wb-main-layout', { timeout: 30_000 })
  })

  test.afterAll(async () => {
    await app?.close()
    if (profile) fs.rmSync(profile, { recursive: true, force: true })
  })

  testOrSkip('决策页：明确说"暂无决策记录"，没有卡片', async () => {
    await goto(page, '#/decision', '[data-dom-id="page-title"]')
    const text = await page.evaluate(() => document.body.innerText)
    expect(text).toContain('暂无决策记录')
    expect(text).not.toMatch(FAKE_HOSTS)
    // 卡片数量直接问数据源：空库时 historyList 必须回空数组（页面渲染的是它的投影）
    const cards = await page.evaluate(async () => {
      const api = (window as unknown as {
        electronAPI: { historyList?: (o: number, l: number) => Promise<unknown[]> }
      }).electronAPI
      if (!api.historyList) throw new Error('historyList 不可用：判据没法证明"库里是空的"')
      return (await api.historyList(0, 20)).length
    })
    expect(cards, '空库不该有决策卡').toBe(0)
  })

  testOrSkip('历史页：统计是 0 / —，而且一条 sparkline 都不画', async () => {
    await goto(page, '#/history', '.hist-page')
    const text = await page.evaluate(() => document.body.innerText)
    expect(text).toContain('还没有决策记录')
    expect(text).toContain('总决策数')
    expect(text).not.toMatch(FAKE_HOSTS)

    const readings = await page.evaluate(() => {
      const values = [...document.querySelectorAll('.hist-stat-value, [class*="stat-value"]')]
        .map((e) => (e.textContent || '').trim())
        .filter(Boolean)
      // 只取统计卡里那张 sparkline（svg viewBox 0 0 100 24）；
      // 空态插画里的图标也是 polyline，按全页取会误伤
      const polylines = [...document.querySelectorAll('.hist-page .hist-stat-spark polyline')]
        .map((p) => p.getAttribute('points'))
        .filter((v): v is string => !!v)
      return { values, polylines }
    })
    expect(readings.values.length, '统计卡没取到值，判据等于空过').toBeGreaterThanOrEqual(4)
    expect(readings.values.slice(0, 4), '空库的四个统计应是 0 / — / — / —').toEqual(['0', '—', '—', '—'])
    expect(
      readings.polylines,
      '空库仍画了 sparkline：贴底的"基线"看起来像有数据（改前就是这个）'
    ).toEqual([])
  })

  testOrSkip('系统日志页：显示本进程真日志，不出现示例/假主机名', async () => {
    await goto(page, '#/logs', 'body')
    const readings = await page.evaluate(() => {
      const text = document.body.innerText
      const rows = [...document.querySelectorAll('.log-row, tbody tr, [class*="log-line"]')]
      const withTime = rows.filter((r) => /\d{2}:\d{2}:\d{2}/.test(r.textContent || '')).length
      return { text, rowCount: rows.length, withTime }
    })
    expect(readings.text).not.toMatch(FAKE_HOSTS)
    // 全新档位也应看到本进程的启动日志——这证明这一页读的是真日志文件，不是空壳
    expect(readings.text, '看不到启动日志，说明日志页没读到真文件').toMatch(/Logger 初始化完成|TDSF-Linux Desktop 启动/)
    expect(readings.rowCount, '日志行数为 0，判据没法证明"显示的是真数据"').toBeGreaterThan(0)
    expect(readings.withTime, '日志行没有真实时间戳，可能不是日志文件里读出来的').toBeGreaterThan(0)
  })
})
