/**
 * 审批判定表驱动测试（D2：审批 fail-closed）
 *
 * 判据来源：计划 §D2 "只有字面 true 算批准；字符串 'true'/数字 1/缺字段/
 * 畸形 JSON/超时/异常 全部拒"。
 * 这里覆盖的是纯判定函数本身。至于"每个审批入口是不是真的都走了它"——那是另一条闸，
 * 见 approval-entry-surface.test.ts（按通道清单反查注册文件）。
 * 这条测试曾经配着一句"入口都走它"的注释而无人验证，当年多出来的那条 agent:confirm（#195 已整删）
 * 就是这么漏掉的，所以现在把那句话从注释挪进了可判红的断言里。
 *
 * 2026-10-20 这一份里原本还有两组用例（`isApprovedValue`、`readRemember`），跟着被测函数一起删了。
 * 删的原因值得记住：**那两个函数只有测试在调，生产代码零调用者**，
 * 而 `readRemember` 的注释写着"会被持久化成自动放行规则"——全仓没有任何界面或载荷带 remember 字段。
 * 「动作有测试没生产」在死代码闸上是不报的（exports 档只打印不拦，为了不罚"为了测试而导出"），
 * 所以这类东西只能靠读注释的人发现。判据见 docs/长期优化目标.md §五。
 */
import { describe, it, expect } from 'vitest'
import { readApproval } from '../../src/main/core/security/approval'

/** 一律算"拒绝"的畸形批准位 */
const MUST_DENY: Array<[string, unknown]> = [
  ['字符串 true', 'true'],
  ['字符串 TRUE', 'TRUE'],
  ['字符串 yes', 'yes'],
  ['数字 1', 1],
  ['数字 0', 0],
  ['对象 {}', {}],
  ['数组 []', []],
  ['null', null],
  ['undefined', undefined],
  ['空字符串', ''],
  ['NaN', Number.NaN],
  ['布尔字符串包装', new Boolean(true)], // eslint-disable-line no-new-wrappers
]

describe('readApproval — 裸布尔形状（paor / sandbox / loop 三个入口）', () => {
  it('只有字面 true 通过', () => {
    expect(readApproval(true)).toBe(true)
  })

  it('false 与一切畸形值都拒绝', () => {
    expect(readApproval(false)).toBe(false)
    for (const [label, raw] of MUST_DENY) {
      expect(readApproval(raw), `裸值 ${label} 被判成批准`).toBe(false)
    }
  })
})

describe('readApproval — 对象形状（载荷里带 approved 字段的那几个入口）', () => {
  it('approved 必须是字面 true', () => {
    expect(readApproval({ approved: true })).toBe(true)
  })

  it('approved 字段上的畸形值一律拒绝', () => {
    for (const [label, value] of MUST_DENY) {
      expect(readApproval({ approved: value }), `approved=${label} 被判成批准`).toBe(false)
    }
  })

  it('缺 approved 字段 / 载荷不是对象 → 拒绝', () => {
    expect(readApproval({})).toBe(false)
    expect(readApproval({ approve: true })).toBe(false) // 字段名写错也不能算批
    expect(readApproval(null)).toBe(false)
    expect(readApproval('"true"')).toBe(false) // 整段 JSON 字符串没 parse
  })
})
