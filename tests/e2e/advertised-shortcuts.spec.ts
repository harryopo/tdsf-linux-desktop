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

/**
 * 双击终端里那一整行的词，把它选中
 *
 * 三条都是当场踩出来的（2026-10-27 全量里这条红过一次，AI 输入框里 prefill 的是 `PS C:\Users\`）：
 * ① 按**整行等于** needle 选行，不按"包含"——按包含会撞上命令回显那一行
 *   （`PS C:\Users\Administrator> echo journalctl`），划它选到的是提示符而不是那个词。
 * ② 用双击（xterm 自己的选词手势），不从行首拖像素：拖满整行会把行尾那些空列一起选进
 *   selection，取词那一步拿到 `journalctl␣␣␣…` 就什么都查不到（同族那条翻译判据当场被它带红）；
 *   而拖固定 96 像素既不覆盖整词也不管字号——一格多宽本来就由字号与容器决定。
 * ③ 选完先证浮层里那个词真是它，再让调用方去按快捷键：选错要红在选这一步，
 *   而不是红成"快捷键没生效"。
 */
async function selectWordOnLine(page: Page, lineText: string): Promise<void> {
  const esc = lineText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const line = page
    .locator('.terminal-view.visible .xterm-rows > div', { hasText: new RegExp(`^\\s*${esc}\\s*$`) })
    .last()
  await expect(line, `终端里没有"${lineText}"这一整行（输出还没画出来，或只找到带它的回显行）`).toBeVisible({
    timeout: 20000,
  })
  const box = await line.boundingBox()
  if (!box) throw new Error('拿不到行元素的盒区')
  // x 落在第一个字符那一格里（行首往右 6 像素），双击选中它所属的那个词
  await page.mouse.dblclick(box.x + 6, box.y + box.height / 2)
  await expect(page.locator('.sel-popover .sel-word'), '选出来的词不是那一整行').toContainText(lineText, {
    timeout: 5000,
  })
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
      await selectWordOnLine(page, 'systemctl')

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

  testOrSkip('划词浮层：Ctrl+Shift+A 把选中文本送进 AI 输入框（本地终端，不用靶机）', async () => {
    test.setTimeout(120_000)
    const { app, page } = await launchApp()
    try {
      await page.evaluate(() => {
        window.location.hash = '#/workbench'
      })
      await page.waitForSelector('.wb-main-layout', { timeout: 15000 })
      await page.getByRole('button', { name: '开一个本机终端', exact: true }).click()
      await expect(page.locator('.term-tab-item')).toHaveCount(1)

      const toggle = page.getByRole('button', { name: '划词翻译' })
      await expect(toggle).toBeVisible()
      if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
      expect(await toggle.getAttribute('aria-pressed')).toBe('true')

      await page.click('.terminal-view.visible')
      await page.keyboard.type('echo journalctl\r')
      await selectWordOnLine(page, 'journalctl')

      const popover = page.locator('.sel-popover')
      await expect(popover, '划词后浮层应出现').toBeVisible({ timeout: 5000 })
      // 按钮上那片 kbd 写的是 Ctrl+Shift+A：按之前输入框里不该有这个词
      const composer = page.locator('textarea[placeholder^="您正在与 Agent 聊天"]')
      await expect(composer).toBeVisible()
      expect(await composer.inputValue(), '前置：输入框本来就带着词，这条测不出什么').not.toContain('journalctl')

      await page.keyboard.press('Control+Shift+A')
      await expect(
        composer,
        'Ctrl+Shift+A 应把选中文本 prefill 进 AI 输入框'
      ).toHaveValue(/journalctl/, { timeout: 5000 })
      // 送出去之后浮层要收掉（否则用户会以为还要再点一次"发送到 AI"）
      await expect(popover).toHaveCount(0, { timeout: 5000 })
    } finally {
      await app.close()
    }
  })

  testOrSkip('Ctrl+K 唤出命令面板，Esc 把它关掉', async () => {
    test.setTimeout(90_000)
    const { app, page } = await launchApp()
    try {
      await page.waitForSelector('.wb-main-layout', { timeout: 20000 })
      // 快捷键的监听挂在工作台标题栏上，而工作台是懒加载的：只等外层壳会按在一还不存在的监听上
      await page.locator('[data-dom-id="btn-toggle-ai"]').waitFor({ state: 'visible', timeout: 20_000 })
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
      const searchInput = page.getByPlaceholder(SEARCH_PLACEHOLDER)
      await expect(searchInput).toBeVisible({ timeout: 5000 })

      // #238：焦点回到终端后 Esc 仍要能关掉搜索栏（以前只有输入框自己收得到 Esc）
      await textarea.focus()
      await page.keyboard.press('Escape')
      await expect(searchInput, '焦点不在搜索框时 Esc 没关掉搜索栏').toHaveCount(0, { timeout: 5000 })

      // 搜索栏已经开着时再按 Ctrl+F：要回到输入框，而不是"什么都不发生"
      await page.keyboard.press('Control+f')
      await expect(searchInput).toBeVisible({ timeout: 5000 })
      await expect(searchInput, '再按 Ctrl+F 没把焦点送回搜索框').toBeFocused()
    } finally {
      await app.close()
      if (fixture) await fixture.close()
    }
  })
})
