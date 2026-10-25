/**
 * 界面上写出来的快捷键，在真窗口里必须真能按（#227）
 *
 * 为什么要这条：2026-10-25 做对账时发现，界面里一共有五组"写在 kbd 里"的快捷键
 * （Ctrl+K 命令面板、Esc 关闭、终端里的 Ctrl+F 搜索 / Ctrl+±/0 缩放 / Ctrl+Shift+T·A 划词动作、
 * 编辑器 Ctrl+S 保存、审批条的 1/2 数字键）。代码里逐组 grep 都能找到处理器，
 * 但"找到处理器"不等于"按下去真有反应"——这正是 #222 那批假按钮的教训。
 *
 * 本文件覆盖其中两组**目前没有真窗口取证**的：Ctrl+K 唤出/关闭命令面板、终端里 Ctrl+F 唤出搜索栏。
 * 已有真窗口取证的（Ctrl+±/0 由 terminal-zoom-fit，Ctrl+Shift+A 由 terminal-translate）不重复。
 * 明确不覆盖：审批条的 1/2 数字键——在真窗口里造一次待审批请求要模型口令；
 * 那一路由 tests/components/permission-bar.test.tsx 在组件层钉住（默认动作是拒绝、数字键只改选中不提交）。
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startSshFixture } from './ssh-fixture-server'
import type { FixtureHandle } from './ssh-fixture-server'
import {
  FIXTURE_READY,
  bindSessionToStore,
  connectToFixture,
  launchApp,
  openShellViaIpc,
} from './ssh-fixture-helpers'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
const testOrSkip = FIXTURE_READY && BUILD_READY ? test : test.skip

if (!testOrSkip) {
  console.log(
    '[advertised-shortcuts] 跳过：需要假 SSH 靶子的前置条件成立且已 pnpm build' +
      '（skip 不等于通过，跑法见 ssh-fixture-server.ts 文件头）。',
  )
}

const KNOWN_HOSTS = path.join(os.tmpdir(), `tdsf-e2e-shortcuts-known_hosts-${process.pid}.txt`)
const PALETTE_PLACEHOLDER = '搜索知识库、历史决策...'
const SEARCH_PLACEHOLDER = '搜索（回车下一个，Shift+回车上一个）'

/** 拖过一行文字选中它（x 从行首往右量，够覆盖一个命令词）——与 terminal-translate.spec 同法 */
async function dragSelectLine(page: Page, lineText: string): Promise<void> {
  const line = page.locator('.terminal-view.visible .xterm-rows > div', { hasText: lineText }).last()
  await expect(line, `终端里没找到回显的 ${lineText}`).toBeVisible({ timeout: 20000 })
  const box = await line.boundingBox()
  if (!box) throw new Error('拿不到行元素的盒区')
  await page.mouse.move(box.x + 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 96, box.y + box.height / 2, { steps: 6 })
  await page.mouse.up()
}

test.describe('界面上写出来的快捷键', () => {
  test.beforeAll(() => {
    fs.writeFileSync(KNOWN_HOSTS, '', 'utf8')
  })

  test.afterAll(() => {
    if (fs.existsSync(KNOWN_HOSTS)) fs.unlinkSync(KNOWN_HOSTS)
  })

  testOrSkip('划词浮层：Ctrl+Shift+T 展开详解（本地终端，不用靶机）', async () => {
    test.setTimeout(120_000)
    const { app, page } = await launchApp()
    try {
      await page.evaluate(() => {
        window.location.hash = '#/workbench'
      })
      await page.waitForSelector('.wb-main-layout', { timeout: 15000 })
      await page.getByRole('button', { name: '开一个本机终端', exact: true }).click()
      await expect(page.locator('.term-tab-item')).toHaveCount(1)

      // 划词翻译是持久化偏好，先把前置条件归零再打开（判据要的是"从关到开"这条路径）
      const toggle = page.getByRole('button', { name: '划词翻译' })
      await expect(toggle).toBeVisible()
      if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
      expect(await toggle.getAttribute('aria-pressed')).toBe('true')

      await page.click('.terminal-view.visible')
      await page.keyboard.type('echo systemctl\r')
      await dragSelectLine(page, 'systemctl')

      const popover = page.locator('.sel-popover')
      await expect(popover, '划词后浮层应出现').toBeVisible({ timeout: 5000 })
      // 浮层上的 kbd 写着 Ctrl+Shift+T：按下之前详解面板不该在
      await expect(page.locator('.trans-panel')).toHaveCount(0)

      await page.keyboard.press('Control+Shift+T')
      await expect(page.locator('.trans-panel'), 'Ctrl+Shift+T 应展开详解面板').toBeVisible({ timeout: 5000 })

      // 再按一次收起（同一个键是开关，不是只能开）
      await page.keyboard.press('Control+Shift+T')
      await expect(page.locator('.trans-panel')).toHaveCount(0, { timeout: 5000 })
    } finally {
      await app.close()
    }
  })

  testOrSkip('Ctrl+K 唤出命令面板，Esc 把它关掉', async () => {
    test.setTimeout(90_000)
    const { app, page } = await launchApp()
    try {
      await page.waitForSelector('.wb-main-layout', { timeout: 20000 })
      // 先证明它本来没开：否则"按了之后在"可能是因为它一直在
      await expect(page.getByPlaceholder(PALETTE_PLACEHOLDER)).toHaveCount(0)

      await page.keyboard.press('Control+k')
      await expect(page.getByPlaceholder(PALETTE_PLACEHOLDER)).toBeVisible({ timeout: 5000 })

      await page.keyboard.press('Escape')
      await expect(page.getByPlaceholder(PALETTE_PLACEHOLDER)).toHaveCount(0, { timeout: 5000 })
    } finally {
      await app.close()
    }
  })

  testOrSkip('终端里 Ctrl+F 唤出搜索栏（按在 xterm 的隐藏输入框上）', async () => {
    test.setTimeout(150_000)
    let fixture: FixtureHandle | undefined
    const { app, page } = await launchApp()
    try {
      fixture = await startSshFixture()
      const connPromise = connectToFixture(page, {
        port: fixture.port,
        id: 'fixture-shortcuts',
        knownHostsPath: KNOWN_HOSTS,
      })
      await page.waitForSelector('[role="dialog"]', { timeout: 20000 })
      await page.getByRole('button', { name: '保存并继续' }).click()
      const conn = await connPromise
      const sessionId = conn.sessionId as string
      expect(sessionId, `连不上假靶机：${conn.error ?? ''}`).toBeTruthy()

      await bindSessionToStore(page, 'fixture-shortcuts', sessionId)
      await page.evaluate(() => {
        window.location.hash = '#/workbench'
      })
      await page.waitForSelector('.wb-main-layout', { timeout: 15000 })

      await openShellViaIpc(page, sessionId)
      const textarea = page.locator('.terminal-view.visible .xterm-helper-textarea')
      await textarea.waitFor({ state: 'attached', timeout: 20000 })

      // 搜索栏本来不该在
      await expect(page.getByPlaceholder(SEARCH_PLACEHOLDER)).toHaveCount(0)

      // Ctrl+F 的处理器由 xterm 的 attachCustomKeyEventHandler 接管（挂在 textarea 上收不到，
      // 见 TerminalView 那段注释）；焦点必须先落在终端输入框里，这是"用户点了终端再按键"的真实前提
      await textarea.focus()
      await page.keyboard.press('Control+f')
      await expect(page.getByPlaceholder(SEARCH_PLACEHOLDER)).toBeVisible({ timeout: 5000 })
    } finally {
      await app.close()
      if (fixture) await fixture.close()
    }
  })
})
