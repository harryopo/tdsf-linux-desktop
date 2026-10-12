/**
 * AI 对话输入框那个模型选择器该列谁、默认选谁
 *
 * 用户原话："关于模型部分不需要弹出那么多，只弹出来已经配置的，没有的就删去"。
 * 之前是 providerList(true) 把全部**启用的内置模板**都拉下来，再在 UI 里把没配 Key 的
 * 画成灰色不可点 —— 一屏十来个灰条目，既难读也没有可点的。改成进选择器之前先按
 * "能不能真用"过滤，只剩一条都算过滤成功，一条不剩就走空态去设置。
 *
 * 第二个洞：默认选中原来取 list[0].id，等于忽略用户在设置里定的默认 Provider。
 * 优先级改成：仍可用的当前选择 → 用户设的默认 → 第一个可用。
 */
import { describe, it, expect } from 'vitest'
import { usableProviders, resolveSelectedProvider } from '@renderer/components/workbench/provider-choice'
import type { PersistedProviderConfig } from '@shared/agent-types'

function p(id: string, hasApiKey: boolean | undefined, enabled = true): PersistedProviderConfig {
  return {
    id,
    name: id,
    type: 'openai-compatible',
    baseURL: 'https://x.example/v1',
    model: `${id}-model`,
    builtin: true,
    enabled,
    hasApiKey,
  } as unknown as PersistedProviderConfig
}

const KEYED = [p('deepseek', true), p('qwen', true), p('kimi', false), p('glm', false)]

describe('usableProviders', () => {
  it('只留有 Key 的，顺序按原表不变', () => {
    expect(usableProviders(KEYED).map((x) => x.id)).toEqual(['deepseek', 'qwen'])
  })

  it('hasApiKey 缺失（老数据没这个字段）不当成"不可用"直接抹掉', () => {
    const list = [p('legacy-user-added', undefined)]
    expect(usableProviders(list).map((x) => x.id)).toEqual(['legacy-user-added'])
  })

  it('阴性对照：全没配 Key 时返回空表（不是"返回原表"）', () => {
    expect(usableProviders([p('a', false), p('b', false)])).toEqual([])
    expect(usableProviders([])).toEqual([])
  })
})

describe('resolveSelectedProvider', () => {
  it('当前选择仍可用就保持不变（不要每次刷新都跳回第一个）', () => {
    expect(
      resolveSelectedProvider({ providers: KEYED, current: 'qwen', defaultId: 'deepseek' }),
    ).toBe('qwen')
  })

  it('当前选择不可用或不存在时，用用户设的默认', () => {
    expect(
      resolveSelectedProvider({ providers: KEYED, current: 'kimi', defaultId: 'deepseek' }),
    ).toBe('deepseek')
    expect(
      resolveSelectedProvider({ providers: KEYED, current: null, defaultId: 'qwen' }),
    ).toBe('qwen')
  })

  it('默认也没配 Key 时退到第一个可用的（不是 null，也不是不可用的那条）', () => {
    const list = [p('kimi', false), p('glm', false), p('deepseek', true)]
    expect(resolveSelectedProvider({ providers: list, current: null, defaultId: 'kimi' })).toBe(
      'deepseek',
    )
  })

  it('一条都不可用时返回 null，交给空态而不是硬选一个跑不通的', () => {
    expect(
      resolveSelectedProvider({ providers: [p('a', false)], current: null, defaultId: 'a' }),
    ).toBeNull()
  })

  it('默认 ID 指向已从模板表退役的条目时不崩（返回可用首条）', () => {
    expect(
      resolveSelectedProvider({ providers: KEYED, current: null, defaultId: 'claude-sonnet-4-5' }),
    ).toBe('deepseek')
  })
})
