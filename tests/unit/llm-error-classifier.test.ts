/**
 * tests/unit/llm-error-classifier.test.ts — provider 错误分类单源（#101）
 *
 * 主案值：三份手抄表都用 `message.includes('404')` 判 HTTP 状态，于是
 * "requested 9404 tokens" 命中 '404'，上下文超限被报成"模型不存在或 endpoint 错误"。
 * 这条回归在界面上的表现就是"AI 突然不能用了，而且提示让我去查模型名"。
 *
 * 每条判据都配"该发生的确实发生了"：脱敏那条先证明 redactSecrets 认这个形状，
 * 单源那条先证明扫描器扫得到旧的裸子串写法（把规则改回 includes 就会红）。
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { classifyLlmError, classifiedErrorCodes, labeledErrorCodes } from '../../src/main/core/agent/providers/llm-error'
import { redactSecrets } from '../../src/main/core/agent/providers/redact'

/** 假口令：相邻字面量拼出来，仓库里任何扫描器都不该看见完整形状 */
const FAKE_KEY = 'sk-' + 'aB3dEf6gHi7jKl8mNo9pQr0s'

/** 真靶子错误形状样本（AI SDK 的 APICallError 带 status/data/responseBody） */
function apiError(init: {
  message: string
  status?: number
  data?: unknown
  responseBody?: string
}): Error & Record<string, unknown> {
  return Object.assign(new Error(init.message), {
    ...(init.status !== undefined ? { status: init.status } : {}),
    ...(init.data !== undefined ? { data: init.data } : {}),
    ...(init.responseBody !== undefined ? { responseBody: init.responseBody } : {}),
    name: 'AI_APICallError',
  })
}

describe('分类：不再被文本里的三位数骗到', () => {
  it('回归主案：9404 tokens 的超限不许报成"模型不存在"', () => {
    const r = classifyLlmError(
      apiError({
        message:
          "This model's maximum context length is 8192 tokens, however you requested 9404 tokens",
        status: 400,
        data: { error: { message: 'max_tokens exceed context limit' } },
      })
    )
    expect(r.code).toBe('CONTEXT_OVERFLOW')
    expect(r.message).not.toContain('模型不存在')
    // 同样的请求再发一次还是超限，所以不许建议重试
    expect(r.retryable).toBe(false)
  })

  it('正向对照：这条样本确实带着 404 这三个字符（判据不是靠"没有 404"蒙对的）', () => {
    const msg = "This model's maximum context length is 8192 tokens, however you requested 9404 tokens"
    expect(msg).toContain('404')
  })

  it('带时机的网络错误不许报成 401 认证失败', () => {
    const r = classifyLlmError(new Error('fetch failed after 1401ms'))
    expect(r.code).toBe('NETWORK')
    expect(r.retryable).toBe(true)
  })
})

