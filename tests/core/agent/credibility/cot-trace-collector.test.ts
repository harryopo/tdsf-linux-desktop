/**
 * CoT 熵轨迹收集器单元测试（v0.9.6 P2 M5+）
 *
 * 论文支撑：
 * - **Zhao, X. 2026**, "Entropy Trajectory Shape Predicts LLM Reasoning Reliability"
 *   arXiv:2603.18940v1, 2026-03-19
 *   - 熵轨迹**形状单调性**比标量总熵更具预测力
 *   - 单调链 68.8% 准确率 vs 非单调链 46.8%
 *
 * 测试目标：
 * - textShannonEntropy：字符级 Shannon 熵归一化
 *   - 空字符串 / 单字符重复 / 完全随机 / 中文 / 英文
 * - splitBySentences：句子边界切分
 *   - 中英文混排 / 段落 / 太短片段合并
 * - CotTraceCollector：3 优先级降级
 *   - 显式 thinking block
 *   - 多 turn 累积
 *   - 文本启发式 fallback
 *   - 状态机：init → recording → finalized
 *   - 互斥优先级：thinking > turn > fallback
 * - 端到端：collector.finalize() → analyzeCotEntropyTrajectory() 联动
 *
 * 调研依据：
 * d:\ai\linux教学一体\idea-to-dev-output\40-CoT-shape熵轨迹置信度架构设计.md
 */
import { describe, it, expect } from 'vitest'
import {
  CotTraceCollector,
  createCotTraceCollector,
  textShannonEntropy,
  splitBySentences,
} from '../../../../src/main/core/agent/credibility/mass-functions/cot-trace-collector'
import {
  extractThinkingBlocks,
  extractTextBlocks,
  adaptAssistantMessageToCollector,
  adaptPartialMessageToCollector,
  extractNumTurns,
} from '../../../../src/main/core/agent/credibility/mass-functions/sdk-trace-adapter'
import { analyzeCotEntropyTrajectory } from '../../../../src/main/core/agent/credibility/mass-functions/cot-trace-signal'

// ============================================================================
// 纯函数：textShannonEntropy
// ============================================================================

describe('cot-trace-collector — textShannonEntropy（字符级归一化熵）', () => {
  it('空字符串 → 0（最确定）', () => {
    expect(textShannonEntropy('')).toBe(0)
  })

  it('单字符重复 "aaaaa" → 0（最确定）', () => {
    expect(textShannonEntropy('aaaaa')).toBe(0)
  })

  it('单字符 "a" → 0（最确定，仅 1 个唯一字符）', () => {
    expect(textShannonEntropy('a')).toBe(0)
  })

  it('完全均匀 26 字母 → 高熵（接近 1）', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz'
    const h = textShannonEntropy(text)
    // 26 个不同字符均匀分布
    // 实际值取决于归一化基数（log2(26) ≈ 4.7）
    expect(h).toBeGreaterThan(0.9)
    expect(h).toBeLessThanOrEqual(1)
  })

  it('完全均匀 36 字符（26+10） → 接近 1', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz0123456789'
    const h = textShannonEntropy(text)
    expect(h).toBeGreaterThan(0.95)
    expect(h).toBeLessThanOrEqual(1)
  })

  it('英文短句 "Hello world" → 中等熵（重复字符+空格）', () => {
    const h = textShannonEntropy('Hello world')
    expect(h).toBeGreaterThan(0.5)
    expect(h).toBeLessThan(0.95)
  })

  it('中文文本 → 中高熵（中文字符种类多）', () => {
    const text = '今天天气很好适合出门散步'
    const h = textShannonEntropy(text)
    expect(h).toBeGreaterThan(0.7)
    expect(h).toBeLessThanOrEqual(1)
  })

  it('中英混排 → 中等熵', () => {
    const text = 'CPU 使用率 95% 持续 5 分钟'
    const h = textShannonEntropy(text)
    expect(h).toBeGreaterThan(0.5)
    expect(h).toBeLessThanOrEqual(1)
  })

  it('NaN/异常输入兜底（虽然类型不允许 string 包含 NaN，但传入不抛错）', () => {
    // null/undefined 兜底
    // @ts-expect-error 故意传错类型
    expect(textShannonEntropy(null)).toBe(0)
    // @ts-expect-error 故意传错类型
    expect(textShannonEntropy(undefined)).toBe(0)
  })

  it('结果始终 ∈ [0, 1]', () => {
    const samples = [
      'a',
      'abc',
      'hello world',
      '中文测试',
      'Mixed 中英 mix 123',
      '!@#$%^&*()',
    ]
    for (const s of samples) {
      const h = textShannonEntropy(s)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(1)
    }
  })
})

