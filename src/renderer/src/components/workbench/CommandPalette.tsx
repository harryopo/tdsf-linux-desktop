/**
 * CommandPalette — 全局搜索面板（Cmd+K / 搜索按钮）
 *
 * 功能：
 * - 搜索知识库条目（kbSearch IPC）
 * - 搜索历史决策记录（historySearch IPC）
 * - 键盘导航：↑/↓/Enter 选择，Esc 关闭
 * - 输入防抖 200ms
 */
import { useState, useEffect, useRef, useCallback, type FC } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, BookOpen, Clock, FileText, Loader2 } from 'lucide-react'
import { cn } from '@/components/trae/utils'

interface SearchResult {
  id: string
  title: string
  subtitle: string
  type: 'knowledge' | 'history' | 'server'
  navigateTo: string
}

interface CommandPaletteProps {
  visible: boolean
  onClose: () => void
}

const DEBOUNCE_MS = 200

const CommandPalette: FC<CommandPaletteProps> = ({ visible, onClose }) => {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 面板打开时聚焦输入框，重置状态
  useEffect(() => {
    if (visible) {
      setQuery('')
      setResults([])
      setSelectedIdx(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [visible])

  // 防抖搜索
  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    const items: SearchResult[] = []
    const api = window.electronAPI

    // 并行搜索知识库 + 历史
    const promises: Promise<void>[] = []

    if (api?.kbSearch) {
      promises.push(
        api.kbSearch(trimmed).then((kbResults) => {
          if (Array.isArray(kbResults)) {
            for (const kb of kbResults) {
              items.push({
                id: kb.id,
                title: kb.title,
                subtitle: `知识库 · ${kb.tags?.slice(0, 2).join('、') || '无标签'}`,
                type: 'knowledge',
                navigateTo: `/knowledge/${kb.id}`,
              })
            }
          }
        }).catch(() => { /* ignore */ })
      )
    }

    if (api?.historyList) {
      promises.push(
        api.historyList(0, 20).then((histResults: Array<{ id: string; title?: string; query?: string; timestamp: number }>) => {
          if (Array.isArray(histResults)) {
            const lower = trimmed.toLowerCase()
            const filtered = histResults.filter(
              (h) =>
                (h.title || '').toLowerCase().includes(lower) ||
                (h.query || '').toLowerCase().includes(lower),
            ).slice(0, 5)
            for (const h of filtered) {
              items.push({
                id: h.id,
                title: h.title || h.query || '无标题',
                subtitle: `历史决策 · ${new Date(h.timestamp).toLocaleDateString('zh-CN')}`,
                type: 'history',
                navigateTo: `/history/${h.id}`,
              })
            }
          }
        }).catch(() => { /* ignore */ })
      )
    }

    await Promise.allSettled(promises)
    setResults(items)
    setSelectedIdx(0)
    setLoading(false)
  }, [])

  const onQueryChange = (value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { void doSearch(value) }, DEBOUNCE_MS)
  }

  const handleSelect = (item: SearchResult) => {
    navigate(item.navigateTo)
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx((s) => Math.min(s + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = results[selectedIdx]
      if (item) handleSelect(item)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  // 全局 Esc 监听
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, onClose])

  if (!visible) return null

  const typeIcon = (type: SearchResult['type']) => {
    switch (type) {
      case 'knowledge': return <BookOpen className="size-3.5 shrink-0 text-[var(--trae-icon-brand)]" />
      case 'history': return <Clock className="size-3.5 shrink-0 text-[var(--trae-icon-secondary)]" />
      case 'server': return <FileText className="size-3.5 shrink-0 text-[var(--trae-icon-secondary)]" />
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center bg-black/50 pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="flex w-[560px] max-w-[92vw] flex-col overflow-hidden rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 搜索输入框 */}
        <div className="flex items-center gap-2 border-b border-[var(--trae-border-neutral-l1)] px-4 py-3">
          <Search className="size-4 shrink-0 text-[var(--trae-text-tertiary)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索知识库、历史决策..."
            className="flex-1 bg-transparent text-[14px] text-[var(--trae-text-default)] outline-none placeholder:text-[var(--trae-text-tertiary)]"
          />
          <kbd className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l2)] px-1.5 text-[10px] text-[var(--trae-text-tertiary)]">
            Esc
          </kbd>
        </div>

        {/* 搜索结果 */}
        <div className="max-h-[360px] overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 px-4 py-8 text-[12px] text-[var(--trae-text-tertiary)]">
              <Loader2 className="size-4 animate-spin" />
              搜索中...
            </div>
          )}

          {!loading && query.trim() && results.length === 0 && (
            <div className="px-4 py-8 text-center text-[12px] text-[var(--trae-text-tertiary)]">
              未找到匹配结果
            </div>
          )}

          {!loading && !query.trim() && (
            <div className="px-4 py-6 text-center text-[12px] text-[var(--trae-text-tertiary)]">
              <div className="mb-1 text-[var(--trae-text-secondary)]">全局搜索</div>
              <div>输入关键词搜索知识库条目和历史决策记录</div>
              <div className="mt-2 inline-flex items-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] px-2 py-0.5 text-[11px]">
                <kbd className="text-[10px]">Cmd+K</kbd>
                <span className="text-[var(--trae-text-tertiary)]">快速打开</span>
              </div>
            </div>
          )}

          {results.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelect(item)}
              onMouseEnter={() => setSelectedIdx(idx)}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                idx === selectedIdx
                  ? 'bg-[var(--trae-bg-overlay-l3)]'
                  : 'hover:bg-[var(--trae-bg-overlay-l2)]',
              )}
            >
              {typeIcon(item.type)}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-[var(--trae-text-default)]">
                  {item.title}
                </div>
                <div className="truncate text-[11px] text-[var(--trae-text-tertiary)]">
                  {item.subtitle}
                </div>
              </div>
              <span className="shrink-0 text-[10px] text-[var(--trae-text-tertiary)]">
                {item.type === 'knowledge' ? '知识库' : '历史'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default CommandPalette