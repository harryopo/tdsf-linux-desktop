/**
 * 预览面板（W5）
 *
 * 三种内容三种走法：
 * - 端口 / HTML 文件 → iframe，src 是 tdsf-preview://<token>/…
 * - Markdown → 走渲染层自己的安全渲染器（产出 React 元素，不拼 HTML），不套 iframe
 *
 * iframe 上 `sandbox="allow-scripts"` 且**不给 allow-same-origin**：被预览的远端页面
 * 因此跑在不透明源里，读不到本应用的 DOM、存储与 cookie；它能请求的只有自己的 token
 * 名下那一笼资源（主进程侧还有一层 CSP 把出网口收到 'self'）。
 */
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/ui'
import { MarkdownMessage } from './panels/MarkdownMessage'
import { rendersAsMarkdown, type PreviewTab } from '@/stores/preview-store'
import { isElectronAPIAvailable } from '@/utils/electron-api'

export interface PreviewPaneProps {
  tab: PreviewTab
}

export function PreviewPane({ tab }: PreviewPaneProps) {
  const asMarkdown = rendersAsMarkdown(tab.entryPath)
  // 刷新靠重挂：iframe 换个 key 就会重新请求（响应头是 no-store，不会吃到旧缓存）
  const [nonce, setNonce] = useState(0)
  const [doc, setDoc] = useState<{ loading: boolean; text: string; error: string | null }>({
    loading: asMarkdown,
    text: '',
    error: null,
  })

  useEffect(() => {
    if (!asMarkdown) return
    let cancelled = false
    setDoc({ loading: true, text: '', error: null })
    if (!isElectronAPIAvailable() || !window.electronAPI?.previewReadText) {
      setDoc({ loading: false, text: '', error: '当前环境不支持预览（非 Electron 运行时）' })
      return
    }
    window.electronAPI
      .previewReadText(tab.token)
      .then((text) => {
        if (!cancelled) setDoc({ loading: false, text, error: null })
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setDoc({ loading: false, text: '', error: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [asMarkdown, tab.token, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas" data-dom-id="wb-preview">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-2 py-1">
        <span className="min-w-0 flex-1 truncate text-caption text-ink-mute" title={tab.entryPath ?? tab.url}>
          {tab.target.kind === 'port'
            ? `隧道 → 远端 127.0.0.1:${tab.target.port}`
            : tab.entryPath}
        </span>
        <Button size="sm" variant="ghost" onClick={reload} title="重新请求这一页">
          <RefreshCw className="size-3.5" />
          刷新
        </Button>
      </div>

      {asMarkdown ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {doc.loading ? <p className="text-caption text-ink-mute">正在读取远端文件…</p> : null}
          {doc.error ? <p className="text-caption text-error-text">{doc.error}</p> : null}
          {!doc.loading && !doc.error ? <MarkdownMessage content={doc.text} /> : null}
        </div>
      ) : (
        <iframe
          key={`${tab.token}-${nonce}`}
          className="min-h-0 flex-1 border-0 bg-white"
          sandbox="allow-scripts"
          title={`预览 ${tab.title}`}
          src={tab.url}
        />
      )}
    </div>
  )
}