// ============================================================================
// 纯函数：splitBySentences
// ============================================================================

describe('cot-trace-collector — splitBySentences（句子边界切分）', () => {
  it('空字符串 → []', () => {
    expect(splitBySentences('')).toEqual([])
  })

  it('单段无标点 → 1 段', () => {
    const s = splitBySentences('just some text without punctuation')
    expect(s.length).toBeGreaterThanOrEqual(1)
  })

  it('英文多句按 . ! ? 切分', () => {
    const s = splitBySentences('First sentence. Second one! Third? Fourth.')
    expect(s.length).toBeGreaterThanOrEqual(3)
    // 每段应包含原句子的核心内容
    expect(s[0]).toContain('First')
    expect(s.some((x) => x.includes('Second'))).toBe(true)
  })

  it('中文多句按 。！？ 切分', () => {
    const s = splitBySentences('第一句。第二句！第三句？第四句。')
    expect(s.length).toBeGreaterThanOrEqual(3)
    expect(s[0]).toContain('第一')
    expect(s.some((x) => x.includes('第二'))).toBe(true)
  })

  it('段间空行作为切分点', () => {
    const text = 'First paragraph here.\n\nSecond paragraph here.'
    const s = splitBySentences(text)
    expect(s.length).toBeGreaterThanOrEqual(2)
    expect(s[0]).toContain('First')
    expect(s[1]).toContain('Second')
  })

  it('短句（< 4 字符）合并到上一句，且不反复吸入长句', () => {
    // 合并规则：只在「上一句本身也过短」时才合并，避免长句被反复吸入
    // - "OK." (3 字符) < 4 → 待合并
    // - "Yes." (4 字符) NOT < 4 → 独立成段
    // - "This is a long..." (44 字符) NOT < 4 → 独立成段
    const s = splitBySentences('OK. Yes. This is a long sentence that should be kept.')
    // 期望：3 段（OK./Yes./This is a long...）
    expect(s.length).toBeLessThanOrEqual(3)
    expect(s[0]).toContain('OK')
    expect(s[1]).toContain('Yes')
    expect(s.some((x) => x.includes('This is a long'))).toBe(true)
  })

  it('连续短句（< 4 字符）会聚合成 1 段，但不污染下一个长句', () => {
    // "嗯。" "好。" 都是 2 字符 < 4
    // 但 "This is meaningful content" 远 ≥ 4，不会被吸入
    const s = splitBySentences('嗯。好。This is meaningful content that should stay separate.')
    expect(s.length).toBeGreaterThanOrEqual(2)
    expect(s[0]).toContain('嗯')
    expect(s.some((x) => x.includes('meaningful content'))).toBe(true)
  })

  it('中英混排正确切分', () => {
    const s = splitBySentences('CPU is high. 服务器负载过高。Memory pressure. 内存压力。')
    expect(s.length).toBeGreaterThanOrEqual(3)
  })

  it('仅空白 → []', () => {
    expect(splitBySentences('   \n\n  ')).toEqual([])
  })
})

// ============================================================================
// CotTraceCollector：状态机 + 3 优先级
// ============================================================================

