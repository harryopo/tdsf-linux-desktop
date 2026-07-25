/**
 * Demo 9 步主路径 E2E 测试 — §5.2 完整版
 *
 * 依据：TDSF高质量做大方案-终稿.md §5.2
 * 目标：覆盖比赛 Demo 9 步主路径，确保关键流程不回归
 *
 * 9 步规划：
 *   Step 1: 启动应用 + BootPage 加载
 *   Step 2: 点击 "进入工作台" 按钮进入工作台
 *   Step 3: 验证主界面元素（ActivityRail 8 个导航按钮）
 *   Step 4: 教程页加载（点击 nav-tutorial）
 *   Step 5: 决策页加载（点击 nav-decision）
 *   Step 6: 历史页加载（点击 nav-history）
 *   Step 7: 监控页加载（点击 nav-monitor）
 *   Step 8: 知识库页加载（点击 nav-knowledge）
 *   Step 9: 设置页加载（点击 nav-settings）
 *
 * 选择器策略：
 *   - 优先使用 [data-dom-id="xxx"]（语义化、稳定）
 *   - fallback 到 .wb-*/.tut-*/.hist-*/.mon-*/.kb-*/.set-*/.log-* 语义化 className
 *
 * 降级策略：
 *   - 若 out/main/index.js 不存在（未 build），整个 suite skip
 *   - SSH/AI 真实环境依赖的测试单独 skip（保留 stub）
 *
 * 注意：Electron 测试必须串行（workers=1），实例间状态独立
 */
import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'

/** Electron 主进程入口（需先 pnpm build） */
const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')

/** 截图输出目录 */
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots')

/** 确保截图目录存在 */
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

/** 启动 Electron 应用并返回首窗口 */
async function launchApp() {
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      // 测试模式：禁用真实 SSH/API key 依赖
      NODE_ENV: 'test',
      TDSF_E2E: '1',
    },
  })
  const window = await app.firstWindow()
  // 等待 React 挂载完成
  await window.waitForSelector('body', { timeout: 30000 })
  return { app, window }
}

/** 是否已 build（CI 中由 globalSetup 触发，本地需手动 pnpm build） */
const BUILD_READY = fs.existsSync(MAIN_ENTRY)

/** 跳过未 build 的测试 */
const testOrSkip = BUILD_READY ? test : test.skip

