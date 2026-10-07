/**
 * acceptance-screenshots.spec.ts —— 验收截图（每一步都必须真的发生）
 *
 * 旧版是 12 步全靠 `if (await isVisible())` 软兜底：改版后 antd 的 tab 与
 * `.server-list-add-btn`、`textarea[placeholder*="描述问题"]` 早就不存在，
 * 8 步静默跳过却仍然 "1 passed"，并且往仓库里留着几张再也不会更新的旧图。
 * 现在改成：按路由逐屏截，每屏断言①停在该路由 ②页面标题非空 ③图片真的落盘且不小得可疑。
 * 任何一步做不到就是红，不再"截图完成"打印了却什么也没写。
 */
import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const OUT_DIR = path.join(__dirname, 'screenshots-acceptance')
const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')
const testOrSkip = fs.existsSync(MAIN_ENTRY) ? test : test.skip

/** e2e 专用 userData，别把测试痕迹写进共享配置 */
const E2E_USER_DATA_DIR = path.join(os.tmpdir(), 'tdsf-e2e-profile')

/** 落盘图片的最小字节数：再小就是白屏/半屏 */
const MIN_BYTES = 20_000

interface Shot {
  file: string
  route: string
  /** 该屏的页面标题（外壳工作区没有 PageHeader，用 .wb-main-layout 代替） */
  title?: string
}

const SHOTS: Shot[] = [
  { file: '01-home-terminal.png', route: '#/workbench' },
  { file: '02-home-monitor.png', route: '#/monitor', title: '实时监控' },
  { file: '03-settings-general.png', route: '#/settings/general', title: '通用' },
  { file: '04-settings-model.png', route: '#/settings/model', title: '模型配置' },
  { file: '05-settings-appearance.png', route: '#/settings/appearance', title: '外观' },
  { file: '06-settings-risk.png', route: '#/settings/risk', title: '风险控制' },
  { file: '07-history.png', route: '#/history' },
  { file: '08-knowledge.png', route: '#/knowledge' },
  { file: '09-tutorial.png', route: '#/tutorial', title: '运维教程' },
  { file: '10-logs.png', route: '#/logs' },
  { file: '11-decision.png', route: '#/decision' },
  { file: '12-settings-ssh.png', route: '#/settings/ssh', title: 'SSH 连接' },
]

async function shoot(page: import('@playwright/test').Page, s: Shot): Promise<string> {
  await page.evaluate((h) => {
    window.location.hash = h
  }, s.route)
  await page.waitForTimeout(900)

  if (s.route === '#/workbench') {
    await page.waitForSelector('.wb-main-layout', { timeout: 15000 })
  } else {
    await page.waitForSelector('[data-dom-id="page-title"]', { timeout: 15000 })
    const got = (await page.locator('[data-dom-id="page-title"]').textContent())?.trim() ?? ''
    if (s.title) {
      expect(got, `${s.route} 的页头标题应为「${s.title}」，实测「${got}」`).toBe(s.title)
    } else {
      expect(got.length, `${s.route} 页头标题不该为空（说明没真渲染出来）`).toBeGreaterThan(0)
    }
  }

  const file = path.join(OUT_DIR, s.file)
  await page.screenshot({ path: file, fullPage: true })
  return file
}

test.describe('TDSF 验收截图', () => {
  testOrSkip('逐屏截图：停对页面、标题非空、图片真的落盘', async () => {
    test.setTimeout(300_000)
    fs.mkdirSync(OUT_DIR, { recursive: true })
    const app = await electron.launch({
      args: [MAIN_ENTRY, `--user-data-dir=${E2E_USER_DATA_DIR}`],
      env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
      timeout: 90_000,
    })
    const page = await app.firstWindow({ timeout: 60_000 })
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 })
    await page.waitForTimeout(3000)

    const written: string[] = []
    for (const s of SHOTS) {
      const file = await shoot(page, s)
      const size = fs.statSync(file).size
      expect(size, `${s.file} 只写了 ${size} 字节，不是一屏真实渲染`).toBeGreaterThan(MIN_BYTES)
      written.push(s.file)
    }
    console.log('[验收截图] 落盘', written.length, '张：', written.join(', '))

    // 浮层两屏：SSH 页的"添加服务器"弹窗、工作台的 AI 输入框
    await page.evaluate(() => {
      window.location.hash = '#/settings/ssh'
    })
    await page.waitForSelector('[data-dom-id="page-title"]', { timeout: 15000 })
    await page.locator('button:has-text("添加服务器")').first().click()
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
    const dialogFile = path.join(OUT_DIR, '13-server-add-dialog.png')
    await page.screenshot({ path: dialogFile, fullPage: true })
    expect(fs.statSync(dialogFile).size, '添加服务器弹窗截图没落盘').toBeGreaterThan(MIN_BYTES)
    await page.keyboard.press('Escape')

    await page.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await page.waitForSelector('.wb-main-layout', { timeout: 15000 })
    const composer = page.locator('#ai-composer-input')
    await composer.waitFor({ state: 'visible', timeout: 10_000 })
    await composer.fill('检查系统状态')
    const aiFile = path.join(OUT_DIR, '14-ai-input.png')
    await page.screenshot({ path: aiFile, fullPage: true })
    expect(fs.statSync(aiFile).size, 'AI 输入框截图没落盘').toBeGreaterThan(MIN_BYTES)

    await app.close()
  })
})
