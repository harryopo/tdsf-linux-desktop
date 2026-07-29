/**
 * tests/components/workbench/panels/MarkdownMessage.test.tsx
 * MarkdownMessage 组件级 RTL 最小伴随测试（ui-story-snapshot 漂移修复）
 *
 * 覆盖范围：
 * 1. 块级语法：标题 / 代码块（含语言标签）/ 无序列表 / 有序列表 / 引用 / 分割线 / 段落
 * 2. 行内语法：**加粗** / *斜体* / `行内代码` / [文本](链接)
 * 3. 安全性：HTML 字符串以纯文本渲染（无 innerHTML 路径），不产生 script 元素
 *
 * 关键决策：
 * - 该组件是 v2.4 新增的 AI 回复渲染核心，无外部依赖 → 纯渲染断言即可
 * - XSS 断言直接查询 DOM 中是否出现 script 元素（组件承诺免疫 XSS）
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type {} from '@testing-library/jest-dom'

import MarkdownMessage from '@renderer/components/workbench/panels/MarkdownMessage'

describe('MarkdownMessage — 块级语法', () => {
  it('1. 标题渲染为对应层级的 h 标签（md-h 类）', () => {
    const { container } = render(<MarkdownMessage content={'# 一级标题\n## 二级标题'} />)
    const h1 = container.querySelector('h1.md-h.md-h1')
    const h2 = container.querySelector('h2.md-h.md-h2')
    expect(h1).toHaveTextContent('一级标题')
    expect(h2).toHaveTextContent('二级标题')
  })

  it('2. 围栏代码块渲染为 pre.md-code-block 并显示语言标签', () => {
    const { container } = render(
      <MarkdownMessage content={'```bash\nls -la /var/log\n```'} />
    )
    const pre = container.querySelector('pre.md-code-block')
    expect(pre).toBeInTheDocument()
    expect(container.querySelector('.md-code-lang')).toHaveTextContent('bash')
    expect(pre?.querySelector('code')).toHaveTextContent('ls -la /var/log')
  })

  it('3. 无序/有序列表分别渲染 ul / ol（md-list 类）', () => {
    const { container } = render(
      <MarkdownMessage content={'- 甲\n- 乙\n\n1. 第一\n2. 第二'} />
    )
    const ul = container.querySelector('ul.md-list')
    const ol = container.querySelector('ol.md-list')
    expect(ul?.querySelectorAll('li')).toHaveLength(2)
    expect(ol?.querySelectorAll('li')).toHaveLength(2)
    expect(ul).toHaveTextContent('甲')
    expect(ol).toHaveTextContent('第一')
  })

  it('4. 引用与分割线渲染 blockquote.md-quote / hr.md-hr', () => {
    const { container } = render(
      <MarkdownMessage content={'> 引用内容\n\n---'} />
    )
    expect(container.querySelector('blockquote.md-quote')).toHaveTextContent('引用内容')
    expect(container.querySelector('hr.md-hr')).toBeInTheDocument()
  })

  it('5. 普通文本渲染为 p.md-p 段落', () => {
    const { container } = render(<MarkdownMessage content="普通段落文本" />)
    expect(container.querySelector('p.md-p')).toHaveTextContent('普通段落文本')
  })

  it('5.1 表格（表头 + 分隔行 + 数据行）渲染为 table.md-table（v2.5）', () => {
    const { container } = render(
      <MarkdownMessage content={'| 项目 | 状态 |\n|------|------|\n| 操作系统 | openEuler |\n| CPU | **1核** |'} />
    )
    const table = container.querySelector('table.md-table')
    expect(table).toBeInTheDocument()
    const ths = table?.querySelectorAll('th') ?? []
    expect(ths).toHaveLength(2)
    expect(ths[0]).toHaveTextContent('项目')
    const rows = table?.querySelectorAll('tbody tr') ?? []
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('openEuler')
    // 单元格内行内语法仍生效
    expect(rows[1]?.querySelector('strong')).toHaveTextContent('1核')
    // 源文本的 | 管道符不应再裸露在文本中
    expect(container.textContent).not.toContain('|')
  })

  it('5.2 孤立 | 行（无分隔行）按段落处理不死循环', () => {
    const { container } = render(<MarkdownMessage content={'| 只有一行管道 |\n后续文本'} />)
    expect(container.querySelector('table')).toBeNull()
    expect(container.textContent).toContain('只有一行管道')
    expect(container.textContent).toContain('后续文本')
  })
})

describe('MarkdownMessage — 行内语法', () => {
  it('6. 加粗/斜体/行内代码渲染 strong / em / code.md-inline-code', () => {
    const { container } = render(
      <MarkdownMessage content={'含 **加粗** 与 *斜体* 与 `code` 的段落'} />
    )
    expect(container.querySelector('strong')).toHaveTextContent('加粗')
    expect(container.querySelector('em')).toHaveTextContent('斜体')
    expect(container.querySelector('code.md-inline-code')).toHaveTextContent('code')
  })

  it('7. 链接渲染为新窗口安全链接（target=_blank + rel=noreferrer）', () => {
    render(<MarkdownMessage content={'参考 [官方文档](https://example.com/doc)'} />)
    const link = screen.getByRole('link', { name: '官方文档' })
    expect(link).toHaveAttribute('href', 'https://example.com/doc')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })
})

describe('MarkdownMessage — XSS 安全性', () => {
  it('8. HTML 字符串以纯文本渲染，不产生 script/img 元素', () => {
    const { container } = render(
      <MarkdownMessage content={'<script>alert(1)</script> 与 <img src=x onerror=alert(2)>'} />
    )
    // 全程 React 元素直出，无 innerHTML → 恶意标签只能是文本
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<script>alert(1)</script>')
  })
})
