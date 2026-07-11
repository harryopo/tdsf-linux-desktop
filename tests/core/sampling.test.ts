/**
 * 自适应自洽采样模块单元测试
 */
import { describe, it, expect, vi } from 'vitest'
import {
  shouldResample,
  resampleAndVote,
  adaptiveSample,
  CONFIDENCE_THRESHOLD,
  RESAMPLE_COUNT
} from '../../src/main/core/sampling'

describe('sampling — 自适应自洽采样', () => {
  // ────────── 常量验证 ──────────

  it('常量: 阈值为 0.7，重采样次数为 3', () => {
    expect(CONFIDENCE_THRESHOLD).toBe(0.7)
    expect(RESAMPLE_COUNT).toBe(3)
  })

  // ────────── shouldResample ──────────

  it('shouldResample: 置信度 < 0.7 返回 true', () => {
    expect(shouldResample(0)).toBe(true)
    expect(shouldResample(0.5)).toBe(true)
    expect(shouldResample(0.69)).toBe(true)
  })

  it('shouldResample: 置信度 >= 0.7 返回 false', () => {
    expect(shouldResample(0.7)).toBe(false)
    expect(shouldResample(0.9)).toBe(false)
    expect(shouldResample(1)).toBe(false)
  })

  // ────────── resampleAndVote ──────────

  it('resampleAndVote: 多数票获胜', () => {
    const results = ['df -h', 'df -h', 'free -m']
    expect(resampleAndVote(results)).toBe('df -h')
  })

  it('resampleAndVote: 空列表返回空字符串', () => {
    expect(resampleAndVote([])).toBe('')
  })

  it('resampleAndVote: 单个结果直接返回', () => {
    expect(resampleAndVote(['only result'])).toBe('only result')
  })

  it('resampleAndVote: 票数相同时返回最先出现的', () => {
    const results = ['first', 'second', 'third']
    // 三者各一票，返回最先出现的 'first'
    expect(resampleAndVote(results)).toBe('first')
  })

  it('resampleAndVote: 全部相同结果', () => {
    expect(resampleAndVote(['same', 'same', 'same'])).toBe('same')
  })

  // ────────── adaptiveSample ──────────

  it('adaptiveSample: 高置信度时只调用一次 generator', async () => {
    const generator = vi.fn().mockResolvedValue('result')
    const result = await adaptiveSample(0.9, generator)
    expect(result).toBe('result')
    expect(generator).toHaveBeenCalledTimes(1)
  })

  it('adaptiveSample: 低置信度时调用三次 generator 并取多数票', async () => {
    const values = ['df -h', 'df -h', 'free -m']
    let callIndex = 0
    const generator = vi.fn().mockImplementation(async () => {
      return values[callIndex++]
    })
    const result = await adaptiveSample(0.5, generator)
    expect(generator).toHaveBeenCalledTimes(3)
    expect(result).toBe('df -h') // 多数票
  })

  it('adaptiveSample: 阈值边界 0.7 时单次调用', async () => {
    const generator = vi.fn().mockResolvedValue('ok')
    await adaptiveSample(0.7, generator)
    expect(generator).toHaveBeenCalledTimes(1)
  })

  it('adaptiveSample: generator 抛出异常时传播错误', async () => {
    const generator = vi.fn().mockRejectedValue(new Error('LLM 调用失败'))
    await expect(adaptiveSample(0.9, generator)).rejects.toThrow('LLM 调用失败')
  })
})
