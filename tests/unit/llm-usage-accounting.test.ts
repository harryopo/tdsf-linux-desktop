/**
 * 自研 LLM 客户端也要计入 token 用量（2026-10-15 全维度审查 D3）
 *
 * 现场：翻译、日志分析、PAOR 解读这些功能走 services/llm/client.ts，
 * 而这个客户端一次都不 recordTokenUsage——用量面板上看不见它们花的钱。
 * 更糟的是它自己带重试（最多 4 趟请求），面板若只记成功那趟，
 * 报出来的数可以只有真实账单的四分之一。
 *
 * 判据口径：
 * - 提供方回了 usage 就照它记，没回就按同一把尺估算，并标 estimated
 * - 重试次数如实进 attempts，让"这是一条重试过 3 次的调用"跟着数据走
 * - 没配 Key / 调用失败时一条都不记（记了就是造出来的数）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/tdsf-llm-usage', isReady: () => true },
}))

vi.mock('electron-store', () => {
  const store = new Map<string, unknown>()
  return {
    default: class {
      get(key: string, fallback?: unknown) {
        return store.has(key) ? store.get(key) : fallback
      }
      set(key: string, value: unknown) {
        store.set(key, value)
      }
    },
  }
})

const alerts = vi.hoisted(() => ({ slow: vi.fn(), failure: vi.fn(), success: vi.fn() }))
vi.mock('../../src/main/services/llm/budget-alerter', () => ({
  alertLlmSlowResponse: alerts.slow,
  alertLlmFailure: alerts.failure,
  alertLlmSuccess: alerts.success,
}))

import { LlmClient } from '../../src/main/services/llm/client'
import { getTokenRecords, resetTokenStats } from '../../src/main/core/agent/providers/token-stats'
import type { LlmConfig, ChatMessage } from '../../src/shared/models'

const CONFIG: LlmConfig = {
  baseUrl: 'https://example.invalid/v1',
  // 假 Key：相邻字面量拼出来，任何凭据扫描器都不该在仓库里看到完整形状
  apiKey: 'sk-' + 'test000000000000',
  model: 'test-model',
  temperature: 0.2,
  maxTokens: 512,
  timeout: 5_000,
}

const MESSAGES: ChatMessage[] = [{ role: 'user', content: '帮我看下磁盘还剩多少' }]

type CreateFn = (params: unknown, opts?: unknown) => Promise<unknown>

/** 装一个假的 openai client：只实现 chat.completions.create */
function makeClient(create: CreateFn): LlmClient {
  const c = new LlmClient(CONFIG)
  Object.assign(c as unknown as Record<string, unknown>, {
    client: { chat: { completions: { create } } },
  })
  return c
}

function chatResponse(text: string, usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) {
  return { choices: [{ message: { content: text } }], usage }
}

beforeEach(() => {
  resetTokenStats()
  vi.clearAllMocks()
})

describe('chat()：提供方给了 usage 就照它记', () => {
  it('成功一次 → 记一条，attempts=1，不算估算', async () => {
    const client = makeClient(async () => chatResponse('还有 40% 空闲', { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }))
    await client.chat(MESSAGES)
    const records = getTokenRecords(10)
    expect(records).toHaveLength(1)
    expect(records[0].inputTokens).toBe(120)
    expect(records[0].outputTokens).toBe(30)
    expect(records[0].totalTokens).toBe(150)
    expect(records[0].attempts).toBe(1)
    expect(records[0].estimated).toBe(false)
    expect(records[0].subagent).toBe('llm-client:chat')
    expect(records[0].model).toBe('test-model')
  })

  it('提供方没回 usage → 按同一把尺估算并标 estimated', async () => {
    const client = makeClient(async () => chatResponse('好的'))
    await client.chat(MESSAGES)
    const r = getTokenRecords(10)[0]
    expect(r.estimated).toBe(true)
    // 估算不能是 0：0 会被读成"这次没花钱"，而那恰恰是错的
    expect(r.inputTokens).toBeGreaterThan(0)
    expect(r.outputTokens).toBeGreaterThan(0)
  })

  it('没配 Key 直接抛错时一条都不记（没发生请求，记了就是造数）', async () => {
    const client = new LlmClient({ ...CONFIG, apiKey: '' })
    Object.assign(client as unknown as Record<string, unknown>, { client: undefined })
    await expect(client.chat(MESSAGES)).rejects.toThrow()
    expect(getTokenRecords(10)).toHaveLength(0)
  })
})

describe('chatStream()：重试过的请求要如实记次数', () => {
  it('流式不回 usage → 记估算，attempts 反映真实发出的趟数', async () => {
    let calls = 0
    const client = makeClient(async () => {
      calls++
      if (calls === 1) throw new Error('fetch failed')
      return (async function* () {
        yield { choices: [{ delta: { content: '第一段' } }] }
        yield { choices: [{ delta: { content: '第二段' } }] }
      })()
    })
    const out = await client.chatStream(MESSAGES, () => {})
    expect(out).toBe('第一段第二段')
    expect(calls).toBe(2)
    const records = getTokenRecords(10)
    expect(records).toHaveLength(1)
    expect(records[0].attempts).toBe(2)
    expect(records[0].estimated).toBe(true)
  })

  it('一次就成功时 attempts 是 1，不是 0 也不是 undefined', async () => {
    const client = makeClient(async () =>
      (async function* () {
        yield { choices: [{ delta: { content: 'x' } }] }
      })()
    )
    await client.chatStream(MESSAGES, () => {})
    expect(getTokenRecords(10)[0].attempts).toBe(1)
  })
})

describe('面板不许把估算和重试演成精确值', () => {
  it('ModelSettings 读取 estimated/attempts 两个字段（只写不读等于没修）', () => {
    const src = readFileSync('src/renderer/src/pages/ModelSettings.tsx', 'utf8')
    expect(src).toContain('r.estimated')
    expect(src).toContain('r.attempts')
  })
})
