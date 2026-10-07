/**
 * terminal-context-to-ai.spec.ts —— 终端命令块真的进了模型请求体
 *
 * 阶段 F 判据里"块收集器供 AI 上下文消费"那半截的端到端证明。
 * 只看单元测试不算数：这条走的是真链路 ——
 *   fixture SSH 靶机（真 ssh2 握手 + 真 OSC 133/633）→ xterm → 块模型 → toAiContext()
 *   → UI 输入框发送（useAgentChat，不是绕过去直调 IPC）→ preload → agent:chat
 *   → Supervisor 注入 system prompt → 假模型服务收到请求体。
 * 断言读的是【服务端收到的原文】，所以"我这边算好了但没发出去"这种缺陷瞒不过去。
 *
 * 第二条是对照：没连过终端（没有命令块）时，请求体里必须【没有】那段注入——
 * 证明这条注入是按需的，不是无条件往 prompt 里塞东西。
 *
 * 运行：pnpm build && npx playwright test tests/e2e/terminal-context-to-ai.spec.ts
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startSshFixture } from './ssh-fixture-server'
import type { FixtureHandle } from './ssh-fixture-server'
import { startAiFixture } from './ai-fixture-server'
import type { AiFixtureHandle } from './ai-fixture-server'
import { bindSessionToStore, connectToFixture, launchApp } from './ssh-fixture-helpers'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
if (!BUILD_READY) console.log('[terminal-context] 跳过：缺 out/main/index.js，先 pnpm build')
const testOrSkip = BUILD_READY ? test : test.skip

/** 本次运行专属 known_hosts，绝不碰用户真实的 ~/.ssh/known_hosts */
const KNOWN_HOSTS = path.join(os.tmpdir(), `tdsf-e2e-tc-known_hosts-${process.pid}.txt`)

/** system prompt 里那段注入的标识（改这个字串要同步改 terminal-context.ts） */
const MARKER = '终端最近命令'

/** 本 spec 用的假模型 Provider id */
const PROVIDER_ID = 'tc-fixture-model'

async function configureFixtureModel(page: Page, url: string): Promise<void> {
  // 与 demo S3 同一套：providerSave + providerSetDefault，走真实持久化路径。
  // 之后还要把列表灌回渲染层 store 并选中它——挂载时 useAgentChat 只会选中 list[0]，
  // 而这里是"运行中新增 Provider"，等价于用户在模型选择器里点一下（用的是同一个 store action）。
  const saved = await page.evaluate(async (cfg) => {
    const w = window as unknown as {
      electronAPI: {
        providerSave: (c: unknown) => Promise<boolean>
        providerSetDefault: (id: string) => Promise<boolean>
        providerList: (withMeta?: boolean) => Promise<Array<{ id: string; hasApiKey?: boolean }>>
      }
      __tdsfStores?: {
        agent?: {
          getState: () => {
            setProviders: (p: unknown[]) => void
            setSelectedProviderId: (id: string) => void
          }
        }
      }
    }
    const ok = await w.electronAPI.providerSave({
      id: cfg.providerId,
      name: '上下文验证模型',
      type: 'openai-compatible',
      baseURL: cfg.baseURL,
      model: cfg.providerId,
      apiKey: 'fixture-' + 'key',
      defaultParams: { temperature: 0, maxTokens: 64 },
      builtin: false,
      enabled: true,
      roles: ['chat'],
    })
    const setOk = await w.electronAPI.providerSetDefault(cfg.providerId)
    const list = await w.electronAPI.providerList(true)
    const mine = list.find((p) => p.id === cfg.providerId)
    if (w.__tdsfStores?.agent) {
      const store = w.__tdsfStores.agent.getState()
      store.setProviders(list)
      store.setSelectedProviderId(cfg.providerId)
    }
    return { ok, setOk, found: !!mine, hasApiKey: mine?.hasApiKey }
  }, { providerId: PROVIDER_ID, baseURL: url })
  expect(saved.ok, 'providerSave 应成功').toBe(true)
  expect(saved.setOk, 'providerSetDefault 应成功').toBe(true)
  expect(saved.found, '列表里应查得到这个 Provider').toBe(true)
  expect(saved.hasApiKey, '假 Key 应被认成已配置').toBe(true)
}

