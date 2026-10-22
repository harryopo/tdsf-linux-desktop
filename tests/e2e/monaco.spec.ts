/**
 * Monaco 本地化的运行时判据（P1-4）
 *
 * 缺陷本体：`@monaco-editor/react` 默认在运行时从 CDN 拉 AMD loader
 * （`@monaco-editor/loader@1.7.0` 的默认地址实测是
 * `https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs`），而我们的 CSP 是
 * `script-src 'self'`（src/main/windows/main-window.ts:39）—— 打包后这条脚本必被拒绝，
 * 编辑区整块空白。开发态 CSP 只注入在打包产物里，所以四绿与全部 e2e 都照不到它
 * （和 P1-1、P1-6 同一类："只有特定条件下才暴露"）。
 *
 * 为什么不在这里点文件树开编辑器：资源管理器只服务远端会话，本机会话下它是空的
 * （实测截图确认），而真 SFTP 只有 ssh-live-verification 那批有靶机时才跑。
 * 所以这里量**本地化这件事本身**的三条真判据：
 *   1. `window.MonacoEnvironment` 被我们装上，且 `getWorker()` 真造出一个 Worker
 *      —— 没本地化时这个全局不会存在（loader 走 CDN 才配 worker）；
 *   2. 整页零远程请求（http/https 一条都不许有）；
 *   3. CSP 探针：从页面注入一条指向 jsdelivr 的 `<script>`，必须被拒 ——
 *      这条是量具自证，证明"走 CDN 就一定坏"，不是"今天网络恰好不通"。
 *
 * 前置：`pnpm build`。没 build 就整份 skip 并写明跑法，skip 不等于通过。
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp } from './ssh-fixture-helpers'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
const testOrSkip = BUILD_READY ? test : test.skip

/**
 * 2026-10-22 起 Monaco 是独立懒加载 chunk（首屏不再带 5.7MB）。
 * 本判据改为：首屏不加载它 → 按需 import 该 chunk → worker 与 CSP 判据照旧成立。
 */
function monacoChunkName(): string {
  const assets = path.join(__dirname, '../../out/renderer/assets')
  const file = fs.readdirSync(assets).find((f) => /^MonacoEditor-.*\.js$/.test(f))
  if (!file) throw new Error('out/renderer/assets 里没有 MonacoEditor-*.js，先 pnpm build')
  return file
}

if (!BUILD_READY) {
  console.log('[monaco] 跳过：需要先 pnpm build（out/main/index.js 不存在）。')
}

test.describe('Monaco 本地化：不靠 CDN 也配好编辑器与 worker', () => {
  testOrSkip('MonacoEnvironment 装上了、零远程请求、且 CSP 确实会拦 CDN 脚本', async () => {
    test.setTimeout(120_000)
    const { app, page } = await launchApp()
    const remoteRequests: string[] = []
    const cspRefusals: string[] = []

    // 先挂监听再操作：漏听等于没测
    page.on('request', (req) => {
      const u = req.url()
      if (u.startsWith('http://') || u.startsWith('https://')) remoteRequests.push(u)
    })
    const grab = (text: string) => {
      if (/Content Security Policy|Refused to load/i.test(text)) cspRefusals.push(text.slice(0, 200))
    }
    page.on('console', (msg) => grab(msg.text()))
    page.on('pageerror', (err) => grab(String(err)))

    try {
      await page.evaluate(() => {
        window.location.hash = '#/workbench'
      })
      await page.waitForSelector('.wb-main-layout', { timeout: 15000 })

      // 判据 0：首屏不许带 Monaco（拆包的意义）
      const loadedBefore = await page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .some((e) => /MonacoEditor-.*\.js$/.test(e.name)),
      )
      expect(loadedBefore, '工作台首屏又把 Monaco 装回来了').toBe(false)

      // 判据 1：按需加载 Monaco chunk 后，本地化真的装上
      const chunk = monacoChunkName()
      await page.evaluate(async (name) => {
        const url = new URL(`./assets/${name}`, window.location.href).href
        await import(/* @vite-ignore */ url)
      }, chunk)
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              // MonacoEnvironment 是产品运行时挂到 window 上的，没有全局声明；
              // 在页面里就地收窄一次，别靠 any 飘过去
              const env = (
                window as unknown as { MonacoEnvironment?: { getWorker?: unknown } }
              ).MonacoEnvironment
              return typeof env?.getWorker
            }),
          { timeout: 15000 },
        )
        .toBe('function')

      // 判据 1b：起一个 worker 要真起得来（file:// 下从 file: 直接 new Worker 会被 Chromium 拒，
      // 所以本地化必须把 worker 编成 blob: —— 这一步失败就是没内联）
      const workerErr = await page.evaluate(() => {
        try {
          const w = (
            window as unknown as {
              MonacoEnvironment?: {
                getWorker?: (m: string, label: string) => { terminate: () => void }
              }
            }
          ).MonacoEnvironment?.getWorker?.('1', 'shell')
          if (!w) return 'getWorker 没返回 Worker'
          w.terminate()
          return ''
        } catch (e) {
          return String(e)
        }
      })
      expect(workerErr, `Monaco worker 起不来：${workerErr}`).toBe('')

      // 判据 3（量具自证）：CSP 必须真的拦得住 CDN 脚本，否则"走 CDN 会白屏"这条前提不成立
      await page.evaluate(() => {
        const s = document.createElement('script')
        s.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs/loader.js'
        document.head.append(s)
      })
      await expect
        .poll(() => cspRefusals.length, { timeout: 8000, message: 'CSP 没拦住 CDN 脚本：这条前提失效' })
        .toBeGreaterThan(0)

      // 判据 2：除了上面那条**故意注入**的探针，页面自己一条远程请求都不该发
      // （探针是 <script> 注入，不产生 request 事件之外的路径；这里按域名把它摘掉再判）
      expect(
        remoteRequests.filter((u) => !u.includes('cdn.jsdelivr.net')),
        `界面发起了远程请求：${remoteRequests.join(' | ')}`
      ).toHaveLength(0)
    } finally {
      await app.close().catch(() => {})
    }
  })
})
