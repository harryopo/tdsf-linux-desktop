/**
 * 摘要调用按内容去重（2026-10-28，#255）
 *
 * 为什么要它：`compactIfNeededAsync` 在**每次** chat 之前跑，而压缩用的摘要提示词是
 * `dropped.join('\n').slice(0, 12_000)`——取的是**最前面** 12000 字符。也就是说：
 * 老对话一旦超过这个长度，每一轮的摘要提示词**逐字相同**，模型却每轮被重新叫一次，
 * 每次都按同一段 12K 文本计费。长会话里这是纯浪费。
 *
 * 去重只按提示词内容：内容变了就重新摘（那是真的新信息）；调用失败不缓存（下次还要试）。
 */
import { describe, it, expect, vi } from 'vitest'
import { createMemoizedSummarizer } from '../../src/main/core/agent/summary-cache'

describe('摘要去重缓存', () => {
  it('同一段提示词第二次直接命中，不再调模型', async () => {
    const raw = vi.fn(async (p: string) => `摘要:${p.length}`)
    const memo = createMemoizedSummarizer(raw)
    expect(await memo('同样的旧对话')).toBe('摘要:6')
    expect(await memo('同样的旧对话')).toBe('摘要:6')
    expect(raw).toHaveBeenCalledTimes(1)
  })

  it('提示词变了就重新摘（不拿旧摘要糊弄）', async () => {
    const raw = vi.fn(async (p: string) => `S(${p})`)
    const memo = createMemoizedSummarizer(raw)
    await memo('A')
    await memo('B')
    expect(raw).toHaveBeenCalledTimes(2)
    expect(await memo('B')).toBe('S(B)')
  })

  it('并发同一段只发一次（两个请求同时进来不重复计费）', async () => {
    let resolve!: (v: string) => void
    const raw = vi.fn(() => new Promise<string>((r) => (resolve = r)))
    const memo = createMemoizedSummarizer(raw)
    const p1 = memo('同一段')
    const p2 = memo('同一段')
    resolve('done')
    expect(await p1).toBe('done')
    expect(await p2).toBe('done')
    expect(raw).toHaveBeenCalledTimes(1)
  })

  it('空结果不缓存（下一次还要再试一遍）', async () => {
    const raw = vi.fn(async () => '')
    const memo = createMemoizedSummarizer(raw)
    await memo('x')
    await memo('x')
    expect(raw).toHaveBeenCalledTimes(2)
  })

  it('失败不缓存，并且把错误原样抛给调用方去降级', async () => {
    const raw = vi
      .fn<(p: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok')
    const memo = createMemoizedSummarizer(raw)
    await expect(memo('y')).rejects.toThrow('boom')
    expect(await memo('y')).toBe('ok')
    expect(raw).toHaveBeenCalledTimes(2)
  })

  it('容量上限：超过 maxEntries 先淘汰最旧的（缓存不是无界内存）', async () => {
    const raw = vi.fn(async (p: string) => `S${p}`)
    const memo = createMemoizedSummarizer(raw, { maxEntries: 2 })
    await memo('1')
    await memo('2')
    await memo('3')
    await memo('1') // 1 已被淘汰 → 再算一次
    expect(raw).toHaveBeenCalledTimes(4)
  })
})
