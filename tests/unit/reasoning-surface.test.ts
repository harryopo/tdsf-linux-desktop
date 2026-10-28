/**
 * 思考链在兼容端能不能被看见（#90）
 *
 * 一条链上有两个人：fetch 层把 reasoning_content 包成标签，中间件按标签名把它提取回
 * reasoning 分片。两边名字必须一模一样，否则要么思考整段丢掉（旧行为：只有
 * deepseek+deep 档做了这套），要么标签以字面文本留在答案里（包了却没提取）。
 * 所以这里钉三件事：参与的端点、名字同源、标签足够罕见。
 */
import { describe, it, expect } from 'vitest'
import {
  createReasoningTagState,
  rewriteReasoningChunk,
  REASONING_TAG,
} from '../../src/main/core/agent/providers/deepseek-reasoning-transform'
import { reasoningExtractionTag } from '../../src/main/core/agent/providers/provider-factory'
import type { ProviderType } from '../../src/main/core/agent/providers/types'

describe('哪些端点参与思考链提取', () => {
  it('OpenAI 兼容协议族全部参与（不再只限 deepseek+deep）', () => {
    for (const type of ['deepseek', 'qwen', 'volcengine-ark', 'openai-compatible'] as ProviderType[]) {
      expect(reasoningExtractionTag(type), `${type} 的思考在 reasoning_content 里，不提取就看不见`).toBe(REASONING_TAG)
    }
  })

  it('anthropic / google 不参与（它们的 SDK 本来就发标准 reasoning 分片）', () => {
    expect(reasoningExtractionTag('anthropic')).toBeNull()
    expect(reasoningExtractionTag('google')).toBeNull()
  })
})

describe('标签名同源', () => {
  it('fetch 层包出来的标签，就是中间件要提取的那个', () => {
    const state = createReasoningTagState()
    const out = rewriteReasoningChunk({ choices: [{ delta: { reasoning_content: '先看内存' } }] }, state) as {
      choices: Array<{ delta: { content?: string } }>
    }
    expect(out.choices[0].delta.content).toBe(`<${REASONING_TAG}>先看内存`)
    expect(reasoningExtractionTag('qwen')).toBe(REASONING_TAG)
  })

  it('标签刻意避开 <think> 这种常见写法（模型在正文里写出它会撞车）', () => {
    expect(REASONING_TAG).not.toBe('think')
    expect(REASONING_TAG.length).toBeGreaterThan(4)
  })
})