test.describe('Demo 9 步主路径', () => {
  testOrSkip('Step 1: 启动应用 + BootPage 加载', async () => {
    const { app, window } = await launchApp()

    // BootPage 根元素：data-viewport-mode="app-shell"
    await window.waitForSelector('main[data-viewport-mode="app-shell"]', { timeout: 30000 })

    // 验证标题 TDSF LINUX 可见
    const title = await window.locator('.boot-title').textContent()
    expect(title?.trim()).toBe('TDSF LINUX')

    // 截图作为基线
    await window.screenshot({
      path: path.join(SCREENSHOT_DIR, '01-boot.png'),
    })

    await app.close()
  })

  testOrSkip('Step 2: 点击 "进入工作台" 进入工作台', async () => {
    const { app, window } = await launchApp()

    // 等待 BootPage 加载完成（boot-enter 按钮可点击）
    const enterBtn = window.locator('[data-dom-id="boot-enter"]')
    await enterBtn.waitFor({ state: 'visible', timeout: 30000 })

    // BootPage 进度条动画 3s，最多等 6s 让按钮 enable
    await window.waitForFunction(
      () => {
        const btn = document.querySelector('[data-dom-id="boot-enter"]') as HTMLButtonElement | null
        return btn !== null && !btn.disabled
      },
      { timeout: 15000 },
    )

    await enterBtn.click()

    // 等待跳转到 /workbench（HashRouter 改变 hash）
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })

    // 验证 URL hash 包含 workbench
    const hash = await window.evaluate(() => window.location.hash)
    expect(hash).toContain('/workbench')

    await window.screenshot({
      path: path.join(SCREENSHOT_DIR, '02-workbench.png'),
    })

    await app.close()
  })

  testOrSkip('Step 3: 主界面元素可见（ActivityRail 8 个导航按钮）', async () => {
    const { app, window } = await launchApp()

    // 跳过 BootPage 直接进入工作台（用 evaluate 改 hash）
    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })

    // 验证 ActivityRail 导航存在
    const rail = window.locator('.wb-activity-rail')
    await expect(rail).toBeVisible()

    // 验证 7 个顶部导航按钮 + 1 个底部设置按钮 = 8 个
    const navButtons = window.locator('.wb-nav-btn')
    await expect(navButtons).toHaveCount(8)

    // 验证关键导航按钮的 data-dom-id 存在
    const expectedDomIds = [
      'nav-tutorial',
      'nav-decision',
      'nav-monitor',
      'nav-knowledge',
      'nav-history',
      'nav-logs',
      'nav-settings',
    ]
    for (const domId of expectedDomIds) {
      const btn = window.locator(`[data-dom-id="${domId}"]`)
      await expect(btn).toBeVisible()
    }

    await window.screenshot({
      path: path.join(SCREENSHOT_DIR, '03-main-ui.png'),
    })

    await app.close()
  })

  testOrSkip('Step 4: 教程页加载（点击 nav-tutorial）', async () => {
    const { app, window } = await launchApp()

    // 进入工作台
    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })

    // 点击教程导航按钮
    await window.locator('[data-dom-id="nav-tutorial"]').click()

    // 等待教程页加载
    await window.waitForSelector('.tut-page', { timeout: 15000 })

    // 验证 URL hash
    const hash = await window.evaluate(() => window.location.hash)
    expect(hash).toContain('/tutorial')

    // 截图
    await window.screenshot({
      path: path.join(SCREENSHOT_DIR, '04-tutorial.png'),
    })

    await app.close()
  })

  testOrSkip('Step 5: 决策页加载（点击 nav-decision）', async () => {
    const { app, window } = await launchApp()

    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })

    await window.locator('[data-dom-id="nav-decision"]').click()

    // 决策页可能渲染为 .dec-* 或其他容器，等待主内容区变化
    await window.waitForFunction(
      () => !document.querySelector('.wb-main-layout') || document.querySelector('.wb-main-layout .wb-editor-wrap') === null,
      { timeout: 15000 },
    ).catch(() => {
      // 决策页可能仍在 MainLayout 内，验证 hash 即可
    })

    const hash = await window.evaluate(() => window.location.hash)
    expect(hash).toContain('/decision')

    await window.screenshot({
      path: path.join(SCREENSHOT_DIR, '05-decision.png'),
    })

    await app.close()
  })

  testOrSkip('Step 6: 历史页加载（点击 nav-history）', async () => {
    const { app, window } = await launchApp()

    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })

    await window.locator('[data-dom-id="nav-history"]').click()

    // 等待历史页根元素 .hist-page 加载
    await window.waitForSelector('.hist-page', { timeout: 15000 })

    // 验证标题"历史决策"
    const title = await window.locator('.hist-header-title').textContent()
    expect(title?.trim()).toBe('历史决策')

    const hash = await window.evaluate(() => window.location.hash)
    expect(hash).toContain('/history')

    await window.screenshot({
      path: path.join(SCREENSHOT_DIR, '06-history.png'),
    })

    await app.close()
  })

  testOrSkip('Step 7: 监控页加载（点击 nav-monitor）', async () => {
    const { app, window } = await launchApp()

    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })

    await window.locator('[data-dom-id="nav-monitor"]').click()

    // 等待监控页根元素 .mon-main 加载
    await window.waitForSelector('.mon-main', { timeout: 15000 })

    const hash = await window.evaluate(() => window.location.hash)
    expect(hash).toContain('/monitor')

    await window.screenshot({
      path: path.join(SCREENSHOT_DIR, '07-monitor.png'),
    })

    await app.close()
  })

  testOrSkip('Step 8: 知识库页加载（点击 nav-knowledge）', async () => {
    const { app, window } = await launchApp()

    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })

    await window.locator('[data-dom-id="nav-knowledge"]').click()

    // 等待知识库页根元素 .kb-page 加载
    await window.waitForSelector('.kb-page', { timeout: 15000 })

    // 验证标题"运维知识库"
    const title = await window.locator('.kb-header__title').textContent()
    expect(title?.trim()).toBe('运维知识库')

    const hash = await window.evaluate(() => window.location.hash)
    expect(hash).toContain('/knowledge')

    await window.screenshot({
      path: path.join(SCREENSHOT_DIR, '08-knowledge.png'),
    })

    await app.close()
  })

  testOrSkip('Step 9: 设置页加载（点击 nav-settings）', async () => {
    const { app, window } = await launchApp()

    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })

    await window.locator('[data-dom-id="nav-settings"]').click()

    // 等待设置页根元素 .set-page 加载（SettingsLayout 主容器）
    await window.waitForSelector('.set-page', { timeout: 15000 })

    // 验证左侧导航存在（6 项核心导航）
    const navItems = window.locator('.set-nav__item')
    await expect(navItems).toHaveCount(6)

    // 验证关键设置导航的 data-dom-id
    const expectedDomIds = ['nav-general', 'nav-ssh', 'nav-model-config', 'nav-alerts', 'nav-appearance', 'nav-about']
    for (const domId of expectedDomIds) {
      const link = window.locator(`[data-dom-id="${domId}"]`)
      await expect(link).toBeVisible()
    }

    const hash = await window.evaluate(() => window.location.hash)
    expect(hash).toContain('/settings')

    await window.screenshot({
      path: path.join(SCREENSHOT_DIR, '09-settings.png'),
    })

    await app.close()
  })

  // 真实环境依赖的测试保留 stub，CI 中标记 skip
  test.skip('Step S1: SSH 连接（需真实凭据）', async () => {
    // TODO: 实现 SSH 连接测试
    // 需要 SSH 测试服务器凭据，通过环境变量传入：
    //   TDSF_TEST_SSH_HOST / TDSF_TEST_SSH_USER / TDSF_TEST_SSH_PASS
  })

  test.skip('Step S2: 终端交互（依赖 SSH 连接）', async () => {
    // TODO: 实现终端命令执行测试
  })

  test.skip('Step S3: AI 助手对话（依赖 API key）', async () => {
    // TODO: 实现 AI 对话测试
    // 需要 TDSF_TEST_AI_API_KEY 环境变量
  })
})
