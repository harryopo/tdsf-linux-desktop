/**
 * 视觉对比测试 — §5.3 严格版
 *
 * 依据：TDSF高质量做大方案-终稿.md §5.3
 * 目标：实际渲染 vs 设计稿基线，确保 UI 改动不破坏视觉一致性
 *
 * 工作机制：
 *   1. 首次运行：`pnpm test:e2e:visual --update-snapshots` 生成基线
 *      基线存放在 tests/e2e/visual.spec.ts-snapshots/ 目录
 *   2. 后续运行：`pnpm test:e2e:visual` 与基线对比，差异 > 阈值 fail
 *
 * 阈值说明：
 *   - maxDiffPixelRatio: 0.1（允许 10% 像素差异，宽容字体抗锯齿/亚像素渲染差异）
 *   - 阈值可按页面调整（复杂页面如工作台可放宽到 0.15）
 *
 * 设计稿基线（参考）：
 *   - 原始设计稿：docs/audit-screenshots/design-*.png（21 个页面）
 *   - 之前的实际截图：docs/audit-screenshots/app-*.png
 *   - 手写 CSS 属性对比：docs/FRONTEND-VISUAL-COMPARISON.md
 *
 * 注意：
 *   - toHaveScreenshot 的第一个参数是相对快照目录的路径
 *   - 快照目录默认：<spec-file>-snapshots/
 *   - Electron 窗口大小固定 1440x900（设计稿 1920x1080 缩放）
 */
import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'

/** Electron 主进程入口 */
const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')

/** 是否已 build */
const BUILD_READY = fs.existsSync(MAIN_ENTRY)

/** 固定窗口大小（视觉对比基线一致性） */
const VIEWPORT_WIDTH = 1440
const VIEWPORT_HEIGHT = 900

/** 跳过未 build 的测试 */
const testOrSkip = BUILD_READY ? test : test.skip

/** 启动 Electron 并设置固定 viewport */
async function launchAppWithViewport() {
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      TDSF_E2E: '1',
    },
  })
  const window = await app.firstWindow()
  await window.waitForSelector('body', { timeout: 30000 })
  // 固定 viewport 确保截图基线一致
  await window.setViewportSize({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT })
  return { app, window }
}

test.describe('视觉对比 — 实际渲染 vs 基线', () => {
  testOrSkip('视觉: BootPage 启动加载页', async () => {
    const { app, window } = await launchAppWithViewport()

    await window.waitForSelector('main[data-viewport-mode="app-shell"]', { timeout: 30000 })
    // 等待 shader 动画稳定（取进度条中段）
    await window.waitForTimeout(2000)

    await expect(window).toHaveScreenshot('boot.png', {
      maxDiffPixelRatio: 0.15, // shader 动画帧差异，放宽到 15%
    })

    await app.close()
  })

  testOrSkip('视觉: 工作台主页', async () => {
    const { app, window } = await launchAppWithViewport()

    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })
    await window.waitForTimeout(1000) // 等 page-enter 动画完成

    await expect(window).toHaveScreenshot('workbench.png', {
      maxDiffPixelRatio: 0.1,
    })

    await app.close()
  })

  testOrSkip('视觉: 教程页', async () => {
    const { app, window } = await launchAppWithViewport()

    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })
    await window.locator('[data-dom-id="nav-tutorial"]').click()
    await window.waitForSelector('.tut-page', { timeout: 15000 })
    await window.waitForTimeout(1000)

    await expect(window).toHaveScreenshot('tutorial.png', {
      maxDiffPixelRatio: 0.1,
    })

    await app.close()
  })

  testOrSkip('视觉: 决策页', async () => {
    const { app, window } = await launchAppWithViewport()

    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })
    await window.locator('[data-dom-id="nav-decision"]').click()
    await window.waitForTimeout(1500)

    await expect(window).toHaveScreenshot('decision.png', {
      maxDiffPixelRatio: 0.1,
    })

    await app.close()
  })

  testOrSkip('视觉: 历史页', async () => {
    const { app, window } = await launchAppWithViewport()

    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })
    await window.locator('[data-dom-id="nav-history"]').click()
    await window.waitForSelector('.hist-page', { timeout: 15000 })
    await window.waitForTimeout(1000)

    await expect(window).toHaveScreenshot('history.png', {
      maxDiffPixelRatio: 0.1,
    })

    await app.close()
  })

  testOrSkip('视觉: 监控页', async () => {
    const { app, window } = await launchAppWithViewport()

    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })
    await window.locator('[data-dom-id="nav-monitor"]').click()
    await window.waitForSelector('.mon-main', { timeout: 15000 })
    await window.waitForTimeout(1500)

    await expect(window).toHaveScreenshot('monitor.png', {
      maxDiffPixelRatio: 0.1,
    })

    await app.close()
  })

  testOrSkip('视觉: 知识库页', async () => {
    const { app, window } = await launchAppWithViewport()

    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })
    await window.locator('[data-dom-id="nav-knowledge"]').click()
    await window.waitForSelector('.kb-page', { timeout: 15000 })
    await window.waitForTimeout(1000)

    await expect(window).toHaveScreenshot('knowledge.png', {
      maxDiffPixelRatio: 0.1,
    })

    await app.close()
  })

  testOrSkip('视觉: 系统日志页', async () => {
    const { app, window } = await launchAppWithViewport()

    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })
    await window.locator('[data-dom-id="nav-logs"]').click()
    await window.waitForSelector('.log-main', { timeout: 15000 })
    await window.waitForTimeout(1000)

    await expect(window).toHaveScreenshot('logs.png', {
      maxDiffPixelRatio: 0.1,
    })

    await app.close()
  })

  testOrSkip('视觉: 设置页', async () => {
    const { app, window } = await launchAppWithViewport()

    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })
    await window.locator('[data-dom-id="nav-settings"]').click()
    await window.waitForSelector('.set-page', { timeout: 15000 })
    await window.waitForTimeout(1000)

    await expect(window).toHaveScreenshot('settings.png', {
      maxDiffPixelRatio: 0.1,
    })

    await app.close()
  })
})

/**
 * 使用指南：
 *
 * 1. 首次生成基线（必须）：
 *    ```bash
 *    pnpm test:e2e:visual --update-snapshots
 *    ```
 *    会在 tests/e2e/visual.spec.ts-snapshots/ 目录生成基线 PNG
 *
 * 2. 后续验证（CI / 本地回归）：
 *    ```bash
 *    pnpm test:e2e:visual
 *    ```
 *    差异 > 阈值的页面会 fail，差异图保存到 test-results/
 *
 * 3. 设计稿参考：
 *    - 原始设计稿：docs/audit-screenshots/design-*.png
 *    - 当前实际：docs/audit-screenshots/app-*.png
 *    - 手写 CSS 属性对比：docs/FRONTEND-VISUAL-COMPARISON.md
 *
 * 4. 更新基线（UI 改动后）：
 *    ```bash
 *    pnpm test:e2e:visual --update-snapshots
 *    git add tests/e2e/visual.spec.ts-snapshots/
 *    git commit -m "test: update visual baseline after UI change"
 *    ```
 */
