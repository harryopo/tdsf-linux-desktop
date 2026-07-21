/**
 * Polite-Fetch：礼貌 HTTP 客户端
 *
 * 教学术语：
 * - User-Agent (UA)：HTTP 请求头，标识客户端身份（爬虫礼仪第一条：明确身份）
 * - Jitter：随机抖动，避免多个爬虫同步请求形成"波峰"
 * - Token Bucket (令牌桶)：限流算法，每 period 时间补充一个令牌
 * - 429 Too Many Requests：服务器明确告诉你"太频繁了"
 * - Retry-After：服务器告诉你"等 N 秒再来"
 *
 * 合规参考（robots.txt 是君子协议，但工程上必须遵守）：
 * - Polite Scraping: https://scrapingcentral.com/learn/static-scraping/polite-scraping
 * - CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 * 设计原则：
 * 1. 每个请求必须设置明确的 User-Agent（含项目名+版本+教育目的+联系方式）
 * 2. 每个请求之间必须有 base interval + 随机 jitter
 * 3. 遇到 429 必须尊重 Retry-After（解析秒数或 HTTP date）
 * 4. Token Bucket 限制并发，防止误击服务器
 */

import { setTimeout as delay } from 'node:timers/promises'

/** 默认 User-Agent（含项目名+版本+教育目的+GitHub 链接） */
export const DEFAULT_USER_AGENT =
  'TDSF-Linux-Desktop/0.6.0 (Educational; +https://github.com/tdsf; +mailto:crawler@tdsf.app)'

/** Polite-Fetch 配置 */
export interface PoliteFetchOptions {
  /** 目标 URL */
  url: string
  /** 自定义 User-Agent（默认 DEFAULT_USER_AGENT） */
  userAgent?: string
  /** 自定义请求头 */
  headers?: Record<string, string>
  /** 基础间隔（ms），默认 1000ms */
  baseIntervalMs?: number
  /** 随机抖动范围（ms），默认 ±300ms */
  jitterMs?: number
  /** 最大重试次数（遇到 429/5xx 时），默认 3 */
  maxRetries?: number
  /** 超时（ms），默认 30000ms */
  timeoutMs?: number
  /** 是否跟随重定向，默认 true */
  redirect?: 'follow' | 'manual' | 'error'
  /** 限流令牌桶：每 N ms 放一个令牌，最大 M 个并发 */
  rateLimiter?: TokenBucket
  /** 外部 AbortSignal，用于取消当前请求 */
  signal?: AbortSignal
}

/** 令牌桶（Token Bucket）限流器 */
export class TokenBucket {
  private tokens: number
  private lastRefill: number
  private queue: Array<() => void> = []

  constructor(
    /** 桶容量（即最大并发） */
    public readonly capacity: number,
    /** 补充周期（ms）：每隔 refillMs 补充 1 个令牌 */
    public readonly refillMs: number
  ) {
    this.tokens = capacity
    this.lastRefill = Date.now()
  }

  /** 申请一个令牌（异步，无可用时等待） */
  async acquire(): Promise<void> {
    this.refill()
    if (this.tokens > 0) {
      this.tokens--
      return
    }
    // 没有令牌：等待下一次补充
    return new Promise<void>((resolve) => {
      this.queue.push(resolve)
    })
  }

  /** 内部：按时间差补充令牌 */
  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    const newTokens = Math.floor(elapsed / this.refillMs)
    if (newTokens > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + newTokens)
      this.lastRefill += newTokens * this.refillMs
      // 唤醒等待的请求
      while (this.queue.length > 0 && this.tokens > 0) {
        this.tokens--
        const resolve = this.queue.shift()
        if (resolve) resolve()
      }
    }
  }

  /** 释放一个令牌（请求失败时主动释放） */
  release(): void {
    this.tokens = Math.min(this.capacity, this.tokens + 1)
  }
}

/** 解析 Retry-After 头（支持秒数或 HTTP-date） */
function parseRetryAfter(value: string | null): number {
  if (!value) return 0
  // 纯数字：秒数
  if (/^\d+$/.test(value.trim())) {
    return parseInt(value, 10) * 1000
  }
  // HTTP-date 格式
  const date = Date.parse(value)
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now())
  }
  return 0
}

/** Polite-Fetch 错误（带状态码） */
export class PoliteFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
    public readonly retryAfterMs?: number
  ) {
    super(message)
    this.name = 'PoliteFetchError'
  }
}

/**
 * 礼貌 HTTP GET 请求
 *
 * 行为：
 * - 自动应用 User-Agent
 * - 自动应用 Jitter（每个请求 baseInterval + random(0, jitterMs)）
 * - 遇到 429 自动读取 Retry-After 并退避
 * - 遇到 5xx 自动重试（指数退避）
 * - Token Bucket 控制并发
 *
 * @example
 * const bucket = new TokenBucket(3, 1000)  // 3 并发，每秒补充 1 个
 * const html = await politeFetch({
 *   url: 'https://tldp.org/HOWTO/...',
 *   rateLimiter: bucket
 * })
 */
