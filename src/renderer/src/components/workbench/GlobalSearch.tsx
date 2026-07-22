/**
 * GlobalSearch — 全局内容搜索面板（Cmd+Shift+F）
 *
 * v2.0 Phase C Task C.2
 *
 * - 远程内容搜索（sftp:grep IPC，grep -rn）
 * - 3 个 toggle：正则 / 全词 / 大小写
 * - 按文件分组展示匹配项，匹配子串高亮
 * - 键盘导航：↑/↓/Enter/Esc；鼠标点击选择
 * - 输入框防抖 300ms；最多展示 100 条
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/components/trae/utils'
import type { SftpGrepMatch } from '@preload/index'

export interface GlobalSearchProps {
  visible: boolean
  sessionId: string
  cwd: string
  onPick: (file: string, line: number) => void
  onClose: () => void
}

const DEBOUNCE_MS = 300
const MAX_VISIBLE = 100

/** Toggle 开关配置 */
interface ToggleOpt {
  key: 'isRegex' | 'wholeWord' | 'caseSensitive'
  label: string
  shortcut: string
}

const TOGGLES: ToggleOpt[] = [
  { key: 'isRegex', label: '正则', shortcut: 'R' },
  { key: 'wholeWord', label: '全词', shortcut: 'W' },
  { key: 'caseSensitive', label: '大小写', shortcut: 'C' },
]

/** 按文件分组的匹配结果 */
interface GroupedResult {
  file: string
  matches: SftpGrepMatch[]
}

/** 把一行文本按 match 子串切分为段，用于高亮渲染 */
function splitHighlight(text: string, match: string): Array<{ text: string; highlight: boolean }> {
  if (!match) return [{ text, highlight: false }]
  const segments: Array<{ text: string; highlight: boolean }> = []
  let cursor = 0
  const lowerText = text.toLowerCase()
  const lowerMatch = match.toLowerCase()
  let idx = lowerText.indexOf(lowerMatch, cursor)
  while (idx !== -1) {
    if (idx > cursor) segments.push({ text: text.slice(cursor, idx), highlight: false })
    segments.push({ text: text.slice(idx, idx + match.length), highlight: true })
    cursor = idx + match.length
    idx = lowerText.indexOf(lowerMatch, cursor)
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlight: false })
  return segments
}

