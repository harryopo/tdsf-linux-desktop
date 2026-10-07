/**
 * shell-stability.spec.ts —— 外壳稳定性：反复切页不许崩、不许有未捕获异常
 *
 * 接替旧 electron.spec.ts 里两条至今仍有效的检查（那份其余用例写的是 antd 时代的
 * 选择器，改版后全部静默 skip，属于"看着有覆盖其实没跑"，已删除）。
 * 界面长什么样由 ui-audit --gate 与 button-truth-census 负责，这里只管两件事：
 *   1) 连续切页不炸；
 *   2) 渲染进程不许抛未捕获异常（pageerror）。
 */
import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { e2eProfileDir } from './ssh-fixture-helpers'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')
const testOrSkip = fs.existsSync(MAIN_ENTRY) ? test : test.skip

/** 与 e2e 其它 spec 一样隔离 userData，别把测试痕迹写进共享配置 */

/** 全站路由（hash），覆盖外壳的每个一级页面 */
const ROUTES = [
  '#/workbench',
  '#/tutorial',
  '#/decision',
  '#/monitor',
  '#/knowledge',
  '#/history',
  '#/logs',
  '#/settings/general',
]

async function launch() {
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${e2eProfileDir()}`],
    env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
  })
  const page = await app.firstWindow()
  await page.waitForSelector('body', { timeout: 30000 })
  return { app, page }
}

testOrSkip('连续两轮切页不崩，且没有未捕获异常', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launch()

  const pageErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(String(err)))

  // 进工作台（外壳挂载点）
  await page.evaluate(() => {
    window.location.hash = '#/workbench'
  })
  await page.waitForSelector('.wb-main-layout', { timeout: 15000 })

  for (const round of [1, 2]) {
    for (const route of ROUTES) {
      await page.evaluate((h) => {
        window.location.hash = h
      }, route)
      await page.waitForTimeout(120)
    }
    console.log(`[稳定] 第 ${round} 轮 ${ROUTES.length} 个页面切换完成`)
  }

  // 收尾必须还有一页在渲染：标题钩子是全站统一的，取不到就是白屏
  await page.evaluate(() => {
    window.location.hash = '#/workbench'
  })
  await page.waitForSelector('.wb-main-layout', { timeout: 15000 })
  const alive = await page.evaluate(() => document.querySelectorAll('*').length)
  expect(alive, '两轮切页后 DOM 不该空掉').toBeGreaterThan(50)

  expect(pageErrors, `切页过程中出现未捕获异常：\n${pageErrors.join('\n')}`).toEqual([])

  await app.close()
})

testOrSkip('教程页背景必须来自主题令牌（旧缺陷：深色模式下写死纯白）', async () => {
  test.setTimeout(60_000)
  const { app, page } = await launch()

  await page.evaluate(() => {
    window.location.hash = '#/tutorial'
  })
  // 用全站统一的标题钩子确认停在教程页，不再依赖改版前的 .tutorial-page
  await page.waitForSelector('[data-dom-id="page-title"]', { timeout: 15000 })
  const title = await page.locator('[data-dom-id="page-title"]').textContent()
  expect(title?.trim(), '应当停在教程页').toBe('运维教程')

  const probe = await page.evaluate(() => {
    const main = document.querySelector('main')
    if (!main) return null
    const cs = getComputedStyle(main)
    return {
      bg: cs.backgroundColor,
      canvasToken: getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim(),
      theme: document.documentElement.getAttribute('data-theme') ?? '',
    }
  })
  expect(probe, '教程页根元素 <main> 必须存在').not.toBeNull()
  console.log('[主题对账] theme =', probe!.theme, ' main 背景 =', probe!.bg, ' 令牌 --bg-primary =', probe!.canvasToken)

  expect(probe!.theme, '根元素必须带 data-theme，否则主题根本没落地').toMatch(/^(dark|light)$/)
  expect(probe!.canvasToken, '应能读到画布令牌（读不到说明令牌改名了，这条会假绿）').not.toBe('')

  // 颜色必须来自令牌，而不是组件里写死的白：旧缺陷就是深色主题下页面盖着一层纯白
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
  const tokenAsRgb = await page.evaluate((tok) => {
    const d = document.createElement('div')
    d.style.color = tok
    document.body.appendChild(d)
    const rgb = getComputedStyle(d).color
    d.remove()
    return rgb
  }, probe!.canvasToken)
  expect(norm(probe!.bg), `页面背景应等于令牌色 ${tokenAsRgb}`).toBe(norm(tokenAsRgb))

  if (probe!.theme === 'dark') {
    // 令牌本身也不该是白的：深色主题的画布令牌写成 #ffffff 说明主题串了
    const [r, g, b] = (tokenAsRgb.match(/\d+/g) ?? []).map(Number)
    expect(r === 255 && g === 255 && b === 255, `深色主题下画布不应是纯白（实测 ${tokenAsRgb}）`).toBe(false)
  }

  await app.close()
})

/**
 * 从旧 fixes-verification.spec.ts 的「修复 5」搬来：那条不依赖界面选择器，
 * 至今有效，跟着整份 antd 时代的选择器一起删掉太浪费，所以留在这里。
 */
testOrSkip('日志系统能记录并可读回（logStats / logRead）', async () => {
  test.setTimeout(60_000)
  const { app, page } = await launch()

  await page.evaluate(() => {
    window.location.hash = '#/workbench'
  })
  await page.waitForSelector('.wb-main-layout', { timeout: 15000 })

  const stats = await page.evaluate(async () => {
    const api = (window as unknown as { electronAPI: { logStats: () => Promise<{ total: number }> } }).electronAPI
    return api.logStats()
  })
  expect(typeof stats?.total, 'logStats 应返回条数').toBe('number')

  const recent = await page.evaluate(async () => {
    const api = (
      window as unknown as {
        electronAPI: {
          logRead: (f?: { limit?: number }) => Promise<Array<{ level: string; category: string; message: string }>>
        }
      }
    ).electronAPI
    return api.logRead({ limit: 20 })
  })
  expect(recent.length, '启动到工作台这一段日志不该是空的').toBeGreaterThan(0)
  const categories = new Set(recent.map((e) => e.category))
  expect(categories.size, '日志应带来源分类（否则筛不了）').toBeGreaterThan(0)
  console.log('[日志] 最近', recent.length, '条，分类：', [...categories].join(', '))

  await app.close()
})
