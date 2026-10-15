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
import { basename, join, relative, resolve } from 'node:path'
import * as ts from 'typescript'
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
  // 原先声明成 Error & Record<string, unknown>：Object.assign 造不出索引签名，
  // 于是这条"真形状"的构造函数自己过不了类型检查。按实际有的字段声明。
}): Error & { name: string; status?: number; data?: unknown; responseBody?: string } {
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

  it('OpenAI SDK 把真原因藏在 cause 里：只看顶层会报 UNKNOWN', () => {
    const wrapped = Object.assign(new Error('Connection error.'), {
      name: 'Error',
      cause: Object.assign(
        new Error('request to http://127.0.0.1:9/v1/chat/completions failed, reason: connect ECONNREFUSED 127.0.0.1:9'),
        { code: 'ECONNREFUSED', name: 'FetchError' }
      ),
    })
    const r = classifyLlmError(wrapped)
    expect(r.code).toBe('NETWORK')
    expect(r.retryable).toBe(true)
    // 正向对照：顶层那句单独拿出来确实什么线索都没有，说明是 cause 挖掘在起作用
    expect(classifyLlmError(new Error('Connection error.')).code).toBe('UNKNOWN')
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

/**
 * 自抛的中文错误必须被同一张表认得（2026-10-15 全维度审查 D5）
 *
 * 这张表是给"上游返回的英文错误"写的，而我们自己也抛中文：
 * `LLM 不可用：API Key 未配置` 与规则 `/未配置 ?api key/i` 是同一句话的**反语序**，
 * 于是它落到 UNKNOWN——界面上"调用失败"四个字，把明明一步就能修的事
 * 变成用户对着黑盒猜。这条判据把"自己抛的每一句"钉进表里：
 * 新增一处没配规则的自抛，测试先红，而不是等用户报"AI 又坏了"。
 */
describe('自抛错误不许落 UNKNOWN', () => {
  const ROOT = resolve(__dirname, '../..')
  const SCOPED = [
    join('src', 'main', 'services', 'llm', 'client.ts'),
    join('src', 'main', 'core', 'agent', 'supervisor.ts'),
    join('src', 'main', 'core', 'agent', 'providers', 'provider-factory.ts'),
  ]

  /**
   * 已知不该由这张表负责的自抛（每条都要写清为什么）。
   * 判据是"这条错误会不会走到 classifyLlmError"，不是"文案像不像 LLM 错误"。
   */
  const EXEMPT: Array<{ file: string; text: string; why: string }> = [
    {
      file: 'client.ts',
      text: 'LLM 调用失败：未知错误',
      why: '重试三轮后一个原因都没拿到时的兜底——UNKNOWN 是这里的诚实答案，不是漏配规则',
    },
  ]

  /** 从 AST 里取 new Error('...') / new Error(`...${x}...`) 的字面文案，插值处补占位符 */
  function thrownLiterals(rel: string): Array<{ file: string; text: string; wrapped: boolean }> {
    const src = readFileSync(join(ROOT, rel), 'utf8')
    const file = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true)
    const out: Array<{ file: string; text: string; wrapped: boolean }> = []
    const textOf = (n: ts.Node): { text: string; wrapped: boolean } | null => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
        return { text: n.text, wrapped: false }
      }
      if (ts.isTemplateExpression(n)) {
        let acc = n.head.text
        for (const span of n.templateSpans) acc += `占位${span.literal.text}`
        // 带插值 = 把原始错误拼进来当理由，运行时分类吃的是全文，不是这段前缀
        return { text: acc, wrapped: true }
      }
      return null
    }
    const walk = (node: ts.Node): void => {
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'Error' &&
        node.arguments?.length
      ) {
        const t = textOf(node.arguments[0])
        if (t) out.push({ file: basename(rel), ...t })
      }
      ts.forEachChild(node, walk)
    }
    walk(file)
    return out
  }

  const all = SCOPED.flatMap((rel) => thrownLiterals(rel))

  it('阳性对照：真的抽到了自抛文案（抽到 0 条就是量具坏了）', () => {
    expect(all.length, `抽到 ${all.length} 条`).toBeGreaterThan(10)
  })

  it('每一条要么有归类、要么带插值转述原始错误、要么在豁免清单里写明原因', () => {
    const offenders = all
      .filter((t) => classifyLlmError(new Error(t.text)).code === 'UNKNOWN')
      .filter((t) => !t.wrapped)
      .filter((t) => !EXEMPT.some((e) => e.file === t.file && t.text.includes(e.text)))
    expect(
      offenders.map((o) => `${o.file}: ${o.text.slice(0, 60)}`),
      '这些自抛的中文错误在界面上只会显示"调用失败"'
    ).toEqual([])
  })

  it('正语序与反语序都要认得（这是本次回归的原点）', () => {
    expect(classifyLlmError(new Error('LLM 不可用：API Key 未配置')).code).toBe('NO_API_KEY')
    expect(classifyLlmError(new Error('未配置 API Key')).code).toBe('NO_API_KEY')
    expect(
      classifyLlmError(new Error('Provider "deepseek" (deepseek) 缺少 API Key，请在设置中配置')).code
    ).toBe('NO_API_KEY')
  })

  it('配置类错误单独成码，不蹭"未配置 API Key"那句文案', () => {
    for (const text of [
      'Provider "ollama" (ollama) 缺少 baseURL，请在设置中配置',
      'Provider "ollama" (ollama) 缺少模型名，请在设置中配置',
      '不支持的 Provider 类型: 占位',
      'Provider "占位" 不存在，请在设置中配置',
    ]) {
      const r = classifyLlmError(new Error(text))
      expect(r.code, text).toBe('CONFIG')
      expect(r.message, text).toContain('设置')
    }
  })

  it('豁免清单不许留着已经不再需要的条目（防它变成新的盲区）', () => {
    for (const e of EXEMPT) {
      const matched = all.filter((t) => t.file === e.file && t.text.includes(e.text))
      expect(matched.length, `豁免项「${e.file}: ${e.text}」现在没有对应自抛，请删掉`).toBeGreaterThan(0)
      // 豁免的前提是"它确实不会被分类"——如果哪天规则覆盖了它，就该把它移出清单
      const stillUnknown = matched.every(
        (t) => classifyLlmError(new Error(t.text)).code === 'UNKNOWN'
      )
      expect(stillUnknown, `「${e.file}: ${e.text}」已被规则覆盖，不该再豁免`).toBe(true)
    }
  })
})
