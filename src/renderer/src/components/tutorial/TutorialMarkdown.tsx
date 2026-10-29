/**
 * TutorialMarkdown — 教程正文的 Markdown 渲染 + 复制
 *
 * 只改"怎么读"，不改教程内容：解析结果全部是 React 元素（无 innerHTML），
 * 块级语法覆盖标题 / 段落 / 列表 / 表格 / 引用 / 分割线 / 代码围栏；
 * 行内覆盖 `code`、**粗体**、*斜体*、[链接](url)（链接走 http/https 白名单）。
 *
 * 每个代码围栏右上角都有复制按钮：复制的是围栏内的纯代码（不含 ``` 与语言标签），
 * 成功显示"已复制" 2 秒；`writeText` 失败时显示"复制失败"并 toast 报错，不伪装成功。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Copy, CopyX } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/components/trae/utils'
import { safeMarkdownHref } from '@/components/workbench/panels/markdown-links'
import { copyText } from './copy-text'
import { parseMarkdownBlocks, type MarkdownBlock } from './tutorial-markdown'

const COPY_FEEDBACK_MS = 2000

type CopyState = 'idle' | 'copied' | 'failed'

export interface CopyButtonProps {
  /** 要写入剪贴板的文本（代码块传纯代码，整篇传 Markdown 原文） */
  text: string
  /** 空闲态按钮文字 */
  idleLabel: string
  /** 复制成功的按钮文字 */
  copiedLabel?: string
  /** 复制失败的按钮文字 */
  failedLabel?: string
  /** 无障碍名称（按钮文字会变，aria-label 给出稳定语义） */
  ariaLabel: string
  /** 稳定的自动化钩子（同一屏内必须唯一） */
  copyId?: string
  className?: string
}

