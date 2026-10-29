/**
 * ai-fixture-server.ts —— 本地假 OpenAI 兼容模型服务（测试专用）
 *
 * 为什么要它：AI 对话的全链路 e2e（providerSave → agentChat → 流式 chunk 回流 → 上屏）
 * 此前只有 ai-chat-live-verification.spec.ts，而它要求真实 API Key（要花钱），
 * 没有 Key 时整段 skip，于是"流式层是不是真的在流"在本机从来没被验过。
 * 这个 fixture 用 node:http 演一个 SSE 的 chat/completions，分多个 chunk 回，
 * 因此能断言到"确实是多条增量拼出来的"，而不是一次性甩回一整段。
 *
 * 它不是真模型：回答是写死的。它证明的是我们这侧的流式管道，
 * 真实模型质量仍由连真 API 的那条 spec 负责。
 *
 * 2026-10-23（#173）加了一项能力：按测试的安排回一次 tool_calls。
 * 外部 MCP 工具能不能真被 AI 调起来，中间那段"模型发起工具调用 → 主进程执行 →
 * 结果回喂给模型"只有假服务能被精确指挥（真模型调不调、调哪个都不由测试决定）。
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'

/** fixture 按顺序吐出的增量（拼起来必须含"2"，与产品侧断言口径一致） */
export const FIXTURE_DELTAS = ['1+1', ' 等于 ', '2']
export const FIXTURE_ANSWER = FIXTURE_DELTAS.join('')

/** 让模型发起的一次工具调用（name 必须与主进程挂上来的键一致） */
export interface PlannedToolCall {
  name: string
  args: Record<string, unknown>
}

/** 请求体里能按角色取正文的那几种 */
export type FixtureMessageRole = 'system' | 'user' | 'assistant' | 'tool'

export interface AiFixtureHandle {
  baseURL: string
  /** 服务端收到过的请求数（含 SDK 可能发的预检） */
  requestCount(): number
  /**
   * 最近一次**带该角色消息**的请求里，那些消息的正文（多条按行拼接；没有则空串）。
   *
   * 断言一律走这里，不要拿整份请求体比字符串，两个理由都是实测来的：
   *
   * 1. 正向断言会恒真。请求体含系统提示词，而系统提示词会注入长期记忆——
   *    上一次运行留下的《错误教训》原文里就带着"这次外部 MCP 调用没有被批准"
   *    （2026-10-27 量到：第一条请求里那句话命中 61 处）。拿整份 body `toContain(那句话)`
   *    等于判据从没生效过。
   * 2. 反向断言会假红。同理，某段文本"这轮不该出现"，却可能被上一轮沉淀的记忆带进来。
   *
   * 按角色取的那一层才是本次调用自己的话：`'tool'` 是回喂给模型的工具结果
   * （拒绝话术、第三方返回、环境隔离后的变量清单只可能在这里），
   * `'system'` 是注入上下文的地方，`'user'` 是这轮的问题原文。
   */
  lastRoleText(role: FixtureMessageRole): string
  /**
   * 最近一次请求的"花多少钱"相关字段（#255）：
   * - maxTokens：请求里有没有带输出上限（undefined = 没带，等于让模型自己停）
   * - toolCount：这次请求挂了多少个工具 schema（每个都算 input token）
   * - messageCount：这次带了多少条消息（步数越多、历史越长，这个数越大）
   */
  lastRequest(): { maxTokens: number | undefined; toolCount: number; messageCount: number }
  /**
   * 安排"下一次模型发起工具调用"（仅对还没有工具结果的那一轮请求生效）。
   * 传 null 收回安排，回到只回文本的老行为。
   */
  planToolCall(next: PlannedToolCall | null): void
  /**
   * 安排"下一次只回一个空内容就结束"（模拟内容过滤 / max_tokens 太小）。
   * 不带任何 content 增量，也不带工具调用——这正是线上会遇到的空回复形状。
   */
  planEmptyReply(on: boolean): void
  /**
   * 安排"下一次说半句就断"：先吐 prefix，再把连接直接掐掉。
   * 这是流式回答中途断网的真实形状（客户端会抛 terminated · other side closed）。
   */
  planAbortAfter(prefix: string | null): void
  close(): Promise<void>
}

function chunkBody(delta: string | null, done = false, finishReason: string | null = null): string {
  if (done) return 'data: [DONE]\n\n'
  return (
    'data: ' +
    JSON.stringify({
      id: 'fixture-' + Math.random().toString(36).slice(2, 8),
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'fixture-model',
      choices: [
        {
          index: 0,
          delta: delta === null ? {} : { content: delta },
          finish_reason: finishReason,
        },
      ],
    }) +
    '\n\n'
  )
}