describe('cot-trace-collector — CotTraceCollector 状态机', () => {
  it('初始状态：空 trajectory + collected=false', () => {
    const c = createCotTraceCollector()
    const r = c.finalize()
    expect(r.collected).toBe(false)
    expect(r.trajectory).toEqual([])
    expect(r.totalSteps).toBe(0)
    expect(r.usedFallback).toBe(false)
  })

  it('recordThinkingBlock 后 state 变为 recording', () => {
    const c = createCotTraceCollector()
    c.recordThinkingBlock('Let me think about this problem carefully.')
    const r = c.finalize()
    expect(r.collected).toBe(true)
    expect(r.totalSteps).toBe(1)
    expect(r.sourceBreakdown['thinking-block']).toBe(1)
  })

  it('多次 recordThinkingBlock → 累积多步', () => {
    const c = createCotTraceCollector()
    c.recordThinkingBlock('Step 1: Analyze the input structure.')
    c.recordThinkingBlock('Step 2: Consider the edge cases.')
    c.recordThinkingBlock('Step 3: Formulate the answer.')
    const r = c.finalize()
    expect(r.totalSteps).toBe(3)
    expect(r.sourceBreakdown['thinking-block']).toBe(3)
  })

  it('空字符串 recordThinkingBlock 静默跳过', () => {
    const c = createCotTraceCollector()
    c.recordThinkingBlock('')
    c.recordThinkingBlock('   \n  ')
    const r = c.finalize()
    expect(r.totalSteps).toBe(0)
  })

  it('recordTurnText 后 state 变为 recording', () => {
    const c = createCotTraceCollector()
    c.recordTurnText('This is the assistant response.')
    const r = c.finalize()
    expect(r.collected).toBe(true)
    expect(r.sourceBreakdown['turn-text']).toBe(1)
  })

  it('多次 recordTurnText → 累积多 turn', () => {
    const c = createCotTraceCollector()
    c.recordTurnText('Turn 1 reasoning.')
    c.recordTurnText('Turn 2 reasoning.')
    const r = c.finalize()
    expect(r.totalSteps).toBe(2)
    expect(r.sourceBreakdown['turn-text']).toBe(2)
  })

  it('finalize 后不可再 record', () => {
    const c = createCotTraceCollector()
    c.recordThinkingBlock('First.')
    c.finalize()
    expect(() => c.recordThinkingBlock('After finalize.')).toThrow(/finalized/)
    expect(() => c.recordTurnText('After finalize.')).toThrow(/finalized/)
  })

  it('多次 finalize 返回相同结果（幂等）', () => {
    const c = createCotTraceCollector()
    c.recordThinkingBlock('Step 1.')
    const r1 = c.finalize()
    const r2 = c.finalize()
    expect(r1).toEqual(r2)
  })
})

// ============================================================================
// CotTraceCollector：3 优先级降级
// ============================================================================

describe('cot-trace-collector — 3 优先级降级（thinking > turn > fallback）', () => {
  it('优先级 1：thinking blocks 为主，不触发 fallback', () => {
    const c = createCotTraceCollector()
    c.recordThinkingBlock('First reasoning step.')
    c.accumulateFinalText('This is a long final text that should not be split. ')
    c.accumulateFinalText('It contains multiple sentences. ')
    c.accumulateFinalText('Yet fallback should not be used because thinking was recorded.')
    const r = c.finalize()
    expect(r.usedFallback).toBe(false)
    expect(r.totalSteps).toBe(1)
    expect(r.sourceBreakdown['thinking-block']).toBe(1)
    expect(r.sourceBreakdown['text-fallback']).toBe(0)
  })

  it('优先级 2：turn text 为主，不触发 fallback', () => {
    const c = createCotTraceCollector()
    c.recordTurnText('First turn response.')
    c.accumulateFinalText('A lot of accumulated text here. ')
    const r = c.finalize()
    expect(r.usedFallback).toBe(false)
    expect(r.totalSteps).toBe(1)
    expect(r.sourceBreakdown['turn-text']).toBe(1)
  })

  it('优先级 3：仅 finalText 触发 fallback 切分', () => {
    const c = createCotTraceCollector()
    c.accumulateFinalText('First sentence here. Second sentence here. Third sentence here. Fourth one.')
    const r = c.finalize()
    expect(r.usedFallback).toBe(true)
    expect(r.totalSteps).toBeGreaterThan(1)
    expect(r.sourceBreakdown['text-fallback']).toBe(r.totalSteps)
  })

  it('thinking + turn 混合：各算各的', () => {
    const c = createCotTraceCollector()
    c.recordThinkingBlock('Thinking step 1.')
    c.recordTurnText('Turn text 1.')
    c.recordThinkingBlock('Thinking step 2.')
    const r = c.finalize()
    expect(r.usedFallback).toBe(false)
    expect(r.totalSteps).toBe(3)
    expect(r.sourceBreakdown['thinking-block']).toBe(2)
    expect(r.sourceBreakdown['turn-text']).toBe(1)
  })

  it('完全无数据 → empty trajectory', () => {
    const c = createCotTraceCollector()
    const r = c.finalize()
    expect(r.collected).toBe(false)
    expect(r.trajectory).toEqual([])
    expect(r.usedFallback).toBe(false)
  })

  it('accumulateFinalText 单次完成不调用 record → 触发 fallback', () => {
    const c = createCotTraceCollector()
    c.accumulateFinalText('A complete paragraph.\n\nAnother paragraph follows.')
    const r = c.finalize()
    expect(r.usedFallback).toBe(true)
    expect(r.totalSteps).toBeGreaterThanOrEqual(2)
  })
})