export function CopyButton({
  text,
  idleLabel,
  copiedLabel = '已复制',
  failedLabel = '复制失败',
  ariaLabel,
  copyId,
  className,
}: CopyButtonProps) {
  const [state, setState] = useState<CopyState>('idle')
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current)
    },
    [],
  )

  const handleCopy = async () => {
    const result = await copyText(text)
    if (resetTimer.current !== null) clearTimeout(resetTimer.current)
    if (result.ok) {
      setState('copied')
    } else {
      setState('failed')
      toast.error(`复制失败：${result.error}`)
    }
    resetTimer.current = setTimeout(() => {
      setState('idle')
      resetTimer.current = null
    }, COPY_FEEDBACK_MS)
  }

  const label = state === 'copied' ? copiedLabel : state === 'failed' ? failedLabel : idleLabel
  const stateAria =
    state === 'idle'
      ? ariaLabel
      : state === 'copied'
        ? `${ariaLabel}，已复制`
        : `${ariaLabel}，复制失败，请手动选择`

  return (
    <button
      type="button"
      className={cn('tut-copy-btn', className)}
      data-copy-state={state}
      data-dom-id={copyId}
      aria-label={stateAria}
      onClick={() => void handleCopy()}
    >
      {state === 'copied' ? (
        <Check className="size-3.5" aria-hidden />
      ) : state === 'failed' ? (
        <CopyX className="size-3.5" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
      <span>{label}</span>
    </button>
  )
}

/** 代码块外壳：语言标签 + 复制按钮 + 可横向滚动的 pre */
export function TutorialCodeBlock({
  code,
  lang,
  copyId,
  children,
}: {
  code: string
  lang?: string
  copyId?: string
  children: ReactNode
}) {
  return (
    <div className="tut-md-code-card">
      <div className="tut-md-code-head">
        {lang ? <span className="tut-md-code-lang">{lang}</span> : <span aria-hidden />}
        <CopyButton text={code} idleLabel="复制" ariaLabel="复制代码" copyId={copyId} />
      </div>
      <pre className="tut-md-pre">
        <code>{children}</code>
      </pre>
    </div>
  )
}

/** 行内解析：`code` > **粗体** > *斜体* > [链接](url)，按出现顺序切分 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)\s]+\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let index = 0

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    const token = match[0]
    const key = `${keyPrefix}-i${index++}`

    if (token.startsWith('`')) {
      nodes.push(
        <code key={key} className="tut-md-code">
          {token.slice(1, -1)}
        </code>,
      )
    } else if (token.startsWith('**')) {
      nodes.push(
        <strong key={key} className="tut-md-strong">
          {token.slice(2, -2)}
        </strong>,
      )
    } else if (token.startsWith('*')) {
      nodes.push(
        <em key={key} className="tut-md-em">
          {token.slice(1, -1)}
        </em>,
      )
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      if (!link) {
        nodes.push(token)
      } else {
        const href = safeMarkdownHref(link[2])
        if (href) {
          nodes.push(
            <a key={key} href={href} target="_blank" rel="noreferrer" className="tut-md-link">
              {link[1]}
            </a>,
          )
        } else {
          // 协议不在白名单：只留字面文本，不给任何可点击语义
          nodes.push(
            <span key={key} className="tut-md-link-disabled">
              {link[1]}
            </span>,
          )
        }
      }
    }
    lastIndex = match.index + token.length
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

/** 列表缩进档：写成字面量数组，静态死 CSS 扫描才看得见这三个类 */
const LIST_DEPTH_CLASS = ['', 'tut-md-li--depth-1', 'tut-md-li--depth-2', 'tut-md-li--depth-3']

/** 按内容给代码行一个语义类：注释弱化、shell 提示符用强调色 */
function codeLineClass(line: string): string {
  const trimmed = line.trimStart()
  if (trimmed.startsWith('#') || trimmed.startsWith('//')) return ' tut-md-code-comment'
  if (trimmed.startsWith('$') || trimmed.startsWith('user@') || trimmed.startsWith('root@')) {
    return ' tut-md-code-prompt'
  }
  return ''
}

function renderBlock(block: MarkdownBlock, index: number, copyIdPrefix: string): ReactNode {
  const key = `${block.type}-${index}`

  switch (block.type) {
    case 'heading': {
      const Tag = block.level <= 2 ? 'h2' : 'h3'
      const levelClass =
        block.level === 1 ? 'tut-md-h2 tut-md-h2--major' : block.level === 2 ? 'tut-md-h2' : 'tut-md-h3'
      return (
        <Tag key={key} className={levelClass}>
          {renderInline(block.text, key)}
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p key={key} className="tut-md-p">
          {renderInline(block.text, key)}
        </p>
      )
    case 'code':
      return (
        <TutorialCodeBlock
          key={key}
          code={block.code}
          lang={block.lang}
          copyId={`${copyIdPrefix}-code-${index}`}
        >
          {block.code.split('\n').map((line, lineIndex) => (
            <span key={lineIndex} className={`tut-md-code-line${codeLineClass(line)}`}>
              {line || '\u00A0'}
            </span>
          ))}
        </TutorialCodeBlock>
      )
    case 'quote':
      return (
        <blockquote key={key} className="tut-md-blockquote">
          {block.lines.map((line, lineIndex) => (
            <p key={lineIndex} className="tut-md-blockquote-p">
              {renderInline(line, `${key}-${lineIndex}`)}
            </p>
          ))}
        </blockquote>
      )
    case 'list': {
      const ListTag = block.ordered ? 'ol' : 'ul'
      return (
        <ListTag key={key} className={cn('tut-md-list', block.ordered && 'tut-md-list--ordered')}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex} className={cn('tut-md-li', LIST_DEPTH_CLASS[item.depth] ?? '')}>
              {renderInline(item.text, `${key}-${itemIndex}`)}
            </li>
          ))}
        </ListTag>
      )
    }
    case 'table':
      return (
        <div key={key} className="tut-md-table-wrap">
          <table className="tut-md-table">
            <thead>
              <tr>
                {block.header.map((cell, cellIndex) => (
                  <th key={cellIndex}>{renderInline(cell, `${key}-h-${cellIndex}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {block.header.map((_, cellIndex) => (
                    <td key={cellIndex}>{renderInline(row[cellIndex] ?? '', `${key}-${rowIndex}-${cellIndex}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'hr':
      return <hr key={key} className="tut-md-hr" />
  }
}

export function TutorialMarkdown({
  content,
  copyIdPrefix = 'tutorial',
}: {
  content: string
  /** 代码块复制按钮的 data-dom-id 前缀，同一屏只放一个实例 */
  copyIdPrefix?: string
}) {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content])
  return <div className="tut-md-content">{blocks.map((block, index) => renderBlock(block, index, copyIdPrefix))}</div>
}
