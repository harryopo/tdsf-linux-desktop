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
import MonacoEditor, { type MonacoEditorLanguage } from './MonacoEditor'
import { useServerStore } from '@/stores/server-store'
import { useEditorStore } from '@/stores/editor-store'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import type { OpenFileRequest } from './FileTree'

/**
 * 根据文件扩展名识别 Monaco 语言标识
 *
 * 用于 MonacoEditor 的 language prop，控制语法高亮
 */
function detectLanguage(filePath: string): MonacoEditorLanguage {
  const ext = filePath.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? ''
  switch (ext) {
    case 'sh':
    case 'bash':
      return 'shell'
    case 'py':
      return 'python'
    case 'json':
      return 'json'
    case 'yaml':
    case 'yml':
      return 'yaml'
    case 'md':
    case 'markdown':
      return 'markdown'
    case 'conf':
    case 'cfg':
    case 'ini':
      return 'ini'
    default:
      return 'plaintext'
  }
}

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
      <div className="min-h-0 flex-1">
        <MonacoEditor
          value={tab.content}
          language={detectLanguage(tab.path)}
          path={tab.path}
          onChange={onChange}
          onSave={onSave}
        />
      </div>
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
  const setActiveFilePath = useEditorStore((s) => s.setActiveFilePath)
  const setCursorPosition = useEditorStore((s) => s.setCursorPosition)
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

  // 切换 Tab 时同步 editor-store 的 activeFilePath（供 StatusBar 显示）
  // 终端 tab 或无激活文件时清空光标位置
  useEffect(() => {
    if (activeFile) {
      setActiveFilePath(activeFile.path)
    } else {
      setActiveFilePath(null)
      setCursorPosition(null)
    }
  }, [activeFile, setActiveFilePath, setCursorPosition])

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
      {/* 标签栏 — 设计稿高度 40px */}
      <div className="flex h-10 shrink-0 items-stretch border-b border-[var(--trae-border-neutral-l1)]">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const isTerm = tab.id === 'tab-terminal'
          return (
            <div
              key={tab.id}
              className={cn(
                'group relative flex h-10 items-center gap-2 border-r border-[var(--trae-border-neutral-l1)] px-3.5 text-[13px]',
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
                className="inline-flex items-center gap-2"
                onClick={() => onTabChange(tab.id)}
              >
                {isTerm ? (
                  <TerminalIcon className="size-4" />
                ) : (
                  <FileText className="size-4" />
                )}
                <span className="max-w-[140px] truncate">{tab.label}</span>
              </button>
              {!isTerm && (
                <button
                  type="button"
                  title="关闭"
                  className="ml-1 rounded p-0.5 opacity-0 hover:bg-[var(--trae-bg-overlay-l2)] group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseFile?.(tab.id)
                  }}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          )
        })}
        <div className="flex flex-1 items-center justify-end gap-1.5 px-3">
          <button
            type="button"
            title="分屏"
            onClick={() => { /* TODO: 分屏功能 */ }}
            className="flex size-8 items-center justify-center rounded text-[var(--trae-text-tertiary)] transition-colors duration-150 hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-secondary)] active:scale-95"
          >
            <Columns2 className="size-4" />
          </button>
          <button
            type="button"
            title="更多"
            onClick={() => { /* TODO: 更多选项菜单 */ }}
            className="flex size-8 items-center justify-center rounded text-[var(--trae-text-tertiary)] transition-colors duration-150 hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-secondary)] active:scale-95"
          >
            <MoreHorizontal className="size-4" />
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
