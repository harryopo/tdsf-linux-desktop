/**
 * 上下文窗口覆盖的判定（#91）
 *
 * 这个输入框 v2.11 被删过一次，理由是"全仓零消费者的假设置"。这次放回来的前提是
 * 消费者真的存在了（AI 面板徽章按 capabilities.contextWindow 算分母），
 * 所以判据也要钉住两件事：填错要拦住，不该覆盖时不许偷偷造一份能力声明。
 */
import { describe, it, expect } from 'vitest'
import {
  MIN_CONTEXT_WINDOW,
  validateContextWindow,
  withContextWindow,
} from '@renderer/components/settings/model/provider-capability-override'

const caps = {
  streaming: true,
  toolCall: true,
  vision: false,
  contextWindow: 64_000,
  logprobs: true,
}

describe('validateContextWindow', () => {
  it('0 表示未知/不覆盖，合法', () => {
    expect(validateContextWindow(0)).toBeNull()
  })

  it('不小于下限的整数合法', () => {
    expect(validateContextWindow(MIN_CONTEXT_WINDOW)).toBeNull()
    expect(validateContextWindow(1_000_000)).toBeNull()
  })

  it('小于下限要拒绝（这种分母会让徽章百分比失真）', () => {
    expect(validateContextWindow(MIN_CONTEXT_WINDOW - 1)).toMatch(/不小于 1024/)
    expect(validateContextWindow(-8000)).toMatch(/不小于 1024/)
  })

  it('非整数与非数字要拒绝，且提示能指到问题', () => {
    expect(validateContextWindow(64_000.5)).toMatch(/整数/)
    expect(validateContextWindow(Number.NaN)).toMatch(/数字/)
  })
})

describe('withContextWindow', () => {
  it('填了值只改 contextWindow，其余能力原样带回去', () => {
    expect(withContextWindow({ capabilities: caps }, 131_072)).toEqual({
      ...caps,
      contextWindow: 131_072,
    })
  })

  it('填 0 不覆盖，返回的能力声明与进来时一致', () => {
    expect(withContextWindow({ capabilities: caps }, 0)).toEqual(caps)
  })

  it('目标本来没有能力声明时不凭空造一份（一半字段是猜的）', () => {
    expect(withContextWindow({ capabilities: undefined }, 131_072)).toBeUndefined()
  })
})
