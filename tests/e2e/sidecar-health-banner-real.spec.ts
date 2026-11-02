/**
 * sidecar-health-banner-real.spec.ts —— 引擎起不来时，全局横幅要真的出现（#292）
 *
 * 为什么这条不能只留组件测：组件测是自己 emit 一个 phase 进去的，
 * "主进程到底报什么状态、推送有没有走到渲染层"这一半从来没被覆盖。
 * 真窗口一量就量出问题：这台机器缺 Python，主进程报的是
 * `status: 'stopped'` + `lastError: 'Sidecar 启动超时（10000ms）'`，
 * 而横幅原先把 stopped 整档当"只是没运行"静默掉 ⇒ 用户只看见"AI 日志分析点了没结果"。
 *
 * 判据的形状：横幅只在挂载时取一次状态，之后的变化只能来自推送。
 * 所以"调用之后横幅出现"这件事本身就证明 main → preload → 渲染层这条链是通的。
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp } from './ssh-fixture-helpers'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
if (!BUILD_READY) console.log('[sidecar-health-banner-real] 跳过：缺 out/main/index.js，先 pnpm build')
const testOrSkip = BUILD_READY ? test : test.skip

interface SidecarReadout {
  status: string
  lastError: string | null
}

async function readStatus(page: Page): Promise<SidecarReadout> {
  return page.evaluate(async () => {
    const w = window as unknown as {
      electronAPI: { sidecarStatus: () => Promise<{ status: string; lastError: string | null }> }
    }
    const s = await w.electronAPI.sidecarStatus()
    return { status: s.status, lastError: s.lastError ?? null }
  })
}

/** 产品里唯一的引擎启动点：日志分析的 pipeline 通道（懒启动） */
async function askForPipeline(page: Page): Promise<{ ok: boolean; error?: string }> {
  return page.evaluate(async () => {
    const w = window as unknown as {
      electronAPI: {
        sidecarPipeline: (lines: string[], service?: string) => Promise<{ ok: boolean; error?: string }>
      }
    }
    return await w.electronAPI.sidecarPipeline(['Jul  1 00:00:00 host sshd[42]: Failed password for root'], 'e2e-probe')
  })
}

const banner = (page: Page) => page.locator('[data-dom-id="sidecar-health-banner"]')

test.describe('引擎健康横幅的真窗口口径', () => {
  testOrSkip('没叫过引擎不打扰；叫过一次而起不来时，横幅要带着原因出现', async () => {
    test.setTimeout(120_000)
    const { app, page: mainWin } = await launchApp()
    try {
      await mainWin.evaluate(() => {
        window.location.hash = '#/workbench'
      })
      await mainWin.waitForSelector('.wb-main-layout', { timeout: 15000 })

      // 起点：懒启动还没被触发，横幅不该拦在任何页面顶上
      const before = await readStatus(mainWin)
      expect(before.status, '未触发时引擎应是 stopped').toBe('stopped')
      expect(before.lastError, '未触发时不该有失败原因').toBeNull()
      expect(await banner(mainWin).count(), '没叫过引擎就不该有横幅').toBe(0)

      const result = await askForPipeline(mainWin)
      const after = await readStatus(mainWin)

      if (result.ok) {
        // 这台机器装了可用 Python 时会走这一支：引擎就绪 ⇒ 不该有横幅
        expect(after.status, 'pipeline 成功说明引擎已就绪').toBe('ready')
        await expect.poll(() => banner(mainWin).count(), { timeout: 10_000 }).toBe(0)
        return
      }

      // 本机实测走这一支（缺解释器 → 启动超时）：原因必须原样上屏。
      // 30 秒余量：引擎那侧的启动尝试自己有 10 秒预算，机器忙时 spawn 还要排队。
      expect(after.lastError, '失败原因要留在状态里').toBeTruthy()
      await banner(mainWin).waitFor({ state: 'visible', timeout: 30_000 })
      const text = await banner(mainWin).innerText()
      expect(text).toContain('AI 日志分析引擎没能启动')
      expect(text, '横幅要说的是主进程给的那句原因，不是自造的"未运行"').toContain(
        String(after.lastError).slice(0, 12),
      )
    } finally {
      await app.close()
    }
  })
})
