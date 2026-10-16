/**
 * wiring-verification.spec.ts — 端到端"接线真通"验证（P0/P1 修复回归门禁）
 *
 * 背景：本项目曾出现 typecheck/lint/单测全绿但链路断在中间的问题
 * （假 UI、按钮无响应、Agent 连上 API 运行不显示）。本 spec 用真实 Electron
 * 实例做**带断言的链路验证**，而非截图冒烟：
 *
 *   T1. preload 契约运行时抽查 — P0-3/P1-1 修复的方法真实存在且 invoke 可达
 *   T2. Agent 全链路事件回流 — agentChat 发出后事件必须回来（无 Key 时为 error，
 *       验证 渲染→preload→main→supervisor→agent:error→渲染 完整环）
 *   T3. AIPanel 发送按钮有真实响应 — 无 Key 时错误必须上屏（不许静默）
 *   T4. 假 UI 回归断言 — 假服务器标签/假告警/假AI检索开关/死按钮 不得复活
 *
 * 运行：pnpm build && npx playwright test tests/e2e/wiring-verification.spec.ts
 */
import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'
import { e2eProfileDir } from './ssh-fixture-helpers'

/** Electron 主进程入口（需先 pnpm build） */
const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')

/** 是否已 build（本地需手动 pnpm build） */
const BUILD_READY = fs.existsSync(MAIN_ENTRY)
const testOrSkip = BUILD_READY ? test : test.skip

