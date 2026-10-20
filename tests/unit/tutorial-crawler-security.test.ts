/**
 * 教程抓取器的输入清洗回归测试
 *
 * 覆盖 CodeQL 报出的两类问题（2026-10-20 修复）：
 * - MS Learn hub 链接只按字符串前缀判同域，`learn.microsoft.com.evil.com` 能混进来
 * - Debian Wiki 的 wikitext → Markdown 单次剥离标签，嵌套形状能拼出新标签
 */
import { describe, it, expect } from 'vitest'
import { _internal as msLearn } from '../../src/main/services/tutorial/crawler/ms-learn-offline'
import { _internal as debianWiki } from '../../src/main/services/tutorial/crawler/debian-wiki-offline'

describe('MS Learn hub 链接同域判定', () => {
  const { sameDomainAbsoluteUrl } = msLearn

  it('接受 learn.microsoft.com 的 https 页面', () => {
    const url = 'https://learn.microsoft.com/en-us/linux/'
    expect(sameDomainAbsoluteUrl(url)).toBe(url)
  })

  it('拒绝后缀伪造域（前缀比较挡不住的那类）', () => {
    expect(sameDomainAbsoluteUrl('https://learn.microsoft.com.evil.com/en-us/linux/')).toBeNull()
  })

  it('拒绝把目标域塞进路径或 userinfo 的形状', () => {
    expect(sameDomainAbsoluteUrl('https://evil.com/https://learn.microsoft.com/')).toBeNull()
    expect(sameDomainAbsoluteUrl('https://learn.microsoft.com@evil.com/en-us/')).toBeNull()
  })

  it('拒绝非 https 与无法解析的地址', () => {
    expect(sameDomainAbsoluteUrl('http://learn.microsoft.com/en-us/linux/')).toBeNull()
    expect(sameDomainAbsoluteUrl('https://')).toBeNull()
  })
})

describe('Debian Wiki wikitext 标签剥离', () => {
  const { wikitextToMd } = debianWiki

  it('嵌套标签不会在单次剥离后拼出新标签', () => {
    const md = wikitextToMd('<scr<script>ipt>alert(1)</script>')
    expect(md).not.toContain('<script')
    expect(md).not.toContain('</script')
  })

  it('剥不出完整标签的残余尖括号被转义', () => {
    expect(wikitextToMd('a <b')).toBe('a &lt;b')
    expect(wikitextToMd('</div')).toBe('&lt;/div')
  })

  it('普通比较符号不受影响', () => {
    expect(wikitextToMd('a < b')).toBe('a < b')
  })
})
