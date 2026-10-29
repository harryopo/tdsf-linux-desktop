/**
 * 终端内容跨页面/标签切换不丢（真窗口判据）
 *
 * 用户 2026-10-26："终端不会持久化，我切换别的窗口就消失之前留着的内容了"。
 *
 * 这条 spec 用真实本机 PTY + 真实 xterm 判两件事：
 * 1. 工作台 → 监控 → 工作台：终端 DOM 节点是**同一个**（打了探针属性），
 *    并且 `.xterm-rows` 里还能读到切换前 echo 出来的标记；
 * 2. 两条本机终端来回切标签：各自的缓冲都还在，两个 xterm 实例都没被重建。
 *
 * 为什么不看 `localTtyList`：主进程的 shell 一直活着，它证明不了渲染层丢没丢缓冲。
 * 断言落在 xterm 渲染出来的行文本与 DOM 身份上，这才是用户看得见的那份内容。
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp } from './ssh-fixture-helpers'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
const testOrSkip = BUILD_READY ? test : test.skip

if (!BUILD_READY) {
  console.log('[terminal-persistence] 跳过：需要先 pnpm build（out/main/index.js 不存在）。')
}

/** 读所有终端视图当前渲染出来的行文本（含隐藏的那些） */
async function readTerminalRows(page: Page): Promise<Array<{ visible: boolean; text: string }>> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.terminal-view')).map((view) => ({
      visible: view.classList.contains('visible'),
      text: view.querySelector('.xterm-rows')?.textContent ?? '',
    })),
  )
}

/** 当前可见终端里必须出现某段标记 */
async function expectVisibleRowsToContain(page: Page, marker: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const rows = await readTerminalRows(page)
        return rows.find((r) => r.visible)?.text ?? ''
      },
      {
        message: `可见终端里应出现 ${marker}，实际=${JSON.stringify(await readTerminalRows(page))}`,
        timeout: 25000,
      },
    )
    .toContain(marker)
}

test.describe('终端内容跨切换持久化', () => {
  testOrSkip('工作台 ↔ 监控往返、两条终端来回切，缓冲与实例都不丢', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launchApp()
    try {
      await page.evaluate(() => {
        window.location.hash = '#/workbench'
      })
      await page.waitForSelector('.wb-main-layout', { timeout: 15000 })

      // ===== 开第一条本机终端并留一段可检索的输出 =====
      await page.getByRole('button', { name: '开一个本机终端', exact: true }).click()
      await expect(page.locator('.term-tab-item')).toHaveCount(1, { timeout: 15000 })

      const MARK_A = `tdsf-keep-a-${Date.now().toString(36)}`
      await page.click('.terminal-view.visible')
      await page.keyboard.type(`echo ${MARK_A}\r`)
      await expectVisibleRowsToContain(page, MARK_A)

      // 给终端 DOM 节点打探针：重建过就不可能有这个属性
      await page.evaluate(() => {
        const el = document.querySelector('.terminal-view.visible')
        if (el) el.setAttribute('data-persist-probe', 'keep')
      })

      // ===== 切去监控：工作台只应被隐藏，终端节点仍在文档里 =====
      await page.getByRole('button', { name: '监控', exact: true }).click()
      await expect.poll(async () => page.evaluate(() => window.location.hash), { timeout: 10000 }).toBe(
        '#/monitor',
      )
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const shell = document.querySelector('.wb-shell')
              const pane = shell?.closest('.wb-route-pane')
              return pane?.classList.contains('wb-route-pane-hidden') ?? null
            }),
          { message: '离开工作台后，工作台这一层应 display:none 而不是被卸载', timeout: 10000 },
        )
        .toBe(true)
      await expect(page.locator('.terminal-view')).toHaveCount(1)
      expect(
        await page.locator('.terminal-view').getAttribute('data-persist-probe'),
        '切走之后终端 DOM 节点不该消失',
      ).toBe('keep')

      // ===== 切回工作台：同一个节点 + 同一段输出 =====
      await page.getByRole('button', { name: '工作台', exact: true }).click()
      await expect.poll(async () => page.evaluate(() => window.location.hash), { timeout: 10000 }).toBe(
        '#/workbench',
      )
      await page.waitForSelector('.terminal-view.visible', { timeout: 10000 })
      expect(
        await page.locator('.terminal-view.visible').getAttribute('data-persist-probe'),
        '回来时必须是同一个 xterm 容器（重建会丢掉这个属性）',
      ).toBe('keep')
      await expectVisibleRowsToContain(page, MARK_A)

      // ===== 第二条本机终端：两条标签来回切，各留各的缓冲 =====
      await page.click('[data-dom-id="workbench-new-terminal"]')
      await page.getByRole('menuitem', { name: /开一个本机终端/ }).click()
      await expect(page.locator('.term-tab-item')).toHaveCount(2, { timeout: 15000 })

      const MARK_B = `tdsf-keep-b-${Date.now().toString(36)}`
      await page.click('.terminal-view.visible')
      await page.keyboard.type(`echo ${MARK_B}\r`)
      await expectVisibleRowsToContain(page, MARK_B)

      // 切回第一条终端（标签按打开顺序）
      await page.locator('.term-tab-item').first().locator('.term-tab-btn').click()
      await expectVisibleRowsToContain(page, MARK_A)
      // 再切回第二条
      await page.locator('.term-tab-item').nth(1).locator('.term-tab-btn').click()
      await expectVisibleRowsToContain(page, MARK_B)

      // 两条终端实例都还在（切标签没有把任何一条卸载掉）
      const rows = await readTerminalRows(page)
      expect(rows, '两条终端都应保持挂载').toHaveLength(2)
      expect(rows.some((r) => r.text.includes(MARK_A)), '第一条终端的缓冲应仍在').toBe(true)
      expect(rows.some((r) => r.text.includes(MARK_B)), '第二条终端的缓冲应仍在').toBe(true)
    } finally {
      await app.close()
    }
  })
})
