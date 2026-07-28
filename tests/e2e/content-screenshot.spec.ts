/**
 * content-screenshot.spec.ts — 真实内容截图验证（非占位核查）
 *
 * 目的：启动真实 Electron，逐页截图并断言"有真实内容、非占位/空白"。
 * 重点：知识库页面（修复空查询 bug 后应显示 10 篇内置教程种子）。
 *
 * 产物：tests/e2e/screenshots-content/*.png
 * 运行：pnpm build && npx playwright test tests/e2e/content-screenshot.spec.ts
 */
import { test, expect, _electron as electron } from '@playwright/test'
import type { Page } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')
const BUILD_READY = fs.existsSync(MAIN_ENTRY)
const testOrSkip = BUILD_READY ? test : test.skip
const SHOT_DIR = path.join(__dirname, 'screenshots-content')
fs.mkdirSync(SHOT_DIR, { recursive: true })

async function gotoRoute(window: Page, hash: string, ready: string) {
  await window.evaluate((h) => {
    window.location.hash = h
  }, hash)
  await window.waitForSelector(ready, { timeout: 15000 }).catch(() => {})
  await window.waitForTimeout(1500)
}

testOrSkip('逐页截图 + 知识库真实内容断言', async () => {
  test.setTimeout(180_000)
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
  })
  const window = await app.firstWindow()
  await window.waitForSelector('body', { timeout: 30000 })

  // ===== 知识库：修复后应显示内置教程种子（非空白） =====
  await gotoRoute(window, '#/knowledge', '.kb-page')
  await window.screenshot({ path: path.join(SHOT_DIR, 'knowledge.png'), fullPage: true })

  const kbCards = await window.locator('.kb-card').count()
  console.log(`[知识库] 卡片数量 = ${kbCards}`)
  // 修复空查询 bug 后，内置 10 篇教程种子应被 kbSearch('') 返回并渲染
  expect(kbCards, '知识库应显示真实条目（修复空查询后不再空白）').toBeGreaterThan(0)

  // 断言不是"未找到"空态
  const emptyVisible = await window
    .locator('text=未找到匹配的知识条目')
    .isVisible()
    .catch(() => false)
  expect(emptyVisible, '知识库不应显示空态').toBe(false)

  // ===== 其余关键页截图（人工核查是否占位） =====
  await gotoRoute(window, '#/workbench', '.wb-main-layout')
  await window.screenshot({ path: path.join(SHOT_DIR, 'workbench.png'), fullPage: true })

  await gotoRoute(window, '#/monitor', '.mon-main')
  await window.screenshot({ path: path.join(SHOT_DIR, 'monitor.png'), fullPage: true })

  await gotoRoute(window, '#/tutorial', 'main, body')
  await window.screenshot({ path: path.join(SHOT_DIR, 'tutorial.png'), fullPage: true })

  await gotoRoute(window, '#/settings/model', '.set-page, main')
  await window.screenshot({ path: path.join(SHOT_DIR, 'settings-model.png'), fullPage: true })

  console.log('截图已保存到: ' + SHOT_DIR)
  await app.close()
})
