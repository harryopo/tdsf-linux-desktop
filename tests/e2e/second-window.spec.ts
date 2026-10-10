/**
 * 第二个应用窗口（W4 的交付物判据）
 *
 * 要证的不是"能开两个窗口"（那只是 Electron 的 API），而是两个窗口看的是同一个事实：
 *   1. 窗口一开出来的终端，窗口二靠与主进程的对账自己就把标签显示出来（不需要窗口间同步协议）；
 *   2. 在窗口二里敲的字符进到同一个 shell，输出同时回到两个窗口；
 *   3. 关掉窗口二不会把那条终端一起带走（终端属于通道，不属于哪个窗口开出来的）。
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { installTerminalTap, launchApp } from './ssh-fixture-helpers'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
const testOrSkip = BUILD_READY ? test : test.skip

if (!BUILD_READY) {
  console.log('[second-window] 跳过：需要先 pnpm build（out/main/index.js 不存在）。')
}

test.describe('两个窗口共用同一张终端表', () => {
  testOrSkip('窗口二自动出现窗口一开的终端，敲的字进同一个 shell', async () => {
    test.setTimeout(150_000)
    const { app, page: winA } = await launchApp()
    try {
      await winA.evaluate(() => {
        window.location.hash = '#/workbench'
      })
      await winA.waitForSelector('.wb-main-layout', { timeout: 15000 })
      const tapA = await installTerminalTap(winA)

      await winA.getByRole('button', { name: '开一个本机终端', exact: true }).click()
      await expect(winA.locator('.term-tab-item'), { timeout: 15000 }).toHaveCount(1)

      // 开第二个窗口，并让它也进工作台
      const [winB] = await Promise.all([
        app.waitForEvent('window'),
        winA.evaluate(() =>
          (window as unknown as { electronAPI: { windowOpenSecondary: () => Promise<number> } })
            .electronAPI.windowOpenSecondary(),
        ),
      ])
      await winB.waitForSelector('body', { timeout: 30000 })
      await winB.evaluate(() => {
        window.location.hash = '#/workbench'
      })
      await winB.waitForSelector('.wb-main-layout', { timeout: 15000 })
      const tapB = await installTerminalTap(winB)

      // 判据 1：窗口二没人点过"新建终端"，标签必须靠对账自己出现
      await expect(winB.locator('.term-tab-item'), {
        timeout: 20000,
        message: '窗口二没显示窗口一开着的终端——投影断了',
      }).toHaveCount(1)
      await expect(winB.locator('.term-tab-item').first()).toContainText('本机')

      // 判据 2：在窗口二里敲，两个窗口都该收到同一个 shell 的回显
      const MARK = `tdsf-two-win-${Date.now().toString(36)}`
      await winB.click('.terminal-view.visible')
      await winB.keyboard.type(`echo ${MARK}\r`)
      await expect
        .poll(async () => (await tapB()).includes(MARK), {
          message: '窗口二自己该看到回显',
          timeout: 25000,
        })
        .toBe(true)
      await expect
        .poll(async () => (await tapA()).includes(MARK), {
          message: '同一个 shell 的输出必须也回到窗口一（广播，不是只发给开它的那个窗口）',
          timeout: 25000,
        })
        .toBe(true)

      // 判据 3：关掉窗口二，终端还在（窗口一仍能用它）
      await winB.close()
      await expect
        .poll(
          async () =>
            winA.evaluate(() =>
              (
                window as unknown as { electronAPI: { localTtyList: () => Promise<string[]> } }
              ).electronAPI.localTtyList(),
            ),
          { message: '关一个窗口不该带走终端通道', timeout: 15000 },
        )
        .toHaveLength(1)
      await expect(winA.locator('.term-tab-item')).toHaveCount(1)
    } finally {
      await app.close()
    }
  })
})
