/**
 * tests/unit/ai-stream-stability.test.ts — AI 部分要稳：小窗口先压缩、断了不重发（#98）
 *
 * 钉三件真实故障，都是"用户觉得 AI 突然坏了"的来源：
 * 1. 压缩阈值只有一把 150K 的绝对尺子 → Ollama 这类 8K 窗口的模型永远轮不到压缩，
 *    请求被上游拒成 400。现在阈值按 Provider 的生效窗口再收一道（只更严不更松）。
 * 2. token 估算不分语种一律 len/3 → 中文低估近一倍，等于中文对话总是压晚了。
 * 3. 流式中断后 chatWithRetry 会整段重发 → 同一个气泡里"半句 + 完整重来一遍"。
 *    现在推过字就不再重试，报错里说明已输出多少字、不重发。
 *
 * 判据引擎：假 OpenAI client（chat.completions.create 返回可控异步迭代器），
 * 不联网、不需要真 Key。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/tdsf-ai-stability', isReady: () => true },
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

import {
  compactIfNeeded,
  estimateTokens,
  resolveCompactionThresholds,
} from '../../src/main/core/agent/context'
import { LlmClient } from '../../src/main/services/llm/client'
import type { ChatMessage } from '../../src/shared/models'

const messages = [{ role: 'user', content: '讲个故事' }] as ChatMessage[]

/** 造一条纯中文长文本（每条约 n 个汉字） */
function cjkMessages(count: number, charsPerMessage: number) {
  const body = '肯'.repeat(charsPerMessage)
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `${body} 第${i}轮`,
  })) as never
}

describe('压缩阈值跟着生效窗口走', () => {
  it('1. 未知窗口（0）维持旧的绝对阈值，不因为"不知道"就乱压缩', () => {
    const t = resolveCompactionThresholds(0)
    expect(t.critical).toBe(112_500)
    expect(t.dedup).toBe(135_000)
    expect(t.singleMessage).toBe(4_000)
    expect(t.windowTokens).toBe(0)
  })

  it('2. 8K 窗口（Ollama 默认）：四层触发线全部前移且严格递增', () => {
    const t = resolveCompactionThresholds(8_000)
    expect(t.critical).toBe(6_000)
    expect(t.dedup).toBe(7_200)
    expect(t.singleMessage).toBe(2_400)
    expect(t.sessionSoft).toBeLessThan(t.sessionHard)
    expect(t.sessionHard).toBeLessThan(t.critical)
    expect(t.critical).toBeLessThan(t.dedup)
  })

  it('3. 1M 窗口不会被放宽（比例只用来收紧，不用来放松）', () => {
    const t = resolveCompactionThresholds(1_000_000)
    expect(t.critical).toBe(112_500)
    expect(t.dedup).toBe(135_000)
  })

  it('4. 中文 token 估算不再低估：同长度中文比英文估得多', () => {
    const zh = '运维知识库'.repeat(200) // 1000 个汉字
    const en = 'ops knowledge base'.repeat(63) // ~1000 个 ASCII
    expect(estimateTokens(zh)).toBe(500)
    expect(estimateTokens(zh)).toBeGreaterThan(estimateTokens(en))
    expect(estimateTokens('')).toBe(0)
  })

  it('5. 6K tokens 的中文长对话：8K 窗口必须压缩，未知窗口维持原样', () => {
    // 40 条 × 每条约 150 汉字 ≈ 3.1K tokens：在旧 50K 阈值之下，但在 8K 窗口的软阈值之上
    const msgs = cjkMessages(40, 150)
    expect(estimateTokens(msgs[0].content as string) * msgs.length,
      '样本总量要跨过 8K 窗口的软阈值，否则第 5 条是空跑').toBeGreaterThan(2_720)

    const withWindow = compactIfNeeded(msgs as never, 8_000)
    expect(withWindow.level, '小窗口模型不该一路不压缩直到被上游 400').not.toBe('none')
    expect(withWindow.afterTokens).toBeLessThan(withWindow.beforeTokens)

    const legacy = compactIfNeeded(msgs as never)
    expect(legacy.level, '没报窗口时行为要等于改动前（不误伤大窗口用户）').toBe('none')
  })
})

