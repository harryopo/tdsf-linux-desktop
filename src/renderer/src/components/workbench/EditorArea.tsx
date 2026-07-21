/**
 * EditorArea — 标签栏 + 真终端 + 远程文件编辑
 *
 * // @ai-session: ai-claude-20260720-wb3
 * // @ai-task: overnight-phase-B-editor-io
 *
 * - tab-terminal：TerminalView（有 session）或引导
 * - file:*：sftpReadFile / sftpWriteFile
 * - 仍保留可选 demo 标签（无会话时示意）
 */
import { useCallback, useEffect, useMemo, useState, type FC } from 'react'
import {
  Terminal as TerminalIcon,
  FileText,
  Columns2,
  MoreHorizontal,
  Save,
  Loader2,
  X,
} from 'lucide-react'
import { cn } from '@/components/trae/utils'
import TerminalView from '@/components/terminal/TerminalView'
import { useServerStore } from '@/stores/server-store'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import type { OpenFileRequest } from './FileTree'

export type WorkbenchTabId = 'tab-terminal' | `file:${string}`

export interface WorkbenchFileTab {
  id: WorkbenchTabId
  path: string
  name: string
  content: string
  original: string
  loading: boolean
  error?: string
  dirty: boolean
}

export interface EditorAreaProps {
  activeTabId: WorkbenchTabId
  onTabChange: (tabId: WorkbenchTabId) => void
  fileTabs: WorkbenchFileTab[]
  onCloseFile?: (tabId: WorkbenchTabId) => void
  onFileContentChange?: (tabId: WorkbenchTabId, content: string) => void
  onFileLoaded?: (tabId: WorkbenchTabId, content: string, error?: string) => void
  onFileSaved?: (tabId: WorkbenchTabId, content: string) => void
}

const TerminalPanel: FC<{ sessionId: string | null; visible: boolean }> = ({
  sessionId,
  visible,
}) => {
  if (sessionId) {
    return (
      <div className="relative min-h-0 flex-1 bg-[#0F1011]">
        <TerminalView sessionId={sessionId} visible={visible} />
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-[#0F1011] px-6 text-center">
      <TerminalIcon className="size-8 text-[var(--trae-text-tertiary)]" />
      <div className="text-[13px] text-[var(--trae-text-secondary)]">
        连接 SSH 后，这里显示真实 Shell（xterm）
      </div>
      <div className="max-w-md font-mono text-[11px] leading-5 text-[var(--trae-text-tertiary)]">
        设置 → SSH 连接 → 添加主机并连接，再回到工作台。
      </div>
    </div>
  )
}

const FileEditorPanel: FC<{
  tab: WorkbenchFileTab
  onChange: (content: string) => void
  onSave: () => void
  saving: boolean
}> = ({ tab, onChange, onSave, saving }) => {
  if (tab.loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-[var(--trae-text-tertiary)]">
        <Loader2 className="size-4 animate-spin" />
        读取 {tab.path}…
      </div>
    )
  }
  if (tab.error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <div className="text-[13px] text-[var(--trae-status-error-default)]">{tab.error}</div>
        <div className="font-mono text-[11px] text-[var(--trae-text-tertiary)]">{tab.path}</div>
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] px-3">
        <span className="truncate font-mono text-[11px] text-[var(--trae-text-tertiary)]">
          {tab.path}
          {tab.dirty ? ' · 未保存' : ''}
        </span>
        <button
          type="button"
          onClick={onSave}
          disabled={!tab.dirty || saving}
          className="inline-flex h-7 items-center gap-1.5 rounded-[var(--trae-radius-4)] bg-[var(--trae-bg-brand)] px-2.5 text-[12px] font-medium text-[var(--trae-text-onbrand)] disabled:opacity-40"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          保存
        </button>
      </div>
      <textarea
        value={tab.content}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="min-h-0 flex-1 resize-none border-0 bg-[#0F1011] px-4 py-3 font-mono text-[13px] leading-5 text-[#E0E3EE] outline-none"
      />
    </div>
  )
}