export async function politeFetch(options: PoliteFetchOptions): Promise<string> {
  const {
    url,
    userAgent = DEFAULT_USER_AGENT,
    headers = {},
    baseIntervalMs = 1000,
    jitterMs = 300,
    maxRetries = 3,
    timeoutMs = 30000,
    redirect = 'follow',
    rateLimiter,
    signal: externalSignal
  } = options

  // 0. 如果外部已取消，直接退出
  if (externalSignal?.aborted) {
    if (rateLimiter) rateLimiter.release()
    throw new PoliteFetchError('请求已取消', 499, url)
  }

  // 1. 限流：申请令牌
  if (rateLimiter) {
    await rateLimiter.acquire()
  }

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // 2. 礼貌间隔（base + jitter）— 仅在重试时和请求之间
      if (attempt > 0) {
        const backoff = baseIntervalMs * Math.pow(2, attempt - 1) + Math.random() * jitterMs
        await delay(backoff)
      } else if (baseIntervalMs > 0) {
        // 首次请求也加 jitter（避免与其他爬虫同步）
        await delay(baseIntervalMs + Math.random() * jitterMs)
      }

      // 每次循环前检查外部取消
      if (externalSignal?.aborted) {
        if (rateLimiter) rateLimiter.release()
        throw new PoliteFetchError('请求已取消', 499, url)
      }

      // 3. 发起请求（合并外部 signal 与内部超时 signal）
      const controller = new AbortController()
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)
      const onExternalAbort = (): void => controller.abort()
      externalSignal?.addEventListener('abort', onExternalAbort, { once: true })

      let res: Response
      try {
        res = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': userAgent,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            ...headers
          },
          redirect,
          signal: controller.signal
        })
      } finally {
        clearTimeout(timeoutHandle)
        externalSignal?.removeEventListener('abort', onExternalAbort)
      }

      // 4. 处理 429（Rate Limit）
      if (res.status === 429) {
        const retryAfterMs = parseRetryAfter(res.headers.get('Retry-After'))
        const waitMs = retryAfterMs > 0 ? retryAfterMs : baseIntervalMs * 2
        // 主动释放令牌（避免后续请求雪崩）
        if (rateLimiter) rateLimiter.release()
        if (attempt < maxRetries) {
          console.warn(
            `[polite-fetch] 429 ${url} - 尊重 Retry-After 等 ${Math.round(waitMs / 1000)}s`
          )
          await delay(waitMs)
          continue
        }
        throw new PoliteFetchError(`429 Too Many Requests (after ${maxRetries} retries)`, 429, url, waitMs)
      }

      // 5. 处理 5xx（服务器错误）
      if (res.status >= 500) {
        if (attempt < maxRetries) {
          const backoff = baseIntervalMs * Math.pow(2, attempt) + Math.random() * jitterMs
          console.warn(
            `[polite-fetch] ${res.status} ${url} - 指数退避 ${Math.round(backoff / 1000)}s (重试 ${attempt + 1}/${maxRetries})`
          )
          if (rateLimiter) rateLimiter.release()
          await delay(backoff)
          continue
        }
        throw new PoliteFetchError(`${res.status} ${res.statusText} (after ${maxRetries} retries)`, res.status, url)
      }

      // 6. 处理 4xx（客户端错误，不重试）
      if (!res.ok) {
        throw new PoliteFetchError(`HTTP ${res.status} ${res.statusText}`, res.status, url)
      }

      // 7. 成功
      return await res.text()
    } catch (err) {
      lastError = err as Error
      // PoliteFetchError 且不再重试：直接抛出
      if (err instanceof PoliteFetchError) {
        if (err.status === 429 && attempt < maxRetries) continue
        if (err.status >= 500 && attempt < maxRetries) continue
        if (err.status >= 400 && err.status < 500) {
          // 4xx 客户端错误不重试
          if (rateLimiter) rateLimiter.release()
          throw err
        }
      }
      // AbortError：区分外部取消与内部超时
      if ((err as Error).name === 'AbortError') {
        // 外部信号取消优先判定为 499，避免被当成超时 408
        if (externalSignal?.aborted) {
          if (rateLimiter) rateLimiter.release()
          throw new PoliteFetchError('请求已取消', 499, url)
        }
        if (attempt < maxRetries) {
          console.warn(`[polite-fetch] 超时 ${url} - 重试 ${attempt + 1}/${maxRetries}`)
          if (rateLimiter) rateLimiter.release()
          continue
        }
        throw new PoliteFetchError(`请求超时 (${timeoutMs}ms)`, 408, url)
      }
      // 其他网络错误
      if (attempt >= maxRetries) {
        if (rateLimiter) rateLimiter.release()
        throw err
      }
    }
  }

  if (rateLimiter) rateLimiter.release()
  throw lastError ?? new Error('未知错误')
}

/**
 * Polite-Fetch 流式下载（用于大文件如 Arch Wiki dump）
 *
 * 与 politeFetch 区别：
 * - 返回 ReadableStream，不读取全部内容到内存
 * - 不重试（流式一旦中断很难恢复）
 * - 限流逻辑相同
 */
export async function politeFetchStream(options: PoliteFetchOptions): Promise<ReadableStream<Uint8Array>> {
  const {
    url,
    userAgent = DEFAULT_USER_AGENT,
    headers = {},
    timeoutMs = 30000,
    rateLimiter,
    signal: externalSignal
  } = options

  if (externalSignal?.aborted) {
    if (rateLimiter) rateLimiter.release()
    throw new PoliteFetchError('请求已取消', 499, url)
  }

  if (rateLimiter) {
    await rateLimiter.acquire()
  }

  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)
  const onExternalAbort = (): void => controller.abort()
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true })

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        ...headers
      },
      redirect: 'follow',
      signal: controller.signal
    })

    if (!res.ok) {
      if (rateLimiter) rateLimiter.release()
      throw new PoliteFetchError(`HTTP ${res.status} ${res.statusText}`, res.status, url)
    }

    if (!res.body) {
      if (rateLimiter) rateLimiter.release()
      throw new Error('响应体为空')
    }

    return res.body
  } finally {
    clearTimeout(timeoutHandle)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
}
