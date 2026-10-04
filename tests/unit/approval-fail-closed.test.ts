/**
 * 审批判定表驱动测试（D2：审批 fail-closed）
 *
 * 判据来源：计划 §D2 "只有字面 true 算批准；字符串 'true'/数字 1/缺字段/
 * 畸形 JSON/超时/异常 全部拒"。
 * 这里覆盖的是纯判定函数；五个 IPC 审批入口都走它，所以入口侧不需要
 * 各写一份断言 —— 但要防的就是有人以后又在本地写一个 if (approved)。
 */
import { describe, it, expect } from 'vitest'
import {
  isApprovedValue,
  readApproval,
  readRemember,
} from '../../src/main/core/security/approval'

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

describe('readApproval — 对象形状（llm:tool-approve / task:permission-approve）', () => {
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

describe('readRemember — 记住决策同样只认字面 true', () => {
  it('remember 会被持久化成自动放行规则，宽松真值等于留永久后门', () => {
    expect(readRemember({ remember: true })).toBe(true)
    expect(readRemember({ remember: 'true' })).toBe(false)
    expect(readRemember({ remember: 1 })).toBe(false)
    expect(readRemember({})).toBe(false)
    expect(readRemember(null)).toBe(false)
    expect(readRemember(true)).toBe(false) // 裸布尔没有 remember 字段
  })
})

describe('isApprovedValue', () => {
  it('与 readApproval 对裸布尔的判定一致', () => {
    expect(isApprovedValue(true)).toBe(true)
    expect(isApprovedValue(false)).toBe(false)
    for (const [label, raw] of MUST_DENY) {
      expect(isApprovedValue(raw), label).toBe(false)
    }
  })
})
