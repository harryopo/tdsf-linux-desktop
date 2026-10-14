/**
 * Provider 错误分类的唯一一份规则表（#101）
 *
 * 合并前的三份手抄表：ipc/agent-runtime.ts toAgentError（15 码）、
 * ipc/llm.ts toLlmError（7 码）、ipc/llm-tools.ts toLlmError（6 码且丢掉原始信息）。
 * 三份都靠 `message.includes('404')` 这类裸子串判 HTTP 状态，于是 OpenAI 兼容端点那句
 * "maximum context length is 8192 tokens, however you requested 9404 tokens"
 * 里的 9404 命中 '404' —— 上下文超限被报成"模型不存在或 endpoint 错误"。
 * 用户看到的是"AI 突然不能用了"，而文案把排查方向指错了地方。
 *
 * 口径（顺序即优先级，越具体的信号越先）：
 *   1) provider 给机器读的错误码（data.code / responseBody.error.code / type / cause.code）
 *   2) 人读文本里的语义短语（一律用足够长的片段或带词边界）
 *   3) 结构化 HTTP 状态（err.status / err.statusCode）
 *   4) 文本里的三位数状态（\b404\b，词边界让 9404 不再命中）
 *   5) 兜底 UNKNOWN
 *
 * cause 链必须挖：OpenAI SDK 把连不上表现为 message="Connection error."，
 * 真信号在 cause.code=ECONNREFUSED。只看顶层会把最常见的断网报成 UNKNOWN。
 *
 * 原始消息进 payload 与日志之前先过 redactSecrets：调用点那句"错误信息已脱敏"
 * 此前只是注释，没有执行体。
 */

import { redactSecrets } from './redact'
import type { LlmErrorCode } from '@shared/agent-types'

/** 分类结果：码 + 给人看的一句话 + 该不该重试 */
export interface ClassifiedLlmError {
  code: LlmErrorCode
  message: string
  retryable: boolean
}

/** 重试口径：只有"再试一次有可能成"的码才 true */
const RETRYABLE: ReadonlySet<LlmErrorCode> = new Set<LlmErrorCode>([
  'RATE_LIMIT',
  'TIMEOUT',
  'NETWORK',
  'SERVER',
])

/** 每个码的固定说法（调用点只改兜底前缀，不改这些句子） */
const LABEL: Record<LlmErrorCode, string> = {
  AUTH: 'API Key 无效或已过期',
  PAYMENT_REQUIRED: '账户欠费，请充值后重试',
  PERMISSION: '权限不足或模型未开通',
  MODEL_NOT_FOUND: '模型不存在或 endpoint 错误',
  BAD_REQUEST: '请求参数错误',
  CONTEXT_OVERFLOW: '上下文超出模型窗口，请缩短对话或换更大窗口的模型',
  VALIDATION: '请求被服务器拒绝',
  RATE_LIMIT: '请求过于频繁，请稍后重试',
  QUOTA_EXHAUSTED: '账户额度已用尽，重试不会恢复，请检查配额',
  CONTENT_POLICY: '内容被服务端安全策略拒绝',
  TIMEOUT: '请求超时',
  NETWORK: '网络连接异常',
  SERVER: '服务器内部错误',
  PARSE: 'LLM 响应解析失败',
  NO_API_KEY: '未配置 API Key',
  UNKNOWN: '调用失败',
  CANCELLED: '已取消',
}

/** 一条规则：机器码 / 文本语义 / HTTP 状态，任一命中即归类 */
interface Rule {
  code: LlmErrorCode
  /** provider 在响应体里给机器读的标识（小写比较，取包含关系） */
  apiCodes?: readonly string[]
  /** 人读文本特征 */
  patterns?: readonly RegExp[]
  /** HTTP 状态码 */
  statuses?: readonly number[]
}

/**
 * 顺序即优先级。改动前先想清楚：越靠前的规则越具体，
 * 把 BAD_REQUEST(400) 放到 CONTEXT_OVERFLOW 前面就会把超限重新误诊成参数错误。
 */
