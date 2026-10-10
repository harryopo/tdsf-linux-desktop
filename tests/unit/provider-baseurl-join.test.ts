/**
 * baseURL 的拼接真值：@ai-sdk/openai 不会替我们补 /v1
 *
 * 起因：provider-templates.ts 里写着"baseURL 不含 /v1 后缀——createOpenAI 会自动追加 /v1"，
 * 而 DeepSeek 的模板正好是 `https://api.deepseek.com`。2026-10-10 拿仓库内 vendor 的
 * SDK 源码核对（node_modules/.pnpm/@ai-sdk+openai@2.0.112/.../dist/index.js:4986 默认值
 * 就是 `https://api.openai.com/v1`，:887 请求路径是 `/chat/completions`），
 * 那句话与该版本的真实行为相反：SDK 只在 baseURL 末尾接路径，**不补版本段**。
 * 于是 DeepSeek 每次调用都打在 https://api.deepseek.com/chat/completions（不存在的路径）。
 *
 * 这份测试是**行为判据**，不是比字符串：真的用 SDK 建一次 provider、真的走一次请求，
 * 把我们注入的 fetch 收到的 URL 拿回来对。所以规则写死在库的行为上，
 * 换 SDK 版本时它会自己说话。
 *
 * 不发网络：fetch 由测试注入，直接返回错误响应，只看它收到的 URL。
 */
import { describe, it, expect } from 'vitest'
import { createOpenAI } from '@ai-sdk/openai'
import { PROVIDER_TEMPLATES, assertTemplateInvariants } from '../../src/main/core/agent/providers/provider-templates'

/** 走 createOpenAI 家族的 type（provider-factory.ts:209-223 的同一个分支集合） */
const OPENAI_FAMILY = ['openai-compatible', 'qwen', 'volcengine-ark', 'ollama', 'deepseek'] as const

/** 用给定 baseURL 真跑一次请求，返回注入 fetch 实际收到的 URL */
async function urlBuiltBy(baseURL: string): Promise<string> {
  const seen: string[] = []
  const openai = createOpenAI({
    apiKey: 'test-key-not-a-secret',
    baseURL,
    fetch: (async (input: RequestInfo | URL) => {
      seen.push(String(input))
      // 给一个 400：我们不关心响应内容，只关心请求打到哪个 URL
      return new Response(JSON.stringify({ error: 'probe' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch,
  })
  const model = openai.chat('probe-model')
  let thrown = ''
  try {
    await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      maxOutputTokens: 1,
      temperature: 0,
      mode: 'standard',
      abortSignal: new AbortController().signal,
      headers: {},
    })
  } catch (err) {
    // 400 会让 SDK 抛错，这里不需要它成功；但真因是"没发起请求"时必须看得见
    thrown = err instanceof Error ? err.message : String(err)
  }
  expect(seen.length, `注入的 fetch 没被调用（doGenerate 先抛了：${thrown}）`).toBeGreaterThan(0)
  return seen[0]
}

describe('baseURL 拼接真值（provider-factory 的 compat 分支）', () => {
  it('带版本段的 baseURL 原样使用，末尾只接 /chat/completions', async () => {
    const url = await urlBuiltBy('https://api.deepseek.com/v1')
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions')
  })

  it('不补 /v1：这就是"模板必须自带版本段"的证据', async () => {
    const url = await urlBuiltBy('https://api.deepseek.com')
    // 旧模板的写法实际打在这里 —— DeepSeek 没有这个端点，所以那句注释是反的
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(url).not.toContain('/v1/')
  })

  it('每条 compat 系模板的 baseURL 都已被拼成可用端点（数据面 + 行为面同时成立）', async () => {
    const targets = PROVIDER_TEMPLATES.filter(
      (t) => t.baseURL && (OPENAI_FAMILY as readonly string[]).includes(t.type),
    )
    expect(targets.length, '一条 compat 系模板都没扫到，判据空过').toBeGreaterThanOrEqual(5)
    for (const t of targets) {
      const url = await urlBuiltBy(t.baseURL)
      expect(url, `${t.id} 的最终端点`).toBe(`${t.baseURL.replace(/\/+$/, '')}/chat/completions`)
      expect(url, `${t.id} 缺版本段`).toMatch(/\/v\d+\/chat\/completions$/)
    }
  })

  it('模板自检器对这份表返回无问题（并把"没跑出问题"与"能跑出问题"分开证）', () => {
    expect(assertTemplateInvariants()).toEqual([])
    // 阴性对照：坏表必须报，否则上面那条等于没闸
    const broken = PROVIDER_TEMPLATES.map((t) => ({ ...t }))
    broken[0] = { ...broken[0], baseURL: 'https://api.deepseek.com' }
    const problems = assertTemplateInvariants(broken)
    expect(problems.some((p) => p.includes('版本段')), `坏表没被报出来：${problems.join(' | ')}`).toBe(true)
  })
})
