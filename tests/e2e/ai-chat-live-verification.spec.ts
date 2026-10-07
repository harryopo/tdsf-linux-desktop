/**
 * ai-chat-live-verification.spec.ts — AI 对话真实流式验证（连真实 DeepSeek API）
 *
 * 目的：验证「配置 Provider → 发送消息 → agent:chat → 真实 LLM → 流式 chunk 回流 →
 * 消息上屏」全链路真通，证明 AI 对话不是假 UI。
 *
 * 省用策略（真实计费，务必节省）：
 * - 只发 1 条极短消息（"1+1=?"）
 * - maxTokens 512（DeepSeek-V4-Flash 默认思考模式会先输出 reasoning，
 *   太小会导致思考吃光额度、正文空输出 "No output generated"）
 * - 整个 spec 只 1 个 test，只调用 1 次 API
 *
 * 凭据来源：tests/e2e/.ai-credentials.local.json（gitignore 忽略，不提交）
 *   格式：{ "providerId": "deepseek-v4", "model": "deepseek-v4-flash",
 *          "baseURL": "https://api.deepseek.com", "apiKey": "sk-xxx" }
 *
 * 运行：pnpm build && npx playwright test tests/e2e/ai-chat-live-verification.spec.ts
 */
import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')
const BUILD_READY = fs.existsSync(MAIN_ENTRY)

/** 读取 AI 凭据（不写死进代码） */
function loadAiCred(): { providerId: string; model: string; baseURL: string; apiKey: string } | null {
  const f = path.join(__dirname, '.ai-credentials.local.json')
  if (!fs.existsSync(f)) return null
  try {
    return JSON.parse(fs.readFileSync(f, 'utf-8'))
  } catch {
    return null
  }
}

const CRED = loadAiCred()
const canRun = BUILD_READY && !!CRED?.apiKey
const testOrSkip = canRun ? test : test.skip

const SHOT_DIR = path.join(__dirname, 'screenshots-ai')
fs.mkdirSync(SHOT_DIR, { recursive: true })

/**
 * 用 1 个 token 探一次服务端认不认这把 Key。
 * 只回状态与错误类别，不把 Key 或响应原文带进测试报告。
 */
async function probeKey(cred: {
  baseURL: string
  model: string
  apiKey: string
}): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${cred.baseURL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cred.apiKey}`,
      },
      body: JSON.stringify({
        model: cred.model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (res.ok) return { ok: true, detail: `HTTP ${res.status}` }
    let kind = ''
    try {
      const j = (await res.json()) as { error?: { code?: string; type?: string } }
      kind = j.error?.code || j.error?.type || ''
    } catch {
      // 响应不是 JSON 就没有类别可报，状态码本身够用
    }
    return { ok: false, detail: `HTTP ${res.status}${kind ? ` ${kind}` : ''}，模型名 ${cred.model}` }
  } catch (err) {
    return {
      ok: false,
      detail: `请求都没发出去（${err instanceof Error ? err.name : 'unknown'}），多半是不通网或地址不对`,
    }
  }
}

testOrSkip('AI 对话真实流式：发送极短消息，真实回复必须流式上屏', async () => {
  // 先探一把 Key 到底通不通：文件里有 apiKey 不等于这把 Key 有效。
  // 服务端拒了（401/403）或网络不通，那是环境缺东西，不该演成"产品流式层坏了"；
  // 200 才继续跑真正的断言。（与 ssh-live 那边的 TCP 可达性探针同一思路）
  const probe = await probeKey(CRED!)
  test.skip(!probe.ok, `缺一条能用的模型 Key：${probe.detail}`)

  test.setTimeout(120_000)
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${e2eProfileDir()}`],
    env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
  })
  const window = await app.firstWindow()
  await window.waitForSelector('body', { timeout: 30000 })

  // 1. 把真实 Key 存进内置 deepseek-v4 Provider 并设为默认（走真实 IPC）
  const saved = await window.evaluate(async (cred) => {
    const api = (window as unknown as {
      electronAPI: {
        providerSave: (c: unknown) => Promise<boolean>
        providerSetDefault: (id: string) => Promise<boolean>
      }
    }).electronAPI
    const ok = await api.providerSave({
      id: cred.providerId,
      name: 'DeepSeek V4 Flash',
      type: 'deepseek',
      baseURL: cred.baseURL,
      model: cred.model,
      apiKey: cred.apiKey,
      defaultParams: { temperature: 0, maxTokens: 512 }, // DeepSeek-V4-Flash 思考模式需足够额度容纳 reasoning+正文
      builtin: true,
      enabled: true,
      roles: ['chat'],
    })
    const setOk = await api.providerSetDefault(cred.providerId)
    return { ok, setOk }
  }, CRED)

  expect(saved.ok, 'providerSave 应成功').toBe(true)
  expect(saved.setOk, 'providerSetDefault 应成功').toBe(true)

  // 2. 发送 1 条极短消息，收集流式 chunk（只调 1 次 API）
  const result = await window.evaluate(async () => {
    const api = (window as unknown as {
      electronAPI: {
        agentChat: (msgs: unknown[], providerId?: string) => Promise<string>
        onAgentChunk: (cb: (p: { delta?: string }) => void) => () => void
        onAgentDone: (cb: (p: unknown) => void) => () => void
        onAgentError: (cb: (p: { message?: string }) => void) => () => void
      }
    }).electronAPI

    let streamedText = ''
    let doneReceived = false
    let errorMsg = ''

    const finished = new Promise<void>((resolve) => {
      const offs: Array<() => void> = []
      const finish = () => {
        offs.forEach((o) => o())
        resolve()
      }
      offs.push(api.onAgentChunk((p) => {
        if (p.delta) streamedText += p.delta
      }))
      offs.push(api.onAgentDone(() => {
        doneReceived = true
        finish()
      }))
      offs.push(api.onAgentError((p) => {
        errorMsg = p.message || 'unknown error'
        finish()
      }))
      setTimeout(finish, 60_000) // 兜底超时
    })

    const correlationId = await api.agentChat(
      [{ role: 'user', content: '1+1=?' }],
    )
    await finished
    return { correlationId, streamedText, doneReceived, errorMsg }
  })

  console.log('[AI] correlationId =', result.correlationId)
  console.log('[AI] 流式文本 =', JSON.stringify(result.streamedText))
  console.log('[AI] done =', result.doneReceived, ' error =', result.errorMsg)

  // 断言：无错误 + 收到 done + 有真实流式文本
  expect(result.errorMsg, `AI 调用出错: ${result.errorMsg}`).toBe('')
  expect(result.doneReceived, '应收到 agent:done 完成信号').toBe(true)
  expect(result.streamedText.length, '应收到真实流式回复文本（非空）').toBeGreaterThan(0)
  // "1+1=?" 的真实回复必含 "2"
  expect(result.streamedText, '真实回复应包含答案 2').toContain('2')

  // 3. 进工作台看消息是否真实上屏，截图留证
  await window.evaluate(() => {
    window.location.hash = '#/workbench'
  })
  await window.waitForSelector('.wb-main-layout', { timeout: 15000 })
  await window.waitForTimeout(1500)
  await window.screenshot({ path: path.join(SHOT_DIR, 'ai-chat-live.png'), fullPage: true })

  await app.close()
})
