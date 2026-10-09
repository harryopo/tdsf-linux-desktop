/**
 * Markdown 链接协议白名单（2026-10-09 安全审查 S3 / P1-11）
 *
 * 链接文本的三个来源——LLM 回复、知识库条目、爬虫结果——都是"别人写的字"。
 * 白名单按 `new URL()` 解析后的 protocol 判定，不用字符串前缀黑名单：
 * 浏览器解析 href 前会剥掉前导空白与控制字符，`java\nscript:` 这类写法
 * 恰好从黑名单正则的缝里过去。
 */
import { describe, it, expect } from 'vitest'
import { safeMarkdownHref } from '../../src/renderer/src/components/workbench/panels/markdown-links'

describe('markdown 链接协议白名单', () => {
  it('非 http/https 一律不给 href', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      ' data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'file:///C:/Windows/System32/calc.exe',
      'vbscript:msgbox(1)',
      'wt-cli://cmd',
      'feed:https://x',
      '/relative/path',
      'mailto:a@b.c',
      '',
      '   ',
      'not a url',
    ]) {
      expect(safeMarkdownHref(bad), JSON.stringify(bad)).toBeNull()
    }
  })

  it('阴性对照：正常 http/https 链接照常可点（白名单不是把链接全杀了）', () => {
    expect(safeMarkdownHref('https://www.debian.org/doc/')).toBe('https://www.debian.org/doc/')
    expect(safeMarkdownHref('http://10.0.0.5/status')).toBe('http://10.0.0.5/status')
  })

  it('大小写与首尾空白不影响判定', () => {
    expect(safeMarkdownHref('  HTTPS://Example.COM/a  ')).toBe('https://example.com/a')
  })

  it('URL 里内嵌凭据的不给（防止把带口令的地址原样递出去）', () => {
    expect(safeMarkdownHref('https://user:pass@example.com')).toBeNull()
  })
})
