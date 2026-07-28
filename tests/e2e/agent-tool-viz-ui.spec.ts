/**
 * agent-tool-viz-ui.spec.ts — UI 驱动的真机工具卡片可视化验证（连真机 + 真实 LLM）
 *
 * 与 agent-tool-viz-verification.spec.ts 的区别：那条走 IPC 直调 agentChat（不建 UI 占位消息，
 * 故卡片不渲染）；本条**走真实 UI 输入框发送**（经 useAgentChat 创建流式占位消息），
 * 让 agent:tool-event 挂到该消息 → LiveMessageRow 真实渲染「只读诊断命令」执行卡片 → 截图留证。
 *
 * 前提：SSH 凭据（.ssh-credentials.local.json）+ AI 凭据（.ai-credentials.local.json）。
 * 省用：只发 1 条消息，只调用 1 次 API。
 *
 * 运行：pnpm build && npx playwright test tests/e2e/agent-tool-viz-ui.spec.ts
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

testOrSkip('UI 发送诊断消息 → 真实 ssh_readonly 调用 → 执行卡片在对话里渲染', async () => {
  test.setTimeout(180_000)
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
  })
  const window: Page = await app.firstWindow()
  await window.waitForSelector('body', { timeout: 30000 })

  // 1. 配置 Provider + 连 SSH + 写 server-store（复刻真实用户"连接成功"后的完整状态）
  const sessionId = await window.evaluate(
    async ({ ai, ssh }) => {
      const api = (window as unknown as {
        electronAPI: {
          providerSave: (c: unknown) => Promise<boolean>
          providerSetDefault: (id: string) => Promise<boolean>
          providerList: () => Promise<unknown[]>
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
      let sid: string | null = null
      try {
        sid = await api.sshConnect({
          id: 'e2e-ui-server',
          name: 'E2E-UI',
          host: ssh.host,
          port: ssh.port,
          username: ssh.username,
          authType: 'password',
          password: ssh.password,
        })
      } finally {
        offPrompt()
      }

      // 写 store：① server-store 连接态/会话映射/活跃会话（send 据此传 sshSessionId、挂 ssh_readonly）；
      //          ② agent-store 刷新 provider 列表（避免发送前 hasApiKey 陈旧被拦截）。
      const stores = (window as unknown as {
        __tdsfStores?: {
          server: { getState: () => {
            setConnectionState: (id: string, s: string) => void
            setSessionMapping: (id: string, sid: string) => void
            setActiveSession: (sid: string) => void
          } }
          agent: { getState: () => { setProviders: (list: unknown[]) => void } }
        }
      }).__tdsfStores
      if (stores && sid) {
        const st = stores.server.getState()
        st.setConnectionState('e2e-ui-server', 'connected')
        st.setSessionMapping('e2e-ui-server', sid)
        st.setActiveSession(sid)
        try {
          const list = await api.providerList()
          stores.agent.getState().setProviders(list)
        } catch {
          // provider 列表刷新失败不阻断（send 未选 provider 时走默认）
        }
      }
      return sid
    },
    { ai: AI, ssh: SSH },
  )
  expect(sessionId, 'SSH 应连接成功').toBeTruthy()

  // 2. 进工作台，打开 AI 面板
  await window.evaluate(() => {
    window.location.hash = '#/workbench'
  })
  await window.waitForSelector('.wb-main-layout', { timeout: 15000 })
  const composer = window.locator('.ai-composer-textarea')
  if (!(await composer.isVisible().catch(() => false))) {
    await window.locator('[data-dom-id="btn-toggle-ai"]').click()
    await composer.waitFor({ state: 'visible', timeout: 5000 })
  }

  // 3. 真实 UI 输入框发送（走 useAgentChat → 创建流式占位消息 → agent:chat）
  await composer.fill('请用 df -h 命令查看当前服务器的磁盘使用情况，并简要说明。')
  await composer.press('Enter')

  // 发送后应立即出现用户消息（确认 send 真的触发，未被 Provider 守卫拦截）
  await expect(window.locator('.ai-msg-user').first(), '用户消息应上屏（send 已触发）').toBeVisible({
    timeout: 5000,
  })

  // 4. 等真实工具执行卡片出现（真 LLM + SSH 往返，给足时间）
  const card = window.locator('.ai-tool-exec', { hasText: '只读诊断命令' }).first()
  await expect(card, '真实对话里应渲染 ssh_readonly 执行卡片').toBeVisible({ timeout: 120_000 })
  await expect(card).toContainText('df')

  // 5. 截图留证（工具卡片真实出现在对话流中）
  await window.screenshot({ path: path.join(SHOT_DIR, 'tool-card-in-conversation.png'), fullPage: true })

  await app.close()
})
