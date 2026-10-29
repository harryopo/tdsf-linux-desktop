/**
 * config-shape-error.spec.ts —— 服务器列表被写坏时，界面不许说"暂无服务器"（#260）
 *
 * 实测（改前）：`config.json` 里 `sshServers` 被写成字符串，主进程按设计抛错
 * （防止空列表反写覆盖），渲染层只在 console 记一行，界面照常显示
 * 「暂无服务器 · 点击添加开始配置」——把一次读失败演成了用户的事实。
 *
 * 这条起一个带坏配置的真实档位，去 SSH 设置页看它到底说了什么。
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, type ElectronApplication } from '@playwright/test'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')
const BUILD_READY = fs.existsSync(MAIN_ENTRY)
if (!BUILD_READY) console.log('[config-shape] 跳过：缺 out/main/index.js，先 pnpm build')
const testOrSkip = BUILD_READY ? test : test.skip

test.describe('配置形状不对时的界面口径', () => {
  let app: ElectronApplication
  let profile: string

  test.beforeAll(async () => {
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-e2e-shape-'))
    // 合法 JSON，但 sshServers 是字符串——loadServerList 会抛"不是数组"
    fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({ sshServers: 'oops' }))
    app = await electron.launch({
      args: [MAIN_ENTRY, `--user-data-dir=${profile}`],
      env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
    })
  })

  test.afterAll(async () => {
    await app?.close()
    if (profile) fs.rmSync(profile, { recursive: true, force: true })
  })

  testOrSkip('服务器列表读不出来时，说原因而不是「暂无服务器」', async () => {
    const page = await app.firstWindow()
    await page.waitForSelector('body', { timeout: 30_000 })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForSelector('.wb-main-layout', { timeout: 30_000 })

    await page.evaluate(() => (window.location.hash = '#/settings/ssh'))
    const banner = await page
      .waitForSelector('[data-dom-id="ssh-servers-load-error"]', { timeout: 15_000 })
      .catch(() => null)
    expect(banner, '读失败没有任何界面提示，用户只会看到"暂无服务器"').not.toBeNull()

    const text = await page.evaluate(() => document.body.innerText)
    expect(text).toContain('服务器列表读不出来')
    expect(text, '原因要写出来，否则用户不知道是配置坏了还是真没有').toContain('不是数组')
    expect(text, '读失败不许演成"你没有服务器"').not.toContain('暂无服务器')
    expect(text, '修复后要能就地重读，不用重启应用').toContain('重新读取')
  })
})
