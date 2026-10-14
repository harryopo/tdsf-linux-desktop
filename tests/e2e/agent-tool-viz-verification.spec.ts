/**
 * agent-tool-viz-verification.spec.ts — Agent 真实工具执行可视化验证（连真机 + 真实 LLM）
 *
 * 目的：验证 Phase 1 —— 主对话 Agent 真实调用 ssh_readonly 工具时，
 * agent:tool-event 事件真实回流到前端，可用于渲染工具执行卡片。
 *
 * 前提：同时需要 SSH 凭据（.ssh-credentials.local.json）+ AI 凭据（.ai-credentials.local.json）。
 * 省用：只发 1 条明确要求执行只读命令的消息，maxTokens 适中。
 *
 * 运行：pnpm build && npx playwright test tests/e2e/agent-tool-viz-verification.spec.ts
 */
import { test, expect, _electron as electron } from '@playwright/test'
import type { Page } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'
import { e2eProfileDir, tcpReachable } from './ssh-fixture-helpers'
import { probeKey } from './provider-probe'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')
const BUILD_READY = fs.existsSync(MAIN_ENTRY)

function loadJson<T>(file: string): T | null {
  const p = path.join(__dirname, file)
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as T
  } catch {
    return null
  }
}

const SSH = loadJson<{ host: string; port: number; username: string; password: string }>(
  '.ssh-credentials.local.json',
)
const AI = loadJson<{ providerId: string; model: string; baseURL: string; apiKey: string }>(
  '.ai-credentials.local.json',
)
const canRun = BUILD_READY && !!SSH?.password && !!AI?.apiKey
const testOrSkip = canRun ? test : test.skip

const SHOT_DIR = path.join(__dirname, 'screenshots-tool-viz')
fs.mkdirSync(SHOT_DIR, { recursive: true })

