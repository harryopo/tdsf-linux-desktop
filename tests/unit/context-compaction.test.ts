/**
 * Context Compaction L1-L5 端到端测试
 *
 * 验证 5 层 compaction pipeline 的正确性：
 * - L1：单条消息截断（> 4K tokens）
 * - L2：滑动窗口（> 50K tokens → 保留 30K）
 * - L3/L4/L5：级联不可达（L2 降到 30K 后均不触发）
 * - compactIfNeededAsync：与 sync 行为一致
 * - 级联：L1+L2 同时触发、system 消息保留
 * - 阈值常量正确性
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ModelMessage } from 'ai'
import {
  compactIfNeeded,
  compactIfNeededAsync,
  estimateTokens,
  estimateMessageTokens,
  COMPACTION_THRESHOLDS,
} from '../../src/main/core/agent/context'

// Mock logger（避免 console 噪音）
vi.mock('../../src/main/services/log/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ─── 辅助工具 ───

/** 生成指定字符数的文本（estimateTokens = ceil(length/3)） */
function makeText(chars: number): string {
  return 'x'.repeat(chars)
}

/** 生成指定字符数的 user 消息 */
function makeMsg(chars: number, role: 'user' | 'assistant' | 'system' = 'user'): ModelMessage {
  return { role, content: makeText(chars) } as ModelMessage
}

/** 生成 N 条消息，每条 charsPerMsg 字符 */
function makeMessages(count: number, charsPerMsg: number, role: 'user' | 'assistant' = 'user'): ModelMessage[] {
  return Array.from({ length: count }, () => makeMsg(charsPerMsg, role))
}

// ─── 基础函数测试 ───

