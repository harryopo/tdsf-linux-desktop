/**
 * 读流式统计（用量 / 完成原因 / 逐步明细）这件事本身要被钉住（调研 P0-2 的第二半）
 *
 * 为什么单独抽出来：supervisor 里这段原来写在主 try 内，取消（点"停止"）那一路
 * 在 `for await` 就抛了，压根走不到拿账的地方 —— 于是那一轮真烧掉的 token 不入账，
 * 成本读数长期偏低。抽成一个不依赖模型、不依赖 SDK 的函数之后，
 * "拿账"这件事第一次有了可跑的判据。
 *
 * 另一条要紧的：三项各自独立拿。原来三个 await 共用一个 try，
 * ai-sdk 在流里见过错时会把三个一起 reject，一个失败就把另外两个也丢掉。
 */
import { describe, it, expect } from 'vitest'
import { readStreamStats } from '@main/core/agent/stream-stats'

const usage = { inputTokens: 900, outputTokens: 12, totalTokens: 912 }
const steps = [{ usage: { inputTokens: 900, outputTokens: 12 } }]

describe('readStreamStats', () => {
  it('三项都拿得到就原样交回来，不带错误', async () => {
    const got = await readStreamStats({
      usage: Promise.resolve(usage),
      finishReason: Promise.resolve('stop'),
      steps: Promise.resolve(steps),
    })
    expect(got.usage).toEqual(usage)
    expect(got.finishReason).toBe('stop')
    expect(got.steps).toEqual(steps)
    expect(got.readErrors).toEqual([])
  })

  it('一项失败不许连累另外两项（原来是三个 await 共用一个 try）', async () => {
    const boom = new Error('No output generated. Check the stream for errors.')
    const got = await readStreamStats({
      usage: Promise.resolve(usage),
      finishReason: Promise.reject(boom),
      steps: Promise.reject(boom),
    })
    expect(got.usage).toEqual(usage)
    expect(got.finishReason).toBeUndefined()
    expect(got.steps).toBeUndefined()
    expect(got.readErrors).toHaveLength(2)
  })

  it('全拿不到时不抛异常，只把原因带回来——拿账失败不该把这次调用也判成失败', async () => {
    const boom = new Error('aborted')
    const got = await readStreamStats({
      usage: Promise.reject(boom),
      finishReason: Promise.reject(boom),
      steps: Promise.reject(boom),
    })
    expect(got.usage).toBeUndefined()
    expect(got.readErrors).toHaveLength(3)
  })

  it('取消那一轮只要账在，就要能被记下来（这条就是修前的缺口）', async () => {
    const got = await readStreamStats({
      usage: Promise.resolve(usage),
      finishReason: Promise.reject(new Error('aborted')),
      steps: Promise.resolve(steps),
    })
    expect(got.usage?.totalTokens).toBe(912)
  })
})