// ============================================================================
// 端到端：collector → analyzeCotEntropyTrajectory 联动
// ============================================================================

describe('cot-trace-collector — 端到端：collector → analyzeCotEntropyTrajectory', () => {
  it('fallback 路径：长单段文本 → trajectory + 单调性分析', () => {
    const c = createCotTraceCollector()
    c.accumulateFinalText(
      'Step 1: Analyze the input. Step 2: Consider edge cases. Step 3: Formulate answer. Step 4: Verify correctness. Step 5: Final output.'
    )
    const r = c.finalize()
    expect(r.collected).toBe(true)
    // 把 trajectory 喂给 analyzeCotEntropyTrajectory，应能正确分类
    const analysis = analyzeCotEntropyTrajectory(r.trajectory)
    expect(analysis.steps).toBe(r.totalSteps)
    expect(analysis.confidence).toBeGreaterThan(0)
    expect(analysis.confidence).toBeLessThanOrEqual(0.85)
  })

  it('thinking 路径：多 step 推理 → 与 Zhao 论文场景一致', () => {
    const c = createCotTraceCollector()
    // 模拟 Anthropic Claude with thinking 暴露的多个 reasoning blocks
    c.recordThinkingBlock('The user asks about system performance.')
    c.recordThinkingBlock('I should check CPU, memory, and disk metrics first.')
    c.recordThinkingBlock('Based on the metrics, the issue is likely memory pressure.')
    c.recordThinkingBlock('I recommend adding more RAM or optimizing memory usage.')
    c.recordThinkingBlock('Final answer: upgrade memory or optimize workloads.')
    const r = c.finalize()
    expect(r.totalSteps).toBe(5)
    // 喂给分析器
    const analysis = analyzeCotEntropyTrajectory(r.trajectory)
    expect(analysis.steps).toBe(5)
  })

  it('thinking 路径 + monotonic 文本构造完美单调链', () => {
    const c = createCotTraceCollector()
    // 构造确定性递增的字符复杂度（更确定 → 熵更低）
    c.recordThinkingBlock('1111111111111111111111') // 极低熵
    c.recordThinkingBlock('aaaaaaaaaa bbbbbbbbbb') // 中低熵
    c.recordThinkingBlock('aabbccddeeffgg') // 中等熵
    c.recordThinkingBlock('hello world this is mixed text content') // 中高熵
    c.recordThinkingBlock('a long and varied text with many different characters and words here') // 高熵
    const r = c.finalize()
    // 注意：上述文本构造可能不会完美单调，但应该有几个 trace points
    expect(r.totalSteps).toBe(5)
    // 至少 trajectory 是 number[]
    expect(r.trajectory).toHaveLength(5)
    r.trajectory.forEach((h) => {
      expect(typeof h).toBe('number')
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(1)
    })
  })
})

// ============================================================================
// SDK Adapter：adaptAssistantMessageToCollector
// ============================================================================