/** GlobalSearch 组件 */
export function GlobalSearch({ visible, sessionId, cwd, onPick, onClose }: GlobalSearchProps) {
  const [pattern, setPattern] = useState('')
  const [results, setResults] = useState<SftpGrepMatch[]>([])
  const [selected, setSelected] = useState(0)
  const [loading, setLoading] = useState(false)
  const [toggles, setToggles] = useState({
    isRegex: false,
    wholeWord: false,
    caseSensitive: false,
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (visible) {
      setPattern(''); setResults([]); setSelected(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [visible])

  const triggerSearch = useCallback(
    (p: string) => {
      if (!sessionId || !p) { setResults([]); return }
      setLoading(true)
      window.electronAPI
        .sftpGrep({
          sessionId,
          path: cwd,
          pattern: p,
          isRegex: toggles.isRegex,
          caseSensitive: toggles.caseSensitive,
          wholeWord: toggles.wholeWord,
        })
        .then(({ results: r }) => setResults(r.slice(0, MAX_VISIBLE)))
        .finally(() => setLoading(false))
    },
    [sessionId, cwd, toggles]
  )

  const onPatternChange = (value: string) => {
    setPattern(value); setSelected(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => triggerSearch(value), DEBOUNCE_MS)
  }

  const toggle = (key: ToggleOpt['key']) => {
    setToggles((t) => {
      const next = { ...t, [key]: !t[key] }
      // 重新触发搜索（用新 toggle）
      if (pattern) {
        setTimeout(() => {
          setLoading(true)
          window.electronAPI
            .sftpGrep({
              sessionId, path: cwd, pattern,
              isRegex: next.isRegex,
              caseSensitive: next.caseSensitive,
              wholeWord: next.wholeWord,
            })
            .then(({ results: r }) => setResults(r.slice(0, MAX_VISIBLE)))
            .finally(() => setLoading(false))
        }, 0)
      }
      return next
    })
  }

  // 按文件分组
  const grouped = useMemo(() => {
    const map = new Map<string, SftpGrepMatch[]>()
    for (const m of results) {
      if (!map.has(m.file)) map.set(m.file, [])
      map.get(m.file)!.push(m)
    }
    return Array.from(map.entries()).map(([file, matches]) => ({ file, matches }))
  }, [results])

  // 扁平化选中索引 → { group, match }
  const flat = useMemo(() => {
    const arr: Array<{ group: GroupedResult; match: SftpGrepMatch }> = []
    for (const group of grouped) {
      for (const match of group.matches) arr.push({ group, match })
    }
    return arr
  }, [grouped])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, flat.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = flat[selected]
      if (pick) { onPick(pick.match.file, pick.match.line); onClose() }
    } else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selected}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (!visible) return null

  let runningIdx = -1

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 pt-[12vh]" onClick={onClose}>
      <div
        className="flex max-h-[76vh] w-[760px] max-w-[92vw] flex-col overflow-hidden rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 输入框 + toggles */}
        <div className="flex items-center gap-2 border-b border-[var(--trae-border-neutral-l1)] px-4 py-3">
          <input
            ref={inputRef}
            type="text"
            value={pattern}
            onChange={(e) => onPatternChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`在 ${cwd} 中搜索内容...`}
            className="flex-1 bg-transparent text-[14px] text-[var(--trae-text-default)] outline-none placeholder:text-[var(--trae-text-tertiary)]"
          />
          {TOGGLES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => toggle(t.key)}
              title={`${t.label}（${t.shortcut}）`}
              className={cn(
                'rounded-[var(--trae-radius-4)] px-2 py-1 text-[11px] transition-colors',
                toggles[t.key]
                  ? 'bg-[var(--trae-bg-brand)] text-white'
                  : 'bg-[var(--trae-bg-overlay-l2)] text-[var(--trae-text-secondary)] hover:bg-[var(--trae-bg-overlay-l3)]'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* 结果列表 */}
        <div ref={listRef} className="flex-1 overflow-y-auto">
          {loading && <div className="px-4 py-2 text-[12px] text-[var(--trae-text-tertiary)]">搜索中...</div>}
          {!loading && flat.length === 0 && pattern && (
            <div className="px-4 py-2 text-[12px] text-[var(--trae-text-tertiary)]">无匹配结果</div>
          )}
          {!loading && grouped.map((group) => (
            <div key={group.file} className="border-b border-[var(--trae-border-neutral-l1)] last:border-b-0">
              <div className="bg-[var(--trae-bg-overlay-l1)] px-4 py-1.5 text-[11px] text-[var(--trae-text-secondary)]">
                {group.file} <span className="text-[var(--trae-text-tertiary)]">({group.matches.length})</span>
              </div>
              {group.matches.map((m) => {
                runningIdx++
                const idx = runningIdx
                return (
                  <div
                    key={`${m.file}:${m.line}`}
                    data-idx={idx}
                    onMouseEnter={() => setSelected(idx)}
                    onClick={() => { onPick(m.file, m.line); onClose() }}
                    className={cn(
                      'flex cursor-pointer items-start gap-2 px-4 py-1.5 text-[12px]',
                      idx === selected
                        ? 'bg-[var(--trae-bg-overlay-l3)]'
                        : 'hover:bg-[var(--trae-bg-overlay-l2)]'
                    )}
                  >
                    <span className="min-w-[36px] shrink-0 text-right text-[var(--trae-text-tertiary)]">{m.line}</span>
                    <span className="flex-1 break-all text-[var(--trae-text-default)]">
                      {splitHighlight(m.text, m.match).map((seg, i) => (
                        <span key={i} className={seg.highlight ? 'bg-[var(--trae-bg-brand)]/40 text-[var(--trae-text-default)]' : ''}>
                          {seg.text}
                        </span>
                      ))}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
