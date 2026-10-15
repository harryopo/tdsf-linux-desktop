/**
 * 上下文计量与压缩同源（2026-10-15 全维度审查 D4）
 *
 * 钉住的三个假读数/静默失效：
 * 1. 徽章分子用的是 `usage.inputTokens`——那是**各步之和**。带工具的对话最多 12 步，
 *    同一份上下文被数 12 遍，4 万 tokens 的会话能报成 40 万，徽章直接顶格。
 *    现在分子是末步真实占用（contextTokens），inputTokens 只留给计费。
 * 2. 主进程压缩了历史（L2/L3/L5 是整条丢），`compactionLevel` 一路带回渲染层却零消费，
 *    于是"AI 忘了三分钟前说过的话"在界面上没有任何痕迹。
 * 3. 界面的"压缩上下文"按钮自己一把尺（固定保留 6 条），与主进程的阈值互不相认——
 *    同一个窗口 8K 时留太多、200K 时留太少。现在两边都从 shared 那把尺取数。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  latestContextTokens,
  useAgentStore,
  type AgentMessage,
} from '@renderer/stores/agent-store'
import { buildCompactionNote, resolveContextUsage } from '@renderer/components/workbench/context-usage'
import type { AgentDonePayload, ChatResult } from '@shared/agent-types'

const store = () => useAgentStore.getState()

function msg(overrides: Partial<AgentMessage>): AgentMessage {
  return { id: 'm1', role: 'assistant', content: '', timestamp: 1, ...overrides }
}

/** 完整形状的 ChatResult：mock 必须与真实信封同形，不然新加的字段在测试层被抹平 */
function chatResult(overrides: Partial<ChatResult> = {}): ChatResult {
  return {
    text: '答案',
    usage: { inputTokens: 400_000, outputTokens: 1_000, totalTokens: 401_000 },
    finishReason: 'stop',
    providerId: 'p1',
    model: 'm1',
    strength: 'standard',
    durationMs: 1_200,
    compactionLevel: 'none',
    ...overrides,
  }
}

function seedStreaming(): void {
  useAgentStore.setState({
    messages: [
      msg({ id: 'u1', role: 'user', content: '帮我看磁盘' }),
      msg({ id: 'a1', content: '', isStreaming: true, correlationId: 'c-1' }),
    ],
    isStreaming: true,
    currentCorrelationId: 'c-1',
  })
}

beforeEach(() => {
  store().clearMessages()
})

describe('徽章分子用真实占用，不用各步之和', () => {
  it('同一条消息里 contextTokens 赢过 inputTokens（这正是修复的落点）', () => {
    expect(latestContextTokens([msg({ usage: { inputTokens: 400_000, outputTokens: 1, totalTokens: 400_001 }, contextTokens: 40_000 })])).toBe(40_000)
  })

  it('老消息没有 contextTokens 时退回 inputTokens，不至于显示 0', () => {
    expect(latestContextTokens([msg({ usage: { inputTokens: 9_000, outputTokens: 10, totalTokens: 9_010 } })])).toBe(9_000)
  })

  it('取最近一条有计量的 assistant，而不是第一条', () => {
    const list = [
      msg({ id: 'a1', usage: { inputTokens: 100, outputTokens: 1, totalTokens: 101 }, contextTokens: 100 }),
      msg({ id: 'u2', role: 'user', content: '继续' }),
      msg({ id: 'a2', usage: { inputTokens: 500, outputTokens: 1, totalTokens: 501 }, contextTokens: 320 }),
    ]
    expect(latestContextTokens(list)).toBe(320)
  })

  it('还没有回答过时是 0（配合窗口未知时"未知"，不演一个百分比）', () => {
    expect(latestContextTokens([msg({ role: 'user', content: 'hi' })])).toBe(0)
    const usage = resolveContextUsage({ usedTokens: latestContextTokens([]), windowTokens: 0 })
    expect(usage.pct).toBeNull()
  })

  it('done 事件把 contextTokens 落到消息上（链路断在这一步徽章就还是旧的）', () => {
    seedStreaming()
    const payload: AgentDonePayload = {
      correlationId: 'c-1',
      result: chatResult({ contextTokens: 43_210, stepCount: 7 }),
    }
    store().finalizeMessage(payload)
    expect(store().messages[1].contextTokens).toBe(43_210)
    expect(latestContextTokens(store().messages)).toBe(43_210)
  })
})

