/**
 * ai-sdk v7 中止形状的常驻判据（2026-10-22 实测钉下来）
 *
 * 为什么要钉在测试里：supervisor 的取消分支、入账决策（planUsageRecord）和界面上
 * "已停止 / 未拿到账"那两句话，全都建立在"中止时到底抛什么、流里能拿到什么"之上。
 * 这些事实之前只有注释里的推测（而且推错过一次：写着 for await 当场抛），
 * 升级 ai 版本时形状一变就会静默改变成本读数与取消语义——所以让它跑红。
 *
 * 这里不打桩 ai 包本身：用官方测试模型 MockLanguageModelV3 真跑一遍流。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { streamText } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

type Part = { type: string; usage?: unknown; text?: string }

/**
 * 造一条可控的 provider 流。
 * waitForAbort=true 时，脚本发完就不收尾、一直等到 abort（用来模拟"停在半截"）；
 * false 时发完立刻关流（正对照：这条流是真的会说完了的）。
 * 不靠睡固定秒数来制造时序。
 */
function scriptedStream(
  groups: unknown[][],
  aborted: () => boolean,
  onAbort: (fn: () => void) => void,
  waitForAbort: boolean
) {
  let i = 0
  let waiting: (() => void) | null = null
  onAbort(() => waiting && waiting())
  return new ReadableStream({
    async pull(controller) {
      if (i < groups.length) {
        for (const p of groups[i++]) controller.enqueue(p)
        await new Promise((r) => setTimeout(r, 10))
        return
      }
      if (waitForAbort && !aborted()) {
        await new Promise<void>((r) => {
          waiting = r
        })
      }
      controller.close()
    },
  })
}

const textGroups = [
  [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't1' },
    { type: 'text-delta', id: 't1', delta: '半截回答' },
  ],
]

interface AbortObservation {
  seen: string[]
  loopThrew: boolean
  usageOutcome: 'resolve' | 'reject'
  finishReasonOutcome: 'resolve' | 'reject'
  stepsOutcome: 'resolve' | 'reject'
}

async function runAbortedMidStream(): Promise<AbortObservation> {
  const ac = new AbortController()
  const onAbort = (fn: () => void): void => ac.signal.addEventListener('abort', fn)
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: scriptedStream(textGroups, () => ac.signal.aborted, onAbort, true),
    }),
  })
  const result = streamText({ model, prompt: 'hi', abortSignal: ac.signal })

  // 等第一个 chunk 上屏（正文已经出来了）再点停止
  await new Promise((r) => setTimeout(r, 40))
  ac.abort(new Error('user-stop'))

  const seen: string[] = []
  let loopThrew = false
  try {
    for await (const part of result.stream) {
      seen.push((part as Part).type)
    }
  } catch {
    loopThrew = true
  }

  const probe = async (p: PromiseLike<unknown>): Promise<'resolve' | 'reject'> => {
    try {
      await p
      return 'resolve'
    } catch {
      return 'reject'
    }
  }

  return {
    seen,
    loopThrew,
    usageOutcome: await probe(result.usage),
    finishReasonOutcome: await probe(result.finishReason),
    stepsOutcome: await probe(result.steps),
  }
}

describe('ai@7 的流在"用户点停止"那一刻的形状', () => {
  let obs: AbortObservation

  beforeAll(async () => {
    obs = await runAbortedMidStream()
  })

  it('for await 不抛：中止是干净收尾，并在流尾给一个 abort part', () => {
    expect(obs.loopThrew, '中止被当成异常抛出＝supervisor 的取消分支要走 catch').toBe(false)
    expect(obs.seen).toContain('abort')
    expect(obs.seen).toContain('text-delta')
  })

  it('抛的是 result.usage / finishReason / steps 那三个 promise', () => {
    expect(obs.usageOutcome).toBe('reject')
    expect(obs.finishReasonOutcome).toBe('reject')
    expect(obs.stepsOutcome).toBe('reject')
  })

  it('中止之前拿不到 finish-step：所以取消轮的实测用量在 SDK 层就没有，不能写成 0', () => {
    expect(obs.seen).not.toContain('finish-step')
    expect(obs.seen).not.toContain('finish')
  })

  it('正对照：同一条流跑完时 finish-step 是会来的（证明上一条不是因为观察器瞎）', async () => {
    const ac = new AbortController()
    const onAbort = (fn: () => void): void => ac.signal.addEventListener('abort', fn)
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: scriptedStream(
          [
            ...textGroups,
            [
              { type: 'text-end', id: 't1' },
              {
                type: 'finish',
                usage: { inputTokens: 5, outputTokens: 2 },
                finishReason: 'stop',
              },
            ],
          ],
          () => ac.signal.aborted,
          onAbort,
          false
        ),
      }),
    })
    const result = streamText({ model, prompt: 'hi', abortSignal: ac.signal })
    const seen: string[] = []
    for await (const part of result.stream) {
      seen.push((part as Part).type)
    }
    expect(seen).toContain('finish-step')
  })
})