test.describe('终端命令块进 AI 请求体', () => {
  test.describe.configure({ mode: 'serial' })

  let ssh: FixtureHandle
  let ai: AiFixtureHandle

  test.beforeAll(async () => {
    ssh = await startSshFixture()
    ai = await startAiFixture()
    fs.writeFileSync(KNOWN_HOSTS, '', 'utf8')
  })

  test.afterAll(async () => {
    await ssh.close()
    await ai.close()
    if (fs.existsSync(KNOWN_HOSTS)) fs.unlinkSync(KNOWN_HOSTS)
  })

  /** 渲染进程抛的异常：请求没落到主进程时，答案八成在这里 */
  let pageErrors: string[] = []

  function trap(page: Page): void {
    pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') pageErrors.push(m.text())
    })
  }

  /** 在输入框发一句话，返回假模型服务收到的请求体原文 */
  async function sendAndGetBody(page: Page, text: string): Promise<string> {
    const composer = page.locator('#ai-composer-input')
    if (!(await composer.isVisible().catch(() => false))) {
      await page.locator('[data-dom-id="btn-toggle-ai"]').click()
      await composer.waitFor({ state: 'visible', timeout: 5000 })
    }
    // 基线必须在【按发送之前】取：按完再读，请求可能已经落地，
    // 于是"数没涨"是量具读晚了，不是产品没发（第一版就栽在这里）。
    const before = ai.requestCount()
    // 逐键输入而不是 fill()：受控 textarea 要看到真实 keydown/input 才会更新 React state，
    // fill() 只改 DOM 值，state 仍是空的，于是"按了发送但什么都没发生"。
    await composer.click()
    await composer.pressSequentially(text)
    await page.getByRole('button', { name: '发送' }).click()
    await expect
      .poll(
        async () => {
          const count = ai.requestCount()
          if (count > before) return `已收到 ${count - before} 次请求`
          const state = [
            `输入框剩=${JSON.stringify(await composer.inputValue().catch(() => '已消失'))}`,
            `提示=${JSON.stringify(
              await page.locator('[data-sonner-toast]').first().innerText().catch(() => '无')
            )}`,
            `选中模型=${JSON.stringify(
              await page.evaluate(() => {
                const st = (
                  window as unknown as { __tdsfStores?: { agent?: { getState: () => object } } }
                ).__tdsfStores?.agent?.getState() as { selectedProviderId?: string } | undefined
                return st?.selectedProviderId
              })
            )}`,
            `主进程 agent 日志=${JSON.stringify(
              await page.evaluate(async () => {
                const api = (
                  window as unknown as { electronAPI: { logRead?: (o: object) => Promise<unknown> } }
                ).electronAPI
                return api.logRead ? await api.logRead({ categoryPrefix: 'IPC.AGENT', limit: 10 }) : '无 logRead'
              })
            ).slice(0, 900)}`,
            `页面异常=${JSON.stringify(pageErrors.slice(-3))}`,
            `对话状态=${JSON.stringify(
              await page.evaluate(() => {
                const st = (
                  window as unknown as { __tdsfStores?: { agent?: { getState: () => object } } }
                ).__tdsfStores?.agent?.getState() as {
                  isStreaming?: boolean
                  lastError?: string | null
                  messages?: unknown[]
                  currentCorrelationId?: string | null
                }
                return {
                  streaming: st?.isStreaming,
                  lastError: st?.lastError,
                  msgs: st?.messages?.length,
                  cid: st?.currentCorrelationId,
                  providers: (st as { providers?: unknown[] } | undefined)?.providers?.length,
                }
              })
            )}`,
          ].join(' | ')
          return `未收到（假模型累计请求数仍=${count}）${state}`
        },
        {
          message: '假模型服务应收到这次请求（括号里是当场取的界面状态，红了不用猜谁的锅）',
          timeout: 60_000,
        }
      )
      .toContain('已收到')
    return ai.lastBody()
  }

  testOrSkip('连过终端后，请求体里带着刚才跑过的命令', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launchApp()
    trap(page)

    // 主机密钥弹窗按【真实路径】点掉：从旁边替它应答会把弹窗留在屏幕上，
    // 遮罩挡住后面每一次点击（第一版就是这么卡住的）。连接请求要等用户点完才 resolve。
    const connPromise = connectToFixture(page, {
      port: ssh.port,
      id: 'tc-shell',
      knownHostsPath: KNOWN_HOSTS,
    })
    await page.waitForSelector('[role="dialog"]', { timeout: 20000 })
    await page.getByRole('button', { name: '保存并继续' }).click()
    const conn = await connPromise
    const sessionId = conn.sessionId as string
    expect(sessionId, `连接失败：${conn.error ?? ''}`).toBeTruthy()

    await bindSessionToStore(page, 'tc-shell', sessionId)
    await page.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await page.waitForSelector('.wb-main-layout', { timeout: 15000 })

    // 开交互式 shell：靶机一开场就吐一条完整命令块（echo tdsf-boot）
    const started = await page.evaluate(
      (sid) =>
        (window as unknown as { electronAPI: { sshShellStart: (s: string) => Promise<boolean> } })
          .electronAPI.sshShellStart(sid),
      sessionId,
    )
    expect(started, 'sshShellStart 应成功').toBe(true)
    await expect
      .poll(() => page.locator('.wb-statusbar').innerText(), {
        message: '状态栏应先出现至少 1 个命令块',
        timeout: 20000,
      })
      .toMatch(/[1-9]\d* 命令块/)

    await configureFixtureModel(page, ai.baseURL)

    const body = await sendAndGetBody(page, '刚才那条命令跑得怎么样？')
    // 打印模型实际收到的那段（截 240 字），红了也好比对是"没送到"还是"送到了但内容不对"
    const at = body.indexOf(MARKER)
    console.log('[terminal-context] 模型收到的注入片段 =', JSON.stringify(body.slice(at, at + 240)))
    expect(body, '请求体应含注入标识').toContain(MARKER)
    expect(body, '请求体应含靶机开场那条命令').toContain('tdsf-boot')
    // 只给命令与退出码，不给输出正文
    expect(body).toContain('输出正文未附')

    await app.close()
  })

  testOrSkip('没跑过命令时不注入（对照，防无条件塞 prompt）', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launchApp()
    trap(page)
    await page.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await page.waitForSelector('.wb-main-layout', { timeout: 15000 })

    await configureFixtureModel(page, ai.baseURL)

    const body = await sendAndGetBody(page, '这台机器上刚才执行了什么？')
    expect(body, '没有命令块时不该出现注入标识').not.toContain(MARKER)
    expect(body).toContain('这台机器上刚才执行了什么')

    await app.close()
  })
})
