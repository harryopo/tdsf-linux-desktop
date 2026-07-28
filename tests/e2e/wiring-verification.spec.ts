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

/** Electron 主进程入口（需先 pnpm build） */
const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')

/** 是否已 build（本地需手动 pnpm build） */
const BUILD_READY = fs.existsSync(MAIN_ENTRY)
const testOrSkip = BUILD_READY ? test : test.skip

/** 启动 Electron 应用并返回首窗口 */
async function launchApp() {
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      TDSF_E2E: '1',
    },
  })
  const window = await app.firstWindow()
  await window.waitForSelector('body', { timeout: 30000 })
  return { app, window }
}

/** 跳过 BootPage 直接进入指定 hash 路由 */
async function gotoRoute(window: Awaited<ReturnType<typeof launchApp>>['window'], hash: string) {
  await window.evaluate((h) => {
    window.location.hash = h
  }, hash)
  await window.waitForTimeout(800)
}

test.describe('接线真通验证（P0/P1 修复回归）', () => {
  test.describe.configure({ mode: 'serial' })

  // ==========================================================
  // T1. preload 契约运行时抽查
  // ==========================================================
  testOrSkip('T1: P0/P1 修复的 preload 方法运行时存在且 invoke 可达', async () => {
    const { app, window } = await launchApp()

    // 1a. 方法存在性（曾经 electron.d.ts 声明了但运行时 undefined —— 类型撒谎断链）
    const missing = await window.evaluate(() => {
      const api = (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI
      const required = [
        // P1-1：mcp 系 7 方法（曾定义未暴露）
        'mcpGetState', 'mcpReset', 'onMcpStateChanged',
        'mcpExternalStatus', 'mcpExternalTools', 'mcpExternalCall', 'mcpExternalReconnect',
        // P0-3：新增默认 Provider 查询
        'providerGetDefault',
        // Agent 主链路
        'agentChat', 'onAgentChunk', 'onAgentDone', 'onAgentError',
      ]
      return required.filter((m) => typeof api?.[m] !== 'function')
    })
    expect(missing, `以下方法在 window.electronAPI 上不存在：${missing.join(', ')}`).toEqual([])

    // 1b. invoke 真实可达（曾经 preload 定义了但 main 没注册 → invoke reject）
    const results = await window.evaluate(async () => {
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
    const { app, window } = await launchApp()

    const result = await window.evaluate(async () => {
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
    const { app, window } = await launchApp()
    await gotoRoute(window, '#/workbench')
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })

    // AIPanel 默认展开；不在则点标题栏 AI 按钮
    const composer = window.locator('.ai-composer-textarea')
    if (!(await composer.isVisible().catch(() => false))) {
      await window.locator('[data-dom-id="btn-toggle-ai"]').click()
      await composer.waitFor({ state: 'visible', timeout: 5000 })
    }

    await composer.fill('E2E 发送验证')
    await composer.press('Enter')

    // 必须出现可见反馈之一（3 秒内）：
    // a) antd message 提示（未配置 API Key 前置拦截）
    // b) 消息列表新增用户消息（已配 Key 时走真实发送）
    const feedback = window
      .locator('.ant-message-notice, .ai-msg-user, [class*="ai-message"]')
      .first()
    await expect(feedback, '发送后 3 秒内必须有可见反馈（提示或消息上屏），静默=死按钮').toBeVisible({
      timeout: 3000,
    })

    await app.close()
  })

  // ==========================================================
  // T4. 假 UI 回归断言（已删除的假内容不得复活）
  // ==========================================================
  testOrSkip('T4: 假服务器/假告警/假AI检索/死按钮 不得复活', async () => {
    const { app, window } = await launchApp()

    // 4a. MonitorPage：无硬编码假服务器、无 DEV 假告警
    await gotoRoute(window, '#/monitor')
    await window.waitForSelector('.mon-main', { timeout: 15000 })
    const monText = (await window.locator('.mon-main').innerText()) ?? ''
    expect(monText, 'MonitorPage 不得出现硬编码假服务器').not.toContain('prod-web-01')
    expect(monText, 'MonitorPage 不得出现 DEV 假告警').not.toContain('磁盘使用率92%')
    expect(monText, '未连接时应诚实显示').toContain('未连接服务器')

    // 4b. KnowledgePage：假"AI检索"开关已删除
    await gotoRoute(window, '#/knowledge')
    await window.waitForSelector('.kb-page', { timeout: 15000 })
    await expect(
      window.locator('button[aria-label="AI检索"]'),
      '假"AI检索"开关不得复活（kbSearch 不支持语义检索）',
    ).toHaveCount(0)
    // 假统计"已收录 1,247 条"不得在 Electron 环境出现
    const kbText = (await window.locator('.kb-page').innerText()) ?? ''
    expect(kbText, '假统计数据不得出现').not.toContain('1,247')

    // 4c. Workbench EditorArea：两个 A 级死按钮已删除
    await gotoRoute(window, '#/workbench')
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })
    await expect(window.locator('button[title="分屏（开发中）"]')).toHaveCount(0)
    await expect(window.locator('button[title="更多（开发中）"]')).toHaveCount(0)

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
    const { app, window } = await launchApp()
    await gotoRoute(window, '#/workbench')
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })

    // 打开 AI 面板（默认展开；未展开则点标题栏 AI 按钮）
    const composer = window.locator('.ai-composer-textarea')
    if (!(await composer.isVisible().catch(() => false))) {
      await window.locator('[data-dom-id="btn-toggle-ai"]').click()
      await composer.waitFor({ state: 'visible', timeout: 5000 })
    }

    // 1) 注入一条“流式中”assistant 消息（复刻 useAgentChat 发送后创建的占位）。
    //    appendToolEvent 仅把事件挂到 isStreaming 的 assistant 消息上，故必须先有它。
    //    __tdsfStores 仅在 DEV / navigator.webdriver（Playwright）下挂载，见 main.tsx。
    const injected = await window.evaluate(() => {
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
    const card = window.locator('.ai-tool-exec').first()
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
    await window.screenshot({
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
    const { app, window } = await launchApp()
    await gotoRoute(window, '#/workbench')
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })

    const composer = window.locator('.ai-composer-textarea')
    if (!(await composer.isVisible().catch(() => false))) {
      await window.locator('[data-dom-id="btn-toggle-ai"]').click()
      await composer.waitFor({ state: 'visible', timeout: 5000 })
    }

    // 注入流式 assistant 占位（tool-event 挂载目标）
    await window.evaluate(() => {
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
        toolName: 'kb_search', ok: true,
        output: '1. [Nginx 502 排查] 上游进程挂了导致 502',
      })
      win?.webContents.send('agent:tool-event', {
        correlationId: 'e2e_kb', toolCallId: 'tut_1', phase: 'call',
        toolName: 'tutorial_search', input: 'systemd 服务',
      })
      win?.webContents.send('agent:tool-event', {
        correlationId: 'e2e_kb', toolCallId: 'tut_1', phase: 'result',
        toolName: 'tutorial_search', ok: true,
        output: '1. [systemd 入门] 用 systemctl 管理服务',
      })
    })

    // kb_search 卡片：中文名「知识库检索」+ query + summary
    const kbCard = window.locator('.ai-tool-exec', { hasText: '知识库检索' }).first()
    await expect(kbCard, 'kb_search 卡片应上屏并显示中文名').toBeVisible({ timeout: 5000 })
    await expect(kbCard).toContainText('nginx 502')
    await expect(kbCard).toContainText('Nginx 502 排查')

    // tutorial_search 卡片：中文名「教程检索」+ query + summary
    const tutCard = window.locator('.ai-tool-exec', { hasText: '教程检索' }).first()
    await expect(tutCard, 'tutorial_search 卡片应上屏并显示中文名').toBeVisible({ timeout: 5000 })
    await expect(tutCard).toContainText('systemd 服务')
    await expect(tutCard).toContainText('systemd 入门')

    await window.screenshot({
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
    const { app, window } = await launchApp()
    await gotoRoute(window, '#/workbench')
    await window.waitForSelector('.wb-main-layout', { timeout: 15000 })

    const composer = window.locator('.ai-composer-textarea')
    if (!(await composer.isVisible().catch(() => false))) {
      await window.locator('[data-dom-id="btn-toggle-ai"]').click()
      await composer.waitFor({ state: 'visible', timeout: 5000 })
    }

    await window.evaluate(() => {
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

    const skillCard = window.locator('.ai-tool-exec', { hasText: '技能匹配' }).first()
    await expect(skillCard, 'skill_match 卡片应上屏并显示中文名').toBeVisible({ timeout: 5000 })
    await expect(skillCard).toContainText('diagnose-oom-killer')
    await expect(skillCard).toContainText('skill-assisted')

    await window.screenshot({
      path: path.join(__dirname, '../../test-results/p3-skill-match-card.png'),
    })

    await app.close()
  })
})
