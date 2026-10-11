/**
 * 端口预览（W5 的交付物判据）
 *
 * 要证的不是"iframe 能显示东西"，而是这一整条链真的通：
 *   渲染层 previewOpen → 主进程铸句柄 → tdsf-preview: 协议 → SSH direct-tcpip 隧道
 *   → 目标端口上的 HTTP 服务 → 字节回到 iframe
 *
 * 靶子怎么搭：假 SSH 服务（ssh-fixture-server）的 direct-tcpip 会把通道接到
 * **测试进程这台机器**的 destIP:destPort（见它 'tcpip' 那段），所以本用例在本地起一个
 * 一次性 HTTP 服务当"远端服务"。这条链任何一环没接上，页面就是空白或 502。
 *
 * 两条反向判据同样重要：
 * - 没人在听的端口 → 必须看到 502 文案（不是静默空白，那说明错误被吞了）
 * - iframe 必须带 sandbox="allow-scripts" 且不含 allow-same-origin
 *   （被预览的是不可信的第三方页面，不给这条等于让它读本应用的 DOM 与存储）
 */
import { test, expect } from '@playwright/test'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { startSshFixture } from './ssh-fixture-server'
import type { FixtureHandle } from './ssh-fixture-server'
import {
  FIXTURE_READY,
  bindSessionToStore,
  connectToFixture,
  launchApp,
} from './ssh-fixture-helpers'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
const testOrSkip = FIXTURE_READY && BUILD_READY ? test : test.skip

if (!BUILD_READY) {
  console.log('[preview-tunnel] 跳过：需要先 pnpm build（out/main/index.js 不存在）。')
}

const KNOWN_HOSTS = path.join(
  os.tmpdir(),
  `tdsf-e2e-preview-known_hosts-${process.pid}.txt`,
)

/** 一次性"远端服务"：任何路径都回同一页 HTML，带一个可断言的标记 */
function startLocalService(marker: string): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><html><head><title>preview-fixture</title></head>` +
          `<body><h1 id="mark">${marker}</h1><p>来自隧道另一侧的服务</p></body></html>`,
      )
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo
      resolve({ server, port: addr.port })
    })
  })
}

/** 找一个确定没人听的端口：listen(0) 拿到端口后立刻关掉 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port
      srv.close(() => resolve(port))
    })
  })
}

test.describe('端口预览', () => {
  let fixture: FixtureHandle

  test.beforeAll(async () => {
    fixture = await startSshFixture()
    fs.writeFileSync(KNOWN_HOSTS, '', 'utf8')
  })

  test.afterAll(async () => {
    await fixture.close()
    if (fs.existsSync(KNOWN_HOSTS)) fs.unlinkSync(KNOWN_HOSTS)
  })

  testOrSkip('隧道取回真实字节，坏端口给出可见错误，iframe 带 sandbox', async () => {
    test.setTimeout(180_000)
    const MARK = `tdsf-preview-${Date.now().toString(36)}`
    const { server: service, port } = await startLocalService(MARK)
    const deadPort = await freePort()
    const { app, page } = await launchApp()

    try {
      const connPromise = connectToFixture(page, {
        port: fixture.port,
        id: 'fixture-preview',
        knownHostsPath: KNOWN_HOSTS,
      })
      await page.waitForSelector('[role="dialog"]', { timeout: 20000 })
      await page.getByRole('button', { name: '保存并继续' }).click()
      const conn = await connPromise
      const sessionId = conn.sessionId as string
      expect(sessionId, `连不上假靶机：${conn.error ?? ''}`).toBeTruthy()

      await bindSessionToStore(page, 'fixture-preview', sessionId)
      await page.evaluate(() => {
        window.location.hash = '#/workbench'
      })
      await page.waitForSelector('.wb-main-layout', { timeout: 20000 })

      // 走真实用户路径：标签条右上角的地球按钮 → 弹窗填端口 → 打开预览
      await page.click('[data-dom-id="term-preview-port"]')
      await page.fill('[data-dom-id="preview-port-input"]', String(port))
      await page.getByRole('button', { name: '打开预览' }).click()

      const tab = page.locator('.term-tab-item', { hasText: `端口 ${port}` })
      await expect(tab, '预览标签没开出来').toHaveCount(1)

      // 预览面板是内容区里唯一带 iframe 的那块
      const iframe = page.locator('.term-content-area iframe')
      await expect(iframe, '预览面板里没有 iframe').toHaveCount(1)
      // 不可信内容必须关在沙箱里：允许跑脚本，但不给 same-origin
      await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
      expect(await iframe.getAttribute('sandbox')).not.toContain('allow-same-origin')

      // 帧的导航是异步提交的：page.frames() 是快照，刚挂上时那条还没有 url
      await expect
        .poll(() => page.frames().filter((f) => f.url().startsWith('tdsf-preview://')).length, {
          message: `iframe src=${await iframe.getAttribute('src')}；页面里的 frame：${page
            .frames()
            .map((f) => f.url() || '(空)')
            .join(' , ')}`,
          timeout: 20000,
        })
        .toBe(1)
      const previewFrame = page.frames().find((f) => f.url().startsWith('tdsf-preview://'))
      await expect(previewFrame!.locator('#mark'), '隧道另一侧的字节没回到页面').toHaveText(MARK, {
        timeout: 20000,
      })

      // 关掉标签 → iframe 必须一起消失（句柄作废由单测盯）
      await tab.locator('.term-tab-close').click()
      await expect(page.locator('.term-content-area iframe')).toHaveCount(0)

      // 反向判据：没人在听的端口要给出可见错误，不许静默空白
      await page.click('[data-dom-id="term-preview-port"]')
      await page.fill('[data-dom-id="preview-port-input"]', String(deadPort))
      await page.getByRole('button', { name: '打开预览' }).click()
      await expect
        .poll(() => page.frames().filter((f) => f.url().startsWith('tdsf-preview://')).length, {
          message: '第二个预览（没人听的端口）的 iframe 没挂上',
          timeout: 20000,
        })
        .toBeGreaterThan(0)
      const dead = page.frames().filter((f) => f.url().startsWith('tdsf-preview://')).at(-1)
      await expect(dead!.locator('body'), '端口连不上时必须看到可见的错误文案').toContainText(
        '请求失败',
        { timeout: 20000 },
      )
    } finally {
      service.close()
      await app.close()
    }
  })
})
