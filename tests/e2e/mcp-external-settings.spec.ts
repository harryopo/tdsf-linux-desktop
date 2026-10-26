/**
 * 外部 MCP 登记面 + AI 侧调用 + 网关状态格的真机验收（#173 第二、三步；#209 第四、五步；#217 界面试调用）
 *
 * 单测只能证明"validateDraft 会拒这份草稿"、"载荷与装配点在"，证明不了：
 *   1. 从设置页点"添加"之后，那一行真的出现在列表里、状态列读的是连接池的真实结果；
 *   2. 登记完的外部工具，调用前仍然必须有人点头（写入口开了不能把审批绕过去）；
 *   3. **子进程看不见没点名的环境变量**（这是本批关掉的那个洞，正反两对照都做）；
 *   4. 点"移除"之后那行真的没了——不是只从配置里消失、进程还在跑；
 *   5. 模型在对话里报出工具名之后，主进程真能认出是哪台的哪个工具、
 *      拒了不执行、批了把返回回喂给它（第二条用例）；
 *   6. 网关状态那一格真的跟着主进程走（第三条用例，#209）：失败推上来界面就变、
 *      没人点刷新；「重置失败计数」按下去，主进程那台机器也跟着清零；
 *   7. 工具行上那颗「试调用」（#217）：拒了一次都不执行、批了把回话显示出来——
 *      界面入口开的是同一条审批路，不是第二条不用问路。
 *
 * 夹具 tests/e2e/fixtures/mcp-env-probe.mjs 是个真 MCP server，只回报"看得见哪些变量名"。
 * skip 不等于通过：没有 out/main/index.js 就先 pnpm build。
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { FIXTURE_READY, launchApp } from './ssh-fixture-helpers'
import { startAiFixture, type AiFixtureHandle } from './ai-fixture-server'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'mcp-env-probe.mjs')
const testOrSkip = FIXTURE_READY && BUILD_READY && fs.existsSync(FIXTURE_PATH) ? test : test.skip

if (!testOrSkip) {
  console.log(
    '[mcp-external-settings] 跳过：需要 out/main/index.js（先 pnpm build）与夹具。skip 不等于通过。'
  )
}

const CARD = 'section[aria-label="命令审批"]'
/** 种在测试进程里的变量：应用继承得到，外部子进程不该看见 */
const PROBE = 'TDSF_E2E_MCP_PROBE'

interface Probe {
  envNames: string[]
  seenProbeVar: boolean
}