/** 启动 Electron 应用并返回首窗口 */
async function launchApp() {
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${e2eProfileDir()}`],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      TDSF_E2E: '1',
    },
  })
  const mainWin = await app.firstWindow()
  await mainWin.waitForSelector('body', { timeout: 30000 })
  return { app, mainWin }
}

/** 跳过 BootPage 直接进入指定 hash 路由 */
async function gotoRoute(
  // 形别再叫 window：它会把回调里的浏览器全局遮掉（#107 第一族），
  // 类型也从 launchApp 的真实返回取，别再指向已经不存在的 'window' 键。
  page: Awaited<ReturnType<typeof launchApp>>['mainWin'],
  hash: string,
) {
  await page.evaluate((h: string) => {
    window.location.hash = h
  }, hash)
  await page.waitForTimeout(800)
}

test.describe('接线真通验证（P0/P1 修复回归）', () => {
  test.describe.configure({ mode: 'serial' })

  // ==========================================================
  // T1. preload 契约运行时抽查
  // ==========================================================
  testOrSkip('T1: P0/P1 修复的 preload 方法运行时存在且 invoke 可达', async () => {
    const { app, mainWin } = await launchApp()

    // 1a. 方法存在性：拿静态快照闸那份名单（264 条）逐个真验，不再抽查 12 条。
    //     2026-10-07 那次 zod 被 external 进 sandbox 的 preload，整个桥挂掉、window.electronAPI 是 undefined；
    //     抽查式的写法只要挂掉的不是被抽的那几条就照样绿 —— 快照与运行时对上才是证据。
    const snapshot = fs
      .readFileSync(path.join(__dirname, '../../tests/unit/__fixtures__/preload-api-surface.txt'), 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    const runtime = await mainWin.evaluate(() => {
      const api = (window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI
      if (!api) return []
      return Object.keys(api).filter((k) => typeof api[k] === 'function')
    })
    const missing = snapshot.filter((n) => !runtime.includes(n))
    const extra = runtime.filter((n) => !snapshot.includes(n))
    expect(missing, `快照里有、运行时没挂上（前 20 条）：${missing.slice(0, 20).join(', ')}`).toEqual([])
    expect(extra, `运行时挂上了、快照没登记（前 20 条）：${extra.slice(0, 20).join(', ')}`).toEqual([])
    expect(runtime.length, `运行时方法数应与快照一致（${snapshot.length}）`).toBe(snapshot.length)

    // 1b. invoke 真实可达（曾经 preload 定义了但 main 没注册 → invoke reject）
    const results = await mainWin.evaluate(async () => {
      const api = (window as unknown as {
        electronAPI: {
          mcpGetState: () => Promise<unknown>
          providerGetDefault: () => Promise<string>
          mcpExternalStatus: () => Promise<unknown[]>
        }
      }).electronAPI
      const out: Record<string, string> = {}
      try {
        const state = await api.mcpGetState()
        out.mcpGetState = state && typeof state === 'object' ? 'ok' : `bad:${typeof state}`
      } catch (e) {
        out.mcpGetState = `reject:${(e as Error).message}`
      }
      try {
        const id = await api.providerGetDefault()
        out.providerGetDefault = typeof id === 'string' && id.length > 0 ? 'ok' : `bad:${String(id)}`
      } catch (e) {
        out.providerGetDefault = `reject:${(e as Error).message}`
      }
      try {
        const list = await api.mcpExternalStatus()
        out.mcpExternalStatus = Array.isArray(list) ? 'ok' : `bad:${typeof list}`
      } catch (e) {
        out.mcpExternalStatus = `reject:${(e as Error).message}`
      }
      return out
    })
    expect(results.mcpGetState, 'mcp:get-state invoke 应可达').toBe('ok')
    expect(results.providerGetDefault, 'provider:get-default invoke 应可达').toBe('ok')
    expect(results.mcpExternalStatus, 'mcp:external-status invoke 应可达').toBe('ok')

    await app.close()
  })

  // ==========================================================
  // T2. Agent 全链路事件回流（无 API Key 场景）
  // ==========================================================
  testOrSkip('T2: agentChat 发出后事件必须回流（无 Key 时 error 也必须回来）', async () => {
    const { app, mainWin } = await launchApp()

    const result = await mainWin.evaluate(async () => {
      const api = (window as unknown as {
        electronAPI: {
          agentChat: (msgs: unknown[]) => Promise<string>
          onAgentChunk: (cb: (p: unknown) => void) => () => void
          onAgentDone: (cb: (p: unknown) => void) => () => void
          onAgentError: (cb: (p: unknown) => void) => () => void
        }
      }).electronAPI

      // 先订阅三类事件，任一到达即认为"链路回流成功"
      const eventPromise = new Promise<string>((resolve) => {
        const offs: Array<() => void> = []
        const done = (kind: string) => {
          offs.forEach((off) => off())
          resolve(kind)
        }
        offs.push(api.onAgentChunk(() => done('chunk')))
        offs.push(api.onAgentDone(() => done('done')))
        offs.push(api.onAgentError(() => done('error')))
        // 45s 无任何事件 = 链路断（正是"运行不显示"的病灶）
        setTimeout(() => done('timeout'), 45_000)
      })

      let correlationId: string
      try {
        correlationId = await api.agentChat([{ role: 'user', content: 'E2E 链路验证 ping' }])
      } catch (e) {
        return { correlationId: null, event: `invoke-reject:${(e as Error).message}` }
      }
      const event = await eventPromise
      return { correlationId, event }
    })

    // agentChat 必须返回 correlationId（fire-and-forget 契约）
    expect(typeof result.correlationId, 'agentChat 应返回 correlationId').toBe('string')
    // 必须有事件回流：chunk/done/error 均可（无 Key 时预期 error），
    // timeout 表示主进程处理了请求但事件永远没回来 —— 即用户投诉的"运行不显示"
    expect(['chunk', 'done', 'error'], `事件回流结果=${result.event}`).toContain(result.event)

    await app.close()
  })

  // ==========================================================
  // T3. AIPanel 发送按钮有真实响应（错误必须上屏）
  // ==========================================================
  testOrSkip('T3: 工作台发送消息必有可见反馈（无 Key 时提示上屏，不许静默）', async () => {
    const { app, mainWin } = await launchApp()
    await gotoRoute(mainWin, '#/workbench')
    await mainWin.waitForSelector('.wb-main-layout', { timeout: 15000 })

    // AIPanel 默认展开；不在则点标题栏 AI 按钮
    const composer = mainWin.locator('#ai-composer-input')
    if (!(await composer.isVisible().catch(() => false))) {
      await mainWin.locator('[data-dom-id="btn-toggle-ai"]').click()
      await composer.waitFor({ state: 'visible', timeout: 5000 })
    }

    const sent = `E2E 发送验证 ${Date.now()}`
    await composer.fill(sent)
    await composer.press('Enter')

    // 必须出现可见反馈之一（5 秒内）：
    // a) sonner 提示（未配置 API Key 等前置拦截；旧版这里等的是 antd message，antd 已退场）
    // b) 消息列表里出现刚发出去的那句话（已配 Key 时走真实发送）
    const feedback = mainWin.locator(`[data-sonner-toast], :text("${sent}")`)
    await expect(feedback.first(), '发送后 5 秒内必须有可见反馈（提示或消息上屏），静默=死按钮').toBeVisible({
      timeout: 5000,
    })

    await app.close()
  })

  // ==========================================================
  // T4. 假 UI 回归断言（已删除的假内容不得复活）
  // ==========================================================
  testOrSkip('T4: 假服务器/假告警/假AI检索/死按钮 不得复活', async () => {
    const { app, mainWin } = await launchApp()

    // 4a. MonitorPage：无硬编码假服务器、无 DEV 假告警
    //     （旧版等的 .mon-main 随阶段 F 改版消失了，改成全站统一的 page-title 钩子）
    await gotoRoute(mainWin, '#/monitor')
    await mainWin.waitForSelector('[data-dom-id="page-title"]', { timeout: 15000 })
    const monText = (await mainWin.locator('main').first().innerText()) ?? ''
    expect(monText, 'MonitorPage 不得出现硬编码假服务器').not.toContain('prod-web-01')
    expect(monText, 'MonitorPage 不得出现 DEV 假告警').not.toContain('磁盘使用率92%')
    expect(monText, '未连接时应诚实显示').toContain('未连接')

    // 4b. KnowledgePage：假"AI检索"开关已删除
    await gotoRoute(mainWin, '#/knowledge')
    await mainWin.waitForSelector('.kb-page', { timeout: 15000 })
    await expect(
      mainWin.locator('button[aria-label="AI检索"]'),
      '假"AI检索"开关不得复活（kbSearch 不支持语义检索）',
    ).toHaveCount(0)
    // 假统计"已收录 1,247 条"不得在 Electron 环境出现
    const kbText = (await mainWin.locator('.kb-page').innerText()) ?? ''
    expect(kbText, '假统计数据不得出现').not.toContain('1,247')

    // 4c. Workbench EditorArea：两个 A 级死按钮已删除
    await gotoRoute(mainWin, '#/workbench')
    await mainWin.waitForSelector('.wb-main-layout', { timeout: 15000 })
    await expect(mainWin.locator('button[title="分屏（开发中）"]')).toHaveCount(0)
    await expect(mainWin.locator('button[title="更多（开发中）"]')).toHaveCount(0)

    await app.close()
  })

  // ==========================================================
  // T5. Agent 真实工具执行可视化（agent:tool-event 全链路回流）
  // ==========================================================
  // 病灶背景：主对话 Agent 真实调用 ssh_readonly 等工具时，streamText 的
  // tool-call/tool-result 分片此前被丢弃，前端完全看不到 Agent 到底执行了什么。
  // v2.4 修复后新增 agent:tool-event 通道。本用例从【主进程】真实发出该事件，
  // 验证 main → preload(createListener) → 全局订阅 → agent-store.appendToolEvent
  // → LiveMessageRow 执行卡片 的完整链路真通（无需真实 API Key / SSH 服务器）。
  testOrSkip('T5: agent:tool-event 真实回流 → 执行卡片上屏（工具执行可视化）', async () => {
    const { app, mainWin } = await launchApp()
    await gotoRoute(mainWin, '#/workbench')
    await mainWin.waitForSelector('.wb-main-layout', { timeout: 15000 })

    // 打开 AI 面板（默认展开；未展开则点标题栏 AI 按钮）
    const composer = mainWin.locator('#ai-composer-input')
    if (!(await composer.isVisible().catch(() => false))) {
      await mainWin.locator('[data-dom-id="btn-toggle-ai"]').click()
      await composer.waitFor({ state: 'visible', timeout: 5000 })
    }

    // 1) 注入一条“流式中”assistant 消息（复刻 useAgentChat 发送后创建的占位）。
    //    appendToolEvent 仅把事件挂到 isStreaming 的 assistant 消息上，故必须先有它。
    //    __tdsfStores 仅在 DEV / navigator.webdriver（Playwright）下挂载，见 main.tsx。
    const injected = await mainWin.evaluate(() => {
      const stores = (window as unknown as {
        __tdsfStores?: {
          agent: { getState: () => { addMessage: (m: Record<string, unknown>) => void } }
        }
      }).__tdsfStores
      if (!stores) return false
      stores.agent.getState().addMessage({
        id: 'e2e_tool_assistant',
        role: 'assistant',
        content: '正在诊断磁盘与内存…',
        timestamp: Date.now(),
        isStreaming: true,
      })
      return true
    })
    expect(injected, '__tdsfStores 测试钩子应可用（main.tsx 在 webdriver 下挂载）').toBe(true)

    // 2) 从【主进程】真实发出 call 事件（走 webContents.send → 真实 IPC 通道）
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win?.webContents.send('agent:tool-event', {
        correlationId: 'e2e_corr',
        toolCallId: 'e2e_tc_1',
        phase: 'call',
        toolName: 'ssh_readonly',
        input: 'df -h',
      })
    })

    // call 阶段：执行卡片必须上屏，含中文工具名 + 命令 + “执行中”状态
    const card = mainWin.locator('.ai-tool-exec').first()
    await expect(card, 'call 事件后执行卡片必须上屏（否则 main→UI 链路断）').toBeVisible({
      timeout: 5000,
    })
    await expect(card).toContainText('只读诊断命令')
    await expect(card).toContainText('df -h')
    await expect(card).toContainText('执行中')

    // 3) 从【主进程】补发 result 事件（同 toolCallId 配对回填）
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win?.webContents.send('agent:tool-event', {
        correlationId: 'e2e_corr',
        toolCallId: 'e2e_tc_1',
        phase: 'result',
        toolName: 'ssh_readonly',
        ok: true,
        output: 'Filesystem  Size  Used Avail Use%\n/dev/sda1  50G  20G  28G  42% /',
      })
    })

    // result 阶段：输出补全 + “执行中”消失（done=true 不再渲染状态）
    await expect(card, 'result 事件后卡片应补全输出').toContainText('Use%', { timeout: 5000 })
    await expect(card, 'done 后不应再显示“执行中”').not.toContainText('执行中')

    // 截图存档（P1 工具执行可视化的可见证据）
    await mainWin.screenshot({
      path: path.join(__dirname, '../../test-results/p1-tool-exec-card.png'),
    })

    await app.close()
  })

  // ==========================================================
  // T6. 知识检索工具可视化复用（kb_search / tutorial_search）
  // ==========================================================
  // P2：kb_search / tutorial_search 已接成 supervisor 真实工具，复用 agent:tool-event
  // 可视化。本用例验证这两个工具名在前端正确映射为中文卡片标题，且 query/summary
  // 正确渲染（toolDisplayName + 执行卡片复用，无需真实 API Key / DB）。
  testOrSkip('T6: kb_search / tutorial_search 执行卡片复用可视化（P2 知识检索）', async () => {
    const { app, mainWin } = await launchApp()
    await gotoRoute(mainWin, '#/workbench')
    await mainWin.waitForSelector('.wb-main-layout', { timeout: 15000 })

    const composer = mainWin.locator('#ai-composer-input')
    if (!(await composer.isVisible().catch(() => false))) {
      await mainWin.locator('[data-dom-id="btn-toggle-ai"]').click()
      await composer.waitFor({ state: 'visible', timeout: 5000 })
    }

    // 注入流式 assistant 占位（tool-event 挂载目标）
    await mainWin.evaluate(() => {
      const stores = (window as unknown as {
        __tdsfStores?: {
          agent: { getState: () => { addMessage: (m: Record<string, unknown>) => void } }
        }
      }).__tdsfStores
      stores?.agent.getState().addMessage({
        id: 'e2e_kb_assistant',
        role: 'assistant',
        content: '正在检索知识库与教程…',
        timestamp: Date.now(),
        isStreaming: true,
      })
    })

    // 从【主进程】连发 kb_search + tutorial_search 的 call/result 事件
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win?.webContents.send('agent:tool-event', {
        correlationId: 'e2e_kb', toolCallId: 'kb_1', phase: 'call',
        toolName: 'kb_search', input: 'nginx 502',
      })
      win?.webContents.send('agent:tool-event', {
        correlationId: 'e2e_kb', toolCallId: 'kb_1', phase: 'result',
        toolName: 'kb_search', ok: true, count: 1,
        output: '1. [Nginx 502 排查] 上游进程挂了导致 502',
      })
      win?.webContents.send('agent:tool-event', {
        correlationId: 'e2e_kb', toolCallId: 'tut_1', phase: 'call',
        toolName: 'tutorial_search', input: 'systemd 服务',
      })
      win?.webContents.send('agent:tool-event', {
        correlationId: 'e2e_kb', toolCallId: 'tut_1', phase: 'result',
        toolName: 'tutorial_search', ok: true, count: 1,
        output: '1. [systemd 入门] 用 systemctl 管理服务',
      })
    })

    // kb_search 折叠行（v2.8：检索类走 Panel C 式折叠行，中文名 + 命中数徽标；
    // 旧断言等的是 .ai-tool-exec + 「知识库检索」，改版后类名与文案都变了）
    const kbCard = mainWin.locator('.ai-tool-search', { hasText: '检索知识库' }).first()
    await expect(kbCard, 'kb_search 行应上屏并显示中文名').toBeVisible({ timeout: 5000 })
    // 条数来自载荷里的 count（工具自己报的），界面不再从 output 文本数编号行
    await expect(kbCard, '应显示命中数而不是裸工具名').toContainText('1 条结果')
    await expect(
      kbCard.locator('.ai-tool-kind'),
      '展示名里已经写了"知识库"，不该再挂一块重复徽标',
    ).toHaveCount(0)
    await expect(kbCard, '界面上不许出现裸的工具 id').not.toContainText('kb_search')
    await kbCard.locator('button').first().click() // 展开
    await expect(kbCard).toContainText('nginx 502')
    await expect(kbCard).toContainText('Nginx 502 排查')

    // tutorial_search 同理
    const tutCard = mainWin.locator('.ai-tool-search', { hasText: '检索教程' }).first()
    await expect(tutCard, 'tutorial_search 行应上屏并显示中文名').toBeVisible({ timeout: 5000 })
    await tutCard.locator('button').first().click()
    await expect(tutCard).toContainText('systemd 服务')
    await expect(tutCard).toContainText('systemd 入门')

    await mainWin.screenshot({
      path: path.join(__dirname, '../../test-results/p2-kb-tutorial-cards.png'),
    })

    await app.close()
  })

  // ==========================================================
  // T7. 技能匹配可视化（skill_match，P3 skill router 接进主对话）
  // ==========================================================
  // P3：SkillRouter 命中内置运维手册时，supervisor 经 onToolEvent 推送 skill_match 事件。
  // 本用例验证 skill_match 在前端映射为「技能匹配」卡片，命中 skill 名 + 决策摘要正确渲染。
  testOrSkip('T7: skill_match 执行卡片可视化（P3 技能匹配）', async () => {
    const { app, mainWin } = await launchApp()
    await gotoRoute(mainWin, '#/workbench')
    await mainWin.waitForSelector('.wb-main-layout', { timeout: 15000 })

    const composer = mainWin.locator('#ai-composer-input')
    if (!(await composer.isVisible().catch(() => false))) {
      await mainWin.locator('[data-dom-id="btn-toggle-ai"]').click()
      await composer.waitFor({ state: 'visible', timeout: 5000 })
    }

    await mainWin.evaluate(() => {
      const stores = (window as unknown as {
        __tdsfStores?: { agent: { getState: () => { addMessage: (m: Record<string, unknown>) => void } } }
      }).__tdsfStores
      stores?.agent.getState().addMessage({
        id: 'e2e_skill_assistant',
        role: 'assistant',
        content: '正在匹配运维手册…',
        timestamp: Date.now(),
        isStreaming: true,
      })
    })

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win?.webContents.send('agent:tool-event', {
        correlationId: 'e2e_skill', toolCallId: 'sk_1', phase: 'call',
        toolName: 'skill_match', input: 'diagnose-oom-killer',
      })
      win?.webContents.send('agent:tool-event', {
        correlationId: 'e2e_skill', toolCallId: 'sk_1', phase: 'result',
        toolName: 'skill_match', ok: true,
        output: '决策 skill-assisted | 关键词包含匹配: "oom" | 预计省 120 token',
      })
    })

    const skillCard = mainWin.locator('.ai-tool-search', { hasText: '匹配技能' }).first()
    await expect(skillCard, 'skill_match 行应上屏并显示中文名').toBeVisible({ timeout: 5000 })
    await expect(skillCard, '界面上不许出现裸工具名').not.toContainText('skill_match')
    // 技能匹配的输出是一行散文、没有条数可读：报"完成"即可。
    // 旧版从前端的 output 文本里数编号行，数到 0 就写"无结果"——明明匹配到了手册，
    // 界面在说一件没发生过的事。
    await expect(skillCard, '没报条数的卡片不该编一个数字或"无结果"').toContainText('完成')
    await expect(skillCard).not.toContainText('无结果')
    await skillCard.locator('button').first().click() // 展开折叠行
    await expect(skillCard).toContainText('diagnose-oom-killer')
    await expect(skillCard).toContainText('skill-assisted')

    await mainWin.screenshot({
      path: path.join(__dirname, '../../test-results/p3-skill-match-card.png'),
    })

    await app.close()
  })

  // ==========================================================
  // T8. MCP 工具卡的身份与入参排版（外部服务器提供的工具）
  // ==========================================================
  // MCP 工具名带分隔符（server__tool），执行前界面只甩一长串英文原名，入参是
  // JSON.stringify 出来的对象却顶着"查询："的标签——用户看不出这是在对系统动手，
  // 还以为在查资料。本用例从主进程真发一次 MCP 调用，验这几条在真实界面上都成立。
  testOrSkip('T8: MCP 工具显示成「server · tool」，JSON 入参按代码排版', async () => {
    const { app, mainWin } = await launchApp()
    await gotoRoute(mainWin, '#/workbench')
    await mainWin.waitForSelector('.wb-main-layout', { timeout: 15000 })

    const composer = mainWin.locator('#ai-composer-input')
    if (!(await composer.isVisible().catch(() => false))) {
      await mainWin.locator('[data-dom-id="btn-toggle-ai"]').click()
      await composer.waitFor({ state: 'visible', timeout: 5000 })
    }

    await mainWin.evaluate(() => {
      const stores = (window as unknown as {
        __tdsfStores?: { agent: { getState: () => { addMessage: (m: Record<string, unknown>) => void } } }
      }).__tdsfStores
      stores?.agent.getState().addMessage({
        id: 'e2e_mcp_assistant',
        role: 'assistant',
        content: '正在通过 MCP 读取远程文件…',
        timestamp: Date.now(),
        isStreaming: true,
      })
    })

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win?.webContents.send('agent:tool-event', {
        correlationId: 'e2e_mcp', toolCallId: 'mcp_1', phase: 'call',
        toolName: 'filesystem__read_file', input: '{"path":"/etc/hosts","limit":10}',
      })
    })

    const mcpCard = mainWin.locator('.ai-tool-search', { hasText: 'filesystem · read_file' }).first()
    await expect(mcpCard, 'MCP 卡应上屏并显示成 server · tool').toBeVisible({ timeout: 5000 })
    // 进行中的说法按类别分：MCP 是"调用中"，不是所有非命令类都写"检索中"
    await expect(mcpCard, 'MCP 调用不是检索').toContainText('调用中')
    await expect(mcpCard).not.toContainText('检索中')
    await expect(mcpCard.locator('.ai-tool-kind'), 'MCP 那串名字里看不出它是外部工具').toContainText('MCP')

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win?.webContents.send('agent:tool-event', {
        correlationId: 'e2e_mcp', toolCallId: 'mcp_1', phase: 'result',
        toolName: 'filesystem__read_file', ok: true,
        output: '127.0.0.1 localhost\n::1 localhost',
      })
    })
    await mcpCard.locator('button').first().click() // 展开
    await expect(mcpCard, '入参标签该是"入参"，不是"查询"').toContainText('入参')
    await expect(mcpCard).not.toContainText('查询')
    // JSON 串单独成块排版（塞进引号里就是一团读不懂的字）
    await expect(mcpCard.locator('.ai-tool-io-code')).toContainText('"path":"/etc/hosts"')
    // 复制按钮只在环境真能写剪贴板时才画；画出来了就得是真能点的
    await expect(mcpCard.locator('.ai-tool-copy'), '输出块要有能用的复制入口').toHaveCount(1)

    await mainWin.screenshot({
      path: path.join(__dirname, '../../test-results/p4-mcp-card.png'),
    })

    await app.close()
  })
})
