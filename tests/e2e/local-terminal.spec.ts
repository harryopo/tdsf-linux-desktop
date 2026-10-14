/**
 * 本机终端（W3 的交付物判据）
 *
 * 要证的三件事，都是"必须先连 SSH 才有终端"时期做不到的：
 *   1. 没连任何服务器，也能从工作台空态开出本机终端（标签上写着用的是哪个 shell）；
 *   2. 真实按键 → 真 PTY → 真 shell → 输出回到渲染进程（不是本地拼出来的字符串）；
 *   3. 关掉标签后主进程那条通道真的没了（不然机器上留一堆僵尸 shell）。
 *
 * 输出用 installTerminalTap 旁听原始流来判定：它听的是主进程真正推出来的字节，
 * 比"截图看着像"可判定得多，也不需要为测试在产品里开一个读屏幕的口子。
 *
 * 风险闸（本机命令也过闸）在 tests/unit/ipc-local-terminal-gate.test.ts 里判——
 * 那里用假 manager，敢拒也可以敢不拒；这里不能拿真 shell 去试 rm -rf。
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { installTerminalTap, launchApp } from './ssh-fixture-helpers'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
const testOrSkip = BUILD_READY ? test : test.skip

if (!BUILD_READY) {
  console.log('[local-terminal] 跳过：需要先 pnpm build（out/main/index.js 不存在）。')
}

test.describe('本机终端：不连服务器也能敲命令', () => {
  testOrSkip('空态开终端 → 真回显 → 关掉后主进程通道消失', async () => {
    test.setTimeout(120_000)
    const { app, page } = await launchApp()
    try {
      await page.evaluate(() => {
        window.location.hash = '#/workbench'
      })
      await page.waitForSelector('.wb-main-layout', { timeout: 15000 })

      const readTap = await installTerminalTap(page)

      // 空态里的主行动按钮（没连服务器时它就是"开一个本机终端"）
      await page.getByRole('button', { name: '开一个本机终端', exact: true }).click()

      await expect(page.locator('.term-tab-item')).toHaveCount(1, { timeout: 15000 })
      // 标签必须说清这是本机的哪个 shell，只写"终端"分不清本机还是远端
      await expect(page.locator('.term-tab-item').first()).toContainText('本机')

      const listViaIpc = async (): Promise<string[]> =>
        page.evaluate(() =>
          (
            window as unknown as { electronAPI: { localTtyList: () => Promise<string[]> } }
          ).electronAPI.localTtyList(),
        )
      const opened = await listViaIpc()
      expect(opened, '主进程那边必须真开着一条通道').toHaveLength(1)

      const MARK = `tdsf-local-${Date.now().toString(36)}`
      await page.click('.terminal-view.visible')
      await page.keyboard.type(`echo ${MARK}\r`)

      await expect
        .poll(async () => (await readTap()).includes(MARK), {
          message: `按键要真的走到 shell 再回显，实际收到的流=${JSON.stringify((await readTap()).slice(0, 300))}`,
          timeout: 25000,
        })
        .toBe(true)

      // 关掉标签：主进程那条通道必须一起没了（杀进程树 + dispose）
      await page.locator('.term-tab-item').first().locator('.term-tab-close').click()
      await expect(page.locator('.term-tab-item')).toHaveCount(0)
      await expect
        .poll(listViaIpc, { message: '关掉标签后主进程不该还留着通道', timeout: 15000 })
        .toEqual([])
    } finally {
      await app.close()
    }
  })
})
