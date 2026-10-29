/**
 * deepseek-reasoning-transform 单测（v2.11 修复"深度思考看不到"）
 *
 * 锁死 reasoning_content → <REASONING_TAG>…</REASONING_TAG> 包裹逻辑：
 * @ai-sdk/openai 不读 reasoning_content, 故 fetch 层先包罕见标签, 中间件再提取回 reasoning。
 * 标签名从实现里 import 常量用，不在此重抄一份（#90：改名要一处改完）。
 * 若本转换回归, 所有开了思考的对话展示都会失效。
 */
import { describe, it, expect } from 'vitest'
import {
  REASONING_TAG,
  createReasoningTagState,
  injectReasoningContent,
  rewriteReasoningChunk,
  rewriteSseLine,
} from '../../src/main/core/agent/providers/deepseek-reasoning-transform'

/** 构造一个 chat.completion.chunk 对象 */
function chunk(delta: Record<string, unknown>) {
  return { choices: [{ delta }] }
}

describe('rewriteReasoningChunk', () => {
  it('首个 reasoning_content 增量前置推理标签并移入 content', () => {
    const s = createReasoningTagState()
    const r = rewriteReasoningChunk(chunk({ reasoning_content: '先看内存' }), s) as ReturnType<typeof chunk>
    expect(r.choices[0].delta).toEqual({ content: `<${REASONING_TAG}>先看内存` })
    expect(s.open).toBe(true)
  })

  it('后续 reasoning 增量不再加开标签', () => {
    const s = createReasoningTagState()
    rewriteReasoningChunk(chunk({ reasoning_content: 'A' }), s)
    const r = rewriteReasoningChunk(chunk({ reasoning_content: 'B' }), s) as ReturnType<typeof chunk>
    expect(r.choices[0].delta).toEqual({ content: 'B' })
  })

  it('推理结束后首个正文 content 前置闭标签', () => {
    const s = createReasoningTagState()
    rewriteReasoningChunk(chunk({ reasoning_content: '思考' }), s)
    const r = rewriteReasoningChunk(chunk({ content: '答案' }), s) as ReturnType<typeof chunk>
    expect(r.choices[0].delta.content).toBe(`</${REASONING_TAG}>答案`)
    expect(s.closed).toBe(true)
    expect(s.open).toBe(false)
  })

  it('结束帧（空 delta）也闭合未关的标签', () => {
    const s = createReasoningTagState()
    rewriteReasoningChunk(chunk({ reasoning_content: '仅思考无正文' }), s)
    const r = rewriteReasoningChunk(chunk({}), s) as ReturnType<typeof chunk>
    expect(r.choices[0].delta.content).toBe(`</${REASONING_TAG}>`)
    expect(s.closed).toBe(true)
  })

  it('闭合后正文增量不再改动', () => {
    const s = createReasoningTagState()
    rewriteReasoningChunk(chunk({ reasoning_content: 'x' }), s)
    rewriteReasoningChunk(chunk({ content: 'a' }), s)
    const r = rewriteReasoningChunk(chunk({ content: 'b' }), s) as ReturnType<typeof chunk>
    expect(r.choices[0].delta.content).toBe('b')
  })

  it('纯正文对话（无 reasoning）完全不改动', () => {
    const s = createReasoningTagState()
    const r = rewriteReasoningChunk(chunk({ content: '普通回答' }), s) as ReturnType<typeof chunk>
    expect(r.choices[0].delta).toEqual({ content: '普通回答' })
    expect(s.open).toBe(false)
    expect(s.closed).toBe(false)
  })

  it('无 choices/delta 的对象安全返回', () => {
    const s = createReasoningTagState()
    expect(rewriteReasoningChunk({}, s)).toEqual({})
    expect(rewriteReasoningChunk({ choices: [] }, s)).toEqual({ choices: [] })
  })
})

