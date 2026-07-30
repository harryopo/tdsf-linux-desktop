/**
 * deepseek-reasoning-transform 单测（v2.11 修复"深度思考看不到"）
 *
 * 锁死 reasoning_content → <think>…</think> 包裹逻辑：
 * @ai-sdk/openai 不读 reasoning_content, 故 fetch 层先包 <think>, 中间件再提取回 reasoning。
 * 若本转换回归, 所有 deep 对话的思考展示都会失效。
 */
import { describe, it, expect } from 'vitest'
import {
  createReasoningTagState,
  rewriteReasoningChunk,
  rewriteSseLine,
} from '../../src/main/core/agent/providers/deepseek-reasoning-transform'

/** 构造一个 chat.completion.chunk 对象 */
function chunk(delta: Record<string, unknown>) {
  return { choices: [{ delta }] }
}

describe('rewriteReasoningChunk', () => {
  it('首个 reasoning_content 增量前置 <think> 并移入 content', () => {
    const s = createReasoningTagState()
    const r = rewriteReasoningChunk(chunk({ reasoning_content: '先看内存' }), s) as ReturnType<typeof chunk>
    expect(r.choices[0].delta).toEqual({ content: '<think>先看内存' })
    expect(s.open).toBe(true)
  })

  it('后续 reasoning 增量不再加 <think>', () => {
    const s = createReasoningTagState()
    rewriteReasoningChunk(chunk({ reasoning_content: 'A' }), s)
    const r = rewriteReasoningChunk(chunk({ reasoning_content: 'B' }), s) as ReturnType<typeof chunk>
    expect(r.choices[0].delta).toEqual({ content: 'B' })
  })

  it('推理结束后首个正文 content 前置 </think> 闭合', () => {
    const s = createReasoningTagState()
    rewriteReasoningChunk(chunk({ reasoning_content: '思考' }), s)
    const r = rewriteReasoningChunk(chunk({ content: '答案' }), s) as ReturnType<typeof chunk>
    expect(r.choices[0].delta.content).toBe('</think>答案')
    expect(s.closed).toBe(true)
    expect(s.open).toBe(false)
  })

  it('结束帧（空 delta）也闭合未关的 <think>', () => {
    const s = createReasoningTagState()
    rewriteReasoningChunk(chunk({ reasoning_content: '仅思考无正文' }), s)
    const r = rewriteReasoningChunk(chunk({}), s) as ReturnType<typeof chunk>
    expect(r.choices[0].delta.content).toBe('</think>')
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
  it('data 行的 reasoning_content 被改写为 <think> content', () => {
    const s = createReasoningTagState()
    const out = rewriteSseLine('data: {"choices":[{"delta":{"reasoning_content":"想一下"}}]}', s)
    expect(out).toContain('<think>想一下')
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
    expect(l1).toContain('<think>分析')
    expect(l2).toContain('</think>结论')
  })
})
