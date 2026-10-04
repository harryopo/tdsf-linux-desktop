/**
 * known_hosts 主机名模式匹配单元测试（A3b）
 *
 * 语义基准：OpenSSH ssh_config(5) 的 pattern-list —— `*` 通配、`?` 单字符、
 * `!` 否定优先排除；以及"先删旧行再追加"这条不变量（主力项目红线 12）。
 */
import { describe, it, expect } from 'vitest'
import { hostPatternMatches } from '../../src/main/services/ssh/known-hosts'

describe('hostPatternMatches — 明文与通配', () => {
  it('完全相等命中（大小写不敏感）', () => {
    expect(hostPatternMatches('example.com', 'example.com')).toBe(true)
    expect(hostPatternMatches('Example.COM', 'example.com')).toBe(true)
  })
  it('不命中时返回 false', () => {
    expect(hostPatternMatches('other.com', 'example.com')).toBe(false)
  })
  it('`*` 前缀通配命中', () => {
    expect(hostPatternMatches('*.example.com', 'host.example.com')).toBe(true)
    expect(hostPatternMatches('*.example.com', 'a.b.example.com')).toBe(true)
  })
  it('`*` 通配不误伤别的域', () => {
    expect(hostPatternMatches('*.example.com', 'evil-example.com')).toBe(false)
    expect(hostPatternMatches('*.example.com', 'example.com')).toBe(false)
  })
  it('`?` 单字符', () => {
    expect(hostPatternMatches('web?.example.com', 'web1.example.com')).toBe(true)
    expect(hostPatternMatches('web?.example.com', 'web12.example.com')).toBe(false)
  })
  it('正则元字符不被当成模式', () => {
    expect(hostPatternMatches('a+b.example.com', 'a+b.example.com')).toBe(true)
    expect(hostPatternMatches('a.b', 'axb')).toBe(false)
  })
})

describe('hostPatternMatches — 逗号列表与否定', () => {
  it('逗号列表任一命中', () => {
    expect(hostPatternMatches('one.com,two.com', 'two.com')).toBe(true)
    expect(hostPatternMatches('one.com,two.com', 'three.com')).toBe(false)
  })
  it('`!` 否定优先排除', () => {
    expect(hostPatternMatches('*.example.com,!bad.example.com', 'bad.example.com')).toBe(false)
    expect(hostPatternMatches('*.example.com,!bad.example.com', 'good.example.com')).toBe(true)
  })
  it('只有否定项时按"该行不适用"处理（宁可多问一次）', () => {
    expect(hostPatternMatches('!bad.example.com', 'other.example.com')).toBe(false)
  })
  it('空片段被忽略', () => {
    expect(hostPatternMatches('a.com,,', 'a.com')).toBe(true)
  })
})