/** OpenAI 的 tool_calls 增量形状（arguments 是字符串，不是一开始就展开的对象） */
function toolCallBody(call: PlannedToolCall): string {
  return (
    'data: ' +
    JSON.stringify({
      id: 'fixture-tool-' + Math.random().toString(36).slice(2, 8),
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'fixture-model',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_fixture_1',
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    }) +
    '\n\n'
  )
}

/**
 * 把一份请求体按角色归并出正文。解不出 JSON 就当没收到（回空对象）。
 */
function roleTextsOf(raw: string): Partial<Record<FixtureMessageRole, string>> {
  try {
    const parsed = JSON.parse(raw) as { messages?: { role?: unknown; content?: unknown }[] }
    const list = Array.isArray(parsed.messages) ? parsed.messages : []
    const byRole: Record<string, string[]> = {}
    for (const m of list) {
      if (!m || typeof m.role !== 'string') continue
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')
      ;(byRole[m.role] ??= []).push(text)
    }
    const out: Partial<Record<FixtureMessageRole, string>> = {}
    for (const role of ['system', 'user', 'assistant', 'tool'] as const) {
      if (byRole[role]?.length) out[role] = byRole[role].join('\n')
    }
    return out
  } catch {
    return {}
  }
}

export function startAiFixture(): Promise<AiFixtureHandle> {
  let requests = 0
  const lastPerRole = new Map<FixtureMessageRole, string>()
  let planned: PlannedToolCall | null = null
  let plannedEmpty = false
  let plannedAbort: string | null = null
  let lastReq: { maxTokens: number | undefined; toolCount: number; messageCount: number } = {
    maxTokens: undefined,
    toolCount: 0,
    messageCount: 0,
  }

  const server = http.createServer((req, res) => {
    requests += 1
    const body: Buffer[] = []
    req.on('data', (c: Buffer) => body.push(c))
    req.on('end', () => {
      // 不解析具体路径：不同 provider 类型对 baseURL 与 /v1 的拼接规则不一样，
      // 这里只要收到 messages 就按 OpenAI 的 SSE 格式回，避免测试绑死实现细节
      const raw = Buffer.concat(body).toString('utf8')
      const texts = roleTextsOf(raw)
      for (const [role, text] of Object.entries(texts)) {
        lastPerRole.set(role as FixtureMessageRole, text as string)
      }
      try {
        const parsed = JSON.parse(raw) as {
          max_tokens?: number
          max_completion_tokens?: number
          tools?: unknown[]
          messages?: unknown[]
        }
        lastReq = {
          maxTokens: parsed.max_tokens ?? parsed.max_completion_tokens,
          toolCount: Array.isArray(parsed.tools) ? parsed.tools.length : 0,
          messageCount: Array.isArray(parsed.messages) ? parsed.messages.length : 0,
        }
      } catch {
        // 解析不了就当没这些字段；下面还有 messages 形状的兜底判断
      }
      if (!raw.includes('messages')) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'fixture 只服务 chat/completions' } }))
        return
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })

      // 这一轮请求里已经带着工具结果（role=tool）就说明模型已经调过了，该回正文；
      // 只有"第一次进来且请求带了 tools"才把那一次工具调用交出去。
      const shouldCallTool =
        planned !== null && raw.includes('"tools"') && !raw.includes('"role":"tool"')
      if (shouldCallTool && planned) {
        const call = planned
        planned = null
        res.write(toolCallBody(call))
        res.write(chunkBody(null, true))
        res.end()
        return
      }

      if (plannedAbort !== null) {
        const prefix = plannedAbort
        plannedAbort = null
        res.write(chunkBody(prefix))
        setTimeout(() => res.destroy(), 200)
        return
      }

      if (plannedEmpty) {
        plannedEmpty = false
        // 只给一个 finish_reason=stop、delta 为空的分片：正文一个字都没有
        res.write(chunkBody(null, false, 'stop'))
        res.write(chunkBody(null, true))
        res.end()
        return
      }

      let i = 0
      const tick = () => {
        if (i < FIXTURE_DELTAS.length) {
          res.write(chunkBody(FIXTURE_DELTAS[i]))
          i += 1
          setTimeout(tick, 40)
          return
        }
        res.write(chunkBody(null, true))
        res.end()
      }
      tick()
    })
  })

  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({
        baseURL: `http://127.0.0.1:${addr.port}/v1`,
        requestCount: () => requests,
        lastRoleText: (role) => lastPerRole.get(role) ?? '',
        lastRequest: () => lastReq,
        planToolCall: (next) => {
          planned = next
        },
        planEmptyReply: (on) => {
          plannedEmpty = on
        },
        planAbortAfter: (prefix) => {
          plannedAbort = prefix
        },
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.()
            server.close(() => done())
          }),
      })
    })
  })
}
