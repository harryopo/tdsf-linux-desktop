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
 *   ✅ 真起应用、真关一次：收尾那一行必须**在这次新写进日志的内容里**出现，且判定是"完成"
 *      （不是被总时长上限截断），并且主进程是自己退的（不是被 SIGKILL）。
 *   ❌ 它**不**证明每步清理的语义（测试档位下 sidecar 本机 .venv 坏了、实为空跑），
 *      闸门本身（拦住→跑完→放行、单步超时、卡死上报、异常兜底）由 tests/unit/quit-cleanup.test.ts
 *      按行为跑出来测；"Electron 不等 async 监听器"这个语义是 2026-10-08 独立探针量的。
 */
import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { e2eProfileDir } from './ssh-fixture-helpers'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')

/**
 * 记下日志目录里每个文件当前的字节数。
 *
 * 判据只看"这次新追加的那一段"，原因有两个都real踩过：
 * 1. 临时档位目录按 spec 名固定复用（ssh-fixture-helpers 里 e2eProfileDir），上一轮跑留下的
 *    "退出清理收尾"还在文件里——不记基线的话，本轮清理根本没跑也能读到旧行而假绿；
 * 2. 日志按**本地日期**切文件（logger.todayLocal），用 toISOString() 拼名字在 UTC+8 的
 *    每天 00:00–07:59 会去找一个不存在/不是当天写入的那份。按目录里的实际文件取数就绕开了。
 */
function snapshotLogSizes(logsDir: string): Map<string, number> {
  const out = new Map<string, number>()
  if (!fs.existsSync(logsDir)) return out
  for (const f of fs.readdirSync(logsDir)) {
    if (!f.startsWith('app-') || !f.endsWith('.log')) continue
    out.set(f, fs.statSync(path.join(logsDir, f)).size)
  }
  return out
}

/** 读某个日志文件从 fromBytes 起新追加的内容 */
function readAppended(logsDir: string, file: string, fromBytes: number): string {
  const p = path.join(logsDir, file)
  if (!fs.existsSync(p)) return ''
  const size = fs.statSync(p).size
  if (size <= fromBytes) return ''
  const fd = fs.openSync(p, 'r')
  try {
    const buf = Buffer.alloc(size - fromBytes)
    fs.readSync(fd, buf, 0, buf.length, fromBytes)
    return buf.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

test.describe('退出清理收尾', () => {
  test('真关一次应用：这次新写的日志里有收尾行、主进程自己退出', async () => {
    // 默认 30 秒装不下这条的预算（等 body 30s + 等启动页 40s + 读日志 25s + 等退出事件 10s），
    // 机器忙时会先撞 Playwright 的超时，看不到本条自己写的原因
    test.setTimeout(120_000)
    const profile = e2eProfileDir()
    const logsDir = path.join(profile, 'logs')
    const before = snapshotLogSizes(logsDir)

    const app = await electron.launch({
      args: [MAIN_ENTRY, `--user-data-dir=${profile}`],
      env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
    })
    const proc = app.process()

    let exited: number | null = null
    proc.on('exit', (code) => {
      exited = code
    })

    const page = await app.firstWindow()
    await page.waitForSelector('body', { timeout: 30000 })
    // 等启动序列走完：boot 没结束就关掉，清单项基本是空的，测了等于没测
    await page.waitForSelector('[data-dom-id="boot-enter"]', { timeout: 40000 })

    // 用主进程自己的 app.quit() 触发退出，不用 app.close()：
    // close() 是 Playwright 关窗口 + 断连，机器忙时它会先把进程掐掉，before-quit 根本没机会跑完
    // （2026-10-09 并行全量跑实测红一次、单跑永远绿——判据没错，是触发方式在赌时序）。
    await app.evaluate(({ app: electronApp }) => electronApp.quit())

    // 判据读**日志文件**不读 stdout：实测 stdout 是分块缓冲的，进程在收尾那一行刚打完就退出时，
    // 管道尾巴会丢（并行与串行都复现过：最后一步在，收尾行不在）。运维现场看的也是这份文件。
    const deadline = Date.now() + 25000
    let appended = ''
    while (Date.now() < deadline && !appended.includes('退出清理收尾')) {
      const now = snapshotLogSizes(logsDir)
      const files = new Set([...before.keys(), ...now.keys()])
      appended = [...files]
        .map((f) => readAppended(logsDir, f, before.get(f) ?? 0))
        .join('\n')
      if (appended.includes('退出清理收尾')) break
      await new Promise((r) => setTimeout(r, 200))
    }

    // 收尾行落盘之后，进程真正 exit 还要几毫秒到几百毫秒；exit 事件是异步派发的。
    // 原先一 break 就读 exited，把"事件还没到"当成"没退出"——2026-10-14 全量并行实测红过一次，
    // 而那份日志的最后一行就是「退出清理收尾 outcome=完成」：产品退了，是测法抢跑。
    // 这里只补等待窗口，两条判据一条没减（真挂住时 10 秒后照旧红）。
    const quitDeadline = Date.now() + 10_000
    while (exited === null && Date.now() < quitDeadline) {
      await new Promise((r) => setTimeout(r, 100))
    }

    expect(exited, '主进程应正常退出（没被 SIGKILL）').not.toBeNull()
    expect(
      appended,
      '这次退出清理没跑到底：启动之后新追加的日志里没有收尾那一行。' +
        '上一版就是死在这里——接线只写在源码里，Electron 不等 async 监听器，清理停在第一个 await。'
    ).toContain('退出清理收尾')
    expect(
      appended,
      '收尾判定不是"完成"（清理被总时长上限截断；日志里的 stuckAt 会说是哪一步卡住）'
    ).toMatch(/退出清理收尾[^\n]*完成/)
    // 口径对照：增量窗口应当正好罩住"这一次生命周期"——里有本次启动行，且收尾行只出现一次。
    // 若基线失效（从 0 读整个文件），复用档位目录时旧轮次的收尾行会混进来，计数就 >1；
    // 新档位则本来就 ==1，不会假红。
    const markerCount = (appended.match(/退出清理收尾/g) ?? []).length
    expect(markerCount, '一次关闭只该有一条收尾行；多出来说明读到了上一轮留下的旧日志').toBe(1)
    expect(
      appended,
      '增量窗口应罩住本次启动（说明基线是在启动之前取的）'
    ).toContain('TDSF-Linux Desktop 启动')

    // 进程此时应已自己退出；close() 只是让 Playwright 收尾断连，报错不算问题
    await app.close().catch(() => undefined)
  })
})
