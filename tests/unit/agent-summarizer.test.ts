/**
 * L4 摘要压缩真的接上了模型（2026-10-15 全维度审查 D4 的另一半）
 *
 * 压缩分五层，其中 L4 定义为"把旧对话交给模型总结"。代码里两条路都写全了：
 * 同步版取首尾各 500 字符（降级），异步版调 LLM 摘要。问题是生产上唯一的调用点
 * 走的是**降级那条**——摘要器从没被接上，于是"摘要压缩"一直是掐头去尾，
 * 中段整段蒸发。界面上表现为"AI 忘了半小时前那条命令"，而日志里它确实压缩过了。
 *
 * 这里钉三件容易再断的事：
 * 1. 主对话走的是异步版，且摘要用的是**当前这台 Provider**（不能悄悄换成默认那台计费）
 * 2. 摘要输出也要过脱敏——摘要会作为 system 消息常驻后续每一次请求，
 *    模型复述回来的凭据一旦进摘要，就从"一次性出站"变成"永久驻留"
 * 3. 摘要失败不许阻断对话（compactIfNeededAsync 自己降级），但也不许把失败吞掉
 */
import { describe, it, expect, vi } from 'vitest'
import type { ModelMessage } from 'ai'
import {
  makeRedactingSummarizer,
  SUMMARY_SYSTEM_PROMPT,
} from '@main/core/agent/summarizer'
import { compactIfNeeded, compactIfNeededAsync } from '@main/core/agent/context'
import { redactSecrets } from '@main/core/agent/providers/redact'

/** 假凭据：相邻字面量拼出来，仓库里任何扫描器都不该看见完整形状 */
const FAKE_KEY = 'sk-' + 'aB3dEf6gHi7jKl8mNo9pQr0s'

function longHistory(count: number, chars: number): ModelMessage[] {
  const body = '检'.repeat(chars)
  return Array.from({ length: count }, (_, i): ModelMessage => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `${body} 第${i}轮`,
  }))
}

describe('摘要器：输出再过一次脱敏', () => {
  it('阳性对照：redactSecrets 本身认得这个形状（不认得就是判据是死的）', () => {
    expect(redactSecrets(`key is ${FAKE_KEY}`)).not.toContain(FAKE_KEY.slice(4))
  })

  it('模型把上下文里的凭据复述回来时，摘要里不许带原文', async () => {
    const summarizer = makeRedactingSummarizer(async () => `结论：使用 ${FAKE_KEY} 连接失败`)
    const out = await summarizer('请摘要')
    expect(out).not.toContain(FAKE_KEY)
    expect(out).toContain('结论')
  })

  it('调用失败原样抛出——吞掉就等于"摘要一直失败但没人知道"', async () => {
    const summarizer = makeRedactingSummarizer(async () => {
      throw new Error('上游 500')
    })
    await expect(summarizer('请摘要')).rejects.toThrow('上游 500')
  })
})

describe('摘要接进压缩链', () => {
  it('滑动窗口甩出去的段落，会以摘要形式留在列表里', async () => {
    const msgs = longHistory(30, 9000)
    let calls = 0
    const summarizer = vi.fn(async () => {
      calls++
      return '此前排查了磁盘占用与 nginx 配置，结论是日志卷满。'
    })
    const result = await compactIfNeededAsync(msgs, summarizer, 150_000)
    expect(calls, '窗口甩掉了消息却没调摘要器，等于还是静默丢历史').toBe(1)
    expect(result.summarizedCount).toBeGreaterThan(0)
    const systemMsgs = result.messages.filter((m) => m.role === 'system' && typeof m.content === 'string')
    const withSummary = systemMsgs.find((m) => String(m.content).includes('日志卷满'))
    expect(withSummary, '摘要没进消息列表，等于白调一次模型').toBeTruthy()
    expect(String(withSummary!.content)).toContain(`${result.summarizedCount} 条已折叠`)
  })

  it('没有摘要器时照样留痕：降级首尾提取，条目数如实报', () => {
    const msgs = longHistory(30, 9000)
    const result = compactIfNeeded(msgs, 150_000)
    expect(result.summarizedCount).toBeGreaterThan(0)
    const digest = result.messages.find(
      (m) => m.role === 'system' && typeof m.content === 'string' && m.content.includes('已折叠'),
    )
    expect(digest, '同步路径也必须有折叠痕迹').toBeTruthy()
  })

  it('摘要器抛错时对话不中断，退回首尾提取', async () => {
    const msgs = longHistory(30, 9000)
    const summarizer = vi.fn(async () => {
      throw new Error('模型超时')
    })
    const result = await compactIfNeededAsync(msgs, summarizer, 150_000)
    expect(result.messages.length).toBeGreaterThan(1)
    expect(
      result.messages.some((m) => m.role === 'system' && String(m.content).includes('已折叠')),
      '摘要失败后连降级痕迹都没有',
    ).toBe(true)
  })

  it('摘要返回空串也算失败，不许留一条空壳 system', async () => {
    const msgs = longHistory(30, 9000)
    const result = await compactIfNeededAsync(msgs, async () => '   ', 150_000)
    expect(
      result.messages.some((m) => m.role === 'system' && String(m.content).includes('已折叠')),
    ).toBe(true)
  })

  it('短对话不动任何东西，也就不调摘要器', async () => {
    const summarizer = vi.fn(async () => '不该被调用')
    const result = await compactIfNeededAsync([longHistory(2, 100)[0]], summarizer, 150_000)
    expect(result.level).toBe('none')
    expect(result.summarizedCount).toBe(0)
    expect(summarizer).not.toHaveBeenCalled()
  })
})

describe('supervisor 接线', () => {
  const source = (): string => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    return readFileSync('src/main/core/agent/supervisor.ts', 'utf8')
  }

  it('主对话走异步压缩（同步那条只有掐头去尾）', () => {
    expect(source()).toContain('await compactIfNeededAsync(')
  })

  it('摘要用当前这台 Provider，不会悄悄换成默认那台计费', () => {
    const line = source()
      .split(/\r?\n/)
      .find((l) => l.includes('this.callLlm(SUMMARY_SYSTEM_PROMPT'))
    expect(line, '找不到摘要调用那一行').toBeTruthy()
    expect(line).toContain('resolvedProviderId')
  })

  it('摘要器经过脱敏外壳', () => {
    expect(source()).toContain('makeRedactingSummarizer(')
  })

  it('摘要系统提示不许要求额外格式（解释文字会吃掉刚省出来的窗口）', () => {
    expect(SUMMARY_SYSTEM_PROMPT).toContain('只写事实')
  })
})
