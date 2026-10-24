/**
 * workbench-file-search.spec.ts —— 资源管理器那格「在服务器上搜」的真链路（#213）
 *
 * 组件测试证明了面板的三态与文案；证明不了这一下按下去真的顺着 SSH 会话跑了一条
 * `find`、结果从远端回来到屏幕上、点一行真的把编辑器拉去开那个文件。
 *
 * 对端是 tests/e2e/ssh-fixture-server.ts 演的假 SSH：它的 exec 通道会答 find / grep
 * （见那边的 execOutput）。所以这条判的是【我们这一侧】的接线——
 * 渲染层那一下点击有没有真的走到主进程、主进程的解析有没有真的回到界面上。
 * 夹具没有 SFTP 子系统，所以点结果之后读正文一定会失败；这条把这个失败也当成判据：
 * **读不到必须说读不到**，不许开一个空白标签骗人"已经打开了"。
 *
 * 运行：pnpm build && npx playwright test tests/e2e/workbench-file-search.spec.ts
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startSshFixture } from './ssh-fixture-server'
import type { FixtureHandle } from './ssh-fixture-server'
import { bindSessionToStore, connectToFixture, launchApp } from './ssh-fixture-helpers'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
if (!BUILD_READY) console.log('[file-search] 跳过：缺 out/main/index.js，先 pnpm build')
const testOrSkip = BUILD_READY ? test : test.skip

const KNOWN_HOSTS = path.join(os.tmpdir(), `tdsf-e2e-search-known_hosts-${process.pid}.txt`)

testOrSkip('远程搜索：开关点得开、结果真从 SSH 回来、到上限敢说可能不全、点结果真的去开文件', async () => {
  test.setTimeout(180_000)

  const fixture: FixtureHandle = await startSshFixture()
  fs.writeFileSync(KNOWN_HOSTS, '', 'utf8')
  const { app, page } = await launchApp()
  const SERVER_ID = 'search-fixture-server'

  try {
    await page.evaluate((id) => {
      const stores = (window as unknown as {
        __tdsfStores?: { server: { getState: () => { addServer: (cfg: unknown) => Promise<boolean> } } }
      }).__tdsfStores
      if (!stores) throw new Error('__tdsfStores 未挂载')
      return stores.server.getState().addServer({
        id,
        name: 'Fixture靶机',
        host: '127.0.0.1',
        port: 22,
        username: 'fixture',
        authType: 'password',
      })
    }, SERVER_ID)

    // 首连会弹主机密钥确认，走真实用户路径点「保存并继续」
    const connPromise = connectToFixture(page, {
      port: fixture.port,
      id: SERVER_ID,
      knownHostsPath: KNOWN_HOSTS,
    })
    await page.waitForSelector('[role="dialog"]', { timeout: 20_000 })
    await page.getByRole('button', { name: '保存并继续' }).click()
    const conn = await connPromise
    expect(conn.sessionId, `连不上 fixture：${conn.error ?? ''}`).toBeTruthy()
    await bindSessionToStore(page, SERVER_ID, conn.sessionId!)

    await page.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await expect(page.locator('.wb-filetree'), '工作台里没有出现资源管理器').toBeVisible({
      timeout: 20_000,
    })

    const toggle = page.getByRole('button', { name: '搜索远程文件' })
    await expect(toggle, '会话连上了但搜索开关一直不让点').toBeEnabled({ timeout: 20_000 })
    await toggle.click()

    const panel = page.locator('section[aria-label="远程文件搜索"]')
    await expect(panel).toBeVisible()

    // 按文件名搜：结果必须是夹具那台"机器"回的两条路径，不是界面自己编的
    await panel.getByRole('textbox', { name: '搜索远程文件' }).fill('nginx')
    await panel.getByRole('button', { name: '搜索' }).click()
    await expect(panel.getByRole('button', { name: /nginx\.conf/ })).toBeVisible({ timeout: 30_000 })
    await expect(panel.locator('.wb-file-search-item')).toHaveCount(2)

    // 到顶那一档：夹具正好回 50 条，界面必须说"可能不全"
    await panel.getByRole('textbox', { name: '搜索远程文件' }).fill('many')
    await panel.getByRole('button', { name: '搜索' }).click()
    await expect(panel.locator('.wb-file-search-item')).toHaveCount(50, { timeout: 30_000 })
    await expect(panel.getByText(/结果已到上限（50 条），可能不全/), '到上限却没说可能不全').toBeVisible()

    // 按内容搜：行号要显示出来，点下去要真的去开那个文件
    await panel.getByRole('radio', { name: '内容' }).click()
    await panel.getByRole('textbox', { name: '搜索远程文件' }).fill('listen')
    await panel.getByRole('button', { name: '搜索' }).click()
    const hit = panel.getByRole('button', { name: /第 12 行/ })
    await expect(hit, '内容搜索没把行号带回界面').toBeVisible({ timeout: 30_000 })
    await expect(panel.getByText(/结果已到上限（100 条）/), '只有 2 条却报了上限').toHaveCount(0)

    await hit.click()
    const tab = page.locator('[data-tab-id="file:/etc/nginx/conf.d/default.conf"]')
    await expect(tab, '点了搜索结果但编辑器没开这个文件').toBeVisible({ timeout: 20_000 })

    // 夹具不演 SFTP，读正文必然失败——这时界面要说清读不到，而不是留一个空白标签
    const err = page.locator('.term-file-error')
    await expect(err, '读不到正文却没报错（空白标签等于骗人）').toBeVisible({ timeout: 30_000 })
    await expect(err).toContainText('/etc/nginx/conf.d/default.conf')
  } finally {
    await app.close()
    await fixture.close()
    fs.rmSync(KNOWN_HOSTS, { force: true })
  }
})
