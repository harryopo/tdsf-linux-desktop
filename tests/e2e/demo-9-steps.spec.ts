/**
 * Demo 9 步主路径 E2E 测试 — §5.2 完整版
 *
 * 依据：TDSF高质量做大方案-终稿.md §5.2
 * 目标：覆盖 Demo 9 步主路径，确保关键流程不回归
 *
 * 9 步规划：
 *   Step 1: 启动应用 + BootPage 加载
 *   Step 2: 加载完成后自动进入工作台（启动页无按钮）
 *   Step 3: 验证主界面元素（ActivityRail 8 个导航按钮）
 *   Step 4: 教程页加载（点击 nav-tutorial）
 *   Step 5: 决策页加载（点击 nav-decision）
 *   Step 6: 历史页加载（点击 nav-history）
 *   Step 7: 监控页加载（点击 nav-monitor）
 *   Step 8: 知识库页加载（点击 nav-knowledge）
 *   Step 9: 设置页加载（点击 nav-settings）
 *
 * 选择器策略：
 *   - 优先使用 [data-dom-id="xxx"]（语义化、稳定）
 *   - fallback 到 .wb-* / .tut-* / .hist-* / .mon-* / .kb-* / .set-* / .log-* 语义化 className
 *
 * 降级策略：
 *   - 若 out/main/index.js 不存在（未 build），整个 suite skip
 *   - S1/S2 用仓库内的本地 fixture SSH 靶机（tests/e2e/ssh-fixture-server.ts），
 *     S3 用本地假模型服务（tests/e2e/ai-fixture-server.ts），都不需要外部机器与 API Key；
 *     真机与真模型仍分别由 ssh-live-verification / ai-chat-live-verification 覆盖
 *
 * 注意：Electron 测试必须串行（workers=1），实例间状态独立
 */
import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { startSshFixture } from './ssh-fixture-server'
import { startAiFixture } from './ai-fixture-server'
import { bindSessionToStore, connectToFixture, e2eProfileDir, installHostKeyRecorder, openShellViaIpc, readHostKeyPrompts, writeShellViaIpc } from './ssh-fixture-helpers'

/** Electron 主进程入口（需先 pnpm build） */
const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')

/** 截图输出目录 */
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots')

/** 确保截图目录存在 */
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

/** 启动 Electron 应用并返回首窗口 */
async function launchApp() {
  const app = await electron.launch({
    // 隔离 userData：S3 会 providerSave，不隔离就把测试用的假模型写进共享的 Electron 配置
    args: [MAIN_ENTRY, `--user-data-dir=${e2eProfileDir()}`],
    env: {
      ...process.env,
      // 测试模式：禁用真实 SSH/API key 依赖
      NODE_ENV: 'test',
      TDSF_E2E: '1',
    },
  })
  const mainWin = await app.firstWindow()
  // 等待 React 挂载完成
  await mainWin.waitForSelector('body', { timeout: 30000 })
  return { app, mainWin }
}

/** 是否已 build（CI 中由 globalSetup 触发，本地需手动 pnpm build） */
const BUILD_READY = fs.existsSync(MAIN_ENTRY)

/** 跳过未 build 的测试 */
const testOrSkip = BUILD_READY ? test : test.skip

