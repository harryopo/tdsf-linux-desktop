import { chromium } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const baseUrl = 'http://127.0.0.1:9880'
const outDir = 'd:/ai/linux教学一体/tdsf-linux-desktop/scripts/browser-check/screenshots-round2'

const pages = [
  { route: '#/boot', name: 'boot', wait: 4000 },
  { route: '#/workbench', name: 'workbench', wait: 2000 },
  { route: '#/tutorial', name: 'tutorial', wait: 2000 },
  { route: '#/monitor', name: 'monitor', wait: 2000 },
  { route: '#/history', name: 'history', wait: 2000 },
  { route: '#/knowledge', name: 'knowledge', wait: 2000 },
  { route: '#/logs', name: 'logs', wait: 2000 },
  { route: '#/settings/general', name: 'settings-general', wait: 2000 },
  { route: '#/settings/ssh', name: 'settings-ssh', wait: 2000 },
  { route: '#/settings/terminal', name: 'settings-terminal', wait: 2000 },
  { route: '#/settings/model', name: 'settings-model', wait: 2000 },
  { route: '#/settings/appearance', name: 'settings-appearance', wait: 2000 },
  { route: '#/settings/about', name: 'settings-about', wait: 2000 },
]

fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })

for (const p of pages) {
  const page = await ctx.newPage()
  try {
    await page.goto(`${baseUrl}/${p.route}`, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(p.wait)
    const file = path.join(outDir, `${p.name}.png`)
    await page.screenshot({ path: file, fullPage: false })
    console.log('saved', file)
  } catch (e) {
    console.error('failed', p.name, e.message)
  } finally {
    await page.close()
  }
}

await browser.close()
