/**
 * 终端随窗口自适应（用户 2026-10-11 再次指出"放大后底部还是看不见"）
 *
 * 病根不是窗口几何，是留白放错层：FitAddon 按 open() 传进去的那个元素（.terminal-view）
 * 的高算行列，而 xterm 的绘制盒是它内部的 .xterm。留白（padding/inset）留在 .terminal-view 上时，
 * 算行数的框比真正能看到的框高一个留白 —— 实测放大后按 555 算出 22 行、可视区只有 531，
 * 最后一行垂到容器外 10~13px。
 *
 * 所以这条判据写成行为："敲一条命令打出满屏输出，最后一行必须落在可视区内"，
 * 而不是钉某个 CSS 字符串（改结构会假红、语义坏了会假绿）。
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp } from './ssh-fixture-helpers'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
const testOrSkip = BUILD_READY ? test : test.skip

if (!BUILD_READY) console.log('[terminal-fit] 跳过：先 pnpm build（skip 不等于通过）。')

/** 量一次：可视区、行高、行数、最后一行底边 */
const MEASURE = () => {
  const view = document.querySelector('.terminal-view')
  const rows = [...document.querySelectorAll('.terminal-view .xterm-rows > div')]
  if (!view || rows.length === 0) return null
  const vr = view.getBoundingClientRect()
  const first = rows[0].getBoundingClientRect()
  const last = rows[rows.length - 1].getBoundingClientRect()
  const rowHeight = rows.length > 1 ? rows[1].getBoundingClientRect().top - first.top : last.height
  const status = document.querySelector('.wb-statusbar')?.getBoundingClientRect()
  return {
    innerH: window.innerHeight,
    view: { top: Math.round(vr.top), bottom: Math.round(vr.bottom), h: Math.round(vr.height) },
    rows: rows.length,
    rowHeight: Math.round(rowHeight * 10) / 10,
    lastBottom: Math.round(last.bottom),
    slack: Math.round(vr.bottom - last.bottom),
    fits: Math.round(vr.bottom - last.bottom) >= 0,
    statusVisible: status ? Math.round(status.bottom) <= window.innerHeight + 1 : null,
    capacity: Math.floor(vr.height / rowHeight),
  }
}

test.describe('终端跟随窗口尺寸', () => {
  testOrSkip('开终端 → 放大 → 缩小：最后一行始终在可视区内，且行数等于容量', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launchApp()
    try {
      await page.waitForSelector('[data-dom-id="boot-enter"]', { timeout: 60000 })
      await page.click('[data-dom-id="boot-enter"]').catch(() => {})
      await page.evaluate(() => {
        window.location.hash = '#/workbench'
      })
      await page.waitForSelector('.wb-main-layout', { timeout: 30000 })

      // 窗口最小尺寸钉在 1280x720 时，小窗那一档根本进不去；判据要量的是"任意尺寸都自适应"，
      // 所以这里只把**测试实例**的下限放开，不改产品配置
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())?.setMinimumSize(700, 420)
      })

      const localBtn = page.getByRole('button', { name: '开一个本机终端' }).first()
      await localBtn.click()
      await page.waitForSelector('.terminal-view .xterm-rows > div', { timeout: 30000 })
      await expect
        .poll(async () => (await page.evaluate(MEASURE))?.rows ?? 0, { message: '终端没画出内容行' })
        .toBeGreaterThan(3)

      const sizes: Array<[string, () => Promise<void>]> = [
        [
          '1280x720',
          () =>
            app.evaluate(({ BrowserWindow }) => {
              BrowserWindow.getAllWindows()
                .find((w) => !w.isDestroyed())
                ?.setBounds({ x: 30, y: 20, width: 1280, height: 720 })
            }),
        ],
        [
          '最大化',
          () =>
            app.evaluate(({ BrowserWindow }) => {
              BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())?.maximize()
            }),
        ],
        [
          '小窗 1000x560',
          () =>
            app.evaluate(({ BrowserWindow }) => {
              const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed())
              w?.unmaximize()
              w?.setBounds({ x: 30, y: 20, width: 1000, height: 560 })
            }),
        ],
      ]

      for (const [label, resize] of sizes) {
        await resize()
        // 等布局与 fit 都落定：行数是整数，稳定两次读数才算 settled（不睡固定秒）
        await expect
          .poll(
            async () => {
              const a = await page.evaluate(MEASURE)
              await new Promise((r) => setTimeout(r, 350))
              const b = await page.evaluate(MEASURE)
              return a && b && a.rows === b.rows && a.view.h === b.view.h ? b.rows : -1
            },
            { message: `${label}：resize 之后行数一直没定下来`, timeout: 20000 }
          )
          .toBeGreaterThan(3)

        const m = await page.evaluate(MEASURE)
        expect(m, `${label}：量不到终端几何`).not.toBeNull()
        console.log(
          `[terminal-fit] ${label} 可视高 ${m!.view.h} 行高 ${m!.rowHeight} 行数 ${m!.rows} 容量 ${m!.capacity} slack ${m!.slack}`
        )
        expect(m!.fits, `${label}：最后一行垂到可视区外 ${-m!.slack}px（用户看到的"底部看不见"）`).toBe(true)
        expect(
          m!.rows,
          `${label}：行数 ${m!.rows} 不等于可视容量 ${m!.capacity}（FitAddon 量的框和看得见的框不一致）`
        ).toBe(m!.capacity)
        expect(m!.statusVisible, `${label}：状态栏被推到视口外`).toBe(true)
      }
    } finally {
      await app.close()
    }
  })
})
