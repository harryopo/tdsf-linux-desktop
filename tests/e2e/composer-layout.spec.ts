/**
 * composer-layout.spec.ts —— AI 输入区排版的真窗口判据（面板第④笔 #253）
 *
 * 为什么单独一条：输入区是唯一"每轮都要用"的东西，它的层次错了，整个面板的观感就跟着错。
 * 这次改的是两件事，都得在真窗口里量，jsdom 量不到布局：
 *   1. **快捷排挪到输入框下方**——它原来压在输入框上面，等于把"上一条回答"和"你在哪儿打字"
 *      中间塞了一排辅助按钮；主表面（输入框）该在上面，辅助的排下面。
 *   2. **点快捷排填进来的是单源那一句**——正文只有一份（`QUICK_PROMPTS`），
 *      欢迎态与快捷排都只引用键。这条在真窗口端到端走一遍：点 → store → Composer → 输入框。
 *
 * 运行：pnpm build && npx playwright test tests/e2e/composer-layout.spec.ts
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp } from './ssh-fixture-helpers'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')
const READY = fs.existsSync(MAIN_ENTRY)
if (!READY) console.log('[composer-layout] 跳过：缺 out/main/index.js，先 pnpm build')
const testOrSkip = READY ? test : test.skip

async function ensurePanelOpen(page: Page): Promise<void> {
  const composer = page.locator('#ai-composer-input')
  if (await composer.isVisible().catch(() => false)) return
  await page.locator('[data-dom-id="btn-toggle-ai"]').click()
  await composer.waitFor({ state: 'visible', timeout: 10_000 })
}

test.describe('AI 输入区排版', () => {
  test.describe.configure({ mode: 'serial' })

  testOrSkip('快捷排在输入框下方，不再把上一条回答和输入区分开', async () => {
    const { app, page } = await launchApp()
    await page.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await page.waitForSelector('.wb-main-layout', { timeout: 20_000 })
    await ensurePanelOpen(page)

    const input = page.locator('#ai-composer-input')
    const rail = page.locator('.ai-composer-rail')
    await expect(input, '输入框没画出来').toBeVisible({ timeout: 10_000 })
    await expect(rail, '快捷排没画出来').toBeVisible({ timeout: 10_000 })

    const inputBox = await input.boundingBox()
    const railBox = await rail.boundingBox()
    expect(inputBox, '量不到输入框的位置').not.toBeNull()
    expect(railBox, '量不到快捷排的位置').not.toBeNull()
    // 输入框整块在快捷排之上：允许 1px 的边框重叠误差
    expect(
      railBox!.y,
      `快捷排还压在输入框上面（输入框 y=${Math.round(inputBox!.y)} 高 ${Math.round(inputBox!.height)}，快捷排 y=${Math.round(railBox!.y)}）`,
    ).toBeGreaterThanOrEqual(inputBox!.y + inputBox!.height - 1)

    await app.close()
  })

  testOrSkip('点快捷排填进来的是单源那一句（真窗口走一遍 store→输入框）', async () => {
    const { app, page } = await launchApp()
    await page.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await page.waitForSelector('.wb-main-layout', { timeout: 20_000 })
    await ensurePanelOpen(page)

    // 单源正文从渲染层模块里取不到（打包后没有源码），所以按"这一句里独有的词"钉：
    // 巡检那条只出现在单源里，界面上其它地方都不说这句话。
    // 定位要按按钮自己的名字取——`.ai-composer-rail` 里第一个按钮是 PAOR，
    // 用 first() 会点到它头上，然后被"请先输入任务描述"拦住，读出个假失败。
    const chip = page.locator('.ai-composer-rail button', { hasText: /^巡检$/ })
    await expect(chip, '快捷排里没有「巡检」这一条').toBeVisible({ timeout: 10_000 })

    const composer = page.locator('#ai-composer-input')
    await composer.fill('')
    await chip.click()
    const value = await composer.inputValue()
    expect(value, '点了「巡检」，输入框里没填进东西').toContain('只读巡检')
    expect(value, '填进来的不是单源那句（缺 inode 与 journal 两个专有名）').toContain('inode')
    expect(value, '填进来的不是单源那句（缺 journal 错误摘要那半句）').toContain('journal')

    await app.close()
  })
})
