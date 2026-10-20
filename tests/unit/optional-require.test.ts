/**
 * 可选依赖加载器的边界（#164）
 *
 * 这个 helper 存在的前提是：原生依赖可能没装/ABI 不符，不能让主进程起不来。
 * 但它只该接住"依赖不可用"，不该把传错路径这类编程错误也伪装成"没装"——
 * 相对路径在打包产物里会按 out/main 解析，正是 token-stats 之前静默失效的病根。
 */
import { describe, it, expect } from 'vitest'
import { optionalRequire } from '../../src/main/core/optional-require'

describe('optionalRequire', () => {
  it('裸包名正常加载', () => {
    const r = optionalRequire<typeof import('node:path')>('node:path')
    expect(r.mod).not.toBeNull()
    expect(r.error).toBeNull()
  })

  it('包不存在时返回原因，不抛错', () => {
    const r = optionalRequire('tdsf-definitely-not-installed')
    expect(r.mod).toBeNull()
    expect(r.error).toContain('tdsf-definitely-not-installed')
  })

  it('相对/绝对路径直接抛错，别伪装成"可选依赖缺失"', () => {
    expect(() => optionalRequire('./x')).toThrow(/只接受包名/)
    expect(() => optionalRequire('../services/x')).toThrow(/只接受包名/)
    expect(() => optionalRequire('/abs/x')).toThrow(/只接受包名/)
    expect(() => optionalRequire('C:\\x')).toThrow(/只接受包名/)
  })
})