describe('流式中断不再整段重发', () => {
  function clientWithFakeStream(createImpl: () => AsyncGenerator<{ choices: { delta: { content?: string } }[] }>) {
    const cfg = {
      apiKey: ['sk-', 'fake-for-tests-only'].join(''),
      baseUrl: 'https://example.invalid/v1',
      model: 'fake-model',
      temperature: 0.2,
      maxTokens: 100,
      timeout: 0,
    }
    const c = new LlmClient(cfg as never)
    // 顶掉真 SDK：只留 chat.completions.create
    ;(c as unknown as { client: unknown }).client = {
      chat: { completions: { create: vi.fn(async () => createImpl()) } },
    }
    return c
  }

  it('6. 推过一半再断：不重试，报错里说明已输出多少字且不重发', async () => {
    let calls = 0
    const client = clientWithFakeStream(async function* () {
      calls++
      yield { choices: [{ delta: { content: '第一段' } }] }
      if (calls === 1) throw new Error('fetch failed')
      yield { choices: [{ delta: { content: '不该再发' } }] }
    })

    const pushed: string[] = []
    await expect(client.chatStream(messages, (t) => pushed.push(t))).rejects.toThrow(/不重发/)
    expect(calls, '已经推过字，不该再打第二次请求').toBe(1)
    expect(pushed.join(''), '界面上只收到第一段，没有被重复').toBe('第一段')
  })

  it('7. 一个字都没推就失败：照常重试（网络抖一下不该直接报错）', async () => {
    let calls = 0
    const client = clientWithFakeStream(async function* () {
      calls++
      if (calls <= 2) throw new Error('fetch failed')
      yield { choices: [{ delta: { content: '终于成了' } }] }
    })

    const pushed: string[] = []
    const text = await client.chatStream(messages, (t) => pushed.push(t))
    expect(calls).toBe(3)
    expect(text).toBe('终于成了')
    expect(pushed.join('')).toBe('终于成了')
  })

  it('8. 正对照：一次顺利跑完只发一次请求', async () => {
    let calls = 0
    const client = clientWithFakeStream(async function* () {
      calls++
      yield { choices: [{ delta: { content: 'A' } }] }
      yield { choices: [{ delta: { content: 'B' } }] }
    })
    const out: string[] = []
    expect(await client.chatStream(messages, (t) => out.push(t))).toBe('AB')
    expect(calls).toBe(1)
    expect(out).toEqual(['A', 'B'])
  })
})

describe('告警与日志接线（不静默）', () => {
  beforeEach(() => {
    alerts.success.mockClear()
    alerts.failure.mockClear()
  })

  it('9. 成功调用会重置连续失败计数（走 alertLlmSuccess）', async () => {
    const client = (() => {
      const cfg = {
        apiKey: ['sk-', 'fake-for-tests-only'].join(''),
        baseUrl: 'https://example.invalid/v1',
        model: 'm',
        temperature: 0.2,
        maxTokens: 50,
        timeout: 0,
      }
      const c = new LlmClient(cfg as never)
      ;(c as unknown as { client: unknown }).client = {
        chat: { completions: { create: vi.fn(async () => (async function* () { yield { choices: [{ delta: { content: 'ok' } }] } })()) } },
      }
      return c
    })()

    await client.chatStream(messages, () => {})
    expect(alerts.success).toHaveBeenCalled()
  })

  it('10. 放弃重试时计入连续失败告警（不会悄悄失败）', async () => {
    let calls = 0
    const client = (() => {
      const cfg = {
        apiKey: ['sk-', 'fake-for-tests-only'].join(''),
        baseUrl: 'https://example.invalid/v1',
        model: 'm',
        temperature: 0.2,
        maxTokens: 50,
        timeout: 0,
      }
      const c = new LlmClient(cfg as never)
      ;(c as unknown as { client: unknown }).client = {
        chat: {
          completions: {
            create: vi.fn(async () => (async function* () {
              calls++
              throw new Error('HTTP 500 服务不可用')
            })()),
          },
        },
      }
      return c
    })()

    await expect(client.chatStream(messages, () => {})).rejects.toThrow()
    expect(calls).toBeGreaterThan(1)
    expect(alerts.failure).toHaveBeenCalled()
  })
})
