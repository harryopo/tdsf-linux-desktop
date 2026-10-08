/**
 * 关掉应用时，退出清理必须真的跑到底（D3 判据里"退出后无残留"那一半）
 *
 * 为什么单独立一份：Electron **不等** async 的 before-quit 监听器。独立探针实测（2026-10-08）：
 * 监听器里 await 一个 1.5 秒的清理，日志只有 HANDLER_START，主进程 'exit' 就跟着打出来了，
 * await 之后的每一步都被掐掉。所以"把 cleanupSidecar() 接进 handleBeforeQuit"这种接线
 * 只在源码里成立，运行时不成立——原先的清理实际停在第一个 await 上。
 * 现在 main 改成先 preventDefault 拦住、清理 await 完再第二次 quit。
 *
 * 这条 spec 测到的是哪一半（说清楚，别吹成闸门本身）：
 *   ✅ 真起应用、真关应用：收尾那一行必须出现在主进程日志里，且判定是"完成"（不是 8 秒上限截断），
 *      并且主进程是自己退的（不是被 SIGKILL）。
 *   ❌ 它**不**能拦住"把 preventDefault 摘掉"这种回归——实测摘掉闸门它照样绿：
 *      测试档位下每一项清理都只花几毫秒，赶得及在进程结束前跑完。
 *      那条不变量由 tests/unit/sidecar-supervision.test.ts 的结构断言守（摘掉当场红，验过），
 *      而"Electron 不等 async 监听器"这个语义本身，是 2026-10-08 用独立探针量出来的
 *      （handler 里 await 1.5 秒 → 只有 HANDLER_START、没有 HANDLER_DONE）。
 *      真把清理拖慢的是 sidecar 停机要等子进程退出，本机 .venv 坏了测不到那条（归用户重建）。
 */
import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import { e2eProfileDir } from './ssh-fixture-helpers'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')

test.describe('退出清理收尾', () => {
  test('真关一次应用：清理收尾跑完、主进程自己退出（不测 preventDefault，见文件头）', async () => {
    const chunks: string[] = []
    const app = await electron.launch({
      args: [MAIN_ENTRY, `--user-data-dir=${e2eProfileDir()}`],
      env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
      stdio: 'pipe',
    })
    const proc = app.process()
    proc.stdout?.setEncoding('utf8')
    proc.stdout?.on('data', (c: string) => chunks.push(String(c)))
    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (c: string) => chunks.push(String(c)))

    let exited: number | null = null
    proc.on('exit', (code) => {
      exited = code
    })

    const page = await app.firstWindow()
    await page.waitForSelector('body', { timeout: 30000 })
    // 等启动序列走完：boot 没结束就关掉，清单项基本是空的，测了等于没测
    await page.waitForSelector('[data-dom-id="boot-enter"]', { timeout: 40000 })

    await app.close()

    // stdout 是分块推来的，退出后可能还有尾巴没落地：轮询到出现收尾行或超时
    const deadline = Date.now() + 10000
    while (Date.now() < deadline && !chunks.join('').includes('退出清理收尾')) {
      await new Promise((r) => setTimeout(r, 100))
    }

    const all = chunks.join('')
    expect(exited, '主进程应正常退出（没被 SIGKILL）').not.toBeNull()
    expect(
      all,
      '退出清理没跑到底。上一版就是死在这里：接线在源码里，但 Electron 不等 async 监听器，' +
        '清理停在第一个 await。完整主进程日志尾部：' +
        all.slice(-800)
    ).toContain('退出清理收尾')
    expect(all, '收尾判定不是"完成"（清理超过 8 秒上限被截断）').toMatch(/退出清理收尾[^\n]*完成/)
  })
})
