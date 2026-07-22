/**
 * QuickFileSearch — 快速文件搜索面板（Cmd+P）
 *
 * v2.0 Phase C Task C.1
 *
 * - 模糊查找远程文件（sftp:search IPC，find -name 模糊匹配）
 * - 本地 fzf 算法二次排序（字符顺序匹配 + 路径/文件名优先 + 连续 bonus）
 * - 键盘导航：↑/↓/Enter/Esc；鼠标点击选择
 * - 输入框防抖 200ms；最多展示 30 条
 *
 * 行数约束：≤ 200 行（Task C.1）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/components/trae/utils'
import type { SftpSearchFileEntry } from '@preload/index'

export interface QuickFileSearchProps {
  visible: boolean
  sessionId: string
  cwd: string
  onPick: (path: string) => void
  onClose: () => void
}

const DEBOUNCE_MS = 200
const MAX_VISIBLE = 30

/**
 * fzf 风格模糊匹配评分
 *
 * 字符按顺序匹配得分越高；连续匹配有 bonus；
 * 路径分隔符后（单词起始）匹配有 bonus；文件名包含 query 加 30 分。
 * 返回 null 表示不匹配。
 */
function fzfScore(query: string, candidate: string): number | null {
  if (!query) return 0
  const q = query.toLowerCase()
  const c = candidate.toLowerCase()
  let ci = 0
  let score = 0
  let consecutive = 0
  let lastMatchPos = -2
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    let found = -1
    for (; ci < c.length; ci++) {
      if (c[ci] === ch) { found = ci; break }
    }
    if (found === -1) return null
    if (found === lastMatchPos + 1) { consecutive++; score += 10 + consecutive * 5 }
    else { consecutive = 0; score += 1 }
    if (found === 0 || c[found - 1] === '/') score += 15
    lastMatchPos = found
    ci = found + 1
  }
  const slashIdx = candidate.lastIndexOf('/')
  const fileName = slashIdx >= 0 ? candidate.slice(slashIdx + 1) : candidate
  if (fileName.toLowerCase().includes(q)) score += 30
  return score
}

/** QuickFileSearch 组件 */
export function QuickFileSearch({ visible, sessionId, cwd, onPick, onClose }: QuickFileSearchProps) {
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<SftpSearchFileEntry[]>([])
  const [selected, setSelected] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (visible) {
      setQuery(''); setFiles([]); setSelected(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [visible])

  const triggerSearch = useCallback(
    (q: string) => {
      if (!sessionId || !q) { setFiles([]); return }
      setLoading(true)
      window.electronAPI
        .sftpSearch(sessionId, cwd, q)
        .then(({ files: result }) => setFiles(result))
        .finally(() => setLoading(false))
    },
    [sessionId, cwd]
  )

  const onQueryChange = (value: string) => {
    setQuery(value); setSelected(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => triggerSearch(value), DEBOUNCE_MS)
  }

  const ranked = useMemo(() => {
    if (!query) return files
    return files
      .map((f) => ({ file: f, score: fzfScore(query, f.path) }))
      .filter((x): x is { file: SftpSearchFileEntry; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_VISIBLE)
      .map((x) => x.file)
  }, [files, query])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, ranked.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = ranked[selected]
      if (pick) { onPick(pick.path); onClose() }
    } else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selected}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 pt-[15vh]" onClick={onClose}>
      <div
        className="w-[640px] max-w-[90vw] overflow-hidden rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`在 ${cwd} 中搜索文件...`}
          className="w-full border-b border-[var(--trae-border-neutral-l1)] bg-transparent px-4 py-3 text-[14px] text-[var(--trae-text-default)] outline-none placeholder:text-[var(--trae-text-tertiary)]"
        />
        <div ref={listRef} className="max-h-[400px] overflow-y-auto">
          {loading && <div className="px-4 py-2 text-[12px] text-[var(--trae-text-tertiary)]">搜索中...</div>}
          {!loading && ranked.length === 0 && query && (
            <div className="px-4 py-2 text-[12px] text-[var(--trae-text-tertiary)]">无匹配文件</div>
          )}
          {!loading && ranked.map((f, idx) => {
            const slashIdx = f.path.lastIndexOf('/')
            const dir = slashIdx >= 0 ? f.path.slice(0, slashIdx) : ''
            const name = slashIdx >= 0 ? f.path.slice(slashIdx + 1) : f.path
            return (
              <div
                key={f.path}
                data-idx={idx}
                onMouseEnter={() => setSelected(idx)}
                onClick={() => { onPick(f.path); onClose() }}
                className={cn(
                  'flex cursor-pointer flex-col gap-0.5 px-4 py-2 text-[12px]',
                  idx === selected
                    ? 'bg-[var(--trae-bg-overlay-l3)]'
                    : 'hover:bg-[var(--trae-bg-overlay-l2)]'
                )}
              >
                <span className="text-[var(--trae-text-default)]">{name}</span>
                {dir && <span className="text-[var(--trae-text-tertiary)]">{dir}</span>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

