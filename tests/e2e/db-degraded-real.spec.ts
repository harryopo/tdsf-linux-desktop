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
 * 顺带把主进程日志从第一行就接住（stdio pipe）：降级必须在主进程里留下痕迹，
 * 只在界面弹个红条而主进程一声不响，运维查不到原因。
 */
import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { e2eProfileDir, FIXTURE_READY } from './ssh-fixture-helpers'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')
const BANNER = '.db-degraded-banner'

const testOrSkip = FIXTURE_READY ? test : test.skip

/** 等主进程日志里出现某个片段（超时返回 false，由调用方决定判红还是打印） */
async function waitLog(lines: string[], needle: RegExp, timeoutMs = 8000): Promise<string | null> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const hit = lines.find((l) => needle.test(l))
    if (hit) return hit
    await new Promise((r) => setTimeout(r, 100))
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
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${profile}`],
    env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
    stdio: 'pipe',
  })
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
    const enter = page.locator('[data-dom-id="boot-enter"]')
    await enter.waitFor({ state: 'visible', timeout: 30000 })
    await page.waitForFunction(
      () => {
        const b = document.querySelector('[data-dom-id="boot-enter"]') as HTMLButtonElement | null
        return b !== null && !b.disabled
      },
      { timeout: 20000 }
    )
    await enter.click()
    await page.waitForSelector('.wb-main-layout', { timeout: 20000 })

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

    // 主进程必须留话（运维只看到红条查不到原因是不够的）
    const logHit = await waitLog(logLines, /Database unavailable|数据不会持久化|内存 Map 回退/)
    expect(logHit, `主进程日志里没有降级痕迹。抓到的行数=${logLines.length}`).toBeTruthy()
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

    const enter = page.locator('[data-dom-id="boot-enter"]')
    await enter.waitFor({ state: 'visible', timeout: 30000 })
    await page.waitForFunction(
      () => {
        const b = document.querySelector('[data-dom-id="boot-enter"]') as HTMLButtonElement | null
        return b !== null && !b.disabled
      },
      { timeout: 20000 }
    )
    await enter.click()
    await page.waitForSelector('.wb-main-layout', { timeout: 20000 })
    await expect(page.locator(BANNER)).toHaveCount(0)
  } finally {
    await app.close()
    fs.rmSync(profile, { recursive: true, force: true })
  }
})
