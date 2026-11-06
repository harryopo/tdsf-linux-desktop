/**
 * composer-layout.spec.ts —— AI 输入区排版的真窗口判据（2026-11-05 一行式重做）
 *
 * 为什么单独一条：输入区是唯一"每轮都要用"的东西，它的层次错了，整个面板的观感就跟着错。
 * 这次改的是两件事，都得在真窗口里量，jsdom 量不到布局：
 *   1. **主行只留 `+` / 文本域 / 选项 / 发送**——5 个能力 chip 全部移出主行，
 *      旧 `.ai-composer-rail` 不应再存在；四件套底部对齐（打字的地方和发送按钮同一条线）。
 *   2. **`/` 是真入口**——按 `/` 弹出「提示词模板」面板，选中只填词、不执行；
 *      正文仍只有一份（`QUICK_PROMPTS`）。
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
  // 工作台是懒加载的：先等这颗按钮出现，否则"此刻还没画上"会被误判成"面板关着"，
  // 于是一点反而把开着的面板关掉（2026-10-29 工作台改成常驻挂载后这条竞态被放大）。
  await page.locator('[data-dom-id="btn-toggle-ai"]').waitFor({ state: 'visible', timeout: 20_000 })
  if (await composer.isVisible().catch(() => false)) return
  await page.locator('[data-dom-id="btn-toggle-ai"]').click()
  await composer.waitFor({ state: 'visible', timeout: 10_000 })
}

test.describe('AI 输入区排版', () => {
  test.describe.configure({ mode: 'serial' })

  testOrSkip('主行只有 + / 文本域 / 选项 / 发送，旧快捷排已移除', async () => {
    const { app, page } = await launchApp()
    await page.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await page.waitForSelector('.wb-main-layout', { timeout: 20_000 })
    await ensurePanelOpen(page)

    const input = page.locator('[data-testid="composer-input"]')
    const send = page.locator('[data-testid="composer-send"]')
    await expect(input, '输入框没画出来').toBeVisible({ timeout: 10_000 })
    await expect(send, '发送按钮没画出来').toBeVisible({ timeout: 10_000 })
    // 5 个 chip 已经进 `/` 面板，主行不该再有快捷排。
    // 用 class 属性选择器而不是 `.ai-composer-rail`：这个类**故意**不在渲染层源码里，
    // 写成类选择器会被 tests/unit/e2e-selector-exists 判成死选择器；`[class~=x]` 与 `.x` 等价。
    await expect(page.locator('[class~="ai-composer-rail"]')).toHaveCount(0)

    const inputBox = await input.boundingBox()
    const sendBox = await send.boundingBox()
    expect(inputBox, '量不到输入框的位置').not.toBeNull()
    expect(sendBox, '量不到发送按钮的位置').not.toBeNull()
    // 主行 items-end：文本域与发送按钮的底边应在同一条线上（允许 2px 描边/行高误差）
    expect(
      Math.abs(inputBox!.y + inputBox!.height - (sendBox!.y + sendBox!.height)),
      `输入框与发送按钮底边没对齐（输入框底 ${Math.round(inputBox!.y + inputBox!.height)}，发送底 ${Math.round(sendBox!.y + sendBox!.height)}）`,
    ).toBeLessThanOrEqual(2)

    await app.close()
  })

  testOrSkip('按 / 弹出提示词模板，选中只填词不执行', async () => {
    const { app, page } = await launchApp()
    await page.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await page.waitForSelector('.wb-main-layout', { timeout: 20_000 })
    await ensurePanelOpen(page)

    const composer = page.locator('[data-testid="composer-input"]')
    await composer.fill('')
    await composer.press('/')

    const dialog = page.getByRole('dialog')
    await expect(dialog, '按 / 没弹出模板面板').toBeVisible({ timeout: 5000 })
    // 面板必须自述"只填词、不执行"——这是批准时加的诚实约束
    await expect(dialog, '面板没说明选中不会执行').toContainText('不会执行命令')

    // 单源正文从渲染层模块里取不到（打包后没有源码），所以按"这一句里独有的词"钉：
    // 巡检那条只出现在单源里，界面上其它地方都不说这句话。
    await dialog.getByRole('button', { name: /巡检模板/ }).click()
    await expect(dialog).toBeHidden({ timeout: 5000 })

    const value = await composer.inputValue()
    expect(value, '选了「巡检模板」，输入框里没填进东西').toContain('只读巡检')
    expect(value, '填进来的不是单源那句（缺 inode 与 journal 两个专有名）').toContain('inode')
    expect(value, '填进来的不是单源那句（缺 journal 错误摘要那半句）').toContain('journal')

    await app.close()
  })
})