describe('sdk-trace-adapter — adaptAssistantMessageToCollector（ThinkingBlock 提取）', () => {
  it('提取 thinking block + text block', () => {
    // 模拟 SDKAssistantMessage 结构
    const sdkMsg = {
      type: 'assistant' as const,
      message: {
        content: [
          { type: 'thinking', thinking: 'Let me reason about this step by step.' },
          { type: 'text', text: 'The answer is 42.' },
        ],
      },
      // ... 其他字段省略
    } as unknown as Parameters<typeof adaptAssistantMessageToCollector>[0]

    const c = createCotTraceCollector()
    const { thinkingSteps, turnTextLength } = adaptAssistantMessageToCollector(sdkMsg, c)
    const r = c.finalize()

    expect(thinkingSteps).toBe(1)
    expect(turnTextLength).toBeGreaterThan(0)
    expect(r.totalSteps).toBe(2)
    expect(r.sourceBreakdown['thinking-block']).toBe(1)
    expect(r.sourceBreakdown['turn-text']).toBe(1)
  })

  it('只有 thinking block（无 text）', () => {
    const sdkMsg = {
      type: 'assistant' as const,
      message: {
        content: [{ type: 'thinking', thinking: 'Pure reasoning without final answer.' }],
      },
    } as unknown as Parameters<typeof adaptAssistantMessageToCollector>[0]

    const c = createCotTraceCollector()
    const { thinkingSteps, turnTextLength } = adaptAssistantMessageToCollector(sdkMsg, c)
    const r = c.finalize()

    expect(thinkingSteps).toBe(1)
    expect(turnTextLength).toBe(0)
    expect(r.totalSteps).toBe(1)
    expect(r.sourceBreakdown['thinking-block']).toBe(1)
  })

  it('只有 text block（普通助手消息）', () => {
    const sdkMsg = {
      type: 'assistant' as const,
      message: {
        content: [{ type: 'text', text: 'This is a normal assistant response.' }],
      },
    } as unknown as Parameters<typeof adaptAssistantMessageToCollector>[0]

    const c = createCotTraceCollector()
    const { thinkingSteps, turnTextLength } = adaptAssistantMessageToCollector(sdkMsg, c)
    const r = c.finalize()

    expect(thinkingSteps).toBe(0)
    expect(turnTextLength).toBeGreaterThan(0)
    expect(r.totalSteps).toBe(1)
    expect(r.sourceBreakdown['turn-text']).toBe(1)
  })

  it('多个 thinking blocks（多步推理）', () => {
    const sdkMsg = {
      type: 'assistant' as const,
      message: {
        content: [
          { type: 'thinking', thinking: 'Step 1: Analyze input.' },
          { type: 'thinking', thinking: 'Step 2: Consider alternatives.' },
          { type: 'thinking', thinking: 'Step 3: Conclude.' },
          { type: 'text', text: 'The final answer is X.' },
        ],
      },
    } as unknown as Parameters<typeof adaptAssistantMessageToCollector>[0]

    const c = createCotTraceCollector()
    const { thinkingSteps } = adaptAssistantMessageToCollector(sdkMsg, c)
    const r = c.finalize()

    expect(thinkingSteps).toBe(3)
    expect(r.totalSteps).toBe(4)
    expect(r.sourceBreakdown['thinking-block']).toBe(3)
    expect(r.sourceBreakdown['turn-text']).toBe(1)
  })

  it('空 content / 非数组 content 静默跳过', () => {
    const sdkMsg1 = {
      type: 'assistant' as const,
      message: { content: [] },
    } as unknown as Parameters<typeof adaptAssistantMessageToCollector>[0]
    const sdkMsg2 = {
      type: 'assistant' as const,
      message: { content: null },
    } as unknown as Parameters<typeof adaptAssistantMessageToCollector>[0]
    const sdkMsg3 = {
      type: 'assistant' as const,
      message: {},
    } as unknown as Parameters<typeof adaptAssistantMessageToCollector>[0]

    const c1 = createCotTraceCollector()
    adaptAssistantMessageToCollector(sdkMsg1, c1)
    expect(c1.finalize().totalSteps).toBe(0)

    const c2 = createCotTraceCollector()
    adaptAssistantMessageToCollector(sdkMsg2, c2)
    expect(c2.finalize().totalSteps).toBe(0)

    const c3 = createCotTraceCollector()
    adaptAssistantMessageToCollector(sdkMsg3, c3)
    expect(c3.finalize().totalSteps).toBe(0)
  })
})

// ============================================================================
// SDK Adapter：adaptPartialMessageToCollector（流式 delta）
// ============================================================================