describe('分类：结构化信号优先', () => {
  it('status=404 且没有语义文本 → MODEL_NOT_FOUND', () => {
    expect(classifyLlmError(apiError({ message: 'Not Found', status: 404 })).code).toBe('MODEL_NOT_FOUND')
  })

  it('status=429 → RATE_LIMIT 且可重试', () => {
    const r = classifyLlmError(apiError({ message: 'Too Many Requests', status: 429 }))
    expect(r.code).toBe('RATE_LIMIT')
    expect(r.retryable).toBe(true)
  })

  it('400 + insufficient_quota → QUOTA_EXHAUSTED，并且不说"请稍后重试"', () => {
    const r = classifyLlmError(
      apiError({
        message: '400 Bad Request',
        status: 400,
        data: { error: { code: 'insufficient_quota', type: 'bad_request' } },
      })
    )
    expect(r.code).toBe('QUOTA_EXHAUSTED')
    expect(r.retryable).toBe(false)
    expect(r.message).not.toContain('稍后重试')
  })

  it('机器码只写在 responseBody 里时也认得（内容策略拒绝）', () => {
    const r = classifyLlmError(
      apiError({
        message: '400 Bad Request',
        status: 400,
        responseBody: JSON.stringify({ error: { code: 'content_filter', message: 'flagged' } }),
      })
    )
    expect(r.code).toBe('CONTENT_POLICY')
  })

  it('OpenAI SDK 的超时表现为 AbortError：仍归超时且可重试（客户端重试判定吃这条）', () => {
    const r = classifyLlmError(
      Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' })
    )
    expect(r.code).toBe('TIMEOUT')
    expect(r.retryable).toBe(true)
  })

  it('"No API key provided" 报未配置，而不是"Key 无效或已过期"', () => {
    expect(classifyLlmError(apiError({ message: 'No API key provided', status: 401 })).code).toBe(
      'NO_API_KEY'
    )
  })

  it('认不出来的错误仍归 UNKNOWN，并保留原始文本与前缀说法', () => {
    const r = classifyLlmError(new Error('something the parser cannot describe'), 'Agent 调用失败')
    expect(r.code).toBe('UNKNOWN')
    expect(r.message).toBe('Agent 调用失败（something the parser cannot describe）')
  })
})

describe('分类：原始消息过界面之前先遮凭据', () => {
  it('阳性对照：redactSecrets 本身认得这个形状（不认得就是测试是死的）', () => {
    expect(redactSecrets(`bad key: ${FAKE_KEY}`)).toContain('sk-[REDACTED]')
  })

  it('上游把 Key 回显在错误里时，payload 文本不得带上它', () => {
    const r = classifyLlmError(apiError({ message: `invalid api key ${FAKE_KEY}` }))
    expect(r.code).toBe('AUTH')
    expect(r.message).not.toContain(FAKE_KEY)
    expect(r.message).toContain('sk-[REDACTED]')
  })

  it('超长 responseBody 截断，不淹没那一行', () => {
    const r = classifyLlmError(new Error(`boom ${'x'.repeat(5000)}`))
    expect(r.message.length).toBeLessThan(400)
  })
})

describe('单源：手抄表不许再长回来', () => {
  /**
   * 扫描范围 = 会碰 provider 错误的那几个目录。
   * 不扫 src/main 全量是有意的：core/agent-workflow.ts 里的 lower.includes('502')
   * 判的是用户那句 Linux 问题（"网站报 502"），跟 provider 错误不是一张表。
   */
  const SCOPES = ['ipc', join('core', 'agent'), join('services', 'llm')]

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full, out)
      else if (name.endsWith('.ts')) out.push(full)
    }
    return out
  }

  const files = SCOPES.flatMap((s) => walk(resolve(__dirname, '../../src/main', s)))

  it('阳性对照：扫描真的读到了源码（读到 0 个文件就是量具坏了）', () => {
    expect(files.length, `扫到 ${files.length} 个文件`).toBeGreaterThan(20)
  })

  it('这些目录里不许再用裸子串判三位 HTTP 状态', () => {
    const offenders: string[] = []
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split(/\r?\n/)
      lines.forEach((line, i) => {
        const t = line.trim()
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
        const m = /includes\(\s*['"](40\d|41\d|42\d|50\d)['"]\s*\)/.exec(line)
        if (m) offenders.push(`${relative(resolve(__dirname, '../..'), f)}:${i + 1} ${m[0]}`)
      })
    }
    expect(offenders, `又出现手抄的状态码子串判定：${offenders.join(' | ')}`).toEqual([])
  })

  it('规则表用到的每个码都有固定说法（漏了会在界面上印 undefined）', () => {
    const labels = labeledErrorCodes()
    const missing = classifiedErrorCodes().filter((c) => !labels.includes(c))
    expect(missing, `这些码有规则但没有文案：${missing.join(', ')}`).toEqual([])
    expect(labels.length, '文案表比规则表还短 = 有码永远印不出来').toBeGreaterThan(
      new Set(classifiedErrorCodes()).size
    )
  })
})
