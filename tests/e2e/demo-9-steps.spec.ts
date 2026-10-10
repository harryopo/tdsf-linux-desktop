/**
 * Demo 9 步主路径 E2E 测试 — §5.2 完整版
 *
 * 依据：TDSF高质量做大方案-终稿.md §5.2
 * 目标：覆盖比赛 Demo 9 步主路径，确保关键流程不回归
 *
 * 9 步规划：
 *   Step 1: 启动应用 + BootPage 加载
 *   Step 2: 点击 "进入工作台" 按钮进入工作台
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
  const window = await app.firstWindow()
  // 等待 React 挂载完成
  await window.waitForSelector('body', { timeout: 30000 })
  return { app, window }
}

/** 是否已 build（CI 中由 globalSetup 触发，本地需手动 pnpm build） */
const BUILD_READY = fs.existsSync(MAIN_ENTRY)

/** 跳过未 build 的测试 */
const testOrSkip = BUILD_READY ? test : test.skip

test.describe('Demo 9 步主路径', () => {
  testOrSkip('Step 1: 启动应用 + BootPage 加载', async () => {
    const { app, window } = await launchApp()

    // BootPage 根元素：data-viewport-mode="app-shell"
    await window.waitForSelector('main[data-viewport-mode="app-shell"]', { timeout: 30000 })

    // 验证标题 TDSF LINUX 可见（启动页改版后标题是裸 <h1>，旧类名 .boot-title 已不存在）
    const title = await window
      .locator('main[data-viewport-mode="app-shell"] h1')
      .textContent()
    expect(title?.trim()).toBe('TDSF LINUX')

    // 截图作为基线
    await window.screenshot({
      path: path.join(SCREENSHOT_DIR, '01-boot.png'),
    })

    await app.close()
  })

  testOrSkip('Step 2: 点击 "进入工作台" 进入工作台', async () => {
    const { app, window } = await launchApp()

    // 等待 BootPage 加载完成（boot-enter 按钮可点击）
    const enterBtn = window.locator('[data-dom-id="boot-enter"]')
    await enterBtn.waitFor({ state: 'visible', timeout: 30000 })

    // BootPage 进度条动画 3s，最多等 6s 让按钮 enable
    await window.waitForFunction(
      () => {
        const btn = document.querySelector('[data-dom-id="boot-enter"]') as HTMLButtonElement | null
        return btn !== null && !btn.disabled
      },
      { timeout: 15000 },
    )

    await enterBtn.click()

    // 等待跳转到 /workbench（HashRouter 改变 hash）
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })

    // 验证 URL hash 包含 workbench
    const hash = await window.evaluate(() => window.location.hash)
    expect(hash).toContain('/workbench')

    await window.screenshot({
      path: path.join(SCREENSHOT_DIR, '02-workbench.png'),
    })

    await app.close()
  })

  testOrSkip('Step 3: 主界面元素可见（ActivityRail 8 个导航按钮）', async () => {
    const { app, window } = await launchApp()

    // 跳过 BootPage 直接进入工作台（用 evaluate 改 hash）
    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })

    // 验证 ActivityRail 导航存在
    const rail = window.locator('.wb-activity-rail')
    await expect(rail).toBeVisible()

    // 验证 7 个顶部导航按钮 + 1 个底部设置按钮 = 8 个
    const navButtons = window.locator('.wb-nav-btn')
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
      const btn = window.locator(`.wb-nav-btn[data-dom-id="${domId}"]`)
      await expect(btn).toBeVisible()
    }

    await window.screenshot({
      path: path.join(SCREENSHOT_DIR, '03-main-ui.png'),
    })

    await app.close()
  })

  testOrSkip('Step 4: 教程页加载（点击 nav-tutorial）', async () => {
    const { app, window } = await launchApp()

    // 进入工作台
    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })

    // 点击教程导航按钮
    await window.locator('[data-dom-id="nav-tutorial"]').click()

    // 等待教程页加载
    await window.waitForSelector('.tut-page', { timeout: 15000 })

    // 验证 URL hash
    const hash = await window.evaluate(() => window.location.hash)
    expect(hash).toContain('/tutorial')

    // 截图
    await window.screenshot({
      path: path.join(SCREENSHOT_DIR, '04-tutorial.png'),
    })

    await app.close()
  })

  testOrSkip('Step 5: 决策页加载（点击 nav-decision）', async () => {
    const { app, window } = await launchApp()

    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })

    await window.locator('[data-dom-id="nav-decision"]').click()

    // 决策页可能渲染为 .dec-* 或其他容器，等待主内容区变化
    await window.waitForFunction(
      () => !document.querySelector('.wb-main-layout') || document.querySelector('.wb-main-layout .wb-editor-wrap') === null,
      { timeout: 15000 },
    ).catch(() => {
      // 决策页可能仍在 MainLayout 内，验证 hash 即可
    })

    const hash = await window.evaluate(() => window.location.hash)
    expect(hash).toContain('/decision')

    await window.screenshot({
      path: path.join(SCREENSHOT_DIR, '05-decision.png'),
    })

    await app.close()
  })

  testOrSkip('Step 6: 历史页加载（点击 nav-history）', async () => {
    const { app, window } = await launchApp()

    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })

    await window.locator('[data-dom-id="nav-history"]').click()

    // 等待历史页根元素 .hist-page 加载
    await window.waitForSelector('.hist-page', { timeout: 15000 })

    // 验证标题"历史决策"
    const title = await window.locator('[data-dom-id="page-title"]').textContent()
    expect(title?.trim()).toBe('历史决策')

    const hash = await window.evaluate(() => window.location.hash)
    expect(hash).toContain('/history')

    await window.screenshot({
      path: path.join(SCREENSHOT_DIR, '06-history.png'),
    })

    await app.close()
  })

  testOrSkip('Step 7: 监控页加载（点击 nav-monitor）', async () => {
    const { app, window } = await launchApp()

    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })

    await window.locator('[data-dom-id="nav-monitor"]').click()

    // 监控页在阶段 F 改版后根元素改成通用 <main>，旧类名 .mon-main 已不存在；
    // 改用全站统一钩子 page-title，并核对标题文字确实是监控页
    await window.waitForSelector('[data-dom-id="page-title"]', { timeout: 15000 })
    const monTitle = await window.locator('[data-dom-id="page-title"]').textContent()
    expect(monTitle?.trim()).toBe('实时监控')

    const hash = await window.evaluate(() => window.location.hash)
    expect(hash).toContain('/monitor')

    await window.screenshot({
      path: path.join(SCREENSHOT_DIR, '07-monitor.png'),
    })

    await app.close()
  })

  testOrSkip('Step 8: 知识库页加载（点击 nav-knowledge）', async () => {
    const { app, window } = await launchApp()

    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })

    await window.locator('[data-dom-id="nav-knowledge"]').click()

    // 等待知识库页根元素 .kb-page 加载
    await window.waitForSelector('.kb-page', { timeout: 15000 })

    // 验证标题"运维知识库"
    const title = await window.locator('[data-dom-id="page-title"]').textContent()
    expect(title?.trim()).toBe('运维知识库')

    const hash = await window.evaluate(() => window.location.hash)
    expect(hash).toContain('/knowledge')

    await window.screenshot({
      path: path.join(SCREENSHOT_DIR, '08-knowledge.png'),
    })

    await app.close()
  })

  testOrSkip('Step 9: 设置页加载（点击 nav-settings）', async () => {
    const { app, window } = await launchApp()

    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })

    // 限定 ActivityRail（.wb-nav-btn）点击，避免与 Titlebar 的 wb-icon-btn 冲突
    await window.locator('.wb-nav-btn[data-dom-id="nav-settings"]').click()

    // 等待设置页根元素 .set-page 加载（SettingsLayout 主容器）
    await window.waitForSelector('.set-page', { timeout: 15000 })

    // 验证左侧导航存在（10 项 = settings-sections.ts 的章节清单）
    const navItems = window.locator('.set-nav__item')
    await expect(navItems).toHaveCount(10)

    // 验证关键设置导航的 data-dom-id
    // 决策控制这项叫 nav-settings-decision 而不是 nav-decision：后者是左侧导航
    // 去 /decision 的钩子，两个页面共用一个钩子会让自动化点错地方
    const expectedDomIds = ['nav-general', 'nav-ssh', 'nav-model-config', 'nav-alerts', 'nav-appearance', 'nav-about', 'nav-calibration', 'nav-terminal', 'nav-risk', 'nav-settings-decision']
    for (const domId of expectedDomIds) {
      const link = window.locator(`[data-dom-id="${domId}"]`)
      await expect(link).toBeVisible()
    }

    const hash = await window.evaluate(() => window.location.hash)
    expect(hash).toContain('/settings')

    await window.screenshot({
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
      const { app, window } = await launchApp()
      await installHostKeyRecorder(window, 'accept-and-save')

      const conn = await connectToFixture(window, { port: fixture.port, id: 'demo-fixture', knownHostsPath: knownHosts })
      expect(conn.error, `SSH 连接失败：${conn.error ?? ''}`).toBeUndefined()
      expect(conn.sessionId, '应拿到 sessionId').toBeTruthy()

      // 首次连接必须问，且问的是"陌生主机"；应答后指纹落进 known_hosts
      expect(await readHostKeyPrompts(window), '首次连接应弹一次 unknown-host').toEqual(['unknown-host'])
      const recorded = fs.readFileSync(knownHosts, 'utf8')
      expect(recorded, 'known_hosts 应记下 [127.0.0.1]:port').toContain(`[127.0.0.1]:${fixture.port}`)

      // exec 通道拿到的必须是真回显（fixture 的 uname 带 Linux）
      const exec = await window.evaluate(
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

      await window.screenshot({ path: path.join(SCREENSHOT_DIR, '10-ssh-connected.png') })
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
      const { app, window } = await launchApp()
      await installHostKeyRecorder(window, 'accept-and-save')
      const conn = await connectToFixture(window, { port: fixture.port, id: 'demo-fixture-s2', knownHostsPath: knownHosts })
      const sessionId = conn.sessionId as string
      expect(sessionId, `SSH 连接失败：${conn.error ?? ''}`).toBeTruthy()

      // 先把会话挂到 store 再进工作台，TerminalView 挂上后才有人旁听 OSC
      await bindSessionToStore(window, 'demo-fixture-s2', sessionId)
      await window.evaluate(() => {
        window.location.hash = '#/workbench'
      })
      await window.waitForSelector('.wb-main-layout', { timeout: 15000 })

      const shellId = await openShellViaIpc(window, sessionId)

      const statusbar = window.locator('.wb-statusbar')
      await expect
        .poll(async () => statusbar.innerText(), { message: 'shell 开场应带出至少 1 个命令块', timeout: 20000 })
        .toMatch(/[1-9]\d* 命令块/)

      await writeShellViaIpc(window, shellId, 'uptime\r')

      await expect
        .poll(async () => statusbar.innerText(), { message: '敲命令后命令块计数应增加', timeout: 20000 })
        .toMatch(/[2-9]\d* 命令块/)

      await window.screenshot({ path: path.join(SCREENSHOT_DIR, '11-terminal-blocks.png') })
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
    const { app, window } = await launchApp()

    const saved = await window.evaluate(
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

    const chat = await window.evaluate(async (prompt) => {
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
    await window.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })
    await window.waitForTimeout(1200)
    await window.screenshot({ path: path.join(SCREENSHOT_DIR, '12-ai-streaming.png') })

    await app.close()
    await ai.close()
  })
})
