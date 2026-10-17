/**
 * 真应用里把数据库弄不可用，看横幅到底出不出来（A4 判据的真机那一半）
 *
 * 计划原文：「人为让 better-sqlite3 加载失败 → UI 必须显示『数据不会持久化』横幅」。
 * 此前只有 jsdom 组件测试 + 主进程单测各自证了一半，**没有一次是真的把应用起来看到那条横幅**：
 * 组件测试里 status 是喂进去的，主进程单测里根本没有界面。中间那段（store 取数、路由挂载、
 * 横幅在真实外壳里的可见性）一直是空白。
 *
 * 怎么"弄不可用"：Electron 的 userData 目录可以用 `--user-data-dir` 指到临时目录，
 * 而库路径就是 `<userData>/tdsf.db`。把那个位置提前建成一个**目录**，
 * sqlite 以读写方式打开目录必然失败（SQLITE_CANTOPEN）——不用改代码、不用装补丁、不动 node_modules。
 *
 * 主进程留没留话，判据读**日志文件**（`<userData>/logs/app-*.log`）：
 * stdout 只能靠 launch 之后挂 listener，早于 listener 的头几行会丢（并行跑时实测丢过，
 * 而恰恰是启动阶段那几条最关键）。这一档目录是本轮新建的（上面刚 rm 过），所以文件里的内容
 * 就是这一轮的，不需要再做增量基线。
 */
import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { e2eProfileDir, FIXTURE_READY } from './ssh-fixture-helpers'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')
const BANNER = '.db-degraded-banner'

const testOrSkip = FIXTURE_READY ? test : test.skip

/**
 * 等主进程**日志文件**里出现某个片段（超时返回 null，由调用方决定判红还是打印）。
 * stdout 那份仍在收，但只当补充线索：早于 listener 的头几行会丢，而降级那几条恰恰在启动头几行里。
 */
async function waitLogFile(logsDir: string, needle: RegExp, timeoutMs = 15000): Promise<string | null> {
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

testOrSkip('真应用：数据库打不开时必须出横幅、主进程必须留话、窗口不许崩', async () => {
  const profile = e2eProfileDir()
  fs.rmSync(profile, { recursive: true, force: true })
  fs.mkdirSync(profile, { recursive: true })
  // 把库路径占成一个目录：open 必失败，且失败原因是"打不开"而不是"文件损坏"
  fs.mkdirSync(path.join(profile, 'tdsf.db'), { recursive: true })

  const logLines: string[] = []
  const logsDir = path.join(profile, 'logs')
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${profile}`],
    env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
  })
  // 收着但不当判据：不接走的话管道写满会把子进程写日志堵住
  app.process().stdout?.setEncoding('utf8')
  app.process().stdout?.on('data', (chunk: string) => {
    for (const l of chunk.split(/\r?\n/)) if (l.trim()) logLines.push(l)
  })
  app.process().stderr?.setEncoding('utf8')
  app.process().stderr?.on('data', (chunk: string) => {
    for (const l of chunk.split(/\r?\n/)) if (l.trim()) logLines.push(l)
  })

  try {
    const page = await app.firstWindow()
    await page.waitForSelector('body', { timeout: 30000 })

    // 主进程侧：降级状态必须如实报出来（这条是"看得见"的源头）
    const status = await page.evaluate(() => window.electronAPI.dbGetStatus())
    expect(status.available, `主进程仍报可用，降级没发生：${JSON.stringify(status)}`).toBe(false)
    expect(status.degradedReason, '降级必须带原因，否则用户不知道怎么修').toBeTruthy()

    // 真机操作路径：启动页 → 工作台（横幅挂在全局布局里）
    // 启动页加载完自己跳，所以"到了工作台"的判据就是外壳出现在屏上（没有按钮可点，也不该去点）
    await page.waitForSelector('.wb-main-layout', { timeout: 40000 })

    // 判据核心：横幅真的在界面上，且把"后果 + 原因"都说清了
    // （计划原文写的是『数据不会持久化』这个意思；实现里的文案更具体，
    //  这里断言语义而不是照抄计划措辞——为了测试去改产品文案是反方向的作弊）
    const banner = page.locator(BANNER)
    await expect(banner, '数据库不可用时没有出现降级横幅').toBeVisible({ timeout: 15000 })
    const bannerText = (await banner.innerText()).replace(/\s+/g, ' ')
    expect(bannerText, `横幅没说清后果：${bannerText}`).toContain('不会被保存')
    expect(
      bannerText,
      `横幅没带上可操作的真实原因（只有"出错了"没人能修）：${bannerText}`
    ).toContain(status.degradedReason ?? '__never__')

    // 不许白屏/崩溃：外壳与主要分区仍在
    await expect(page.locator('.wb-main-layout')).toBeVisible()
    await expect(page.locator('.wb-aipanel, .term-editor-area, .wb-filetree').first()).toBeVisible()

    // 主进程必须留话（运维只看到红条查不到原因是不够的）。
    // 判据取日志文件：打包后的 Windows 应用根本没有控制台，只写 console.warn 的那一版
    // 在真机上是"一声不响"，这条也正是本轮改 noteDegraded 的原因。
    const logHit = await waitLogFile(logsDir, /Database unavailable|数据不会持久化|内存 Map 回退/)
    expect(
      logHit,
      `主进程日志文件里没有降级痕迹（${logsDir}）。stdout 抓到 ${logLines.length} 行，` +
        '但 stdout 只作旁证：早于 listener 的头几行会丢'
    ).toBeTruthy()
    console.log('[A4 真机] 主进程降级日志：', (logHit ?? '').slice(0, 200))
  } finally {
    await app.close()
  }
})

testOrSkip('对照：库能正常打开时不许出现横幅（防"横幅常亮"这种假安全）', async () => {
  const profile = `${e2eProfileDir()}-ok`
  fs.rmSync(profile, { recursive: true, force: true })
  fs.mkdirSync(profile, { recursive: true })

  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${profile}`],
    env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
  })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('body', { timeout: 30000 })
    const status = await page.evaluate(() => window.electronAPI.dbGetStatus())
    // 阳性对照：正常库里 available 必须是 true，否则这条对照什么都没守住
    expect(status.available, `正常档位下主进程仍报不可用：${JSON.stringify(status)}`).toBe(true)

    // 启动页加载完自己跳，所以"到了工作台"的判据就是外壳出现在屏上（没有按钮可点，也不该去点）
    await page.waitForSelector('.wb-main-layout', { timeout: 40000 })
    await expect(page.locator(BANNER)).toHaveCount(0)
  } finally {
    await app.close()
    fs.rmSync(profile, { recursive: true, force: true })
  }
})