describe('sdk-trace-adapter — adaptPartialMessageToCollector（流式 delta）', () => {
  it('content_block_delta + text_delta → 累积 finalText', () => {
    const partial = {
      type: 'stream_event' as const,
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hello world' },
      },
    } as unknown as Parameters<typeof adaptPartialMessageToCollector>[0]

    const c = createCotTraceCollector()
    const consumed = adaptPartialMessageToCollector(partial, c)
    expect(consumed).toBe(true)

    // finalText 累积但不直接产生 trace point（要等 finalize 切分）
    expect(c.finalize().usedFallback).toBe(true)
  })

  it('content_block_delta 但 delta 不是 text_delta → 跳过', () => {
    const partial = {
      type: 'stream_event' as const,
      event: {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', text: '...' },
      },
    } as unknown as Parameters<typeof adaptPartialMessageToCollector>[0]

    const c = createCotTraceCollector()
    const consumed = adaptPartialMessageToCollector(partial, c)
    expect(consumed).toBe(false)
    expect(c.finalize().totalSteps).toBe(0)
  })

  it('非 content_block_delta 事件 → 跳过', () => {
    const partial = {
      type: 'stream_event' as const,
      event: { type: 'message_start' },
    } as unknown as Parameters<typeof adaptPartialMessageToCollector>[0]

    const c = createCotTraceCollector()
    const consumed = adaptPartialMessageToCollector(partial, c)
    expect(consumed).toBe(false)
  })

  it('多次流式 delta 累积 → finalize 时一次性切分', () => {
    const c = createCotTraceCollector()
    for (const delta of ['First sentence. ', 'Second sentence. ', 'Third one here.']) {
      const partial = {
        type: 'stream_event' as const,
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: delta } },
      } as unknown as Parameters<typeof adaptPartialMessageToCollector>[0]
      adaptPartialMessageToCollector(partial, c)
    }
    const r = c.finalize()
    expect(r.usedFallback).toBe(true)
    expect(r.totalSteps).toBeGreaterThanOrEqual(2)
  })
})

// ============================================================================
// SDK Adapter：extractThinkingBlocks / extractTextBlocks（纯函数）
// ============================================================================

describe('sdk-trace-adapter — 纯函数提取', () => {
  it('extractThinkingBlocks：只返回非空 thinking', () => {
    const sdkMsg = {
      message: {
        content: [
          { type: 'thinking', thinking: '  Real thinking text here.  ' },
          { type: 'thinking', thinking: '   ' }, // 空白
          { type: 'thinking' }, // 缺 thinking
          { type: 'text', text: 'final answer' },
        ],
      },
    } as unknown as Parameters<typeof extractThinkingBlocks>[0]

    const blocks = extractThinkingBlocks(sdkMsg)
    expect(blocks).toEqual(['Real thinking text here.'])
  })

  it('extractTextBlocks：拼接所有 text block', () => {
    const sdkMsg = {
      message: {
        content: [
          { type: 'text', text: 'First part. ' },
          { type: 'text', text: 'Second part. ' },
          { type: 'thinking', thinking: 'reasoning' },
          { type: 'tool_use' }, // 跳过
        ],
      },
    } as unknown as Parameters<typeof extractTextBlocks>[0]

    const text = extractTextBlocks(sdkMsg)
    expect(text).toBe('First part. Second part.')
  })

  it('extractTextBlocks：空内容返回空字符串', () => {
    const sdkMsg1 = { message: { content: [] } } as unknown as Parameters<typeof extractTextBlocks>[0]
    const sdkMsg2 = { message: {} } as unknown as Parameters<typeof extractTextBlocks>[0]
    expect(extractTextBlocks(sdkMsg1)).toBe('')
    expect(extractTextBlocks(sdkMsg2)).toBe('')
  })

  it('extractNumTurns：成功时返回 num_turns，错误时返回 -1', () => {
    const successResult = {
      type: 'result' as const,
      subtype: 'success' as const,
      num_turns: 5,
    } as unknown as Parameters<typeof extractNumTurns>[0]
    const errorResult = {
      type: 'result' as const,
      subtype: 'error_during_execution' as const,
    } as unknown as Parameters<typeof extractNumTurns>[0]

    expect(extractNumTurns(successResult)).toBe(5)
    expect(extractNumTurns(errorResult)).toBe(-1)
  })
})

