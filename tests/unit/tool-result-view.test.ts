/**
 * 工具返回体 → 界面卡片字段的映射判据
 *
 * 钉三件事：
 *   1. 条数只来自工具自己报的 count。0 也要原样传下去（"无结果"是真结论），
 *      乱填的负数 / NaN / 字符串一律不算，免得界面显示一个没依据的数字。
 *   2. 输出文本的取用顺序（error → stdout → summary → JSON）不能漂：
 *      漂了就是把失败当成功显示，或把 stdout 丢掉。
 *   3. 工具明确给 error 时，即使它自己写了 ok:true，也按失败算。
 */
import { describe, it, expect } from 'vitest'
import { toToolResultView } from '@main/core/agent/tool-result-view'

describe('toToolResultView', () => {
  it('检索类：count 与 summary 都取到', () => {
    const v = toToolResultView({ ok: true, count: 2, summary: '1. a\n2. b' })
    expect(v).toEqual({ ok: true, output: '1. a\n2. b', count: 2 })
  })

  it('零条命中要保留 count:0（界面据此才能说实话"无结果"）', () => {
    const v = toToolResultView({ ok: true, count: 0, summary: '未找到相关条目' })
    expect(v.count, 'count 丢了界面就只能显示"完成"，把有依据的结论也说不出口').toBe(0)
  })

  it('非检索类没有 count 字段 → 不编一个出来', () => {
    const v = toToolResultView({ ok: true, summary: '决策 ai-plus | 关键词命中' })
    expect(v.count).toBeUndefined()
    expect(v.ok).toBe(true)
  })

  it('乱填的条数不算数：负数 / NaN / 小数以外的类型一律丢弃', () => {
    expect(toToolResultView({ count: -1, summary: 'x' }).count).toBeUndefined()
    expect(toToolResultView({ count: Number.NaN, summary: 'x' }).count).toBeUndefined()
    expect(toToolResultView({ count: Number.POSITIVE_INFINITY, summary: 'x' }).count).toBeUndefined()
    expect(toToolResultView({ count: '3', summary: 'x' }).count).toBeUndefined()
    // 小数取整，界面上不出现 2.5 条这种读数
    expect(toToolResultView({ count: 2.7, summary: 'x' }).count).toBe(2)
  })

  it('命令类取 stdout，stdout 空时退回 stderr', () => {
    expect(toToolResultView({ stdout: 'Filesystem 40G', stderr: '' }).output).toBe('Filesystem 40G')
    expect(toToolResultView({ stdout: '', stderr: 'no such file' }).output).toBe('no such file')
  })

  it('有 error 就按失败算，哪怕工具自己写了 ok:true', () => {
    const v = toToolResultView({ ok: true, error: '命令被风险拦截' })
    expect(v.ok).toBe(false)
    expect(v.output).toBe('命令被风险拦截')
  })

  it('字符串返回体原样显示；其它对象兜底成 JSON，不显示 [object Object]', () => {
    expect(toToolResultView('纯文本').output).toBe('纯文本')
    const v = toToolResultView({ nested: { a: 1 } })
    expect(v.output).toContain('"a":1')
    expect(v.ok).toBe(true)
  })

  it('undefined / null 返回体不炸，输出空串', () => {
    expect(toToolResultView(undefined)).toEqual({ ok: true, output: '' })
    expect(toToolResultView(null)).toEqual({ ok: true, output: '' })
  })
})
