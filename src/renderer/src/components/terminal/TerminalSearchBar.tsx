/**
 * TerminalSearchBar — 终端搜索栏
 *
 * 行为：
 * - 父组件通过 open + onClose 控制显隐
 * - 输入关键词后回车 → findNext
 * - Shift+Enter → findPrevious
 * - Esc 关闭
 *
 * 依赖：xterm SearchAddon（TerminalView 已加载）
 */
import { useEffect, useRef, useState, type FC } from 'react'
import { SearchAddon } from '@xterm/addon-search'
import { X, ChevronUp, ChevronDown, Search } from 'lucide-react'

export interface TerminalSearchBarProps {
  open: boolean
  searchAddon: SearchAddon | null
  onClose: () => void
}

const TerminalSearchBar: FC<TerminalSearchBarProps> = ({
  open,
  searchAddon,
  onClose,
}) => {
  const [keyword, setKeyword] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [matchIndex, setMatchIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 打开时聚焦输入框
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus())
    } else {
      setKeyword('')
      setMatchIndex(0)
    }
  }, [open])

  // 关键词变化时自动 findNext
  useEffect(() => {
    if (!open || !searchAddon || !keyword) return
    try {
      searchAddon.findNext(keyword, {
        caseSensitive,
        wholeWord,
        regex: false,
      })
      setMatchIndex(1)
    } catch {
      // 关键词可能是正则非法字符
    }
  }, [keyword, caseSensitive, wholeWord, open, searchAddon])

  const handleFindNext = () => {
    if (!searchAddon || !keyword) return
    try {
      searchAddon.findNext(keyword, { caseSensitive, wholeWord, regex: false })
      setMatchIndex((i) => i + 1)
    } catch {
      // ignore
    }
  }

  const handleFindPrev = () => {
    if (!searchAddon || !keyword) return
    try {
      searchAddon.findPrevious(keyword, { caseSensitive, wholeWord, regex: false })
      setMatchIndex((i) => Math.max(0, i - 1))
    } catch {
      // ignore
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) handleFindPrev()
      else handleFindNext()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  if (!open) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 100,
        background: 'var(--trae-bg-overlay-l2)',
        border: '1px solid var(--trae-border-neutral-l1)',
        borderRadius: 'var(--trae-radius-6)',
        padding: '6px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        boxShadow: 'var(--trae-shadow-2)',
      }}
    >
      <Search size={14} style={{ color: 'var(--trae-text-tertiary)' }} />
      <input
        ref={inputRef}
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="搜索（回车下一个，Shift+回车上一个）"
        style={{
          width: 220,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: 'var(--trae-text-default)',
          fontSize: 12,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      />
      {matchIndex > 0 && (
        <span
          style={{
            fontSize: 11,
            color: 'var(--trae-text-tertiary)',
            minWidth: 28,
            textAlign: 'center',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {matchIndex}
        </span>
      )}
      <button
        type="button"
        onClick={() => setCaseSensitive((v) => !v)}
        title="区分大小写"
        style={{
          padding: '2px 6px',
          fontSize: 11,
          background: caseSensitive ? 'var(--trae-bg-brand)' : 'transparent',
          color: caseSensitive ? 'var(--trae-text-onbrand)' : 'var(--trae-text-secondary)',
          border: '1px solid var(--trae-border-neutral-l1)',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        Aa
      </button>
      <button
        type="button"
        onClick={() => setWholeWord((v) => !v)}
        title="全字匹配"
        style={{
          padding: '2px 6px',
          fontSize: 11,
          background: wholeWord ? 'var(--trae-bg-brand)' : 'transparent',
          color: wholeWord ? 'var(--trae-text-onbrand)' : 'var(--trae-text-secondary)',
          border: '1px solid var(--trae-border-neutral-l1)',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        W
      </button>
      <button
        type="button"
        onClick={handleFindPrev}
        title="上一个 (Shift+Enter)"
        style={{
          padding: 4,
          background: 'transparent',
          border: '1px solid var(--trae-border-neutral-l1)',
          borderRadius: 4,
          cursor: 'pointer',
          color: 'var(--trae-text-secondary)',
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        <ChevronUp size={12} />
      </button>
      <button
        type="button"
        onClick={handleFindNext}
        title="下一个 (Enter)"
        style={{
          padding: 4,
          background: 'transparent',
          border: '1px solid var(--trae-border-neutral-l1)',
          borderRadius: 4,
          cursor: 'pointer',
          color: 'var(--trae-text-secondary)',
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        <ChevronDown size={12} />
      </button>
      <button
        type="button"
        onClick={onClose}
        title="关闭 (Esc)"
        style={{
          padding: 4,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--trae-text-secondary)',
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        <X size={12} />
      </button>
    </div>
  )
}

export default TerminalSearchBar