const RULES: readonly Rule[] = [
  {
    code: 'CONTEXT_OVERFLOW',
    apiCodes: ['context_length_exceeded', 'max_tokens_exceeded', 'input_too_long'],
    patterns: [/context[_\s-]length/i, /maximum context/i, /too many tokens/i, /上下文(超出|过长)/],
  },
  {
    code: 'QUOTA_EXHAUSTED',
    apiCodes: ['insufficient_quota', 'quota_exceeded', 'exceeded_quota'],
    patterns: [/quota exceeded/i, /exceeded your current quota/i, /out of (?:credits?|budget)/i, /余额不足/, /额度(已?用尽|不足)/],
  },
  {
    code: 'CONTENT_POLICY',
    apiCodes: ['content_filter', 'content_policy', 'content_management'],
    patterns: [/content polic/i, /content[_\s-]filter/i, /policy violation/i, /安全策略/],
  },
  {
    code: 'NO_API_KEY',
    apiCodes: ['no_api_key_provided', 'missing_api_key'],
    patterns: [/no api key/i, /missing api key/i, /api key (?:is )?(?:required|not set|missing|empty)/i, /未配置 ?api key/i],
  },
  {
    code: 'AUTH',
    apiCodes: ['invalid_api_key', 'incorrect_api_key', 'authentication_error', 'invalid_apikey', 'unauthorized'],
    patterns: [/invalid api key/i, /incorrect api key/i, /unauthorized/i, /authentication/i, /invalid x-api-key/i],
    statuses: [401],
  },
  {
    code: 'PERMISSION',
    apiCodes: ['permission_denied', 'model_not_enabled', 'access_denied'],
    patterns: [/permission/i, /forbidden/i, /access denied/i, /not have access/i],
    statuses: [403],
  },
  {
    code: 'PAYMENT_REQUIRED',
    patterns: [/payment required/i, /insufficient funds/i, /billing/i],
    statuses: [402],
  },
  {
    code: 'MODEL_NOT_FOUND',
    apiCodes: ['model_not_found'],
    patterns: [/model not found/i, /does not exist/i, /no such model/i, /unknown model/i],
    statuses: [404],
  },
  {
    code: 'RATE_LIMIT',
    apiCodes: ['rate_limit_exceeded', 'requests_rate_limit_exceeded', 'too_many_requests'],
    patterns: [/rate[_\s-]limit/i, /too many requests/i, /throttl/i, /请求过于频繁/],
    statuses: [429],
  },
  {
    code: 'VALIDATION',
    patterns: [/unprocessable/i],
    statuses: [422],
  },
  {
    code: 'TIMEOUT',
    // OpenAI SDK 的超时是 AbortError（"Request was aborted."），不是带 timeout 字样的消息；
    // 这一条同时供 services/llm/client.ts 的重试判定用，漏了它超时就再也不重试了。
    apiCodes: ['request_timeout', 'timeout', 'aborterror'],
    patterns: [/timed? ?out/i, /deadline exceeded/i, /超时/, /abort(ed)?\b/i],
    statuses: [408],
  },
  {
    code: 'NETWORK',
    patterns: [/fetch failed/i, /network(?:error| error|s? error)/i, /\b(?:econnreset|etimedout|enotfound|econnrefused|econnaborted)\b/i, /socket hang up/i, /unable to connect/i],
  },
  {
    code: 'SERVER',
    patterns: [/server error/i, /internal error/i, /bad gateway/i, /service unavailable/i, /gateway timeout/i, /上游服务/],
    statuses: [500, 502, 503, 504],
  },
  {
    code: 'PARSE',
    patterns: [/json parse/i, /parse error/i, /unexpected token/i, /unexpected end of (?:json|input)/i, /malformed/i],
  },
  {
    code: 'BAD_REQUEST',
    apiCodes: ['invalid_request_error', 'invalid_parameter', 'invalid_prompt'],
    patterns: [/bad request/i, /invalid request/i, /invalid[_\s-]param/i, /参数错误/],
    statuses: [400],
  },
]

/** 原始消息进界面/日志前的长度上限：responseBody 可能几十 KB，会淹掉那一行 */
const MAX_DETAIL_CHARS = 300

interface ErrShape {
  message?: unknown
  status?: unknown
  statusCode?: unknown
  code?: unknown
  type?: unknown
  responseBody?: unknown
  cause?: unknown
  data?: {
    code?: unknown
    type?: unknown
    message?: unknown
    error?: { code?: unknown; type?: unknown; message?: unknown; param?: unknown }
  }
}

/** cause 链最多走三层：OpenAI SDK 把真原因藏在 cause 里，再深就是循环引用风险 */
const MAX_CAUSE_DEPTH = 3