describe('estimateTokens / estimateMessageTokens', () => {
  it('estimateTokens：空字符串返回 0', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('estimateTokens：按 ceil(length/3) 估算', () => {
    expect(estimateTokens('abc')).toBe(1)
    expect(estimateTokens('abcdef')).toBe(2)
    expect(estimateTokens('abcdefghi')).toBe(3)
  })

  it('estimateMessageTokens：string content', () => {
    const msgs = [{ content: 'abcdef' }]
    expect(estimateMessageTokens(msgs)).toBe(2)
  })

  it('estimateMessageTokens：多模态数组 content', () => {
    const msgs = [{ content: [{ type: 'text', text: 'abcdef' }, { type: 'text', text: 'ghi' }] }]
    expect(estimateMessageTokens(msgs)).toBe(3)
  })

  it('estimateMessageTokens：对象 content（JSON.stringify）', () => {
    const msgs = [{ content: { key: 'value' } }]
    expect(estimateMessageTokens(msgs)).toBe(5)
  })
})

// ─── L1：单条消息截断 ───

describe('L1 compaction — 单条消息截断', () => {
  it('短消息不触发 L1', () => {
    const msgs = [makeMsg(300), makeMsg(300)]
    const result = compactIfNeeded(msgs)
    expect(result.level).toBe('none')
    expect(result.messages.length).toBe(2)
  })

  it('超长消息触发 L1 截断', () => {
    const msgs = [makeMsg(12_003)] // 4001 tokens > 4K 阈值
    const result = compactIfNeeded(msgs)
    expect(result.level).toBe('L1')
    expect(result.truncatedCount).toBe(1)
    const content = result.messages[0].content as string
    expect(content).toContain('[...省略')
    expect(content).toContain('L1 compaction')
  })

  it('L1 截断保留前 6000 + 后 3000 字符', () => {
    const original = makeText(30_000)
    const msgs = [{ role: 'user', content: original }] as ModelMessage[]
    const result = compactIfNeeded(msgs)
    const content = result.messages[0].content as string
    expect(content.startsWith(original.slice(0, 6000))).toBe(true)
    expect(content.endsWith(original.slice(-3000))).toBe(true)
  })

  it('混合长短消息：只截断超阈值的', () => {
    const msgs = [makeMsg(300), makeMsg(15_000), makeMsg(600)]
    const result = compactIfNeeded(msgs)
    expect(result.level).toBe('L1')
    expect(result.truncatedCount).toBe(1)
    expect((result.messages[0].content as string).length).toBe(300)
    expect((result.messages[2].content as string).length).toBe(600)
    expect((result.messages[1].content as string)).toContain('L1 compaction')
  })
})

// ─── L2：滑动窗口 ───

describe('L2 compaction — 滑动窗口', () => {
  it('总 tokens < 50K 不触发 L2', () => {
    const msgs = makeMessages(10, 3000) // 10K tokens
    const result = compactIfNeeded(msgs)
    expect(result.level).toBe('none')
  })

  it('总 tokens > 50K 触发 L2 滑动窗口', () => {
    const msgs = makeMessages(20, 9000) // 60K tokens
    const result = compactIfNeeded(msgs)
    expect(result.level).toBe('L2')
    expect(result.messages.length).toBeLessThan(20)
    expect(result.afterTokens).toBeLessThanOrEqual(30_000 + 3000)
  })

  it('L2 保留尾部（最近）消息', () => {
    const msgs: ModelMessage[] = []
    for (let i = 0; i < 20; i++) {
      msgs.push({ role: 'user', content: `msg-${i}-${makeText(9000)}` } as ModelMessage)
    }
    const result = compactIfNeeded(msgs)
    const lastContent = result.messages[result.messages.length - 1].content as string
    expect(lastContent).toContain('msg-19')
  })
})

// ─── L3-L5 级联可达性分析 ───

describe('L3/L4/L5 级联可达性', () => {
  // 设计观察：L2 滑动窗口将 tokens 降到 ≤ 30K，
  // 而 L3 阈值 100K > 30K，L4 触发点 112.5K > 30K，L5 触发点 135K > 30K。
  // 因此在当前阈值设置下，L3/L4/L5 在 sync 级联中不可达。
  // L3 是"重要节点抽取"的 Week 2 占位，L4/L5 主要为 compactIfNeededAsync 设计。

  it('L3 不可达：L2 后 tokens ≤ 30K < 100K', () => {
    const msgs = makeMessages(50, 9000) // 150K tokens
    const result = compactIfNeeded(msgs)
    expect(result.level).toBe('L2')
    expect(result.afterTokens).toBeLessThan(100_000)
  })

  it('L4 不可达：L2 后 tokens ≤ 30K < 112.5K', () => {
    const msgs = makeMessages(100, 6000) // 200K tokens
    const result = compactIfNeeded(msgs)
    expect(result.level).toBe('L2')
    expect(result.afterTokens).toBeLessThan(112_500)
  })

  it('L5 不可达：L2 后 tokens ≤ 30K < 135K', () => {
    const msgs = makeMessages(200, 6000) // 400K tokens
    const result = compactIfNeeded(msgs)
    expect(result.level).toBe('L2')
    expect(result.afterTokens).toBeLessThan(135_000)
  })
})

// ─── 级联行为 ───

describe('级联行为', () => {
  it('L1 + L2 同时触发', () => {
    const msgs: ModelMessage[] = [
      makeMsg(15_000), // L1 截断
      ...makeMessages(20, 9000), // L2 触发
    ]
    const result = compactIfNeeded(msgs)
    expect(result.level).toBe('L1') // level 记录最先触发的
    expect(result.truncatedCount).toBeGreaterThanOrEqual(1)
    expect(result.afterTokens).toBeLessThanOrEqual(30_000 + 3000)
  })

  it('无消息触发任何 compaction', () => {
    const msgs = [makeMsg(300), makeMsg(600)]
    const result = compactIfNeeded(msgs)
    expect(result.level).toBe('none')
    expect(result.beforeTokens).toBe(result.afterTokens)
    expect(result.truncatedCount).toBe(0)
  })

  it('空消息列表不崩溃', () => {
    const result = compactIfNeeded([])
    expect(result.level).toBe('none')
    expect(result.messages).toEqual([])
    expect(result.beforeTokens).toBe(0)
  })

  it('system 消息在 L2 滑动窗口中被保留', () => {
    const systemMsg: ModelMessage = { role: 'system', content: '你是运维助手' } as ModelMessage
    const msgs: ModelMessage[] = [systemMsg, ...makeMessages(20, 9000)]
    const result = compactIfNeeded(msgs)
    expect(result.messages[0].role).toBe('system')
    expect(result.messages[0].content).toBe('你是运维助手')
  })

  it('beforeTokens 反映原始总量，afterTokens 反映压缩后', () => {
    const msgs = makeMessages(20, 9000) // 60K tokens
    const result = compactIfNeeded(msgs)
    expect(result.beforeTokens).toBeGreaterThan(50_000)
    expect(result.afterTokens).toBeLessThan(result.beforeTokens)
  })
})

// ─── compactIfNeededAsync ───

describe('compactIfNeededAsync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('短对话不触发任何 compaction', async () => {
    const msgs = [makeMsg(300), makeMsg(600)]
    const result = await compactIfNeededAsync(msgs)
    expect(result.level).toBe('none')
    expect(result.messages.length).toBe(2)
  })

  it('无 summarizer 时行为与 sync 一致', async () => {
    const msgs = makeMessages(20, 9000)
    const syncResult = compactIfNeeded(msgs)
    const asyncResult = await compactIfNeededAsync(msgs)
    expect(asyncResult.level).toBe(syncResult.level)
    expect(asyncResult.messages.length).toBe(syncResult.messages.length)
  })

  it('summarizer 未触发 L4 时不被调用', async () => {
    const mockSummarizer = vi.fn().mockResolvedValue('这是摘要')
    const msgs = [makeMsg(300)]
    const result = await compactIfNeededAsync(msgs, mockSummarizer)
    expect(result.level).toBe('none')
    expect(mockSummarizer).not.toHaveBeenCalled()
  })

  it('summarizer 抛错时不崩溃', async () => {
    const mockSummarizer = vi.fn().mockRejectedValue(new Error('LLM 超时'))
    const msgs = [makeMsg(300)]
    const result = await compactIfNeededAsync(msgs, mockSummarizer)
    expect(result.level).toBe('none')
  })

  it('长对话 async 与 sync 产生相同压缩结果', async () => {
    const msgs = makeMessages(30, 9000)
    const syncResult = compactIfNeeded(msgs)
    const asyncResult = await compactIfNeededAsync(msgs)
    expect(asyncResult.level).toBe(syncResult.level)
    expect(asyncResult.afterTokens).toBe(syncResult.afterTokens)
  })
})

