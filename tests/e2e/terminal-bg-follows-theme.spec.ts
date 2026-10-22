/**
 * 终端底色真的跟着界面走（用户原话："终端的颜色不与其它的界面统一"）
 *
 * 单测那一条（tests/unit/terminal-color-single-source.test.ts）量的是表：
 * tdsf 色板的底色等于 --bg-primary。表对不代表接线对——xterm 是在创建时吃 theme、
 * 之后靠 setTheme 改的，浅色模式下界面整片白而中间一块黑，正是"表对线错"那种。
 * 所以这里真起应用、真开一个本机终端，量屏幕上算出来的颜色。
 *
 * 判据四条，缺一不可：
 *   1. 深色模式下，终端绘制层的底色 == 画布令牌 --bg-primary
 *   2. 切到浅色模式后，同一个活着的终端仍然 == 当时的画布令牌
 *   3. 两次读数必须不同（阳性对照：终端若根本没跟着改，前两条会同时"过"在
 *      同一个值上，是这条把它逼红）
 *   4. 终端那一格（.term-panel）与绘制层同色——不然终端四周露出一圈别的深浅
 *
 * 明暗两档都由用例自己点设置页切，不靠系统默认值——系统偏浅时"深色下"这个说法
 * 当场就是假的。
 *
 * 跑法：pnpm build && npx playwright test tests/e2e/terminal-bg-follows-theme.spec.ts
 */
import { test, expect, _electron as electron } from '@playwright/test'
import type { Page } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'
import { e2eProfileDir } from './ssh-fixture-helpers'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')
const BUILD_READY = fs.existsSync(MAIN_ENTRY)
const testOrSkip = BUILD_READY ? test : test.skip

/** 屏幕上量一次：画布令牌 + 终端各层算出来的底色 */
interface BgReading {
  token: string
  /** xterm 外层容器（实测常年是内建黑，不参与断言，只留着看现场） */
  xterm: string
  /** 真正绘制底色的那一层 */
  viewport: string
  screen: string
  /** 终端那一格自己的底色（终端四周露出的那圈就是它） */
  panel: string
}

/**
 * 颜色归一：#fff / #FFF / rgb(255,255,255) 都得落到 #ffffff。
 *
 * 不这么做的话令牌读回来是 CSS 里写的三位缩写、计算样式是六位，
 * 两边"看着一样"却判不相等——第一版就是这么把一条好判据量成红的。
 */
function normalizeHex(raw: string): string {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(raw)
  if (m) {
    return '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('')
  }
  const hex = raw.trim().toLowerCase()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(hex)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  return hex
}

async function readBackgrounds(page: Page): Promise<BgReading> {
  return page.evaluate(() => {
    const pick = (sel: string): string => {
      const el = document.querySelector(sel)
      return el ? getComputedStyle(el).backgroundColor : 'missing'
    }
    return {
      token: getComputedStyle(document.documentElement).getPropertyValue('--bg-primary'),
      xterm: pick('.xterm'),
      viewport: pick('.xterm-viewport'),
      screen: pick('.xterm-screen'),
      panel: pick('.term-panel'),
    }
  }).then((r) => ({
    token: normalizeHex(r.token),
    xterm: normalizeHex(r.xterm),
    viewport: normalizeHex(r.viewport),
    screen: normalizeHex(r.screen),
    panel: normalizeHex(r.panel),
  }))
}

/** 有终端就用它（换主题不换终端才量得到 setTheme 那条路），没有就从空态开一个 */
async function ensureTerminal(page: Page): Promise<void> {
  const term = page.locator('.xterm').first()
  if (await term.isVisible().catch(() => false)) {
    await term.waitFor({ state: 'visible', timeout: 20000 })
    return
  }
  const btn = page.getByRole('button', { name: /开一个本机终端/ })
  await expect(btn, '工作台空态里该有"开一个本机终端"').toBeVisible({ timeout: 15000 })
  await btn.click()
  await page.waitForSelector('.xterm', { timeout: 20000 })
}

async function gotoHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => {
    window.location.hash = h
  }, hash)
}

/** 在外观设置页点明暗档位 */
async function pickThemeMode(page: Page, name: string): Promise<void> {
  await gotoHash(page, '#/settings/appearance')
  // 按角色 + 无障碍名认这一格，不按可见文本：当前档位那一格会额外挂一个同名标签，
  // 用 getByText 在"已经是深色"的状态下会命中 2 个元素——判据就随上一次跑剩的主题变色。
  const card = page.getByRole('button', { name: new RegExp(name) })
  await expect(card, `外观设置里"${name}"这一格该有且只有一格`).toHaveCount(1, { timeout: 15000 })
  await card.click()
  await page.waitForTimeout(500)
}

/** 轮询等底色落定（setTheme 是异步的，别睡固定秒） */
async function waitForTerminalBg(page: Page, modeName: string): Promise<BgReading> {
  let reading = await readBackgrounds(page)
  for (let i = 0; i < 24 && reading.viewport !== reading.token; i++) {
    await page.waitForTimeout(250)
    reading = await readBackgrounds(page)
  }
  expect(
    reading.viewport,
    `${modeName}下终端绘制层底色该等于画布令牌 ${reading.token}（现场 xterm=${reading.xterm} screen=${reading.screen}）`,
  ).toBe(reading.token)
  // 第四条（2026-10-16 补）：终端那一格自己也得是同一个色。
  // 前三条只量了"终端 vs 令牌"，量不到终端四周那圈容器——浅色档那圈是 #f6f8fa、
  // 终端是 #ffffff，用户看到的"终端和两边的颜色有色差"正是这条缝，当时没有判据拦得住。
  expect(
    reading.panel,
    `${modeName}下终端格底色与终端绘制层不一致，四周会露出一圈不同深浅的边（panel=${reading.panel}）`,
  ).toBe(reading.viewport)
  return reading
}

test.describe('终端底色跟随界面明暗', () => {
  testOrSkip('深色→浅色：同一个活终端的底色始终等于画布令牌，且两次读数确实变了', async () => {
    test.setTimeout(180_000)
    const app = await electron.launch({
      args: [MAIN_ENTRY, `--user-data-dir=${e2eProfileDir()}`],
      env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
    })
    const win: Page = await app.firstWindow()
    await win.waitForSelector('body', { timeout: 30000 })

    await pickThemeMode(win, '深色模式')
    await gotoHash(win, '#/workbench')
    await win.waitForSelector('.wb-main-layout', { timeout: 20000 })
    await ensureTerminal(win)
    const dark = await waitForTerminalBg(win, '深色')
    expect(dark.viewport, '量具得真量到东西（missing 说明终端没画出来）').not.toBe('missing')
    await win.screenshot({ path: path.join(__dirname, '../../test-results/term-bg-dark.png') })

    await pickThemeMode(win, '浅色模式')
    await gotoHash(win, '#/workbench')
    await win.waitForSelector('.wb-main-layout', { timeout: 20000 })
    await ensureTerminal(win)
    const light = await waitForTerminalBg(win, '浅色')
    await win.screenshot({ path: path.join(__dirname, '../../test-results/term-bg-light.png') })

    // 阳性对照：两档令牌本身必须不同，终端也得真的跟着换了色
    expect(light.token, '画布令牌自己都没换，说明主题没切过去').not.toBe(dark.token)
    expect(light.viewport, '终端没跟着换色 = 用户看到的那块黑钉在白面板上').not.toBe(dark.viewport)

    await app.close()
  })
})