const EditorArea: FC<EditorAreaProps> = ({
  activeTabId,
  onTabChange,
  fileTabs,
  onCloseFile,
  onFileContentChange,
  onFileLoaded,
  onFileSaved,
}) => {
  const activeSessionId = useServerStore((s) => s.activeSessionId)
  const [savingId, setSavingId] = useState<string | null>(null)

  const tabs = useMemo(() => {
    const list: Array<{ id: WorkbenchTabId; label: string; dirty?: boolean }> = [
      { id: 'tab-terminal', label: '终端' },
      ...fileTabs.map((f) => ({
        id: f.id,
        label: f.dirty ? `${f.name} •` : f.name,
        dirty: f.dirty,
      })),
    ]
    return list
  }, [fileTabs])

  // 打开文件时若 content 空且 loading，触发读取
  useEffect(() => {
    const tab = fileTabs.find((f) => f.id === activeTabId)
    if (!tab || !tab.loading) return
    if (!activeSessionId || !isElectronAPIAvailable() || !window.electronAPI.sftpReadFile) {
      onFileLoaded?.(tab.id, '', '无法读取：无会话或 sftpReadFile 不可用')
      return
    }
    let cancelled = false
    void window.electronAPI
      .sftpReadFile(activeSessionId, tab.path)
      .then((text) => {
        if (!cancelled) onFileLoaded?.(tab.id, text)
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        if (!cancelled) onFileLoaded?.(tab.id, '', msg)
      })
    return () => {
      cancelled = true
    }
  }, [activeTabId, fileTabs, activeSessionId, onFileLoaded])

  const activeFile = fileTabs.find((f) => f.id === activeTabId)

  const handleSave = useCallback(async () => {
    if (!activeFile || !activeSessionId) return
    if (!isElectronAPIAvailable() || !window.electronAPI.sftpWriteFile) return
    setSavingId(activeFile.id)
    try {
      await window.electronAPI.sftpWriteFile(
        activeSessionId,
        activeFile.path,
        activeFile.content,
      )
      onFileSaved?.(activeFile.id, activeFile.content)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      onFileLoaded?.(activeFile.id, activeFile.content, `保存失败: ${msg}`)
    } finally {
      setSavingId(null)
    }
  }, [activeFile, activeSessionId, onFileSaved, onFileLoaded])

  // Ctrl+S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleSave])

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-[var(--trae-bg-base-default)]">
      <div className="flex h-9 shrink-0 items-stretch border-b border-[var(--trae-border-neutral-l1)]">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const isTerm = tab.id === 'tab-terminal'
          return (
            <div
              key={tab.id}
              className={cn(
                'group relative flex h-9 items-center gap-1.5 border-r border-[var(--trae-border-neutral-l1)] px-3 text-[12px]',
                isActive
                  ? 'bg-[var(--trae-bg-base-default)] text-[var(--trae-text-default)]'
                  : 'text-[var(--trae-text-secondary)] hover:bg-[var(--trae-bg-overlay-l1)]',
              )}
            >
              {isActive && (
                <span className="absolute inset-x-0 top-0 h-0.5 bg-[var(--trae-bg-brand)]" />
              )}
              <button
                type="button"
                className="inline-flex items-center gap-1.5"
                onClick={() => onTabChange(tab.id)}
              >
                {isTerm ? (
                  <TerminalIcon className="size-3.5" />
                ) : (
                  <FileText className="size-3.5" />
                )}
                <span className="max-w-[140px] truncate">{tab.label}</span>
              </button>
              {!isTerm && (
                <button
                  type="button"
                  title="关闭"
                  className="ml-0.5 rounded p-0.5 opacity-0 hover:bg-[var(--trae-bg-overlay-l2)] group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseFile?.(tab.id)
                  }}
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          )
        })}
        <div className="flex flex-1 items-center justify-end gap-1 px-2">
          <button
            type="button"
            title="分屏（即将支持）"
            className="flex size-7 items-center justify-center rounded text-[var(--trae-text-tertiary)]"
          >
            <Columns2 className="size-3.5" />
          </button>
          <button
            type="button"
            title="更多"
            className="flex size-7 items-center justify-center rounded text-[var(--trae-text-tertiary)]"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {activeTabId === 'tab-terminal' ? (
          <TerminalPanel
            sessionId={activeSessionId}
            visible={activeTabId === 'tab-terminal'}
          />
        ) : activeFile ? (
          <FileEditorPanel
            tab={activeFile}
            saving={savingId === activeFile.id}
            onChange={(c) => onFileContentChange?.(activeFile.id, c)}
            onSave={() => void handleSave()}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-[13px] text-[var(--trae-text-tertiary)]">
            从左侧打开文件
          </div>
        )}
      </div>
    </div>
  )
}

/** 供 WorkbenchPage 打开文件时构造 tab id */
export function fileTabId(path: string): WorkbenchTabId {
  return `file:${path}`
}

export function createLoadingFileTab(req: OpenFileRequest): WorkbenchFileTab {
  return {
    id: fileTabId(req.path),
    path: req.path,
    name: req.name,
    content: '',
    original: '',
    loading: true,
    dirty: false,
  }
}

export default EditorArea