testOrSkip('设置页登记外部 MCP：列表、审批、环境隔离、移除，全在真窗口里走一遍', async () => {
  test.setTimeout(180_000)
  process.env[PROBE] = 'planted-for-isolation-check'

  const { app, page } = await launchApp()
  try {
    await page.evaluate(() => {
      window.location.hash = '#/settings/mcp'
    })
    // 档位不是每轮全新的（上一轮登记的服务器还在），所以先把残留清掉，
    // 再给本轮的服务器起一个带一次性后缀的名字——不然"第几行是谁"根本说不清。
    const TAG = `r${Date.now().toString(36)}`
    const NAME = `环境探针 ${TAG}`
    const NAME_NAMED = `环境探针点名 ${TAG}`
    const left = await page.evaluate(async () => {
      const existing = await window.electronAPI.mcpExternalList()
      for (const s of existing) await window.electronAPI.mcpExternalRemove(s.id)
      return existing.length
    })
    if (left > 0) {
      await page.click('[data-dom-id="mcp-reload"]')
    }
    await expect(page.getByText('还没有登记外部 MCP 服务器')).toBeVisible({ timeout: 25_000 })

    // ① 从界面添加一台（command 用当前这台 node/电子二进制的解释器路径，由测试侧递进来）
    const runner = process.execPath
    await page.fill('[data-dom-id="mcp-add-name"]', NAME)
    await page.fill('[data-dom-id="mcp-add-command"]', runner)
    await page.fill('[data-dom-id="mcp-add-args"]', FIXTURE_PATH)
    await page.click('[data-dom-id="mcp-add-submit"]')

    const row = page.locator('tr[data-dom-id^="mcp-server-row-"]')
    await expect(row.first(), '添加后列表里没有那一行').toBeVisible({ timeout: 15_000 })
    await expect(row.first()).toContainText(NAME)

    // ② 工具清单来自那次真连接：读不到工具就说明没连上，状态列也得说同一件事
    await expect(page.locator('[data-dom-id="mcp-tool-row"]').first(), '工具清单里等不到 env_probe').toBeVisible(
      { timeout: 30_000 }
    )
    await expect(page.locator('[data-dom-id="mcp-tool-row"]').first()).toContainText('env_probe')
    await expect(row.first(), '状态列与工具清单说的不是同一件事').toContainText('已连接')
    await expect(row.first()).toContainText('1')

    // ③ 调用前必须有人点头；批准之后才拿到探针回报
    const callByName = (name: string) =>
      page.evaluate(async (target) => {
        const list = await window.electronAPI.mcpExternalList()
        const hit = list.find((s) => s.name === target)
        if (!hit) throw new Error(`列表里没有「${target}」`)
        return window.electronAPI.mcpExternalCall(hit.id, 'env_probe', {})
      }, name)

    const callUnapproved = callByName(NAME)
    await page.waitForSelector(CARD, { timeout: 15_000 })
    // 卡上必须写得出"哪一台的哪个工具"：写内部 id 等于让人对乱码点头
    await expect(page.locator(CARD)).toContainText(NAME)
    await expect(page.locator(CARD)).toContainText('env_probe')
    await page.click(`${CARD} >> role=button[name=/拒绝/]`)
    const rejected = await callUnapproved
    expect(rejected.error, '没批准却执行了').toBe('not-approved')

    const approved = callByName(NAME)
    await page.waitForSelector(CARD, { timeout: 15_000 })
    await page.click(`${CARD} >> role=button[name=/批准这一次/]`)
    const result = await approved
    expect(result.success, `调用失败：${result.error ?? ''}`).toBe(true)

    const probe = JSON.parse(String(result.content[0]?.text ?? '{}')) as Probe
    expect(Array.isArray(probe.envNames), '探针回报的不是清单').toBe(true)
    expect(probe.envNames.length, '探针没回报任何环境变量').toBeGreaterThan(0)
    // 正对照：PATH 这类基础变量在（说明不是"给了个空环境"把断言骗绿）
    expect(probe.envNames.map((k) => k.toUpperCase())).toContain('PATH')
    // 反对照：没点名的那个种进去的变量不该看得见
    expect(probe.seenProbeVar, '外部子进程拿到了整个 process.env，隔离没生效').toBe(false)

    // ④ 点名才给：再登记一台显式要这个变量的，同一条路必须能看见它
    await page.fill('[data-dom-id="mcp-add-name"]', NAME_NAMED)
    await page.fill('[data-dom-id="mcp-add-command"]', runner)
    await page.fill('[data-dom-id="mcp-add-args"]', FIXTURE_PATH)
    await page.fill('[data-dom-id="mcp-add-env-keys"]', PROBE)
    await page.click('[data-dom-id="mcp-add-submit"]')
    await expect(page.locator('tr[data-dom-id^="mcp-server-row-"]')).toHaveCount(2, { timeout: 15_000 })

    const namedPrep = await page.evaluate(
      async ({ name, probeName }) => {
        const list = await window.electronAPI.mcpExternalList()
        const target = list.find((s) => s.name === name)
        if (!target) throw new Error(`没找到「${name}」`)
        // 落库形状里必须带着点名的键（不是值），且不能有任何 env 值这一栏
        if (!target.envKeys?.includes(probeName)) throw new Error('落库的形状里没有 envKeys')
        if ('env' in target) throw new Error('配置里出现了环境变量值')
        return true
      },
      { name: NAME_NAMED, probeName: PROBE }
    )
    expect(namedPrep, '点名继承的那台没有按形状落库').toBe(true)

    const named = callByName(NAME_NAMED)
    await page.waitForSelector(CARD, { timeout: 15_000 })
    await page.click(`${CARD} >> role=button[name=/批准这一次/]`)
    const namedResult = await named
    expect(namedResult.success, `调用失败：${namedResult.error ?? ''}`).toBe(true)
    const namedProbe = JSON.parse(String(namedResult.content[0]?.text ?? '{}')) as Probe
    expect(namedProbe.seenProbeVar, '点名的变量没传下去——那上一条"看不见"是因为根本没给环境').toBe(true)

    // ⑤ 界面「试调用」（#217）：入口按下去走的还是那条 external-call，
    //    所以拒与批必须在真窗口里各走一遍——组件测试只能证明按钮接的是这把键。
    const toolRow = page.locator('li[data-dom-id="mcp-tool-row"]', { hasText: `${NAME} · env_probe` })
    const shown = toolRow.locator('[data-dom-id="mcp-tool-call-result"]')
    await expect(toolRow, '工具行没按"服务器名 · 工具名"渲染').toBeVisible({ timeout: 15_000 })
    await toolRow.locator('[data-dom-id="mcp-tool-tryout"]').click()
    await toolRow.locator('[data-dom-id="mcp-tool-args"]').fill('{}')

    await toolRow.locator('[data-dom-id="mcp-tool-exec"]').click()
    await page.waitForSelector(CARD, { timeout: 15_000 })
    await expect(page.locator(CARD), '界面发起的调用没推审批卡').toContainText(NAME)
    await page.click(`${CARD} >> role=button[name=/拒绝/]`)
    await expect(shown, '拒绝之后界面没写"没有执行"').toContainText('没有执行', { timeout: 15_000 })
    await expect(shown, '没批准那张脸不能长得像回了话').not.toContainText(/成功|已调用/)

    await toolRow.locator('[data-dom-id="mcp-tool-exec"]').click()
    await page.waitForSelector(CARD, { timeout: 15_000 })
    await page.click(`${CARD} >> role=button[name=/批准这一次/]`)
    await expect(shown, '批准之后界面没显出对面回的文本').toContainText('envNames', { timeout: 20_000 })

    // ⑥ 移除：那一行要真的消失，且再读列表少一条（只删配置不断进程的话，这里还会读到已连接）
    await page.click(`tr[data-dom-id^="mcp-server-row-"] >> nth=0 >> role=button[name="移除 ${NAME}"]`)
    await expect(page.locator('tr[data-dom-id^="mcp-server-row-"]')).toHaveCount(1, { timeout: 15_000 })
    const remaining = await page.evaluate(() => window.electronAPI.mcpExternalList())
    expect(remaining.map((s) => s.name), '列表里还剩着被"移除"的那台').toEqual([NAME_NAMED])
  } finally {
    delete process.env[PROBE]
    await app.close()
  }
})

