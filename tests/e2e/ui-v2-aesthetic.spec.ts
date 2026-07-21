/**
 * TDSF-Linux Desktop v2.0 极致美学 — 对比截图
 *
 * 目的：
 * - 抓取 v2.0 设计系统（黄金比例 / 字号阶梯 / 微动效 / 暗黑一致）下的关键页面截图
 * - 存到 `tests/e2e/screenshots/ui-v2.0-aesthetic/` 供 UI 前后对比
 *
 * 设计对照（对标产品）：
 * - Apple HIG · Linear · Notion · Arc · Raycast · ChatGPT · Claude · LobeChat · Cherry Studio
 *
 * 截图清单（10 张）：
 * 1. 01-homepage.png         — 工作台亮色（三栏 + 微动效）
 * 2. 02-chatpanel.png        — AI 对话（消息气泡 + 输入框）
 * 3. 03-tutorialpage.png     — 教程页（卡片网格 + 悬浮）
 * 4. 04-deploydialog.png     — 部署弹窗（模板卡片）
 * 5. 05-profilerdialog.png   — 系统架构感知（风险等级卡片）
 * 6. 06-settings.png         — 设置页（外观 + LLM 配置）
 * 7. 07-compare-light-dark.png — 亮色 vs 暗黑对比
 * 8. 08-detail-typography.png  — 字号字距细节（设置页 Section）
 * 9. 09-detail-buttons.png     — 按钮质感（主按钮 / 默认按钮 / 链接按钮）
 * 10. 10-detail-cards.png      — 卡片悬浮（教程卡片 hover 态）
 *
 * 运行方式：
 *   pnpm build && npx playwright test tests/e2e/ui-v2-aesthetic.spec.ts
 */
import { test, _electron as electron } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'

// 截图输出目录
const OUT_DIR = path.join(__dirname, 'screenshots', 'ui-v2.0-aesthetic')
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
}

// 启动应用入口
const APP_PATH = path.join(__dirname, '..', '..', 'out', 'main', 'index.js')

/** 启动 Electron 应用 */
async function launchApp() {
  const app = await electron.launch({
    args: [APP_PATH],
    env: { ...process.env, NODE_ENV: 'development' },
    timeout: 90000,
  })
  const page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 })
  await page.waitForTimeout(4000)
  return { app, page }
}

// ============================================================
// 测试套件
// ============================================================