// ─── 阈值常量验证 ───

describe('COMPACTION_THRESHOLDS 常量', () => {
  it('L4 触发点 = 150K × 0.75 = 112500', () => {
    expect(COMPACTION_THRESHOLDS.L4_SESSION_CRITICAL * COMPACTION_THRESHOLDS.L4_TRIGGER_RATIO).toBe(112_500)
  })

  it('L5 触发点 = 150K × 0.90 = 135000', () => {
    expect(COMPACTION_THRESHOLDS.L4_SESSION_CRITICAL * COMPACTION_THRESHOLDS.L5_TRIGGER_RATIO).toBe(135_000)
  })

  it('阈值递增：L1 < L2 < L3 < L4_trigger < L5_trigger', () => {
    const l4t = COMPACTION_THRESHOLDS.L4_SESSION_CRITICAL * COMPACTION_THRESHOLDS.L4_TRIGGER_RATIO
    const l5t = COMPACTION_THRESHOLDS.L4_SESSION_CRITICAL * COMPACTION_THRESHOLDS.L5_TRIGGER_RATIO
    expect(COMPACTION_THRESHOLDS.L1_SINGLE_MESSAGE).toBeLessThan(COMPACTION_THRESHOLDS.L2_SESSION_SOFT)
    expect(COMPACTION_THRESHOLDS.L2_SESSION_SOFT).toBeLessThan(COMPACTION_THRESHOLDS.L3_SESSION_HARD)
    expect(COMPACTION_THRESHOLDS.L3_SESSION_HARD).toBeLessThan(l4t)
    expect(l4t).toBeLessThan(l5t)
  })

  it('L4_KEEP_RECENT_TOKENS = 30K（与 L2 窗口一致）', () => {
    expect(COMPACTION_THRESHOLDS.L4_KEEP_RECENT_TOKENS).toBe(30_000)
  })

  it('L5_SIMILARITY_THRESHOLD = 0.7', () => {
    expect(COMPACTION_THRESHOLDS.L5_SIMILARITY_THRESHOLD).toBe(0.7)
  })
})
