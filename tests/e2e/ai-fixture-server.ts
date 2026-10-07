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
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'

/** fixture 按顺序吐出的增量（拼起来必须含"2"，与产品侧断言口径一致） */
export const FIXTURE_DELTAS = ['1+1', ' 等于 ', '2']
export const FIXTURE_ANSWER = FIXTURE_DELTAS.join('')

export interface AiFixtureHandle {
  baseURL: string
  /** 服务端收到过的请求数（含 SDK 可能发的预检） */
  requestCount(): number
  close(): Promise<void>
}

function chunkBody(delta: string | null, done = false): string {
  if (done) return 'data: [DONE]\n\n'
  return (
    'data: ' +
    JSON.stringify({
      id: 'fixture-' + Math.random().toString(36).slice(2, 8),
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'fixture-model',
      choices: [{ index: 0, delta: delta === null ? {} : { content: delta }, finish_reason: null }],
    }) +
    '\n\n'
  )
}

export function startAiFixture(): Promise<AiFixtureHandle> {
  let requests = 0

  const server = http.createServer((req, res) => {
    requests += 1
    const body: Buffer[] = []
    req.on('data', (c: Buffer) => body.push(c))
    req.on('end', () => {
      // 不解析具体路径：不同 provider 类型对 baseURL 与 /v1 的拼接规则不一样，
      // 这里只要收到 messages 就按 OpenAI 的 SSE 格式回，避免测试绑死实现细节
      const raw = Buffer.concat(body).toString('utf8')
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
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.()
            server.close(() => done())
          }),
      })
    })
  })
}
