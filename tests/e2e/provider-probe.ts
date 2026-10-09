/**
 * 模型 Key 可达性探针（e2e 共用夹具）
 *
 * 为什么共用：`tests/e2e/.ai-credentials.local.json` 里有 apiKey **不等于这把 Key 能用**。
 * 2026-10-09 实测：文件里那把 Key 被 DeepSeek 拒（HTTP 401 authentication_error），
 * 于是三条"要有真模型才能跑"的用例里，只有 ai-chat-live 先探后跳，
 * 另两条 tool-viz 直接开跑，报成"产品流式层坏了"——同一个病在两个地方各演各的。
 * 现在三份都用这一个探针：探不通就带原因 skip，绝不演成产品缺陷。
 */
import fs from 'node:fs'
import path from 'node:path'

export interface ModelCred {
  providerId: string
  model: string
  baseURL: string
  apiKey: string
}

/** 读本地凭据；没有文件返回 null（调用方据此 skip） */
export function loadAiCred(dir = __dirname): ModelCred | null {
  const f = path.join(dir, '.ai-credentials.local.json')
  if (!fs.existsSync(f)) return null
  try {
    return JSON.parse(fs.readFileSync(f, 'utf-8')) as ModelCred
  } catch {
    return null
  }
}

/**
 * 用 1 个 token 探一次服务端认不认这把 Key。
 * 只回状态与错误类别，不把 Key 或响应原文带进测试报告。
 */
export async function probeKey(cred: ModelCred): Promise<{ ok: boolean; detail: string }> {
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
