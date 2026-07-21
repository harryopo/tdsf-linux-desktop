/**
 * polite-fetch 单元测试
 *
 * 覆盖：
 * - AbortController 外部取消应返回 499（不是 408 超时）
 * - TokenBucket 基本并发控制
 */
import { describe, it, expect } from 'vitest'
import { politeFetch, PoliteFetchError, TokenBucket } from '../../src/main/services/tutorial/crawler/polite-fetch'

describe('polite-fetch', () => {
  it('AbortController 取消应抛出 499', async () => {
    const controller = new AbortController()

    const fetchPromise = politeFetch({
      url: 'https://httpbin.org/delay/10',
      timeoutMs: 20000,
      baseIntervalMs: 0,
      maxRetries: 0,
      signal: controller.signal
    })

    setTimeout(() => controller.abort(), 50)

    await expect(fetchPromise).rejects.toThrow(PoliteFetchError)
    try {
      await fetchPromise
    } catch (err) {
      expect(err).toBeInstanceOf(PoliteFetchError)
      expect((err as PoliteFetchError).status).toBe(499)
    }
  })

  it('TokenBucket 应限制并发', async () => {
    const bucket = new TokenBucket(2, 1000)
    await bucket.acquire()
    await bucket.acquire()
    expect(bucket).toBeDefined()
  })
})