describe('压缩过要说出来（compaction 不再静默丢历史）', () => {
  it('没压缩时不给任何提示', () => {
    expect(buildCompactionNote(chatResult({ compactionLevel: 'none' }))).toBeNull()
  })

  it('L2 带去向：层级、前后 tokens、剪掉几条都写出来', () => {
    const note = buildCompactionNote(
      chatResult({
        compactionLevel: 'L2',
        compactionDetail: { beforeTokens: 61_000, afterTokens: 12_000, truncatedCount: 9 },
      }),
    )
    expect(note).toContain('L2')
    expect(note).toContain('61K')
    expect(note).toContain('12K')
    expect(note).toContain('9 条')
  })

  it('一条都没剪时不提"剪掉"，只报压缩本身', () => {
    const note = buildCompactionNote(
      chatResult({
        compactionLevel: 'L1',
        compactionDetail: { beforeTokens: 5_000, afterTokens: 4_000, truncatedCount: 0 },
      }),
    )
    expect(note).not.toContain('剪掉')
    expect(note).toContain('L1')
  })

  it('只有层级、没有去向数据时也不谎报数字', () => {
    const note = buildCompactionNote(chatResult({ compactionLevel: 'L4' }))
    expect(note).toBe('本轮上下文已压缩（L4）')
  })

  it('done 之后消息上带着这条提示', () => {
    seedStreaming()
    store().finalizeMessage({
      correlationId: 'c-1',
      result: chatResult({
        compactionLevel: 'L3',
        compactionDetail: { beforeTokens: 120_000, afterTokens: 9_000, truncatedCount: 14 },
      }),
    })
    expect(store().messages[1].contextNote).toContain('L3')
  })

  it('未压缩的那一轮不留提示（不许每行都挂一句）', () => {
    seedStreaming()
    store().finalizeMessage({ correlationId: 'c-1', result: chatResult() })
    expect(store().messages[1].contextNote).toBeUndefined()
  })
})

describe('压缩按钮与主进程同一把尺', () => {
  /** 10 条各约 100 tokens 的对话（'x'*300 → ceil(300/3)=100） */
  function seedTenChatMessages(): void {
    const list: AgentMessage[] = []
    for (let i = 0; i < 10; i++) {
      list.push(
        msg({ id: `m${i}`, role: i % 2 === 0 ? 'user' : 'assistant', content: 'x'.repeat(300), timestamp: i }),
      )
    }
    useAgentStore.setState({ messages: list, isStreaming: false })
  }

  it('小窗口（2K）按预算只留 4 条，而不是固定 6 条', () => {
    seedTenChatMessages()
    const r = store().compressMessages({ windowTokens: 2_000 })
    expect(r.compressed).toBe(true)
    // 预算 = min(30_000, 2000*0.2)=400 tokens → 4 条 100-token 消息
    const kept = store().messages.filter((m) => m.role !== 'system' && !m.content.startsWith('[上下文已压缩'))
    expect(kept.length).toBe(4)
    expect(r.droppedMessages).toBe(6)
  })

  it('大窗口（100K）预算宽裕，整段都还装得下就说"无需压缩"', () => {
    seedTenChatMessages()
    const r = store().compressMessages({ windowTokens: 100_000 })
    expect(r.compressed).toBe(false)
    expect(store().messages.length).toBe(10)
  })

  it('窗口未知时走绝对阈值（与主进程 resolveCompactionThresholds(0) 同一条规则）', () => {
    seedTenChatMessages()
    const r = store().compressMessages()
    expect(r.compressed).toBe(false)
  })

  it('预算再小也至少留 2 条，不许把对话压没', () => {
    seedTenChatMessages()
    store().compressMessages({ windowTokens: 100 })
    const kept = store().messages.filter((m) => !m.content.startsWith('[上下文已压缩'))
    expect(kept.length).toBeGreaterThanOrEqual(2)
  })

  it('省下来的是 tokens 估算，不再是"字符数"那种口径', () => {
    seedTenChatMessages()
    const r = store().compressMessages({ windowTokens: 2_000 })
    expect(r.droppedTokens).toBe(600)
  })

  it('流式进行中不动列表（压缩不能打断正在写的回答）', () => {
    seedTenChatMessages()
    useAgentStore.setState({ isStreaming: true })
    const r = store().compressMessages({ windowTokens: 2_000 })
    expect(r.compressed).toBe(false)
    expect(store().messages.length).toBe(10)
  })
})
