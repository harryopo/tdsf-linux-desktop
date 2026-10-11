/**
 * 用户键入/粘贴的高危命令必须被拦（P0-2 的承诺级判据）
 *
 * 巡检 §9 要求每条 P0 配一条"用户做 X，产品做 Y"的测试，这条就是 P0-2 的那条：
 *   用户在**自己的**终端里手敲 `rm -rf /` 并按回车 → 屏幕出现"已拦截高危命令"，
 *   而且这条命令没有交给 shell 执行。
 *
 * 判"没执行"不靠猜平台错误文案，靠一个跨平台都成立的推断：
 * 被拦之后另起一行 `echo <标记>`，输出里必须出现**单独一行**的标记值 ——
 * 只有前一行被真的丢掉（stdin 收到 Ctrl-U）才可能如此；若前一行还躺在
 * readline 缓冲里，标记就会被拼进那条命令一起执行。
 *
 * 注意：本机 shell 在 Windows 上是 pwsh/powershell/cmd，在 Linux 上是 bash，
 * `echo X` 三边都成立；被拦的命令本身从不落到 shell，所以不需要它平台可用。
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { installTerminalTap, launchApp } from './ssh-fixture-helpers'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
const testOrSkip = BUILD_READY ? test : test.skip

if (!BUILD_READY) {
  console.log('[command-gate] 跳过：需要先 pnpm build（out/main/index.js 不存在）。')
}

/** 把主进程推过来的 ANSI 去掉，方便按行判断 */
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')

async function openLocalTerminal(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '#/workbench'
  })
  await page.waitForSelector('.wb-main-layout', { timeout: 15000 })
  await page.getByRole('button', { name: '开一个本机终端', exact: true }).click()
  await expect(page.locator('.term-tab-item'), { timeout: 15000 }).toHaveCount(1)
  await page.click('.terminal-view.visible')
}

test.describe('用户输入过闸（P0-2）', () => {
  testOrSkip('手敲 rm -rf / 回车：出现拦截提示，且命令没被交给 shell', async () => {
    test.setTimeout(150_000)
    const { app, page } = await launchApp()
    try {
      await openLocalTerminal(page)
      const readTap = await installTerminalTap(page)
      const ts = Date.now().toString(36)

      // 先立一个基线：证明这个终端真的能执行命令（否则后面的"没执行"是假证据）。
      // 判据取"标记单独成行"——输入回显是 `echo BASE_x`，只有真执行才会打印出 `BASE_x` 这一行。
      await page.keyboard.type(`echo BASE_${ts}\r`)
      await expect
        .poll(
          async () =>
            stripAnsi(await readTap())
              .split(/[\r\n]+/)
              .filter((l) => l.trim() === `BASE_${ts}`).length,
          {
            message: '基线命令要真的执行并打印出结果行',
            timeout: 25000,
          },
        )
        .toBeGreaterThan(0)

      // 手敲危险命令 + 回车
      await page.keyboard.type('rm -rf /')
      await page.keyboard.press('Enter')

      await expect
        .poll(async () => stripAnsi(await readTap()), {
          message: '屏幕上必须出现拦截提示，否则用户只看到按了没反应',
          timeout: 20000,
        })
        .toContain('已拦截高危命令')

      // 关键一步：被拦之后另起一行。前一行若还躺在 shell 的行缓冲里，
      // 这行会被拼上去一起执行，标记就不会单独成行
      const MARK = `AFTER_${ts}`
      await page.keyboard.type(`echo ${MARK}\r`)

      let lastTap = ''
      const onlyLine = (blob: string, want: string): number =>
        blob
          .split(/[\r\n]+/)
          .map((l) => l.trim())
          .filter((l) => l === want).length
      try {
        await expect
          .poll(
            async () => {
              lastTap = stripAnsi(await readTap())
              return onlyLine(lastTap, MARK)
            },
            {
              message: '标记必须作为 echo 的**输出**单独成行 —— 证明危险命令那行已被丢弃',
              timeout: 25000,
            },
          )
          .toBeGreaterThan(0)
      } catch (err) {
        // 失败时把终端实际收到什么打出来：不贴现场的话，下一轮还得重跑一遍才能定位
        throw new Error(`${(err as Error).message}\n\n终端输出尾部：\n${lastTap.slice(-900)}`)
      }

      // 反向对照（量具能被证伪）：如果拦截提示其实是 shell 打印的（即命令被当输入喂了进去），
      // 那"已拦截"会出现在回显里而不是主进程推送里 —— 这里再判一次提示只出现过一回
      const notices = stripAnsi(await readTap()).split('已拦截高危命令').length - 1
      expect(notices, '一次回车只许提示一次').toBe(1)
    } finally {
      await app.close()
    }
  })

  testOrSkip('粘贴多行里含危险命令：整段不转发，终端不出现其输出', async () => {
    test.setTimeout(150_000)
    const { app, page } = await launchApp()
    try {
      await openLocalTerminal(page)
      const readTap = await installTerminalTap(page)
      const ts = Date.now().toString(36)

      // 一次写入里带多个换行 —— 这就是"从网页复制一段脚本粘贴"的形状
      await page.evaluate((marker) => {
        const w = window as unknown as {
          electronAPI: { localTtyList: () => Promise<string[]>; localTtyWrite: (id: string, d: string) => Promise<boolean> }
        }
        return w.electronAPI.localTtyList().then((ids) => {
          const id = ids[0]
          if (!id) throw new Error('本机终端没开起来')
          return w.electronAPI.localTtyWrite(id, `echo SAFE_${marker}\ndd if=/dev/zero of=/dev/sda\n`)
        })
      }, ts)

      await expect
        .poll(async () => stripAnsi(await readTap()), { timeout: 20000 })
        .toContain('已拦截高危命令')

      // 整段都没转发：连同一批里那条安全命令也不该被执行。
      // 判据取"SAFE_<ts> 单独成行"（echo 真跑过才会有输出行），
      // 输入回显里出现它是正常的，所以数的是独立成行的输出。
      const echoed = stripAnsi(await readTap())
        .split(/[\r\n]+/)
        .filter((l) => l.trim() === `SAFE_${ts}`).length
      expect(echoed, '被拦的那一批整体都不该送进 shell').toBe(0)
    } finally {
      await app.close()
    }
  })
})
