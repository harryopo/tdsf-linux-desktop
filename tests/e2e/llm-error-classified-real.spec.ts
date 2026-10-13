/**
 * 真应用里把 provider 的错误分类跑一遍（#101 判据的真机那一半）
 *
 * 单测证明了 classifyLlmError 的表，但没证明这条链在路上不掉：
 *   OpenAI SDK 抛出的错误形状 → llm:test 的 catch → toLlmError → IPC → 渲染层拿到的字符串。
 * 中间任何一段把错误对象换成 new Error(String(err)) 之类，结构化信号就没了，
 * 而单测里喂的是我自己造的假对象，看不出这种掉法。
 *
 * 所以起一个假 provider（本机 127.0.0.1 上的临时 http 服务），让它按真厂商的样子回答，
 * 然后从渲染层调 llmTest，看拿回来的码与文案。全程不出本机、不碰任何真口令。
 *
 * 主案值仍然是那条 9404：真实 OpenAI 兼容端点的超限消息里带着 "404" 三个字符，
 * 老写法会把它报成"模型不存在"。这条现在要在真链路上判对。
 */
import { test, expect, _electron as electron } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { e2eProfileDir } from './ssh-fixture-helpers'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')

/** 假口令：相邻字面量拼出来，仓库里任何扫描器都不该看到完整形状 */
const FAKE_KEY = 'sk-' + 'aB3dEf6gHi7jKl8mNo9pQr0s'

interface Case {
  /** 假 provider 的应答 */
  respond: { status: number; body: unknown }
  /** 期望的分类码 */
  code: string
  /** 期望文案开头（说人话的那半句） */
  startsWith: string
}

const CASES: Case[] = [
  {
    respond: {
      status: 400,
      body: {
        error: {
          message:
            "This model's maximum context length is 8192 tokens, however you requested 9404 tokens",
          type: 'invalid_request_error',
          code: 'context_length_exceeded',
        },
      },
    },
    code: 'CONTEXT_OVERFLOW',
    startsWith: '上下文超出模型窗口',
  },
  {
    respond: {
      status: 401,
      body: { error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } },
    },
    code: 'AUTH',
    startsWith: 'API Key 无效或已过期',
  },
  {
    respond: {
      status: 429,
      body: { error: { message: 'Too Many Requests', type: 'rate_limit_error', code: 'rate_limit_exceeded' } },
    },
    code: 'RATE_LIMIT',
    startsWith: '请求过于频繁',
  },
]

/** 起一个只监听 127.0.0.1 的假 provider，按队列顺序回答 */
function startFakeProvider(cases: Case[]): Promise<{ url: string; close: () => void; hits: () => number }> {
  let i = 0
  const server = http.createServer((req, res) => {
    const c = cases[Math.min(i, cases.length - 1)]
    i += 1
    const json = JSON.stringify(c.respond.body)
    res.writeHead(c.respond.status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(json) })
    res.end(json)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        close: () => server.close(),
        hits: () => i,
      })
    })
  })
}

test('真应用：provider 报错必须被分类成人话，且原始消息里的超限不被误判成模型不存在', async () => {
  const profile = e2eProfileDir()
  fs.rmSync(profile, { recursive: true, force: true })
  fs.mkdirSync(profile, { recursive: true })

  const fake = await startFakeProvider(CASES)
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${profile}`],
    env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
  })

  try {
    const page = await app.firstWindow()
    await page.waitForSelector('body', { timeout: 30000 })

    const results = await page.evaluate(
      async ({ baseUrl, apiKey }) => {
        const out: Array<{ ok: boolean; code?: string; error?: string }> = []
        for (let i = 0; i < 3; i++) {
          out.push(
            await window.electronAPI.llmTest({
              baseUrl,
              apiKey,
              model: 'tdsf-fake-model',
              temperature: 0,
              maxTokens: 8,
              timeout: 8000,
            })
          )
        }
        return out
      },
      { baseUrl: fake.url, apiKey: FAKE_KEY }
    )

    // 正向对照：假 provider 确实被打了三次（没打到就是整条判据空转）
    expect(fake.hits()).toBe(3)
    expect(results).toHaveLength(3)

    CASES.forEach((c, idx) => {
      const r = results[idx]
      expect(r.ok, `第 ${idx + 1} 次居然报成功，假 provider 的应答没生效`).toBe(false)
      expect(r.code, `第 ${idx + 1} 次分类码不对：${r.error}`).toBe(c.code)
      expect(r.error ?? '').toContain(c.startsWith)
      // 凭据不进渲染层，原始错误也不该是堆栈
      expect(r.error).not.toContain(FAKE_KEY)
      expect(r.error).not.toMatch(/\n\s+at\s+/)
    })

    // 反向对照：端口没人听时必须归 NETWORK（不是 UNKNOWN，也不是被 401 那类抢走）
    const dead = await page.evaluate(() =>
      window.electronAPI.llmTest({
        baseUrl: 'http://127.0.0.1:9/v1',
        apiKey: 'sk-' + 'deadport0000000000000',
        model: 'tdsf-fake-model',
        temperature: 0,
        maxTokens: 8,
        timeout: 4000,
      })
    )
    expect(dead.ok).toBe(false)
    expect(dead.code).toBe('NETWORK')
    expect(dead.error ?? '').toContain('网络连接异常')
  } finally {
    await app.close()
    fake.close()
  }
})
