// 临时验收脚本 - 用 Playwright _electron 启动应用并截屏关键页面
import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'

const OUT_DIR = path.join(__dirname, 'screenshots-acceptance')
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
}

test.describe('TDSF 验收截图', () => {
  test('所有关键页面截图', async () => {
    test.setTimeout(300000)
    const appPath = path.join(__dirname, '..', '..', 'out', 'main', 'index.js')
    const app = await electron.launch({
      args: [appPath],
      env: { ...process.env, NODE_ENV: 'development' },
      timeout: 90000
    })
    const page = await app.firstWindow({ timeout: 60000 })
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 })
    await page.waitForTimeout(4000)

    // 1. 主页（工作台）
    await page.screenshot({ path: path.join(OUT_DIR, '01-home-terminal.png'), fullPage: true })
    console.log('[1] 工作台截图完成')

    // 2. 切换到监控 Tab
    const monitorTab = page.locator('text=监控').first()
    if (await monitorTab.isVisible().catch(() => false)) {
      await monitorTab.click()
      await page.waitForTimeout(2000)
      await page.screenshot({ path: path.join(OUT_DIR, '02-home-monitor.png'), fullPage: true })
      console.log('[2] 监控视图截图完成')
    }

    // 3. 设置页
    await page.evaluate(() => { window.location.hash = '#/settings' })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: path.join(OUT_DIR, '03-settings-appearance.png'), fullPage: true })
    console.log('[3] 设置-外观截图完成')

    // 4. LLM 配置
    const llmTab = page.locator('.ant-tabs-tab').filter({ hasText: 'LLM 配置' })
    if (await llmTab.first().isVisible().catch(() => false)) {
      await llmTab.first().click()
      await page.waitForTimeout(800)
      await page.screenshot({ path: path.join(OUT_DIR, '04-settings-llm.png'), fullPage: true })
      console.log('[4] LLM 配置截图完成')
    }

    // 5. 暗黑模式
    const darkBtn = page.locator('button').filter({ hasText: '暗黑' })
    if (await darkBtn.first().isVisible().catch(() => false)) {
      await darkBtn.first().click()
      await page.waitForTimeout(800)
      await page.screenshot({ path: path.join(OUT_DIR, '05-settings-dark.png'), fullPage: true })
      console.log('[5] 暗黑模式截图完成')
    }

    // 6. 风险规则
    const riskTab = page.locator('.ant-tabs-tab').filter({ hasText: '风险规则' })
    if (await riskTab.first().isVisible().catch(() => false)) {
      await riskTab.first().click()
      await page.waitForTimeout(800)
      await page.screenshot({ path: path.join(OUT_DIR, '06-settings-risk.png'), fullPage: true })
      console.log('[6] 风险规则截图完成')
    }

    // 7. 历史决策
    await page.evaluate(() => { window.location.hash = '#/history' })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: path.join(OUT_DIR, '07-history.png'), fullPage: true })
    console.log('[7] 历史决策截图完成')

    // 8. 知识库
    await page.evaluate(() => { window.location.hash = '#/knowledge' })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: path.join(OUT_DIR, '08-knowledge-command.png'), fullPage: true })
    console.log('[8] 知识库截图完成')

    // 9. 知识库 - 故障案例 Tab
    const incidentTab = page.locator('.ant-tabs-tab').filter({ hasText: '故障案例' })
    if (await incidentTab.first().isVisible().catch(() => false)) {
      await incidentTab.first().click()
      await page.waitForTimeout(800)
      await page.screenshot({ path: path.join(OUT_DIR, '09-knowledge-incident.png'), fullPage: true })
      console.log('[9] 知识库-故障案例截图完成')
    }

    // 10. 知识库 - 添加弹窗
    const addBtn = page.locator('button').filter({ hasText: '添加' }).first()
    if (await addBtn.isVisible().catch(() => false)) {
      await addBtn.click()
      await page.waitForTimeout(800)
      await page.screenshot({ path: path.join(OUT_DIR, '10-knowledge-add-modal.png'), fullPage: true })
      console.log('[10] 知识库添加弹窗截图完成')
      // 关闭弹窗
      const cancelBtn = page.locator('.ant-modal-footer button').filter({ hasText: '取消' })
      if (await cancelBtn.first().isVisible().catch(() => false)) {
        await cancelBtn.first().click()
        await page.waitForTimeout(500)
      }
    }

    // 11. 新建服务器弹窗
    await page.evaluate(() => { window.location.hash = '#/' })
    await page.waitForTimeout(1500)
    const addServerBtn = page.locator('.server-list-add-btn')
    if (await addServerBtn.isVisible().catch(() => false)) {
      await addServerBtn.click()
      await page.waitForTimeout(800)
      await page.screenshot({ path: path.join(OUT_DIR, '11-server-add-dialog.png'), fullPage: true })
      console.log('[11] 新建服务器截图完成')
      const cancelServerBtn = page.locator('.ant-modal-footer button').filter({ hasText: '取消' })
      if (await cancelServerBtn.first().isVisible().catch(() => false)) {
        await cancelServerBtn.first().click()
        await page.waitForTimeout(500)
      }
    }

    // 12. AI 助手输入框
    const aiInput = page.locator('textarea[placeholder*="描述问题"]')
    if (await aiInput.first().isVisible().catch(() => false)) {
      await aiInput.first().fill('检查系统状态')
      await page.waitForTimeout(500)
      await page.screenshot({ path: path.join(OUT_DIR, '12-ai-input.png'), fullPage: true })
      console.log('[12] AI 输入框截图完成')
    }

    await app.close()
    console.log('所有验收截图已保存到:', OUT_DIR)
  })
})