/**
 * 第三步：AI 在对话里真能调用外部 MCP 工具，而且调用前照样要有人点头（#173）
 *
 * 单测能证明"载荷与装配点接上了"，证明不了这一整串：
 * 模型发出的工具名 ↔ 主进程挂上去的键对得上、执行前真弹卡、
 * 拒绝时那句话说得清、批准时第三方程序的返回真回喂给了模型。
 *
 * 对端用 tests/e2e/ai-fixture-server.ts 的本地假模型：工具调用的名字由测试指定，
 * 这是真模型给不了的确定性（真模型调不调、调哪个都不由测试决定）。
 * 拒与批各走一轮，是因为只批不拒测不出"没批准那条路真的没执行"。
 */
testOrSkip('对话里调外部 MCP 工具：模型发起 → 审批 → 结果回喂，拒与批各一轮', async () => {
  test.setTimeout(180_000)
  process.env[PROBE] = 'planted-for-isolation-check'

  const ai: AiFixtureHandle = await startAiFixture()
  const { app, page } = await launchApp()
  const TAG = `a${Date.now().toString(36)}`
  const NAME = `对话探针 ${TAG}`

  /** 发一轮对话；审批卡会在执行工具前推出来，所以这里不能 await 到底再交互 */
  const runChat = (prompt: string): Promise<string> =>
    page.evaluate(async (p) => {
      const w = window as unknown as {
        electronAPI: { agentChat: (msgs: unknown[], providerId?: string) => Promise<string> }
      }
      return w.electronAPI.agentChat([{ role: 'user', content: p }])
    }, prompt)

  try {
    // 档位是跨轮累积的，先把上一台留下的服务器清掉
    await page.evaluate(async () => {
      const list = await window.electronAPI.mcpExternalList()
      for (const s of list) await window.electronAPI.mcpExternalRemove(s.id)
    })

    const saved = await page.evaluate(async (cfg) => {
      const api = window.electronAPI
      const ok = await api.providerSave({
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
      const setOk = await api.providerSetDefault(cfg.providerId)
      return ok && setOk
    }, { providerId: 'fixture-chat-model', baseURL: ai.baseURL, model: 'fixture-model', apiKey: 'fixture-' + 'key' })
    expect(saved, '假模型没存成默认，后面测的就不是真对话链路').toBe(true)

    // 登记并连上一台真 MCP 服务器（界面添加那一步由上一条判据负责，这里只关心 AI 侧）
    const serverId = await page.evaluate(async (args) => {
      const s = await window.electronAPI.mcpExternalAdd({
        name: args.name,
        transport: 'stdio',
        command: args.command,
        args: [args.fixture],
      })
      return s.id
    }, { name: NAME, command: process.execPath, fixture: FIXTURE_PATH })

    // 连上才读得到工具（读工具那一次才建连接，与设置页同一条路）
    await page.waitForFunction(
      async (id) => {
        const tools = await window.electronAPI.mcpExternalTools()
        return tools.some((t) => t.serverId === id && t.name === 'env_probe')
      },
      serverId,
      { timeout: 30_000 }
    )

    // 模型要原样报出这个键，主进程才认得出是哪台的哪个工具
    const toolKey = `mcp__${serverId}__env_probe`
    const allowBtn = page.locator(CARD).getByRole('button', { name: /批准这一次/ })
    const denyBtn = page.locator(CARD).getByRole('button', { name: /拒绝/ })

    /**
     * 按键走审批条的快捷键通道
     *
     * 先 blur 是真的必要：`permission-bar.tsx` 明写"输入框里打字不该被当成审批快捷键"，
     * 焦点若留在输入框，这条测的就不是那两片数字键承诺的东西。
     */
    const pressKey = async (key: string): Promise<void> => {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await page.keyboard.press(key)
    }

    // ① 模型发起 → 用键盘拒绝：外部程序一次都不该跑
    // 卡上那两片 kbd（1=批准 / 2=拒绝）此前只有代码层处理器、没有真窗口取证（台账里记"未取证"那条），
    // 这里全程不碰鼠标：按 1 看选中项真挪过去，按 2 挪回来，Enter 执行选中的那一项。
    ai.planToolCall({ name: toolKey, args: {} })
    const denied = runChat('帮我看看这台机器的环境')
    await page.waitForSelector(CARD, { timeout: 20_000 })
    await expect(page.locator(CARD)).toContainText('外部 MCP 工具请求执行')
    await expect(page.locator(CARD)).toContainText(NAME)
    await pressKey('1')
    await expect(allowBtn, '按 1 没把选中项挪到"批准这一次"').toHaveAttribute('aria-pressed', 'true')
    await expect(denyBtn).toHaveAttribute('aria-pressed', 'false')
    await pressKey('2')
    await expect(denyBtn, '按 2 没把选中项挪回"拒绝"').toHaveAttribute('aria-pressed', 'true')
    await pressKey('Enter')
    await denied

    const deniedBody = ai.lastBody()
    expect(deniedBody, '"没有被批准"这句话没回到模型，它会以为自己查到了').toContain('没有被批准')
    expect(deniedBody, '没批准却执行了：探针的返回出现在回喂给模型的内容里').not.toContain('envNames')

    // ② 同样的工具，这次用键盘批准：第三方的返回必须真回到模型
    ai.planToolCall({ name: toolKey, args: {} })
    const approved = runChat('那再查一次')
    await page.waitForSelector(CARD, { timeout: 20_000 })
    await pressKey('1')
    await pressKey('Enter')
    const answer = await approved
    expect(answer, '对话没走到终点').toContain('2')

    const okBody = ai.lastBody()
    expect(okBody, '外部工具的返回没回到模型').toContain('envNames')
    // 环境隔离在 AI 这条路上同样成立：没点名的变量不该被子进程看见
    expect(okBody, '外部子进程拿到了整个 process.env').not.toContain(PROBE)
  } finally {
    delete process.env[PROBE]
    await ai.close()
    await app.close()
  }
})

/**
 * 网关状态那一格：真窗口里从"调用失败"到"界面变红"再到"重置回绿"（#209）
 *
 * 组件测试证明了订阅接上了、读数来自 mcpGetState；证明不了整条真链路：
 * 主进程状态机变更真的推到了这个窗口、界面不靠点刷新就变、
 * 「重置失败计数」真的把主进程那台机器清零（不是只把本地 state 洗白）。
 *
 * 触发的失败用一台没登记过的服务器 id —— clientManager 会把它做成带 isError 的
 * 正常返回（`src/main/services/mcp/client-manager.ts:186`），这正是网关上报失败
 * 那条真路，不是测试自己造出来的假状态。审批照点头：失败发生在批准之后。
 */
testOrSkip('网关状态格：外部调用失败 → 不刷新就变红 → 重置回绿', async () => {
  test.setTimeout(120_000)

  const { app, page } = await launchApp()
  const GHOST = `ghost-${Date.now().toString(36)}`
  /** 那一格在界面上的定位（按标题找卡片，不按内部组件名） */
  const card = page.locator('div.set-card', { hasText: '本机 MCP 网关此刻的健康状态' })

  /** 只从 DOM 文本读界面此刻显示的次数——不去猜组件内部状态 */
  const shownFailures = (): Promise<number | null> =>
    page.evaluate(() => {
      const el = Array.from(document.querySelectorAll<HTMLElement>('.set-card')).find((c) =>
        c.textContent?.includes('本机 MCP 网关此刻的健康状态')
      )
      const m = el?.textContent?.match(/连续失败 (\d+) 次/)
      return m ? Number(m[1]) : null
    })
  /** 主进程那台状态机此刻的真读数 */
  const truth = () => page.evaluate(() => window.electronAPI.mcpGetState())

  try {
    await page.evaluate(() => {
      window.location.hash = '#/settings/mcp'
    })
    await expect(card, '设置页里没有网关状态这一格').toBeVisible({ timeout: 20_000 })

    // 首屏：界面显示的次数必须等于主进程读数。这里不假设它是 0——
    // 本机 MCP Server 启动失败也会记进这台状态机（server.ts:247），档位不是每轮全新的。
    await expect
      .poll(async () => (await shownFailures()) === (await truth()).consecutiveFailures, {
        message: '首屏那一格显示的不是 mcpGetState 的读数',
        timeout: 20_000,
      })
      .toBe(true)

    const baseline = (await truth()).consecutiveFailures

    const call = page.evaluate(
      async (id) => window.electronAPI.mcpExternalCall(id, 'env_probe', {}),
      GHOST
    )
    await page.waitForSelector(CARD, { timeout: 15_000 })
    await page.click(`${CARD} >> role=button[name=/批准这一次/]`)
    const r = await call
    expect(r.success, '这台服务器压根没登记，这条该失败').toBe(false)
    expect(String(r.error ?? ''), '失败原因没回到调用方').toContain('未注册')

    // 关键一步：全程没有点任何"刷新"，界面应当被主进程的推送推着变，且两边数一致
    await expect
      .poll(async () => {
        const t = await truth()
        return t.consecutiveFailures > baseline && (await shownFailures()) === t.consecutiveFailures
      }, {
        message: '状态机上报了失败，但界面没跟着变（或界面与主进程读数不一致）',
        timeout: 15_000,
      })
      .toBe(true)
    await expect(card, '失败原因没上屏').toContainText('未注册')

    // 重置真的动到主进程那台机器：界面清零的同时 mcpGetState 也必须回到 connected / 0
    await page.click('[data-dom-id="mcp-gateway-reset"]')
    await expect
      .poll(async () => {
        const t = await truth()
        return t.state === 'connected' && t.consecutiveFailures === 0 && (await shownFailures()) === 0
      }, {
        message: '按了重置：界面与主进程没有一起归零',
        timeout: 15_000,
      })
      .toBe(true)
  } finally {
    await app.close()
  }
})