testOrSkip('Agent 真实调用 ssh_readonly → agent:tool-event 回流 + 可视化', async () => {
  // 进得来这条用例说明 canRun 已过，但 TS 不知道；显式收窄一次，
  // 传进 evaluate 的 ai/ssh 就不再是 | null——缺哪份文件当场报错，不会带着 undefined 去连靶机。
  if (!SSH || !AI) throw new Error('凭据缺失：.ssh-credentials.local.json / .ai-credentials.local.json')
  const up = await tcpReachable(SSH.host, SSH.port)
  test.skip(!up, `靶机 ${SSH.host}:${SSH.port} TCP 连不上（机器没开或不在同一网），这条要有真机才能跑`)
  // 文件里有 apiKey ≠ 这把 key 能用。先探一次，401/不通就带原因跳过，
  // 别把"环境缺东西"演成"产品流式层坏了"（2026-10-09 实测：这把 key 被 DeepSeek 拒 401，本条却开跑并红了）
  const probe = await probeKey(AI)
  test.skip(!probe.ok, `缺一条能用的模型 Key：${probe.detail}`)
  test.setTimeout(180_000)
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${e2eProfileDir()}`],
    env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
  })
  const mainWin: Page = await app.firstWindow()
  await mainWin.waitForSelector('body', { timeout: 30000 })

  // 1. 配置 DeepSeek Provider + SSH 连接
  const setup = await mainWin.evaluate(
    async ({ ai, ssh }) => {
      const api = (window as unknown as {
        electronAPI: {
          providerSave: (c: unknown) => Promise<boolean>
          providerSetDefault: (id: string) => Promise<boolean>
          sshConnect: (config: unknown) => Promise<string>
          sshRespondHostKey: (requestId: string, action: string) => Promise<boolean>
          onSshHostKeyPrompt: (cb: (p: { requestId: string }) => void) => () => void
        }
      }).electronAPI
      await api.providerSave({
        id: ai.providerId,
        name: 'DeepSeek V4 Flash',
        type: 'deepseek',
        baseURL: ai.baseURL,
        model: ai.model,
        apiKey: ai.apiKey,
        defaultParams: { temperature: 0, maxTokens: 800 },
        builtin: true,
        enabled: true,
        roles: ['chat'],
      })
      await api.providerSetDefault(ai.providerId)

      const offPrompt = api.onSshHostKeyPrompt((p) => {
        void api.sshRespondHostKey(p.requestId, 'accept-and-save')
      })
      let sshSessionId: string | null = null
      try {
        sshSessionId = await api.sshConnect({
          id: 'e2e-tool-viz',
          name: 'E2E工具可视化',
          host: ssh.host,
          port: ssh.port,
          username: ssh.username,
          authType: 'password',
          password: ssh.password,
        })
      } finally {
        offPrompt()
      }
      return { sshSessionId }
    },
    { ai: AI, ssh: SSH },
  )
  expect(setup.sshSessionId, 'SSH 应连接成功').toBeTruthy()

  // 2. 发一条明确要求执行只读诊断命令的消息，收集 agent:tool-event
  const result = await mainWin.evaluate(async (sshSessionId) => {
    const api = (window as unknown as {
      electronAPI: {
        agentChat: (msgs: unknown[], providerId?: string, strength?: string, sshSessionId?: string) => Promise<string>
        onAgentToolEvent: (cb: (p: { phase: string; toolName: string; input?: string; ok?: boolean; output?: string }) => void) => () => void
        onAgentDone: (cb: (p: unknown) => void) => () => void
        onAgentError: (cb: (p: { message?: string }) => void) => () => void
      }
    }).electronAPI

    const toolEvents: Array<{ phase: string; toolName: string; input?: string; ok?: boolean; output?: string }> = []
    let done = false
    let errorMsg = ''
    const finished = new Promise<void>((resolve) => {
      const offs: Array<() => void> = []
      const fin = () => { offs.forEach((o) => o()); resolve() }
      offs.push(api.onAgentToolEvent((p) => toolEvents.push(p)))
      offs.push(api.onAgentDone(() => { done = true; fin() }))
      offs.push(api.onAgentError((p) => { errorMsg = p.message || 'error'; fin() }))
      setTimeout(fin, 120_000)
    })

    // 明确指令：要求用 df -h 查看磁盘（引导 Agent 调用 ssh_readonly 工具）
    // 注意：preload agentChat 签名为 (messages, providerId, strength, sshSessionId)，
    // sshSessionId 是【第 4 参】（第 4 参内部自动作为 agentSession，不需传）。
    await api.agentChat(
      [{ role: 'user', content: '请用 df -h 命令查看当前服务器的磁盘使用情况，并简要说明。' }],
      undefined,
      undefined,
      sshSessionId as string,
    )
    await finished
    return { toolEvents, done, errorMsg }
  }, setup.sshSessionId)

  console.log('[工具可视化] done =', result.done, ' error =', result.errorMsg)
  console.log('[工具可视化] 工具事件数 =', result.toolEvents.length)
  console.log('[工具可视化] 事件明细 =', JSON.stringify(result.toolEvents, null, 2).slice(0, 1500))

  expect(result.errorMsg, `不应出错: ${result.errorMsg}`).toBe('')
  // 核心断言：Agent 真实调用了工具，且 call + result 都回流
  expect(result.toolEvents.length, 'agent:tool-event 应有事件回流').toBeGreaterThan(0)
  const hasCall = result.toolEvents.some((e) => e.phase === 'call')
  const hasResult = result.toolEvents.some((e) => e.phase === 'result')
  expect(hasCall, '应收到工具 call 事件').toBe(true)
  expect(hasResult, '应收到工具 result 事件').toBe(true)
  // 工具名应为 ssh_readonly，input 应含 df
  const callEvt = result.toolEvents.find((e) => e.phase === 'call')
  expect(callEvt?.toolName, '工具名应为 ssh_readonly').toBe('ssh_readonly')

  // 3. 截图工作台，留证工具执行卡片
  await mainWin.evaluate(() => { window.location.hash = '#/workbench' })
  await mainWin.waitForSelector('.wb-main-layout', { timeout: 15000 })
  await mainWin.waitForTimeout(2000)
  await mainWin.screenshot({ path: path.join(SHOT_DIR, 'tool-exec-card.png'), fullPage: true })

  await app.close()
})