test.describe('Demo 9 步主路径', () => {
  testOrSkip('Step 1: 启动应用 + BootPage 加载', async () => {
    const { app, mainWin } = await launchApp()

    // BootPage 根元素：data-viewport-mode="app-shell"
    await mainWin.waitForSelector('main[data-viewport-mode="app-shell"]', { timeout: 30000 })

    // 验证标题 TDSF LINUX 可见（启动页改版后标题是裸 <h1>，旧类名 .boot-title 已不存在）
    const title = await mainWin
      .locator('main[data-viewport-mode="app-shell"] h1')
      .textContent()
    expect(title?.trim()).toBe('TDSF LINUX')

    // 截图作为基线
    await mainWin.screenshot({
      path: path.join(SCREENSHOT_DIR, '01-boot.png'),
    })

    await app.close()
  })

  testOrSkip('Step 2: 加载完成后自动进入工作台（没人去点它）', async () => {
    const { app, mainWin } = await launchApp()

    // 启动页没有按钮可点了：主进程把 boot 推到 done、最短展示时长走完，自己跳去工作台。
    // 所以这一步断的是"谁都不碰它也能到工作台"——手动点一下反而把这条测成假的。
    await mainWin.waitForSelector('.wb-main-layout', { timeout: 30000 })

    // 验证 URL hash 包含 workbench
    const hash = await mainWin.evaluate(() => window.location.hash)
    expect(hash).toContain('/workbench')

    await mainWin.screenshot({
      path: path.join(SCREENSHOT_DIR, '02-workbench.png'),
    })

    await app.close()
  })

  testOrSkip('Step 3: 主界面元素可见（ActivityRail 8 个导航按钮）', async () => {
    const { app, mainWin } = await launchApp()

    // 跳过 BootPage 直接进入工作台（用 evaluate 改 hash）
    await mainWin.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await mainWin.waitForSelector('.wb-main-layout', { timeout: 15000 })

    // 验证 ActivityRail 导航存在
    const rail = mainWin.locator('.wb-activity-rail')
    await expect(rail).toBeVisible()

    // 验证 7 个顶部导航按钮 + 1 个底部设置按钮 = 8 个
    const navButtons = mainWin.locator('.wb-nav-btn')
    await expect(navButtons).toHaveCount(8)

    // 验证关键导航按钮的 data-dom-id 存在
    const expectedDomIds = [
      'nav-tutorial',
      'nav-decision',
      'nav-monitor',
      'nav-knowledge',
      'nav-history',
      'nav-logs',
      'nav-settings',
    ]
    for (const domId of expectedDomIds) {
      // 限定 .wb-nav-btn（ActivityRail 风格）避免与 Titlebar 的 wb-icon-btn 同 domId 冲突
      // v4.0 重构后 Titlebar 也加了 settings 按钮（domId="nav-settings-top"），故用 .wb-nav-btn 精确选择
      const btn = mainWin.locator(`.wb-nav-btn[data-dom-id="${domId}"]`)
      await expect(btn).toBeVisible()
    }

    await mainWin.screenshot({
      path: path.join(SCREENSHOT_DIR, '03-main-ui.png'),
    })

    await app.close()
  })

  testOrSkip('Step 4: 教程页加载（点击 nav-tutorial）', async () => {
    const { app, mainWin } = await launchApp()

    // 进入工作台
    await mainWin.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await mainWin.waitForSelector('.wb-main-layout', { timeout: 15000 })

    // 点击教程导航按钮
    await mainWin.locator('[data-dom-id="nav-tutorial"]').click()

    // 等待教程页加载
    await mainWin.waitForSelector('.tut-page', { timeout: 15000 })

    // 验证 URL hash
    const hash = await mainWin.evaluate(() => window.location.hash)
    expect(hash).toContain('/tutorial')

    // 截图
    await mainWin.screenshot({
      path: path.join(SCREENSHOT_DIR, '04-tutorial.png'),
    })

    await app.close()
  })

  testOrSkip('Step 5: 决策页加载（点击 nav-decision）', async () => {
    const { app, mainWin } = await launchApp()

    await mainWin.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await mainWin.waitForSelector('.wb-main-layout', { timeout: 15000 })

    await mainWin.locator('[data-dom-id="nav-decision"]').click()

    // 工作台改成常驻挂载（切路由只 display:none，不卸载）之后，".wb-editor-wrap 消失"
    // 不再是"离开了工作台"的证据——它永远在 DOM 里。判据改成直接等路由落到 /decision。
    await mainWin
      .waitForFunction(() => window.location.hash.includes('/decision'), null, { timeout: 15000 })
      .catch(() => {
        // 落不到 /decision 由下面那条断言负责报红，这里不重复判
      })

    const hash = await mainWin.evaluate(() => window.location.hash)
    expect(hash).toContain('/decision')

    await mainWin.screenshot({
      path: path.join(SCREENSHOT_DIR, '05-decision.png'),
    })

    await app.close()
  })

  testOrSkip('Step 6: 历史页加载（点击 nav-history）', async () => {
    const { app, mainWin } = await launchApp()

    await mainWin.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await mainWin.waitForSelector('.wb-main-layout', { timeout: 15000 })

    await mainWin.locator('[data-dom-id="nav-history"]').click()

    // 等待历史页根元素 .hist-page 加载
    await mainWin.waitForSelector('.hist-page', { timeout: 15000 })

    // 验证标题"历史决策"
    const title = await mainWin.locator('[data-dom-id="page-title"]').textContent()
    expect(title?.trim()).toBe('历史决策')

    const hash = await mainWin.evaluate(() => window.location.hash)
    expect(hash).toContain('/history')

    await mainWin.screenshot({
      path: path.join(SCREENSHOT_DIR, '06-history.png'),
    })

    await app.close()
  })

  testOrSkip('Step 7: 监控页加载（点击 nav-monitor）', async () => {
    const { app, mainWin } = await launchApp()

    await mainWin.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await mainWin.waitForSelector('.wb-main-layout', { timeout: 15000 })

    await mainWin.locator('[data-dom-id="nav-monitor"]').click()

    // 监控页在阶段 F 改版后根元素改成通用 <main>，旧类名 .mon-main 已不存在；
    // 改用全站统一钩子 page-title，并核对标题文字确实是监控页
    await mainWin.waitForSelector('[data-dom-id="page-title"]', { timeout: 15000 })
    const monTitle = await mainWin.locator('[data-dom-id="page-title"]').textContent()
    expect(monTitle?.trim()).toBe('实时监控')

    const hash = await mainWin.evaluate(() => window.location.hash)
    expect(hash).toContain('/monitor')

    await mainWin.screenshot({
      path: path.join(SCREENSHOT_DIR, '07-monitor.png'),
    })

    await app.close()
  })

  testOrSkip('Step 8: 知识库页加载（点击 nav-knowledge）', async () => {
    const { app, mainWin } = await launchApp()

    await mainWin.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await mainWin.waitForSelector('.wb-main-layout', { timeout: 15000 })

    await mainWin.locator('[data-dom-id="nav-knowledge"]').click()

    // 等待知识库页根元素 .kb-page 加载
    await mainWin.waitForSelector('.kb-page', { timeout: 15000 })

    // 验证标题"运维知识库"
    const title = await mainWin.locator('[data-dom-id="page-title"]').textContent()
    expect(title?.trim()).toBe('运维知识库')

    const hash = await mainWin.evaluate(() => window.location.hash)
    expect(hash).toContain('/knowledge')

    await mainWin.screenshot({
      path: path.join(SCREENSHOT_DIR, '08-knowledge.png'),
    })

    await app.close()
  })

  testOrSkip('Step 9: 设置页加载（点击 nav-settings）', async () => {
    const { app, mainWin } = await launchApp()

    await mainWin.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await mainWin.waitForSelector('.wb-main-layout', { timeout: 15000 })

    // 限定 ActivityRail（.wb-nav-btn）点击，避免与 Titlebar 的 wb-icon-btn 冲突
    await mainWin.locator('.wb-nav-btn[data-dom-id="nav-settings"]').click()

    // 等待设置页根元素 .set-page 加载（SettingsLayout 主容器）
    await mainWin.waitForSelector('.set-page', { timeout: 15000 })

    // 左侧导航的项数由唯一正本推导，不抄字面数：新增一节时这里跟着动，
    // 抄死的数字只会有一种结局——要么拦住合法的改动，要么放过真正的漏项
    const sectionSource = fs.readFileSync(
      path.join(__dirname, '../../src/renderer/src/pages/settings-sections.ts'),
      'utf8'
    )
    const sectionCount = (sectionSource.match(/to: '\/settings\//g) ?? []).length
    expect(sectionCount, '正本里一个章节都没匹配到，说明这个推导本身失效了').toBeGreaterThan(5)
    const navItems = mainWin.locator('.set-nav__item')
    await expect(navItems).toHaveCount(sectionCount)

    // 验证关键设置导航的 data-dom-id
    // 决策控制这项叫 nav-settings-decision 而不是 nav-decision：后者是左侧导航
    // 去 /decision 的钩子，两个页面共用一个钩子会让自动化点错地方
    const expectedDomIds = ['nav-general', 'nav-ssh', 'nav-model-config', 'nav-alerts', 'nav-appearance', 'nav-about', 'nav-calibration', 'nav-terminal', 'nav-risk', 'nav-settings-decision']
    for (const domId of expectedDomIds) {
      const link = mainWin.locator(`[data-dom-id="${domId}"]`)
      await expect(link).toBeVisible()
    }

    const hash = await mainWin.evaluate(() => window.location.hash)
    expect(hash).toContain('/settings')

    await mainWin.screenshot({
      path: path.join(SCREENSHOT_DIR, '09-settings.png'),
    })

    await app.close()
  })

  /**
   * S1/S2：SSH 连接与终端交互。
   * 对端是仓库内的本地 fixture（tests/e2e/ssh-fixture-server.ts），不是真 Linux——
   * 它证明的是【我们这侧的链路】：ssh2 客户端握手 → 主机密钥三态 → 交互式 shell →
   * OSC 133/633 → 块模型 → 状态栏读数。真内网 VM 仍由 ssh-live-verification.spec.ts 覆盖。
   */
  testOrSkip('Step S1: SSH 连接（本地 fixture 靶机 + 主机密钥首次确认）', async () => {
    test.setTimeout(120_000)
    const fixture = await startSshFixture()
    const knownHosts = path.join(os.tmpdir(), `tdsf-demo-known_hosts-s1-${process.pid}.txt`)
    fs.writeFileSync(knownHosts, '', 'utf8')

    try {
      const { app, mainWin } = await launchApp()
      await installHostKeyRecorder(mainWin, 'accept-and-save')

      const conn = await connectToFixture(mainWin, { port: fixture.port, id: 'demo-fixture', knownHostsPath: knownHosts })
      expect(conn.error, `SSH 连接失败：${conn.error ?? ''}`).toBeUndefined()
      expect(conn.sessionId, '应拿到 sessionId').toBeTruthy()

      // 首次连接必须问，且问的是"陌生主机"；应答后指纹落进 known_hosts
      expect(await readHostKeyPrompts(mainWin), '首次连接应弹一次 unknown-host').toEqual(['unknown-host'])
      const recorded = fs.readFileSync(knownHosts, 'utf8')
      expect(recorded, 'known_hosts 应记下 [127.0.0.1]:port').toContain(`[127.0.0.1]:${fixture.port}`)

      // exec 通道拿到的必须是真回显（fixture 的 uname 带 Linux）
      const exec = await mainWin.evaluate(
        async (sid) => {
          const w = window as unknown as {
            electronAPI: { sshExec: (s: string, c: string) => Promise<{ stdout: string; exitCode: number }> }
          }
          return w.electronAPI.sshExec(sid, 'uname -a')
        },
        conn.sessionId as string,
      )
      expect(exec.exitCode, 'uname 退出码应为 0').toBe(0)
      expect(exec.stdout, 'uname 输出必须来自对端').toContain('Linux')

      await mainWin.screenshot({ path: path.join(SCREENSHOT_DIR, '10-ssh-connected.png') })
      await app.close()
    } finally {
      await fixture.close()
      fs.unlinkSync(knownHosts)
    }
  })

  testOrSkip('Step S2: 终端交互（敲命令 → OSC 133/633 → 状态栏命令块）', async () => {
    test.setTimeout(120_000)
    const fixture = await startSshFixture()
    const knownHosts = path.join(os.tmpdir(), `tdsf-demo-known_hosts-s2-${process.pid}.txt`)
    fs.writeFileSync(knownHosts, '', 'utf8')

    try {
      const { app, mainWin } = await launchApp()
      await installHostKeyRecorder(mainWin, 'accept-and-save')
      const conn = await connectToFixture(mainWin, { port: fixture.port, id: 'demo-fixture-s2', knownHostsPath: knownHosts })
      const sessionId = conn.sessionId as string
      expect(sessionId, `SSH 连接失败：${conn.error ?? ''}`).toBeTruthy()

      // 先把会话挂到 store 再进工作台，TerminalView 挂上后才有人旁听 OSC
      await bindSessionToStore(mainWin, 'demo-fixture-s2', sessionId)
      await mainWin.evaluate(() => {
        window.location.hash = '#/workbench'
      })
      await mainWin.waitForSelector('.wb-main-layout', { timeout: 15000 })

      const shellId = await openShellViaIpc(mainWin, sessionId)

      // 首次连接的确认卡是刻意不可关的，而这条请求已经答复了（recorder 走的就是主进程那条口）。
      // 主进程必须把"结项"广播回来让卡自己收——不然这张遮罩会拦住本窗口的一切点击。
      await expect
        .poll(() => mainWin.locator('[role="dialog"]').count(), { message: '主机密钥确认结项后弹窗应自己收', timeout: 15000 })
        .toBe(0)

      const statusbar = mainWin.locator('.wb-statusbar')
      await expect
        .poll(async () => statusbar.innerText(), { message: 'shell 开场应带出至少 1 个命令块', timeout: 20000 })
        .toMatch(/[1-9]\d* 命令块/)

      await writeShellViaIpc(mainWin, shellId, 'uptime\r')

      await expect
        .poll(async () => statusbar.innerText(), { message: '敲命令后命令块计数应增加', timeout: 20000 })
        .toMatch(/[2-9]\d* 命令块/)

      // 状态栏只证明块模型有数据；工具条真的画在 xterm 上、位置对不对、
      // exit/耗时/cwd 跟着真事件走，必须在这个带真终端与真 OSC 的窗口里量。
      const readToolbars = () =>
        mainWin.evaluate(() => {
          const term = document.querySelector('.xterm')
          const box = term?.getBoundingClientRect()
          return Array.from(document.querySelectorAll<HTMLElement>('.terminal-block-toolbar')).map((el) => {
            const r = el.getBoundingClientRect()
            return {
              exit: el.dataset.exit ?? '',
              text: el.innerText.replace(/\s+/g, ' ').trim(),
              bad: !!el.querySelector('.terminal-block-exit.is-bad'),
              cwd: el.querySelector('.terminal-block-cwd')?.textContent ?? '',
              w: Math.round(r.width),
              h: Math.round(r.height),
              inside: !!box && r.top >= box.top - 1 && r.bottom <= box.bottom + 1,
            }
          })
        })
      const findBar = (needle: string) => readToolbars().then((bars) => bars.find((b) => b.text.includes(needle)))

      // 「复制输出」的可用性取决于输出正文真被抄下来了（133;D 那一刻读 buffer 行范围）
      const outputBtnEnabled = (needle: string) =>
        mainWin.evaluate((cmd) => {
          const bars = Array.from(document.querySelectorAll<HTMLElement>('.terminal-block-toolbar'))
          const bar = bars.find((el) => el.innerText.includes(cmd))
          const btn = bar?.querySelector<HTMLButtonElement>('button[aria-label^="复制输出"]')
          return btn ? !btn.disabled : null
        }, needle)

      await expect
        .poll(async () => (await findBar('uptime'))?.w ?? 0, { message: 'uptime 那条命令应在块尾画出工具条', timeout: 20000 })
        .toBeGreaterThan(0)
      {
        const bar = await findBar('uptime')
        expect(bar?.exit, '工具条上的退出码应来自 133;D').toBe('0')
        expect(bar?.bad, 'exit 0 不该标成失败色').toBe(false)
        expect(bar?.h, '工具条要有真实高度（量到 0 说明定位没生效）').toBeGreaterThan(0)
        expect(bar?.inside, '工具条必须落在终端可视区内').toBe(true)
        // 耗时来自 133;B/C 与 133;D 两个真时刻，不是界面自己编的
        expect(bar?.text, '工具条应带耗时').toMatch(/\d+(ms|s)/)
      }
      // 这条命令真有过输出行 → 「复制输出」必须可点（输出正文在 133;D 那一刻从 buffer 抄下来）
      await expect
        .poll(() => outputBtnEnabled('uptime'), { message: '有输出的块，复制输出应可用', timeout: 15000 })
        .toBe(true)

      // 重跑：点一下要真把命令写回同一个 shell（再走一遍键入通道），块计数跟着涨。
      // 放在最前面按：此时屏上只有两条工具条，不会被后画的块压住点击命中。
      const uptimeCount = async () => (await readToolbars()).filter((b) => b.text.includes('uptime')).length
      const before = await uptimeCount()
      expect(before, '重跑前 uptime 应只有一条').toBe(1)
      await mainWin.locator('.terminal-block-toolbar', { hasText: 'uptime' }).first().getByLabel('重跑：uptime').click()
      await expect
        .poll(uptimeCount, { message: '点重跑后应多出一条同样的命令块', timeout: 20000 })
        .toBeGreaterThan(before)

      await writeShellViaIpc(mainWin, shellId, 'tdsf-exit 7\r')
      await expect
        .poll(async () => (await findBar('tdsf-exit 7'))?.exit ?? '', { message: '非零退出码应上工具条并标失败色', timeout: 20000 })
        .toBe('7')
      {
        const bar = await findBar('tdsf-exit 7')
        expect(bar?.bad, 'exit 7 应标失败色').toBe(true)
      }

      await writeShellViaIpc(mainWin, shellId, 'tdsf-cwd\r')
      await expect
        .poll(async () => (await findBar('tdsf-cwd'))?.cwd ?? '', { message: '只有 633;P 报了 Cwd 才显示目录', timeout: 20000 })
        .toBe('/srv/fixture-dir')

      // 反向对照：fixture 从没发过 633;P 的那条命令，工具条上不该凭空多一个目录
      {
        const uptimeBar = await findBar('uptime')
        expect(uptimeBar?.cwd, '没收到 Cwd 就不许编一个目录').toBe('')
      }

      await mainWin.screenshot({ path: path.join(SCREENSHOT_DIR, '11-terminal-blocks.png') })
      await app.close()
    } finally {
      await fixture.close()
      fs.unlinkSync(knownHosts)
    }
  })

  /**
   * S3：AI 助手对话。对端是仓库内的本地假模型服务（tests/e2e/ai-fixture-server.ts），
   * 它按 OpenAI 的 SSE 格式分多个 chunk 回，因此这条证的是【流式管道真的在流】：
   * providerSave → agentChat → agent:chunk × N → agent:done → 文本按增量拼接上屏。
   * 模型的回答是写死的，真实模型质量仍由 ai-chat-live-verification.spec.ts（要 Key）负责。
   */
  testOrSkip('Step S3: AI 助手对话（本地假模型服务，流式增量必须分多条到达）', async () => {
    test.setTimeout(120_000)
    const ai = await startAiFixture()
    const { app, mainWin } = await launchApp()

    const saved = await mainWin.evaluate(
      async (cfg) => {
        const w = window as unknown as {
          electronAPI: {
            providerSave: (c: unknown) => Promise<boolean>
            providerSetDefault: (id: string) => Promise<boolean>
          }
        }
        const ok = await w.electronAPI.providerSave({
          id: cfg.providerId,
          name: 'Fixture 模型',
          type: 'openai-compatible',
          baseURL: cfg.baseURL,
          model: cfg.model,
          // 假 Key，只为过 SDK 的鉴权字段检查；不会外发
          apiKey: cfg.apiKey,
          defaultParams: { temperature: 0, maxTokens: 64 },
          builtin: false,
          enabled: true,
          roles: ['chat'],
        })
        const setOk = await w.electronAPI.providerSetDefault(cfg.providerId)
        return { ok, setOk }
      },
      { providerId: 'fixture-model', baseURL: ai.baseURL, model: 'fixture-model', apiKey: 'fixture-' + 'key' },
    )
    expect(saved.ok, 'providerSave 应成功').toBe(true)
    expect(saved.setOk, 'providerSetDefault 应成功').toBe(true)

    const chat = await mainWin.evaluate(async (prompt) => {
      const w = window as unknown as {
        electronAPI: {
          agentChat: (msgs: unknown[], providerId?: string) => Promise<string>
          onAgentChunk: (cb: (p: { delta?: string }) => void) => () => void
          onAgentDone: (cb: (p: unknown) => void) => () => void
          onAgentError: (cb: (p: { message?: string }) => void) => () => void
        }
      }
      const api = w.electronAPI
      let text = ''
      let deltas = 0
      let done = false
      let error = ''

      const finished = new Promise<void>((resolve) => {
        const offs: Array<() => void> = []
        const finish = () => {
          offs.forEach((o) => o())
          resolve()
        }
        offs.push(api.onAgentChunk((p) => {
          if (p.delta) {
            text += p.delta
            deltas += 1
          }
        }))
        offs.push(api.onAgentDone(() => {
          done = true
          finish()
        }))
        offs.push(api.onAgentError((p) => {
          error = p.message ?? 'unknown error'
          finish()
        }))
        setTimeout(finish, 60_000)
      })

      const correlationId = await api.agentChat([{ role: 'user', content: prompt }])
      await finished
      return { correlationId, text, deltas, done, error }
    }, '1+1=?')

    expect(chat.error, `AI 调用出错：${chat.error}`).toBe('')
    console.log('[S3] 增量条数 =', chat.deltas, ' 拼接文本 =', JSON.stringify(chat.text))
    expect(chat.done, '应收到 agent:done').toBe(true)
    expect(chat.text, '拼接后的回复应含答案 2').toContain('2')
    // 关键：必须是多条增量拼出来的，一次性甩回不叫流式
    expect(chat.deltas, '流式增量应至少到达 2 次').toBeGreaterThanOrEqual(2)
    expect(ai.requestCount(), '假模型服务应至少收到 1 次请求').toBeGreaterThanOrEqual(1)

    // 消息要真上屏（工作台 AI 面板里能看到这条回答）
    await mainWin.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await mainWin.waitForSelector('.wb-main-layout', { timeout: 15000 })
    await mainWin.waitForTimeout(1200)
    await mainWin.screenshot({ path: path.join(SCREENSHOT_DIR, '12-ai-streaming.png') })

    await app.close()
    await ai.close()
  })
})
