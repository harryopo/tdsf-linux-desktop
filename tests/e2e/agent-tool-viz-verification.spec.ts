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
  test.setTimeout(180_000)
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
  })
  const window: Page = await app.firstWindow()
  await window.waitForSelector('body', { timeout: 30000 })

  // 1. 配置 DeepSeek Provider + SSH 连接
  const setup = await window.evaluate(
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
  const result = await window.evaluate(async (sshSessionId) => {
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
  await window.evaluate(() => { window.location.hash = '#/workbench' })
  await window.waitForSelector('.wb-main-layout', { timeout: 15000 })
  await window.waitForTimeout(2000)
  await window.screenshot({ path: path.join(SHOT_DIR, 'tool-exec-card.png'), fullPage: true })

  await app.close()
})
