// @vitest-environment jsdom
/**
 * Markdown 链接渲染的真实产出（2026-10-09 安全审查 S3 / P1-11 判据）
 *
 * 纯函数单测（markdown-link-protocol.test.ts）证明的是白名单本身对；
 * 这里证明组件真的用了它——渲染 `javascript:` 链接后，DOM 里不许出现任何
 * 带该协议的 href，同时阴性对照要保证：正常链接照样是 `<a>`、
 * 原始 HTML（`<img onerror>`）仍然是字面文本（本组件不拼 HTML）。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import MarkdownMessage from '@renderer/components/workbench/panels/MarkdownMessage'

afterEach(cleanup)

function hrefs(container: HTMLElement): string[] {
  return [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')
}

describe('MarkdownMessage 链接协议白名单', () => {
  it('javascript: 链接不产生可点地址，文本仍然看得见', () => {
    const { container } = render(<MarkdownMessage content={'点 [这里](javascript:alert(1)) 执行'} />)
    expect(hrefs(container)).toEqual([])
    expect(container.textContent).toContain('这里')
    expect(container.querySelector('span.md-link-disabled')).toBeTruthy()
    expect(container.innerHTML).not.toContain('javascript:')
  })

  it('file: / 自定义协议同样降级', () => {
    const { container } = render(
      <MarkdownMessage content={'[a](file:///C:/Windows/System32/calc.exe) [b](wt-cli://cmd)'} />,
    )
    expect(hrefs(container)).toEqual([])
  })

  it('阴性对照：https 链接仍然渲染成可点的 <a>（白名单不是把链接全杀了）', () => {
    const { container } = render(<MarkdownMessage content={'看 [官方文档](https://www.debian.org/doc/)'} />)
    expect(hrefs(container)).toEqual(['https://www.debian.org/doc/'])
    expect(screen.getByText('官方文档')).toBeTruthy()
  })

  it('阴性对照：模型回复里的原始 HTML 保持字面文本，不被当标签执行', () => {
    const { container } = render(<MarkdownMessage content={'<img src=x onerror=alert(1)>'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })
})
