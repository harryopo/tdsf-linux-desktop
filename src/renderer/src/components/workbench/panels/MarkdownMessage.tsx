/**
 * MarkdownMessage — 轻量安全的 Markdown 渲染组件
 *
 * 背景（v2.4 修复）：AI 回复此前用 whitespace-pre-wrap 纯文本直出，**加粗/标题/列表/
 * 代码块全是原始 markdown 符号**，无法预览。项目未装任何 markdown 渲染库。
 *
 * 本组件不引入新依赖、**直接产出 React 元素**（全程不拼接 HTML 字符串、
 * 不走 innerHTML 路径），因此天然免疫 XSS。覆盖 AI 实际输出的常见语法：
 * - 块级：# 标题、``` 代码块、- / * / 1. 列表、> 引用、--- 分割线、| 表格、段落
 * - 行内：**加粗**、*斜体*、`行内代码`、[文本](链接)
 *
 * 不追求完整 CommonMark（不处理嵌套列表/HTML），够用且安全；
 * 如需完整能力后续可升级 react-markdown。
 */
import { Fragment, type ReactNode } from 'react'

/** 行内解析：**粗** / *斜* / `码` / [文本](url)，返回 React 节点数组 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  // 依次匹配：行内代码 > 粗体 > 斜体 > 链接。用一个组合正则按出现顺序切分。
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g
  let lastIndex = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      nodes.push(text.slice(lastIndex, m.index))
    }
    const token = m[0]
    const key = `${keyPrefix}-i${i++}`
    if (token.startsWith('`')) {
      nodes.push(
        <code key={key} className="md-inline-code">
          {token.slice(1, -1)}
        </code>,
      )
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    } else {
      // [文本](url)
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      if (linkMatch) {
        nodes.push(
          <a key={key} href={linkMatch[2]} target="_blank" rel="noreferrer" className="md-link">
            {linkMatch[1]}
          </a>,
        )
      } else {
        nodes.push(token)
      }
    }
    lastIndex = m.index + token.length
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

/** 表格行：以 | 开头的行（宽松判定，尾部 | 可缺失 — AI 常不闭合） */
const TABLE_ROW_RE = /^\s*\|/
/** 表格分隔行：| --- | :---: | 之类 */
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

/** 把一行表格文本切成单元格数组（去首尾 |，trim） */
function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

/** 解析 markdown 文本为 React 元素（块级） */
function renderMarkdown(content: string): ReactNode[] {
  const lines = content.split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // 代码块 ```lang ... ```
    const fence = line.match(/^```(\w*)/)
    if (fence) {
      const lang = fence[1]
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        body.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // 跳过结束 ```
      blocks.push(
        <pre key={`b${key++}`} className="md-code-block">
          {lang && <span className="md-code-lang">{lang}</span>}
          <code>{body.join('\n')}</code>
        </pre>,
      )
      continue
    }

    // 空行 → 跳过
    if (!line.trim()) {
      i++
      continue
    }

    // 分割线 ---
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr key={`b${key++}`} className="md-hr" />)
      i++
      continue
    }

    // 标题 # / ## / ###
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = heading[1].length
      const Tag = (`h${Math.min(level, 6)}`) as keyof JSX.IntrinsicElements
      blocks.push(
        <Tag key={`b${key++}`} className={`md-h md-h${level}`}>
          {renderInline(heading[2], `h${key}`)}
        </Tag>,
      )
      i++
      continue
    }

    // 引用 >
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      blocks.push(
        <blockquote key={`b${key++}`} className="md-quote">
          {renderInline(quote.join(' '), `q${key}`)}
        </blockquote>,
      )
      continue
    }

    // 表格：| a | b | 行 + 紧跟 | --- | 分隔行（v2.5：AI 回复大量使用表格）
    if (TABLE_ROW_RE.test(line) && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const headers = splitTableRow(line)
      i += 2 // 跳过表头 + 分隔行
      const rows: string[][] = []
      while (i < lines.length && TABLE_ROW_RE.test(lines[i]) && !TABLE_SEP_RE.test(lines[i])) {
        rows.push(splitTableRow(lines[i]))
        i++
      }
      blocks.push(
        <div key={`b${key++}`} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {headers.map((h, idx) => (
                  <th key={idx}>{renderInline(h, `th${key}-${idx}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((cells, r) => (
                <tr key={r}>
                  {headers.map((_, c) => (
                    <td key={c}>{renderInline(cells[c] ?? '', `td${key}-${r}-${c}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // 无序列表 - / * ；有序列表 1.
    const isUl = /^\s*[-*]\s+/.test(line)
    const isOl = /^\s*\d+\.\s+/.test(line)
    if (isUl || isOl) {
      const items: string[] = []
      const itemRe = isUl ? /^\s*[-*]\s+/ : /^\s*\d+\.\s+/
      while (i < lines.length && (isUl ? /^\s*[-*]\s+/ : /^\s*\d+\.\s+/).test(lines[i])) {
        items.push(lines[i].replace(itemRe, ''))
        i++
      }
      const ListTag = isUl ? 'ul' : 'ol'
      blocks.push(
        <ListTag key={`b${key++}`} className="md-list">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `li${key}-${idx}`)}</li>
          ))}
        </ListTag>,
      )
      continue
    }

    // 普通段落：合并连续非空、非块级起始的行
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith('```') &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*(-{3,}|\*{3,})\s*$/.test(lines[i]) &&
      !TABLE_ROW_RE.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    // 兜底：单独的 | 行（无分隔行，不构成表格）也按段落消费，避免死循环
    if (para.length === 0) {
      para.push(lines[i])
      i++
    }
    blocks.push(
      <p key={`b${key++}`} className="md-p">
        {renderInline(para.join('\n'), `p${key}`)}
      </p>,
    )
  }

  return blocks.map((b, idx) => <Fragment key={idx}>{b}</Fragment>)
}

interface MarkdownMessageProps {
  content: string
  className?: string
}

/** Markdown 消息渲染（产出 React 元素，无 innerHTML，安全） */
export function MarkdownMessage({ content, className }: MarkdownMessageProps): JSX.Element {
  return <div className={`md-body ${className ?? ''}`}>{renderMarkdown(content)}</div>
}

export default MarkdownMessage