describe('rewriteSseLine', () => {
  it('data 行的 reasoning_content 被改写进 content 并带标签', () => {
    const s = createReasoningTagState()
    const out = rewriteSseLine('data: {"choices":[{"delta":{"reasoning_content":"想一下"}}]}', s)
    expect(out).toContain(`<${REASONING_TAG}>想一下`)
    expect(out).not.toContain('reasoning_content')
    expect(out.startsWith('data: ')).toBe(true)
  })

  it('[DONE] 行原样透传', () => {
    const s = createReasoningTagState()
    expect(rewriteSseLine('data: [DONE]', s)).toBe('data: [DONE]')
  })

  it('空行原样透传', () => {
    const s = createReasoningTagState()
    expect(rewriteSseLine('', s)).toBe('')
  })

  it('非 JSON data 行原样透传（不抛异常）', () => {
    const s = createReasoningTagState()
    expect(rewriteSseLine('data: not-json', s)).toBe('data: not-json')
  })

  it('完整思考→正文序列跨行闭合正确', () => {
    const s = createReasoningTagState()
    const l1 = rewriteSseLine('data: {"choices":[{"delta":{"reasoning_content":"分析"}}]}', s)
    const l2 = rewriteSseLine('data: {"choices":[{"delta":{"content":"结论"}}]}', s)
    expect(l1).toContain(`<${REASONING_TAG}>分析`)
    expect(l2).toContain(`</${REASONING_TAG}>结论`)
  })
})

/**
 * DeepSeek 思考模式 + 工具调用：带 tool_calls 的 assistant 消息必须把
 * reasoning_content 原样带回去，否则整轮 400。判据必须能分开"补对了"与"全没补"。
 */
describe('injectReasoningContent（思考模式回传）', () => {
  function payload(messages: Array<Record<string, unknown>>) {
    return { messages } as Record<string, unknown>
  }

  it('第一条带 tool_calls 的 assistant 拿到第一段推理', () => {
    const p = payload([
      { role: 'user', content: '查磁盘' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'ssh_readonly', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'out' },
    ])
    expect(injectReasoningContent(p, ['先看 df'])).toBe(true)
    const assistant = (p.messages as Array<Record<string, unknown>>)[1]
    expect(assistant.reasoning_content).toBe('先看 df')
  })

  it('多步工具调用按顺序对齐（第 k 条 ↔ 第 k 段推理）', () => {
    const p = payload([
      { role: 'assistant', tool_calls: [{ id: 'c1' }], content: '' },
      { role: 'tool', tool_call_id: 'c1', content: 'a' },
      { role: 'assistant', tool_calls: [{ id: 'c2' }], content: '' },
      { role: 'tool', tool_call_id: 'c2', content: 'b' },
    ])
    injectReasoningContent(p, ['推理一', '推理二'])
    const msgs = p.messages as Array<Record<string, unknown>>
    expect(msgs[0].reasoning_content).toBe('推理一')
    expect(msgs[2].reasoning_content).toBe('推理二')
  })

  it('不带 tool_calls 的 assistant 不塞 reasoning_content（DeepSeek 只在工具轮要求）', () => {
    const p = payload([
      { role: 'assistant', content: '上一轮的最终回答' },
      { role: 'user', content: '继续' },
    ])
    expect(injectReasoningContent(p, ['不该出现'])).toBe(false)
    expect((p.messages as Array<Record<string, unknown>>)[0].reasoning_content).toBeUndefined()
  })

  it('已有 reasoning_content 的消息不被覆盖', () => {
    const p = payload([
      { role: 'assistant', tool_calls: [{ id: 'c1' }], content: '', reasoning_content: '原始推理' },
    ])
    expect(injectReasoningContent(p, ['别处来的'])).toBe(false)
    expect((p.messages as Array<Record<string, unknown>>)[0].reasoning_content).toBe('原始推理')
  })

  it('没捕获到任何推理时不改 payload（普通轮次零副作用）', () => {
    const p = payload([{ role: 'assistant', tool_calls: [{ id: 'c1' }], content: '' }])
    expect(injectReasoningContent(p, [])).toBe(false)
  })

  it('改写流时会累计推理原文（供下一轮回传）', () => {
    const s = createReasoningTagState()
    rewriteSseLine('data: {"choices":[{"delta":{"reasoning_content":"第一段"}}]}', s)
    rewriteSseLine('data: {"choices":[{"delta":{"reasoning_content":"第二段"}}]}', s)
    expect(s.reasoning).toBe('第一段第二段')
  })
})
