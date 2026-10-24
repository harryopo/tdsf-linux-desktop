/**
 * monitor-server-probe.spec.ts —— 监控页那格「服务器体检」的真链路（#212）
 *
 * 组件测试证明了这张卡的三态与文案；证明不了整条真链路：
 * 界面那一下按下去，主进程真的顺着 SSH 会话跑了 27 项探查、把风险算回来，
 * 而点「导出 md」之后**盘上真的多了一个文件**，位置由主进程定在应用数据目录里，
 * 界面只是把它显示出来。
 *
 * 对端是 tests/e2e/ssh-fixture-server.ts 演的假 SSH（exec 通道固定回显，
 * uname / hostname 答得像台真机器）。所以这条判的是【我们这一侧】的接线，
 * 不是探查结果在真实 Linux 上准不准——那归内网靶机上的 ssh-live-verification。
 *
 * 运行：pnpm build && npx playwright test tests/e2e/monitor-server-probe.spec.ts
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startSshFixture } from './ssh-fixture-server'
import type { FixtureHandle } from './ssh-fixture-server'
import {
  bindSessionToStore,
  connectToFixture,
  e2eProfileDir,
  launchApp,
} from './ssh-fixture-helpers'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
if (!BUILD_READY) console.log('[server-probe] 跳过：缺 out/main/index.js，先 pnpm build')
const testOrSkip = BUILD_READY ? test : test.skip

/** 本次运行专属 known_hosts（临时目录，跑完删掉——只删我自己造的） */
const KNOWN_HOSTS = path.join(os.tmpdir(), `tdsf-e2e-probe-known_hosts-${process.pid}.txt`)

testOrSkip('体检这格：按下去真跑、导出真落盘、落点由主进程定', async () => {
  test.setTimeout(180_000)

  const fixture: FixtureHandle = await startSshFixture()
  fs.writeFileSync(KNOWN_HOSTS, '', 'utf8')
  const { app, page } = await launchApp()
  const SERVER_ID = 'probe-fixture-server'

  try {
    // 真实路径里这台机器是先存进服务器列表、再从列表连上的：体检要用配置里那个地址
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

    // 首连这台 fixture 会弹主机密钥确认，走真实用户路径点「保存并继续」把连接放过去
    const connPromise = connectToFixture(page, { port: fixture.port, id: SERVER_ID, knownHostsPath: KNOWN_HOSTS })
    await page.waitForSelector('[role="dialog"]', { timeout: 20_000 })
    await page.getByRole('button', { name: '保存并继续' }).click()
    const conn = await connPromise
    expect(conn.sessionId, `连不上 fixture：${conn.error ?? ''}`).toBeTruthy()
    await bindSessionToStore(page, SERVER_ID, conn.sessionId!)

    await page.evaluate(() => {
      window.location.hash = '#/monitor'
    })

    const card = page.locator('section[aria-label="服务器体检"]')
    await expect(card, '监控页里没有「服务器体检」这一格').toBeVisible({ timeout: 20_000 })

    // 主机名要等 monitor:get-system-info 回来，这一格才有体检对象
    const runBtn = card.getByRole('button', { name: /开始体检/ })
    await expect(runBtn, '会话连上了但按钮一直不让按（主机名没读到）').toBeEnabled({ timeout: 30_000 })

    await runBtn.click()
    // 真跑一次：界面必须给出主进程算出来的风险摘要，而不是一句"0 条风险"的安慰
    const summary = card.getByText(/共 \d+ 条风险/)
    await expect(summary, '点了体检但界面没等到摘要').toBeVisible({ timeout: 90_000 })
    // 摘要上的主机就是这条会话连的地址（连接配置里那个），不是远端 uname 输出的一整行
    await expect(card.getByText('目标主机：127.0.0.1'), '体检对象标错了机器').toBeVisible()

    // 导出：渲染层只递正文 + 主机名，路径由主进程定，界面把主进程回的那条显示出来
    await card.getByRole('button', { name: /导出 md/ }).click()
    const shown = await card
      .getByText(/已导出：/)
      .innerText({ timeout: 30_000 })
    const shownPath = shown.replace('已导出：', '').trim()

    expect(fs.existsSync(shownPath), `界面说写过了，但盘上没有：${shownPath}`).toBe(true)
    const reportsDir = path.join(e2eProfileDir(), 'reports')
    const real = path.resolve(shownPath)
    expect(
      real.startsWith(reportsDir + path.sep),
      `文件没落在主进程自己的 reports 目录：${real}`,
    ).toBe(true)
    const body = fs.readFileSync(real, 'utf8')
    expect(body, '落盘内容是空的').toContain('系统架构感知报告')
    expect(path.basename(real)).toMatch(/^system-report-127\.0\.0\.1-\d{8}-\d{6}\.md$/)
  } finally {
    await app.close()
    await fixture.close()
    fs.rmSync(KNOWN_HOSTS, { force: true })
  }
})
