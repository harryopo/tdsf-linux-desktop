/**
 * 教程正文 Markdown 解析（纯函数，可单测）
 *
 * 教程内容来自随包分发的 Markdown，不能假设它只含标题与段落：
 * 列表、表格、引用、链接都要能被读成"文档"，而不是把 `|` `-` 原样吐在页面上。
 * 这里只做块级切分，不拼 HTML、不走 innerHTML，渲染层产出 React 元素，天然免疫 XSS。
 */

export interface MarkdownListItem {
  text: string
  /** 缩进层级（按两个空格一层折算，最多 3 层） */
  depth: number
}

export type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'code'; lang: string; code: string }
  | { type: 'quote'; lines: string[] }
  | { type: 'list'; ordered: boolean; items: MarkdownListItem[] }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'hr' }

const HEADING_RE = /^(#{1,6})\s+(.*)$/
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const FENCE_RE = /^\s*```/
const QUOTE_RE = /^\s*>\s?/
const UL_RE = /^(\s*)[-*+]\s+(.*)$/
const OL_RE = /^(\s*)\d+[.)]\s+(.*)$/
/** 表格分隔行：| --- | :---: |（允许单列与首尾竖线缺失） */
const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/

/** 把一行表格文本切成单元格数组（去首尾 |，trim） */
export function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function matchListItem(line: string): { ordered: boolean; depth: number; text: string } | null {
  const ul = UL_RE.exec(line)
  if (ul) return { ordered: false, depth: Math.min(3, Math.floor(ul[1].length / 2)), text: ul[2].trim() }
  const ol = OL_RE.exec(line)
  if (ol) return { ordered: true, depth: Math.min(3, Math.floor(ol[1].length / 2)), text: ol[2].trim() }
  return null
}

function isTableStart(lines: string[], index: number): boolean {
  const header = lines[index]
  const separator = lines[index + 1]
  if (header === undefined || separator === undefined) return false
  return header.includes('|') && separator.includes('|') && TABLE_SEP_RE.test(separator)
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index]
  if (line === undefined) return true
  if (FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line) || QUOTE_RE.test(line)) return true
  if (isTableStart(lines, index)) return true
  return matchListItem(line) !== null
}

/** 把 Markdown 原文切成块；末尾未闭合的代码围栏按"到文件尾"处理，不丢内容 */
export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i++
      continue
    }

    // 代码围栏：```lang ... ```；复制用的是围栏内的纯文本，语言标签单独存
    if (FENCE_RE.test(line)) {
      const lang = line.trim().slice(3).trim().split(/\s+/)[0] ?? ''
      const body: string[] = []
      i++
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        body.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // 跳过结束围栏
      blocks.push({ type: 'code', lang, code: body.join('\n') })
      continue
    }

    const heading = HEADING_RE.exec(line)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() })
      i++
      continue
    }

    if (HR_RE.test(line)) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }

    if (QUOTE_RE.test(line)) {
      const quoteLines: string[] = []
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        quoteLines.push(lines[i].replace(QUOTE_RE, ''))
        i++
      }
      blocks.push({ type: 'quote', lines: quoteLines })
      continue
    }

    if (isTableStart(lines, i)) {
      const header = splitTableRow(lines[i])
      i += 2 // 表头 + 分隔行
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim() && lines[i].includes('|') && !TABLE_SEP_RE.test(lines[i])) {
        rows.push(splitTableRow(lines[i]))
        i++
      }
      blocks.push({ type: 'table', header, rows })
      continue
    }

    const firstItem = matchListItem(line)
    if (firstItem) {
      const ordered = firstItem.ordered
      const items: MarkdownListItem[] = []
      while (i < lines.length) {
        const item = matchListItem(lines[i])
        if (!item || item.ordered !== ordered) break
        items.push({ text: item.text, depth: item.depth })
        i++
        // 列表项换行续写（缩进行且不是新的块级起始）并回同一项
        while (i < lines.length && lines[i].trim() && /^\s+/.test(lines[i]) && !isBlockStart(lines, i)) {
          items[items.length - 1].text += ` ${lines[i].trim()}`
          i++
        }
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    // 普通段落：连续非空、且不以任何块级语法开头的行
    const paragraph: string[] = []
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines, i)) {
      paragraph.push(lines[i].trim())
      i++
    }
    if (paragraph.length === 0) {
      // 兜底：任何漏判的行都要被消费掉，不能死循环
      paragraph.push(lines[i])
      i++
    }
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
  }

  return blocks
}
