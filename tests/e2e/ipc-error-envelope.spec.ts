/**
 * IPC 错误信封的真机判据（P1-2 的"防线真的生效"那一半）
 *
 * 单元测试（tests/unit/ipc-error-boundary.test.ts）里边界是我手工装上去的，
 * 全绿也不能证明生产入口装了它、更不能证明 `contextBridge` 会让那句话原样到达渲染层。
 * 所以这里真起一次应用，走一条必然失败的调用：previewReadText 拿一个不存在的句柄
 * —— 主进程 handler 里那句 `throw new Error('预览句柄不存在或已过期')` 是稳定靶子。
 *
 * 判据分三段，缺一不算过：
 *   1. 渲染层收到的第一行就是那句人话，没有 `Error invoking remote method ...` 前缀，
 *      也没有末尾的 `[E_*]` 码（码被 preload 解掉了）；
 *   2. 主进程日志里留了全貌并带通道名（跨边界丢掉的信息本地找得回）；
 *   3. 反向：一条正常成功的调用不受影响（边界不会把返回值改写掉）。
 */
import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { e2eProfileDir, FIXTURE_READY } from './ssh-fixture-helpers'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')
const BUILD_READY = fs.existsSync(MAIN_ENTRY)
const testOrSkip = FIXTURE_READY && BUILD_READY ? test : test.skip

/** 轮询主进程日志文件（stdout 会丢启动头几行，日志文件才是完整那份） */
async function waitLog(logsDir: string, needle: RegExp, timeoutMs = 15000): Promise<string | null> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (fs.existsSync(logsDir)) {
      for (const f of fs.readdirSync(logsDir)) {
        if (!/^app-.*\.log$/.test(f)) continue
        const hit = fs
          .readFileSync(path.join(logsDir, f), 'utf8')
          .split(/\r?\n/)
          .find((l) => needle.test(l))
        if (hit) return hit
      }
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return null
}

testOrSkip('真应用：handler 抛错到渲染层只剩那句人话，全貌留在主进程日志', async () => {
  const profile = e2eProfileDir()
  fs.rmSync(profile, { recursive: true, force: true })
  fs.mkdirSync(profile, { recursive: true })
  const logsDir = path.join(profile, 'logs')

  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${profile}`],
    env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
  })

  try {
    const page = await app.firstWindow()
    await page.waitForSelector('body', { timeout: 30000 })

    const probe = await page.evaluate(async () => {
      const out: {
        threw: boolean
        message?: string
        ipcCode?: string | null
        ctor?: string
      } = { threw: false }
      try {
        await window.electronAPI.previewReadText('e2e-no-such-token')
      } catch (e) {
        const err = e as Error & { ipcCode?: string }
        out.threw = true
        out.message = String(err?.message)
        out.ipcCode = err?.ipcCode ?? null
        out.ctor = Object.prototype.toString.call(err)
      }
      return out
    })
    console.log('[ipc-error-envelope] 渲染层实际收到：', JSON.stringify(probe))

    expect(probe.threw, '这条调用本该 reject').toBe(true)
    // 整串相等，不是"第一行相等"：开发态那份详情与原话相同，收口处就不该再重复一遍
    expect(probe.message).toBe('预览句柄不存在或已过期')
    expect(probe.message).not.toContain('invoking remote method')
    expect(probe.message).not.toContain('[E_')
    // contextBridge 不带自定义属性过隔离世界 —— 实测渲染层读不到 ipcCode。
    // 这条不是"希望如此"，是写死的事实：谁改成依赖 err.ipcCode 分支，这里就红。
    expect(probe.ipcCode, 'ipcCode 不该被当成渲染层可用的载体').toBeNull()

    // 反向判据：同一条链上成功调用不受影响
    const ok = await page.evaluate(() => window.electronAPI.dbGetStatus())
    expect(ok, '正常 invoke 被边界改写').toBeTruthy()
    expect(typeof ok.available).toBe('boolean')

    const logHit = await waitLog(logsDir, /handler 抛错已折进信封[^\n]*预览句柄不存在/)
    expect(
      logHit,
      '主进程日志没留全貌：跨边界被丢掉的那份必须在本地找得回'
    ).toBeTruthy()
    expect(logHit).toContain('preview:readText')
  } finally {
    await app.close()
  }
})
