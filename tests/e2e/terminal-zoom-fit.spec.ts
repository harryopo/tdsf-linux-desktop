/**
 * 终端字号缩放后必须重算行列（回归判据）
 *
 * 用户报"放大后下面的内容就看不见了"。实测真因有两条，这条钉第二条：
 * Ctrl+ +/- 只改了 xterm 的 fontSize，没重算行列，也没回报 PTY 尺寸——
 * 格子变高而行数不变，终端就把容器一路撑到视口外（放大四次：容器 712→920px，
 * 底边越过视口 184px，24px 状态栏整个被顶没）。
 * 修好后同一动作：行高 24.57→32px，行数 28→21，容器底边始终停在视口 −24px。
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp } from './ssh-fixture-helpers'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
const testOrSkip = BUILD_READY ? test : test.skip

if (!BUILD_READY) {
  console.log('[terminal-zoom-fit] 跳过：需要先 pnpm build（out/main/index.js 不存在）。')
}

/**
 * 量终端容器与行几何：底边相对视口的位置、行数、行高。
 * 找不到节点时三项返回 null——不卡住就参与比较的话，JS 把 null 强转成 0，
 * "底边没越过视口""行高变大了"这类判据会静默空过，所以读数一律走 readGeometry()。
 */
type TermGeometry = {
  vh: number
  hostBottom: number | null
  rowCount: number | null
  cellHeight: number | null
}

/** 几何缺读要当场红，不许混进后面的数值比较 */
function num(v: number | null, label: string): number {
  if (v === null) {
    throw new Error(`终端几何没读到：${label}（.terminal-view.visible / .xterm-rows 在不在？）`)
  }
  return v
}

/** readGeometry 的返回：三项都已过非空卡口，可以直接参与数值比较 */
type Geometry = { vh: number; hostBottom: number; rowCount: number; cellHeight: number }

async function readGeometry(page: Page): Promise<Geometry> {
  const g = await page.evaluate<TermGeometry>(GEOMETRY)
  return {
    vh: g.vh,
    hostBottom: num(g.hostBottom, '容器底边'),
    rowCount: num(g.rowCount, '行数'),
    cellHeight: num(g.cellHeight, '行高'),
  }
}

const GEOMETRY = `(() => {
  const host = document.querySelector('.terminal-view.visible');
  const rows = host && host.querySelector('.xterm-rows');
  const first = rows && rows.querySelector(':scope > div');
  return {
    vh: window.innerHeight,
    hostBottom: host ? Math.round(host.getBoundingClientRect().bottom) : null,
    rowCount: rows ? rows.querySelectorAll(':scope > div').length : null,
    cellHeight: first ? Math.round(first.getBoundingClientRect().height * 100) / 100 : null,
  };
})()`

/** 状态栏高度（.wb-statusbar 取 --ui-size-statusbar），终端不得压到它下面 */
const STATUSBAR_GAP = 24

test.describe('终端字号缩放', () => {
  testOrSkip('Ctrl+ 放大后行数变少、底边不越出视口，Ctrl+0 还原', async () => {
    test.setTimeout(150_000)
    const { app, page } = await launchApp()
    try {
      await page.evaluate(() => {
        window.location.hash = '#/workbench'
      })
      await page.waitForSelector('.wb-main-layout', { timeout: 20000 })
      await page.getByRole('button', { name: '开一个本机终端', exact: true }).click()
      await expect(page.locator('.term-tab-item')).toHaveCount(1, { timeout: 20000 })
      await page.waitForSelector('.terminal-view.visible', { timeout: 20000 })
      await page.waitForTimeout(1500)

      const base = await readGeometry(page)
      expect(base.rowCount, '基线行数应已算出').toBeGreaterThan(5)
      expect(base.hostBottom).toBeLessThanOrEqual(base.vh - STATUSBAR_GAP)

      await page.click('.terminal-view.visible')
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Control+=')
        await page.waitForTimeout(250)
      }
      await page.waitForTimeout(1200)

      const zoomed = await readGeometry(page)
      // 格子的确变高了（否则这条判据测不到东西）
      expect(zoomed.cellHeight).toBeGreaterThan(base.cellHeight)
      // 行数必须跟着重算，容器底边不许压到状态栏下面
      expect(zoomed.rowCount, '字号放大后没重算行列——终端会把容器撑出视口').toBeLessThan(
        base.rowCount,
      )
      expect(zoomed.hostBottom, '终端底边越出视口，状态栏被顶没').toBeLessThanOrEqual(
        zoomed.vh - STATUSBAR_GAP,
      )

      await page.keyboard.press('Control+0')
      await page.waitForTimeout(1200)
      const reset = await readGeometry(page)
      expect(reset.cellHeight).toBe(base.cellHeight)
      expect(reset.rowCount).toBe(base.rowCount)
      expect(reset.hostBottom).toBeLessThanOrEqual(reset.vh - STATUSBAR_GAP)
    } finally {
      await app.close()
    }
  })
})