// ============================================================================
// CotTraceCollector：recordTokenLogprobEntropies（v0.9.7 P3 M1 新增）
//
// 论文支撑：Zhao, X. 2026, arXiv:2603.18940 §3 — token-level answer-distribution
// entropy 比 text-Shannon entropy 更预测 LLM 推理可靠性。
//
// 测试目标：
// - 单 token / 多 token logprobs 都能记录为 trace points
// - 每个 token 算 1 个熵值（多 token → 多 trace point）
// - 边界：空 / 单元素 / 含非法值（NaN / -Infinity）→ 委托给 tokenLogprobShannonEntropy
// - 状态机：与 recordThinkingBlock / recordTurnText 共享 'recording' 状态
// - finalize 后抛错
// ============================================================================
describe('cot-trace-collector — recordTokenLogprobEntropies（v0.9.7 P3 M1）', () => {
  it('多 token logprobs → 每个 token 1 个 trace point（uniform=1）', () => {
    const c = createCotTraceCollector()
    // 3 个 token，每个 token 的 top-3 logprobs 均匀分布（logprob 相等）
    // → 归一化熵 ≈ 1（最大熵）
    c.recordTokenLogprobEntropies([
      [-1, -1, -1],
      [-0.5, -0.5, -0.5],
      [-2, -2, -2],
    ])
    const r = c.finalize()
    expect(r.collected).toBe(true)
    expect(r.totalSteps).toBe(3)
    // 每个 token 都是均匀分布 → 熵 = 1
    for (const h of r.trajectory) {
      expect(h).toBeCloseTo(1, 6)
    }
    expect(r.sourceBreakdown['turn-text']).toBe(3)
  })

  it('极度不均的 logprobs → 熵接近 0', () => {
    const c = createCotTraceCollector()
    // 1 个 token，独热：top-1 ≈ 0，其余 -Infinity → 委托给函数返回 0
    c.recordTokenLogprobEntropies([[0, -Infinity, -Infinity]])
    const r = c.finalize()
    expect(r.trajectory[0]).toBe(0)
  })

  it('混合：均匀 + 不均 token → 各算各的', () => {
    const c = createCotTraceCollector()
    c.recordTokenLogprobEntropies([
      [-1, -1, -1], // 均匀 → 1
      [0, -10, -10], // 独热 → ≈0
    ])
    const r = c.finalize()
    expect(r.totalSteps).toBe(2)
    expect(r.trajectory[0]).toBeCloseTo(1, 6)
    expect(r.trajectory[1]).toBeLessThan(0.05)
  })

  it('空数组 → 静默跳过（不抛错、不改 state）', () => {
    const c = createCotTraceCollector()
    c.recordTokenLogprobEntropies([])
    const r = c.finalize()
    expect(r.collected).toBe(false)
    expect(r.totalSteps).toBe(0)
  })

  it('非数组输入 → 静默跳过（防御性）', () => {
    const c = createCotTraceCollector()
    c.recordTokenLogprobEntropies(null as unknown as number[][])
    c.recordTokenLogprobEntropies(undefined as unknown as number[][])
    const r = c.finalize()
    expect(r.collected).toBe(false)
  })

  it('token 内含空数组 → 静默跳过该 token', () => {
    const c = createCotTraceCollector()
    c.recordTokenLogprobEntropies([
      [], // 跳过
      [-1, -1, -1], // 保留
      [], // 跳过
    ])
    const r = c.finalize()
    expect(r.totalSteps).toBe(1)
    expect(r.trajectory[0]).toBeCloseTo(1, 6)
  })

  it('含 NaN → tokenLogprobShannonEntropy 内部过滤', () => {
    const c = createCotTraceCollector()
    // [0, 0, NaN] 过滤后 [0, 0] → 均匀分布 → 归一化熵 = 1
    c.recordTokenLogprobEntropies([[0, 0, NaN]])
    const r = c.finalize()
    expect(r.totalSteps).toBe(1)
    expect(Number.isFinite(r.trajectory[0])).toBe(true)
    expect(r.trajectory[0]).toBeCloseTo(1, 6)
  })

  it('state 从 init → recording', () => {
    const c = createCotTraceCollector()
    c.recordTokenLogprobEntropies([[0, -0.5, -1]])
    const r = c.finalize()
    expect(r.collected).toBe(true)
  })

  it('finalize 后再调用 → 抛错', () => {
    const c = createCotTraceCollector()
    c.recordTokenLogprobEntropies([[0, -1]])
    c.finalize()
    expect(() => c.recordTokenLogprobEntropies([[0, -1]])).toThrow(/finalized/)
  })

  it('与 recordTurnText 互不冲突（都归到 turn-text）', () => {
    const c = createCotTraceCollector()
    c.recordTurnText('First turn.')
    c.recordTokenLogprobEntropies([[-1, -1]])
    const r = c.finalize()
    expect(r.totalSteps).toBe(2)
    expect(r.sourceBreakdown['turn-text']).toBe(2)
  })
})

