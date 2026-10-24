/**
 * FileSearchPanel — 资源管理器里的「在服务器上搜」（#213）
 *
 * 主进程这两条早就实现了（SSH exec 跑 find / grep，输入走单引号转义，3 秒超时，
 * 条数有上限），preload 也暴露了，唯独界面没有入口——想在服务器上找一个配置文件，
 * 只能回终端自己敲 find。这一格把那两把键接成看得见的动作。
 *
 * 两件容易做假的事在这里是判据盯着的：
 * - 内容命中带行号，点下去必须真的跳到那一行（`onOpenFile` 收到 line），
 *   只显示行号却跳不过去就是假 affordance；
 * - 主进程的结果是 `| head -50` / `| head -100` 截过的，到顶要明说"可能不全"，
 *   超时/失败要说是失败，不许把"没跑完"报成"没有这个文件"。
 */
import { useCallback, useState } from 'react'
import { FileText, Loader2, Search, SearchCode } from 'lucide-react'
import { Button, Notice } from '@/ui'
import type { OpenFileRequest } from './FileTree'

/** 结果类型一律从暴露面派生，不在渲染层再抄一份字段表 */
type Api = typeof window.electronAPI
type FileEntry = Awaited<ReturnType<Api['sftpSearch']>>['files'][number]
type GrepMatch = Awaited<ReturnType<Api['sftpGrep']>>['results'][number]

type Mode = 'name' | 'content'

export interface FileSearchPanelProps {
  /** 当前 SSH 会话 ID；没连上时为 null */
  sessionId: string | null
  /** 搜索根目录（就是资源管理器现在展开的那棵树） */
  rootPath: string
  /** 打开文件；内容命中时带 line，编辑器要跳到那一行 */
  onOpenFile: (req: OpenFileRequest) => void
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function FileSearchPanel({ sessionId, rootPath, onOpenFile }: FileSearchPanelProps) {
  const [mode, setMode] = useState<Mode>('name')
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [matches, setMatches] = useState<GrepMatch[]>([])
  const [truncated, setTruncated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ranOnce, setRanOnce] = useState(false)

  const run = useCallback(async () => {
    const api = window.electronAPI
    const q = query.trim()
    if (!api || sessionId === null || q === '') return
    setBusy(true)
    setError(null)
    setRanOnce(true)
    try {
      if (mode === 'name') {
        const r = await api.sftpSearch(sessionId, rootPath, q)
        setFiles(r.files ?? [])
        setMatches([])
        setTruncated(r.truncated === true)
        if (r.error) setError(r.error)
      } else {
        const r = await api.sftpGrep({
          sessionId,
          path: rootPath,
          pattern: q,
          isRegex: false,
          caseSensitive: false,
          wholeWord: false,
        })
        setMatches(r.results ?? [])
        setFiles([])
        setTruncated(r.truncated === true)
        if (r.error) setError(r.error)
      }
    } catch (err) {
      setFiles([])
      setMatches([])
      setTruncated(false)
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }, [mode, query, rootPath, sessionId])

  const ready = sessionId !== null
  const empty = ranOnce && !busy && !error && files.length === 0 && matches.length === 0

  return (
    <section aria-label="远程文件搜索" className="wb-file-search">
      <div className="wb-file-search-modes" role="radiogroup" aria-label="搜索方式">
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'name'}
          className={mode === 'name' ? 'wb-file-search-mode active' : 'wb-file-search-mode'}
          onClick={() => setMode('name')}
        >
          <FileText aria-hidden className="size-3" />
          文件名
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'content'}
          className={mode === 'content' ? 'wb-file-search-mode active' : 'wb-file-search-mode'}
          onClick={() => setMode('content')}
        >
          <SearchCode aria-hidden className="size-3" />
          内容
        </button>
      </div>

      <div className="wb-file-search-row">
        <input
          type="text"
          aria-label="搜索远程文件"
          className="wb-file-search-input"
          placeholder={mode === 'name' ? '文件名片段，如 nginx' : '要搜的内容，如 Out of memory'}
          value={query}
          disabled={!ready}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run()
          }}
        />
        <Button
          variant="outline"
          size="sm"
          aria-label="搜索"
          onClick={() => void run()}
          disabled={!ready || busy || query.trim() === ''}
        >
          {busy ? (
            <Loader2 aria-hidden className="size-3 animate-spin" />
          ) : (
            <Search aria-hidden className="size-3" />
          )}
        </Button>
      </div>

      {!ready && (
        <p className="wb-file-search-hint">
          没连上服务器 · 先在终端连上一台，这里才有可搜的机器。
        </p>
      )}

      {ready && (
        <p className="wb-file-search-hint">
          {`在 ${rootPath} 下面找${mode === 'name' ? '文件名' : '文件内容'}`}
        </p>
      )}

      {error && (
        <Notice className="wb-file-search-notice" tone="error" title="搜索没做成">
          {error}
        </Notice>
      )}

      {empty && <p className="wb-file-search-hint">没有匹配 · 换个关键词或把范围缩小到某个子目录。</p>}

      {truncated && !error && (
        <p className="wb-file-search-hint" data-dom-id="file-search-truncated">
          {`结果已到上限（${mode === 'name' ? '50' : '100'} 条），可能不全 —— 后面还有没列出来的。`}
        </p>
      )}

      {(files.length > 0 || matches.length > 0) && (
        <ul className="wb-file-search-results">
          {files.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                className="wb-file-search-item"
                title={f.path}
                onClick={() => onOpenFile({ path: f.path, name: f.name })}
              >
                <FileText aria-hidden className="size-3 shrink-0" />
                <span className="wb-file-search-name">{f.name}</span>
                <span className="wb-file-search-path">{f.path}</span>
              </button>
            </li>
          ))}
          {matches.map((m, i) => (
            <li key={`${m.file}:${m.line}:${i}`}>
              <button
                type="button"
                className="wb-file-search-item"
                title={`${m.file}:${m.line}`}
                onClick={() => onOpenFile({ path: m.file, name: basename(m.file), line: m.line })}
              >
                <span className="wb-file-search-name">{basename(m.file)}</span>
                <span className="wb-file-search-line">{`第 ${m.line} 行`}</span>
                <span className="wb-file-search-text">{m.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
