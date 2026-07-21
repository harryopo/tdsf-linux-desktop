import { test, _electron as electron } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'

const OUT_DIR = path.join(__dirname)

test.describe('生成视觉审查截图', () => {
  test('启动页与工作台截图', async () => {
    test.setTimeout(120000)

    const appPath = path.join(__dirname, '..', '..', 'out', 'main', 'index.js')
    const app = await electron.launch({
      args: [appPath],
      env: { ...process.env, NODE_ENV: 'development' },
      timeout: 60000,
    })

    const page = await app.firstWindow({ timeout: 60000 })
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 })

    // 等待启动页标题和进度条动画稳定（按钮在 3.5s 后出现）
    await page.waitForTimeout(4500)
    await page.screenshot({ path: path.join(OUT_DIR, 'boot.png') })
    console.log('[1] 启动页截图完成')

    // 进入工作台
    await page.evaluate(() => { window.location.hash = '#/workbench' })
    await page.waitForTimeout(2500)
    await page.screenshot({ path: path.join(OUT_DIR, 'workbench.png') })
    console.log('[2] 工作台截图完成')

    await app.close()
  })
})
