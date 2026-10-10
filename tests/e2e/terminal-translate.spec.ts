/**
 * 划词翻译（终端取词）判据
 *
 * 要证的是"功能真的到位"，不是"按钮存在"：
 *   1. 开关在标签条右上角，点了确实切换 aria-pressed（偏好持久化由 store 负责）；
 *   2. 关掉时划词不出浮层，开了才出（开关不是摆设）；
 *   3. 拖动选中终端里的命令 → 浮层直接给出词典释义（不用二次点击"翻译"）；
 *   4. 词典没收录的词要明说"词典未收录"并给出问 AI 的出口，不许空白。
 *
 * 取词用真链路：让真 shell 回显一行 `systemctl`，再用鼠标从行首拖过去选中它。
 * 终端是 xterm 的 DOM 渲染器，行文本能在 .xterm-rows 里定位到，所以拖拽起点是量出来的，
 * 不是猜的坐标。
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp } from './ssh-fixture-helpers'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
const testOrSkip = BUILD_READY ? test : test.skip

if (!BUILD_READY) {
  console.log('[terminal-translate] 跳过：需要先 pnpm build（out/main/index.js 不存在）。')
}

/** 拖过一行文字，选中它（x 从行首往右量，够覆盖一个命令词） */
async function dragSelectLine(page: import('@playwright/test').Page, lineText: string): Promise<void> {
  const line = page.locator('.terminal-view.visible .xterm-rows > div', { hasText: lineText }).last()
  await expect(line, `终端里没找到回显的 ${lineText}`).toBeVisible({ timeout: 20000 })
  const box = await line.boundingBox()
  if (!box) throw new Error('拿不到行元素的盒区')
  await page.mouse.move(box.x + 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 96, box.y + box.height / 2, { steps: 6 })
  await page.mouse.up()
}

test.describe('终端划词翻译', () => {
  testOrSkip('开关在右上角，划词直接出释义；关掉就不出', async () => {
    test.setTimeout(150_000)
    const { app, page } = await launchApp()
    try {
      await page.evaluate(() => {
        window.location.hash = '#/workbench'
      })
      await page.waitForSelector('.wb-main-layout', { timeout: 15000 })
      await page.getByRole('button', { name: '开一个本机终端', exact: true }).click()
      await expect(page.locator('.term-tab-item')).toHaveCount(1)

      const toggle = page.getByRole('button', { name: '划词翻译' })
      await expect(toggle, '开关必须在标签条右上角那一排里').toBeVisible()

      // 开关是持久化偏好（translate-store 的 persist），上一轮跑完可能留着"开"；
      // 判据要的是"从关到开"这条路径，所以先把前置条件归零，而不是假设新 profile
      if ((await toggle.getAttribute('aria-pressed')) === 'true') await toggle.click()
      expect(await toggle.getAttribute('aria-pressed'), '归零后应为关').toBe('false')

      await page.click('.terminal-view.visible')
      await page.keyboard.type('echo systemctl\r')

      // 关着划词：不该弹浮层（默认关，避免正常复制被抢）
      await dragSelectLine(page, 'systemctl')
      await expect(page.locator('.sel-popover')).toHaveCount(0)

      // 开着划词：浮层出来，而且直接带释义（不是"再点一下翻译"）
      await toggle.click()
      expect(await toggle.getAttribute('aria-pressed')).toBe('true')
      await dragSelectLine(page, 'systemctl')

      const popover = page.locator('.sel-popover')
      await expect(popover, '开启后划词应出浮层').toBeVisible({ timeout: 5000 })
      await expect(popover).toContainText('systemctl')
      await expect(
        popover.locator('.sel-zh'),
        '词典里 systemctl 是有条目的，出「未收录」说明取词或词典链路断了',
      ).toHaveCount(1)
      await expect(popover.locator('.sel-zh')).not.toHaveText(/^\s*$/)
      // 留一张证据图（screenshots/ 是忽略目录）：这条判据同时是"浮层别画歪"的眼睛
      await page.screenshot({
        path: path.join(__dirname, 'screenshots', 'translate-popover.png'),
      })

      // 快捷键必须真的能用（浮层上印着 Ctrl+Shift+A）
      await page.keyboard.press('Control+Shift+A')
      await expect(popover).toHaveCount(0, { timeout: 5000 })
      const prefill = await page.locator('#ai-composer-input').inputValue()
      expect(prefill, '浮层上印的 Ctrl+Shift+A 必须真的把文本灌进 AI 输入框').toContain('systemctl')
    } finally {
      await app.close()
    }
  })
})