function readStrings(err: unknown): { detail: string; status?: number; apiSignals: string[] } {
  const e = (err ?? {}) as ErrShape & Error
  const topMessage = typeof e.message === 'string' && e.message ? e.message : String(err ?? '未知错误')

  const rawStatus = e.status ?? e.statusCode
  const status = typeof rawStatus === 'number' && Number.isFinite(rawStatus) ? rawStatus : undefined

  const signals: string[] = []
  if (typeof e.code === 'string') signals.push(e.code)
  if (typeof e.type === 'string') signals.push(e.type)
  const d = e.data
  if (d) {
    for (const v of [d.code, d.type, d.error?.code, d.error?.type]) {
      if (typeof v === 'string') signals.push(v)
    }
  }
  // responseBody 常常才是带 code 的那一段（AI SDK 顶层 message 只有一句 "400 Bad Request"）
  if (typeof e.responseBody === 'string' && e.responseBody) {
    try {
      const parsed = JSON.parse(e.responseBody) as ErrShape['data']
      for (const v of [parsed?.code, parsed?.type, parsed?.error?.code, parsed?.error?.type]) {
        if (typeof v === 'string') signals.push(v)
      }
    } catch {
      // 不是 JSON 就把原文当人读文本用
      signals.push(e.responseBody.slice(0, MAX_DETAIL_CHARS))
    }
  }

  // cause 链：OpenAI SDK 的连不上表现为 message="Connection error."，
  // 真信号在 cause.code=ECONNREFUSED 里。只看顶层会把网络故障报成 UNKNOWN。
  const texts = [topMessage]
  let cursor: unknown = e.cause
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && cursor && typeof cursor === 'object'; depth++) {
    const c = cursor as ErrShape
    if (typeof c.message === 'string' && c.message) texts.push(c.message)
    for (const v of [c.code, c.type]) if (typeof v === 'string') signals.push(v)
    cursor = c.cause
  }

  // 去重后拼起来：cause 的 message 常常就是顶层 message 的展开
  const detail = [...new Set(texts)].join(' · ')
  return { detail, status, apiSignals: signals }
}

/**
 * 文本里出现的三位 HTTP 状态候选（词边界：9404 不算 404，127.0.0.1 的 127 会被列进来
 * 但没有任何规则认领它，所以由调用方逐个试到第一个认得的为止）
 */
function statusInText(text: string): number[] {
  return [...text.matchAll(/\b([1-5]\d{2})\b/g)].map((m) => Number(m[1]))
}

/**
 * 分类一个 provider 调用错误
 *
 * @param err 原始错误（AI SDK 的 APICallError 会带 status / data / responseBody / cause）
 * @param fallbackLabel 兜底文案前缀（各调用点历史上写的不一样，保留各自说法）
 */
export function classifyLlmError(err: unknown, fallbackLabel = LABEL.UNKNOWN): ClassifiedLlmError {
  const { detail, status, apiSignals } = readStrings(err)
  const hay = `${detail} ${apiSignals.join(' ')}`
  const signals = apiSignals.map((s) => s.toLowerCase())

  // 1+2) 机器码与语义文本：这一层必须在 HTTP 状态之前，否则 400 包住 context_length_exceeded
  let hit = RULES.find(
    (r) =>
      r.apiCodes?.some((c) => signals.some((s) => s.includes(c))) ||
      r.patterns?.some((p) => p.test(hay))
  )
  // 3) 结构化 HTTP 状态
  if (!hit && status !== undefined) hit = RULES.find((r) => r.statuses?.includes(status))
  // 4) 文本里的状态数字（最后兜底，词边界已经排掉 9404 那一类）
  if (!hit) {
    for (const s of statusInText(detail)) {
      const candidate = RULES.find((r) => r.statuses?.includes(s))
      if (candidate) {
        hit = candidate
        break
      }
    }
  }

  const code: LlmErrorCode = hit?.code ?? 'UNKNOWN'
  const label = code === 'UNKNOWN' ? fallbackLabel : LABEL[code]
  const redacted = redactSecrets(detail).slice(0, MAX_DETAIL_CHARS)
  return { code, message: `${label}（${redacted}）`, retryable: RETRYABLE.has(code) }
}

/** 规则表里的码集合（判据用它反查"新增码有没有漏文案或漏重试口径"） */
export function classifiedErrorCodes(): LlmErrorCode[] {
  return RULES.map((r) => r.code)
}

/** 有固定说法的码集合（LABEL 由 TS 保证与 LlmErrorCode 全覆盖对齐） */
export function labeledErrorCodes(): string[] {
  return Object.keys(LABEL)
}

/**
 * 只要那一句话，不要原始细节。
 *
 * 给"会被存进凭证类产物"的场合用（决策卡、历史记录）：真机实测到上游把
 * "Your api key: ****7eea is invalid (request_id: …)" 回显在错误里，
 * 整条塞进假设文本就等于让口令痕迹落进 SQLite。分类名足够让人知道下一步干什么。
 */
export function llmErrorLabel(err: unknown): string {
  return LABEL[classifyLlmError(err).code]
}