// ============================================================================
// CotTraceCollector：4 优先级降级（v0.9.7 P3 M1 新增 logprobs 优先级）
//
// 论文支撑：Zhao 2026, arXiv:2603.18940 — token-level entropy 比 text-entropy 预测力更强
//
// 优先级：
// 1. thinking-block (Anthropic Claude with thinking) — 显式 reasoning 块
// 2. turn-text / logprobs (Reasoning model 多 turn + OpenAI 协议 logprobs 直采)
// 3. text-fallback (句子切分启发式)
//
// 互斥：一旦有 1+2 路径触发，fallback 不再切分 finalText
// ============================================================================
describe('cot-trace-collector — 4 优先级降级（v0.9.7 P3 M1 加 logprobs）', () => {
  it('thinking + logprobs 并存：fallback 仍被抑制（两者都不触发切分）', () => {
    const c = createCotTraceCollector()
    c.recordThinkingBlock('Step 1 reasoning.')
    // logprobs 也作为显式 trace 点 push（与 thinking-block 并存，不互斥）
    c.recordTokenLogprobEntropies([[-1, -1]])
    c.accumulateFinalText('A lot of fallback text. Multiple sentences here.')
    const r = c.finalize()
    expect(r.usedFallback).toBe(false)
    expect(r.totalSteps).toBe(2) // thinking + logprobs 都 push
    expect(r.sourceBreakdown['thinking-block']).toBe(1)
    expect(r.sourceBreakdown['turn-text']).toBe(1) // logprobs 归到 turn-text
    expect(r.sourceBreakdown['text-fallback']).toBe(0) // fallback 被抑制
  })

  it('优先级 2a: turn-text 优先于 logprobs（同 source，但先来先记）', () => {
    const c = createCotTraceCollector()
    c.recordTurnText('Turn 1 reasoning.')
    c.recordTokenLogprobEntropies([[-1, -1, -1]])
    const r = c.finalize()
    expect(r.usedFallback).toBe(false)
    expect(r.totalSteps).toBe(2)
    expect(r.sourceBreakdown['turn-text']).toBe(2)
  })

  it('优先级 2b: logprobs 触发 → 不进 fallback（即使有 finalText）', () => {
    const c = createCotTraceCollector()
    c.recordTokenLogprobEntropies([[-1, -1, -1]])
    c.accumulateFinalText('A lot of fallback text. Multiple sentences here. Even more.')
    const r = c.finalize()
    expect(r.usedFallback).toBe(false)
    expect(r.totalSteps).toBe(1)
    expect(r.sourceBreakdown['turn-text']).toBe(1)
    expect(r.sourceBreakdown['text-fallback']).toBe(0)
  })

  it('优先级 3: 无任何显式 trace → 仅 finalText 触发 fallback', () => {
    const c = createCotTraceCollector()
    c.recordTokenLogprobEntropies([]) // 空输入，state 不变
    c.accumulateFinalText('First sentence here. Second sentence here. Third one here. Fourth sentence here.')
    const r = c.finalize()
    expect(r.usedFallback).toBe(true)
    expect(r.totalSteps).toBeGreaterThan(1)
    expect(r.sourceBreakdown['text-fallback']).toBe(r.totalSteps)
  })

  it('Claude 兑底（anthropic / claude-sdk / google 不支持 logprobs）→ 走 text-fallback', () => {
    // 模拟 supervisor.ts 中 enableLogprobs=false 的情况：
    // - 不调用 recordTokenLogprobEntropies
    // - 仅调用 accumulateFinalText
    // - finalize 走 sentence-splitting fallback
    const c = createCotTraceCollector()
    c.accumulateFinalText('System CPU usage is high. Memory is at 80%. Disk I/O looks normal.')
    const r = c.finalize()
    expect(r.usedFallback).toBe(true)
    expect(r.totalSteps).toBeGreaterThanOrEqual(1)
    expect(r.sourceBreakdown['text-fallback']).toBeGreaterThan(0)
  })
})