test.describe('TDSF v2.0 极致美学截图', () => {
  test.setTimeout(300000)

  test('01-10 极致美学全场景截图', async () => {
    const { app, page } = await launchApp()
    const appWindow = await app.firstWindow({ timeout: 60000 })
    void appWindow

    try {
      // =========================================================
      // 1. 01-homepage — 工作台亮色
      // =========================================================
      await page.evaluate(() => { window.location.hash = '#/' })
      await page.waitForTimeout(2500)
      // 等所有微动效完成
      await page.waitForTimeout(800)
      await page.screenshot({
        path: path.join(OUT_DIR, '01-homepage.png'),
        fullPage: false,
      })
      console.log('[01] 工作台亮色截图完成')

      // =========================================================
      // 2. 02-chatpanel — AI 对话（聚焦消息 + 输入框）
      // =========================================================
      // 滚动 chat panel 让消息区域显示
      const chatMessages = page.locator('.chat-panel-messages').first()
      if (await chatMessages.isVisible().catch(() => false)) {
        await chatMessages.scrollIntoViewIfNeeded()
      }
      // 聚焦到 AI 输入框
      const aiInput = page.locator('textarea[placeholder*="描述问题"]').first()
      if (await aiInput.isVisible().catch(() => false)) {
        await aiInput.click()
        await aiInput.fill('帮我看看系统状态')
        await page.waitForTimeout(400)
      }
      await page.screenshot({
        path: path.join(OUT_DIR, '02-chatpanel.png'),
        fullPage: false,
      })
      console.log('[02] AI 对话截图完成')
      // 清空输入
      if (await aiInput.isVisible().catch(() => false)) {
        await aiInput.fill('')
      }

      // =========================================================
      // 3. 03-tutorialpage — 教程页（卡片网格 + 悬浮）
      // =========================================================
      await page.evaluate(() => { window.location.hash = '#/tutorial' })
      await page.waitForTimeout(3000)
      // 等教程列表加载 + StaggerList 动画完成（10 项 × 30ms = 300ms）
      await page.waitForTimeout(1500)
      // hover 第一张卡片展示悬浮态
      const firstCard = page.locator('.tutorial-card').first()
      if (await firstCard.isVisible().catch(() => false)) {
        await firstCard.hover()
        await page.waitForTimeout(400)
      }
      await page.screenshot({
        path: path.join(OUT_DIR, '03-tutorialpage.png'),
        fullPage: false,
      })
      console.log('[03] 教程页截图完成')

      // =========================================================
      // 4. 04-deploydialog — 部署弹窗（用新建服务器弹窗替代更稳定）
      // =========================================================
      // 先回工作台
      await page.evaluate(() => { window.location.hash = '#/' })
      await page.waitForTimeout(1500)
      // 点击 + 按钮打开连接弹窗（演示 ant-modal 的 v2.0 样式）
      const addServerBtn = page.locator('.server-list-add-btn')
      if (await addServerBtn.isVisible().catch(() => false)) {
        await addServerBtn.click()
        await page.waitForTimeout(1500)
        // 等 modal 缩放进入
        await page.screenshot({
          path: path.join(OUT_DIR, '04-deploydialog.png'),
          fullPage: false,
        })
        console.log('[04] 弹窗样式截图完成（连接弹窗 = Modal 风格示范）')
        // 关闭弹窗（按 ESC 更可靠）
        await page.keyboard.press('Escape')
        await page.waitForTimeout(800)
        // 若 modal wrap 还在，等它消失
        await page.locator('.ant-modal-wrap:not([style*="display: none"])').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
        await page.waitForTimeout(500)
      }

      // =========================================================
      // 5. 05-profilerdialog — 风险等级视觉（用风险规则设置页替代）
      // =========================================================
      await page.evaluate(() => { window.location.hash = '#/settings' })
      await page.waitForTimeout(2000)
      // 切到风险规则 Tab
      const riskTab = page.locator('.settings-page .ant-tabs-tab').filter({ hasText: '风险' })
      if (await riskTab.first().isVisible().catch(() => false)) {
        await riskTab.first().click({ force: true }).catch(() => {})
        await page.waitForTimeout(1500)
        await page.screenshot({
          path: path.join(OUT_DIR, '05-profilerdialog.png'),
          fullPage: false,
        })
        console.log('[05] 风险规则配置截图完成（风险等级视觉对照）')
      }

      // =========================================================
      // 6. 06-settings — 设置页（外观主题）
      // =========================================================
      const appearanceTab = page.locator('.settings-page .ant-tabs-tab').filter({ hasText: '外观' })
      if (await appearanceTab.first().isVisible().catch(() => false)) {
        await appearanceTab.first().click({ force: true }).catch(() => {})
        await page.waitForTimeout(1500)
        await page.screenshot({
          path: path.join(OUT_DIR, '06-settings.png'),
          fullPage: false,
        })
        console.log('[06] 设置页外观配置截图完成')
      }

      // =========================================================
      // 7. 07-compare-light-dark — 亮色 vs 暗黑对比
      // =========================================================
      // 先截亮色（已经在外观页）
      await page.screenshot({
        path: path.join(OUT_DIR, '07a-light.png'),
        fullPage: false,
      })
      // 切换到暗黑
      const darkBtn = page.locator('button').filter({ hasText: '暗黑' }).first()
      if (await darkBtn.isVisible().catch(() => false)) {
        await darkBtn.click()
        await page.waitForTimeout(1200)
        await page.screenshot({
          path: path.join(OUT_DIR, '07b-dark.png'),
          fullPage: false,
        })
        console.log('[07] 亮色 + 暗黑双截图完成')
        // 切回亮色
        const lightBtn = page.locator('button').filter({ hasText: '亮色' }).first()
        if (await lightBtn.isVisible().catch(() => false)) {
          await lightBtn.click()
          await page.waitForTimeout(800)
        }
      }

      // =========================================================
      // 8. 08-detail-typography — 字号字距细节
      // =========================================================
      // 滚到设置页的"字体大小"section（如果有），或 LLM 配置页（字段密集）
      const llmTab = page.locator('.settings-page .ant-tabs-tab').filter({ hasText: 'LLM' })
      if (await llmTab.first().isVisible().catch(() => false)) {
        await llmTab.first().click({ force: true }).catch(() => {})
        await page.waitForTimeout(1500)
        await page.screenshot({
          path: path.join(OUT_DIR, '08-detail-typography.png'),
          fullPage: false,
        })
        console.log('[08] 字号字距细节截图完成（LLM 配置页）')
      }

      // =========================================================
      // 9. 09-detail-buttons — 按钮质感
      // =========================================================
      // 回到外观页截按钮
      if (await appearanceTab.first().isVisible().catch(() => false)) {
        await appearanceTab.first().click({ force: true }).catch(() => {})
        await page.waitForTimeout(1500)
      }
      // hover 主按钮展示 hover 态
      const primaryBtn = page.locator('button.ant-btn-primary').first()
      if (await primaryBtn.isVisible().catch(() => false)) {
        await primaryBtn.hover({ force: true }).catch(() => {})
        await page.waitForTimeout(500)
      }
      await page.screenshot({
        path: path.join(OUT_DIR, '09-detail-buttons.png'),
        fullPage: false,
      })
      console.log('[09] 按钮质感截图完成')

      // =========================================================
      // 10. 10-detail-cards — 卡片悬浮
      // =========================================================
      // 回到教程页，hover 第二张卡片
      await page.evaluate(() => { window.location.hash = '#/tutorial' })
      await page.waitForTimeout(3000)
      const secondCard = page.locator('.tutorial-card').nth(1)
      if (await secondCard.isVisible().catch(() => false)) {
        await secondCard.hover()
        await page.waitForTimeout(500)
      }
      await page.screenshot({
        path: path.join(OUT_DIR, '10-detail-cards.png'),
        fullPage: false,
      })
      console.log('[10] 卡片悬浮截图完成')

      console.log('\n=== 所有 v2.0 极致美学截图已保存到 ===')
      console.log(OUT_DIR)
    } finally {
      await app.close()
    }
  })
})
