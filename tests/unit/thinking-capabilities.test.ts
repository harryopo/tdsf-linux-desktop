/**
 * 「模型能力 → 可用思考档位」纯函数判据
 *
 * 依据：主进程只有 `config.type === 'deepseek'` 时才往请求体注入
 * `thinking: { type: enabled|disabled }`（provider-factory），
 * `ProviderCapabilities` 里并没有 reasoning/thinking 字段可读。
 * 所以界面按"Provider 类型 + 模型名白名单"给档位，未知模型一律当不支持，
 * 宁可少给，也不能给一个拨了没用的选择器。
 */
import { describe, it, expect } from 'vitest'
import {
  resolveThinkingCapability,
  THINKING_UNSUPPORTED_NOTICE,
} from '@renderer/components/settings/model/thinking-capabilities'

describe('resolveThinkingCapability — 支持的模型', () => {
  it('DeepSeek 现役模型给三档：标准/自动/深度，且每档都有中文说明', () => {
    const cap = resolveThinkingCapability({ providerType: 'deepseek', model: 'deepseek-v4-pro' })
    expect(cap.supported).toBe(true)
    expect(cap.notice).toBe('')
    expect(cap.options.map((o) => o.value)).toEqual(['standard', 'auto', 'deep'])
    expect(cap.options.map((o) => o.label)).toEqual(['标准', '自动', '深度'])
    for (const option of cap.options) {
      expect(option.desc.length).toBeGreaterThan(0)
    }
  })

  it('deepseek-flash / deepseek-reasoner / deepseek-r1 同样命中白名单', () => {
    for (const model of ['deepseek-flash', 'deepseek-reasoner', 'deepseek-r1']) {
      const cap = resolveThinkingCapability({ providerType: 'deepseek', model })
      expect(cap.supported, model).toBe(true)
      expect(cap.options).toHaveLength(3)
    }
  })

  it('返回的是副本：调用方改选项不会污染下一次结果', () => {
    const first = resolveThinkingCapability({ providerType: 'deepseek', model: 'deepseek-flash' })
    first.options[0].label = '被改了'
    const second = resolveThinkingCapability({ providerType: 'deepseek', model: 'deepseek-flash' })
    expect(second.options[0].label).toBe('标准')
  })
})

describe('resolveThinkingCapability — 明确不支持的模型', () => {
  it('非 DeepSeek Provider 一律不支持（运行时不会注入 thinking 开关）', () => {
    const cases = [
      { providerType: 'qwen' as const, model: 'qwen3.8-max' },
      { providerType: 'anthropic' as const, model: 'claude-sonnet-5-5' },
      { providerType: 'google' as const, model: 'gemini-4-argon' },
      { providerType: 'openai-compatible' as const, model: 'kimi-k3.1-pro' },
    ]
    for (const input of cases) {
      const cap = resolveThinkingCapability(input)
      expect(cap.supported, input.model).toBe(false)
      expect(cap.options).toEqual([])
      expect(cap.notice).toBe(THINKING_UNSUPPORTED_NOTICE)
    }
  })

  it('DeepSeek 类型但模型名不像思考模型时也不给档位', () => {
    const cap = resolveThinkingCapability({ providerType: 'deepseek', model: 'some-embedding-model' })
    expect(cap.supported).toBe(false)
    expect(cap.notice).toBe('该模型不支持思考强度设置')
  })
})

describe('resolveThinkingCapability — 未知模型', () => {
  it('DeepSeek 类型下的未知型号按"不支持"处理，不猜能力', () => {
    const cap = resolveThinkingCapability({ providerType: 'deepseek', model: 'deepseek-nebula-9' })
    expect(cap.supported).toBe(false)
    expect(cap.options).toEqual([])
    expect(cap.notice).toBe(THINKING_UNSUPPORTED_NOTICE)
  })

  it('模型为空 / 只有空白 / Provider 类型缺失时都不崩，返回不支持', () => {
    expect(resolveThinkingCapability({ providerType: 'deepseek', model: '' }).supported).toBe(false)
    expect(resolveThinkingCapability({ providerType: 'deepseek', model: '   ' }).supported).toBe(false)
    expect(resolveThinkingCapability({ model: 'deepseek-flash' }).supported).toBe(false)
    expect(resolveThinkingCapability({}).supported).toBe(false)
  })
})
