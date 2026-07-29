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
import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react'
import { message, Dropdown, type MenuProps } from 'antd'
import {
  Terminal as TerminalIcon,
  FileText,
  Save,
  Loader2,
  X,
  Languages,
} from 'lucide-react'
import { cn } from '@/components/trae/utils'
import TerminalView from '@/components/terminal/TerminalView'
import SelectionPopover from '@/components/terminal/SelectionPopover'
import '../terminal/Terminal.css'
import MonacoEditor, { type MonacoEditorLanguage } from './MonacoEditor'
import FileChangeNotice from './FileChangeNotice'
import { useServerStore } from '@/stores/server-store'
import { useEditorStore } from '@/stores/editor-store'
import { useTranslateStore } from '@/stores/translate-store'
// v2.6 修复：AI 命令预测回显条此前只渲染在从未被挂载的 TerminalTabs（死文件）里，
// setPendingCommand 写的 store 没有消费者 —— 搜到真实终端面板这里渲染
import { useTerminalStore } from '@/stores/terminal-store'
import { ThunderboltOutlined, CloseOutlined } from '@ant-design/icons'
import '../terminal/TerminalTabs.css'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import type { OpenFileRequest } from './FileTree'
import type { FileChangedPayload } from '@preload/index'

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
  /** P1-4：关闭其他文件 Tab（保留 keepTabId，关闭其余所有文件） */
  onCloseOthers?: (keepTabId: WorkbenchTabId) => void
  /** P1-4：关闭所有文件 Tab（终端 tab 不在内，始终保留） */
  onCloseAll?: () => void
  onFileContentChange?: (tabId: WorkbenchTabId, content: string) => void
  onFileLoaded?: (tabId: WorkbenchTabId, content: string, error?: string) => void
  onFileSaved?: (tabId: WorkbenchTabId, content: string) => void
}

const TerminalPanel: FC<{ sessionId: string | null; visible: boolean }> = ({
  sessionId,
  visible,
}) => {
  // v0.8.0 终端翻译开关状态（与 translate-store 联动，persist 持久化）
  const translateEnabled = useTranslateStore((s) => s.enabled)
  const toggleTranslate = useTranslateStore((s) => s.toggleEnabled)
  // v2.6：AI 注入命令预测回显条（从死文件 TerminalTabs 迁入真实挂载点，12s 自动消隐）
  const pendingCommand = useTerminalStore((s) => s.pendingCommand)
  const setPendingCommand = useTerminalStore((s) => s.setPendingCommand)
  useEffect(() => {
    if (!pendingCommand) return
    const timer = setTimeout(() => setPendingCommand(null), 12_000)
    return () => clearTimeout(timer)
  }, [pendingCommand, setPendingCommand])

  if (sessionId) {
    return (
      <div className="term-panel" style={{ display: 'flex', flexDirection: 'column' }}>
        {/* v0.8.0 翻译开关工具栏 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '4px 8px',
            flexShrink: 0,
            borderBottom: '1px solid var(--trae-border-neutral-l1)',
          }}
        >
          <button
            type="button"
            className={`term-translate-toggle ${translateEnabled ? 'term-translate-toggle-active' : ''}`}
            onClick={toggleTranslate}
            aria-label="切换翻译功能"
            title={translateEnabled ? '关闭终端翻译' : '开启终端翻译（鼠标滑动选词触发）'}
          >
            <Languages />
            <span className="term-translate-text">
              {translateEnabled ? '翻译 ON' : '翻译 OFF'}
            </span>
          </button>
        </div>
        {/* v2.6：AI 命令预测回显条 —— AI/决策页注入命令时立即可见，对应终端内真实回显 */}
        {pendingCommand && (
          <div className="term-pending-cmd">
            <ThunderboltOutlined className="term-pending-cmd-icon" />
            <span className="term-pending-cmd-label">AI 已注入命令</span>
            <code className="term-pending-cmd-text" title={pendingCommand.command}>
              {pendingCommand.command.split('\n')[0]}
              {pendingCommand.command.includes('\n') ? ' …' : ''}
            </code>
            <button
              type="button"
              className="term-pending-cmd-close"
              aria-label="关闭回显提示"
              onClick={() => setPendingCommand(null)}
            >
              <CloseOutlined />
            </button>
          </div>
        )}
        {/* 终端视图：包裹层 flex:1 确保高度占满剩余空间（.terminal-view 为 height:100%） */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <TerminalView sessionId={sessionId} visible={visible} />
        </div>
        {/* v0.8.0 选词翻译浮层（createPortal 到 body，全局唯一实例） */}
        <SelectionPopover />
      </div>
    )
  }
  return (
    <div className="term-empty">
      <TerminalIcon />
      <div className="term-empty-text">
        终端待连接
      </div>
      <div className="term-empty-hint">
        请在左侧资源管理器连接服务器
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
      <div className="term-file-loading">
        <Loader2 className="term-spin" />
        读取 {tab.path}…
      </div>
    )
  }
  if (tab.error) {
    return (
      <div className="term-file-error">
        <div className="term-file-error-msg">{tab.error}</div>
        <div className="term-file-error-path">{tab.path}</div>
      </div>
    )
  }
  return (
    <div className="term-file-editor">
      <div className="term-file-header">
        <span className="term-file-path">
          {tab.path}
          {tab.dirty ? ' · 未保存' : ''}
        </span>
        <button
          type="button"
          onClick={onSave}
          disabled={!tab.dirty || saving}
          className="term-save-btn"
        >
          {saving ? <Loader2 className="term-spin" /> : <Save />}
          保存
        </button>
      </div>
      <div className="term-file-editor-body">
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
  onCloseOthers,
  onCloseAll,
  onFileContentChange,
  onFileLoaded,
  onFileSaved,
}) => {
  const activeSessionId = useServerStore((s) => s.activeSessionId)
  const setActiveFilePath = useEditorStore((s) => s.setActiveFilePath)
  const setCursorPosition = useEditorStore((s) => s.setCursorPosition)
  const [savingId, setSavingId] = useState<string | null>(null)

  /** 外部变更提示：path 集合（表示该文件有未处理的外部变更） */
  const [changedFiles, setChangedFiles] = useState<Set<string>>(new Set())
  /** path → watchId 映射（null 表示 fileWatchStart 进行中）；用于 fileWatchStop */
  const watchIdMapRef = useRef<Map<string, string | null>>(new Map())

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
  /** 当前激活文件的远程路径（终端 tab 或无激活文件时为 null） */
  const activeFilePath = activeFile?.path ?? null

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

  // ===== FileWatcher：监听远程文件外部变更 =====
  // 1. 全局监听 onFileChanged 事件，将变更路径加入 changedFiles
  // 2. fileTabs 变化时，为新打开的文件 fileWatchStart，为已关闭的文件 fileWatchStop
  // 3. 会话切换 / 组件卸载时停止所有监听
  // 注意：实际 IPC 签名 fileWatchStart 返回 { watchId }，fileWatchStop(watchId)，
  //       因此用 watchIdMapRef 维护 path → watchId 映射（null 表示启动中）。
  useEffect(() => {
    if (!isElectronAPIAvailable() || !window.electronAPI.onFileChanged) return

    const off = window.electronAPI.onFileChanged((payload: FileChangedPayload) => {
      setChangedFiles((prev) => {
        const next = new Set(prev)
        next.add(payload.path)
        return next
      })
    })

    return () => {
      off()
    }
  }, [])

  // 当前打开文件变化时启动/停止监听
  useEffect(() => {
    if (!isElectronAPIAvailable()) return
    const api = window.electronAPI
    if (!api.fileWatchStart || !api.fileWatchStop || !activeSessionId) return

    const currentPaths = new Set(
      fileTabs
        .filter((t) => t.id.startsWith('file:'))
        .map((t) => t.id.slice('file:'.length)),
    )

    // 启动当前打开但尚未监听（且不在启动中）的文件监听
    for (const path of currentPaths) {
      if (watchIdMapRef.current.has(path)) continue
      // 标记为启动中，防止并发重复 fileWatchStart
      watchIdMapRef.current.set(path, null)
      void api
        .fileWatchStart(activeSessionId, path)
        .then(({ watchId }) => {
          // 启动完成：若 path 仍在监听集合（值仍为 null），写入 watchId；
          // 若已被移除（文件已关闭 / 会话已切换），立即停止以避免泄漏
          if (watchIdMapRef.current.get(path) === null) {
            watchIdMapRef.current.set(path, watchId)
          } else {
            void api.fileWatchStop(watchId).catch(() => {})
          }
        })
        .catch(() => {
          // 监听启动失败：移除标记，不影响编辑
          watchIdMapRef.current.delete(path)
        })
    }

    // 停止已关闭文件的监听
    for (const [path, watchId] of watchIdMapRef.current) {
      if (currentPaths.has(path)) continue
      if (watchId) {
        void api.fileWatchStop(watchId).catch(() => {})
      }
      watchIdMapRef.current.delete(path)
    }
  }, [fileTabs, activeSessionId])

  // 会话切换 / 组件卸载时停止所有监听
  useEffect(() => {
    return () => {
      if (!isElectronAPIAvailable() || !window.electronAPI.fileWatchStop) return
      for (const [, watchId] of watchIdMapRef.current) {
        if (watchId) {
          void window.electronAPI.fileWatchStop(watchId).catch(() => {})
        }
      }
      watchIdMapRef.current.clear()
    }
  }, [activeSessionId])

  /**
   * P1-4：构建文件 Tab 右键菜单项
   *
   * 菜单项（与 VS Code 行为对齐）：
   * - 关闭：仅关闭当前 tab（onCloseFile）
   * - 关闭其他：保留当前 tab，关闭其余所有文件（onCloseOthers）
   * - 关闭所有：关闭所有文件 tab（终端 tab 不在内，始终保留）（onCloseAll）
   *
   * 当对应回调未提供时，菜单项禁用。
   */
  const buildFileContextMenuItems = useCallback(
    (tabId: WorkbenchTabId): MenuProps['items'] => {
      const otherCount = fileTabs.filter((t) => t.id !== tabId).length
      return [
        {
          key: 'close',
          label: '关闭',
          disabled: !onCloseFile,
          onClick: () => onCloseFile?.(tabId),
        },
        {
          key: 'close-others',
          label: `关闭其他${otherCount > 0 ? ` (${otherCount})` : ''}`,
          disabled: !onCloseOthers || otherCount === 0,
          onClick: () => onCloseOthers?.(tabId),
        },
        {
          key: 'close-all',
          label: `关闭所有${fileTabs.length > 0 ? ` (${fileTabs.length})` : ''}`,
          disabled: !onCloseAll || fileTabs.length === 0,
          onClick: () => onCloseAll?.(),
        },
      ]
    },
    [fileTabs, onCloseFile, onCloseOthers, onCloseAll],
  )

  return (
    <div className="term-editor-area">
      <div className="term-tab-bar">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const isTerm = tab.id === 'tab-terminal'
          const tabInner = (
            <div
              key={tab.id}
              className={cn(
                'term-tab-item',
                isActive ? 'term-tab-item-active' : '',
              )}
            >
              {isActive && (
                <span className="term-tab-indicator" />
              )}
              <button
                type="button"
                className="term-tab-btn"
                onClick={() => onTabChange(tab.id)}
              >
                {isTerm ? (
                  <TerminalIcon />
                ) : (
                  <FileText />
                )}
                <span className="term-tab-label">{tab.label}</span>
              </button>
              {!isTerm && (
                <button
                  type="button"
                  title="关闭"
                  className="term-tab-close"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseFile?.(tab.id)
                  }}
                >
                  <X />
                </button>
              )}
            </div>
          )
          // P1-4：文件 Tab 支持右键菜单（关闭 / 关闭其他 / 关闭所有）
          if (!isTerm) {
            return (
              <Dropdown
                key={tab.id}
                menu={{ items: buildFileContextMenuItems(tab.id) }}
                trigger={['contextMenu']}
                placement="bottomLeft"
              >
                {tabInner}
              </Dropdown>
            )
          }
          return tabInner
        })}
        {/* P1 修复：移除两个 A 级死按钮"分屏（开发中）""更多（开发中）"——
            纯装饰无 handler，对应能力落地后再恢复按钮 */}
      </div>

      {/* 远程文件外部变更提示 */}
      {activeFilePath && changedFiles.has(activeFilePath) && (
        <FileChangeNotice
          path={activeFilePath}
          onReload={async () => {
            if (!activeSessionId || !activeFilePath) return
            if (!isElectronAPIAvailable() || !window.electronAPI.sftpReadFile) return
            try {
              const content = await window.electronAPI.sftpReadFile(
                activeSessionId,
                activeFilePath,
              )
              onFileContentChange?.(`file:${activeFilePath}`, content)
              setChangedFiles((prev) => {
                const next = new Set(prev)
                next.delete(activeFilePath)
                return next
              })
            } catch (err) {
              message.error(
                `重新加载失败: ${err instanceof Error ? err.message : String(err)}`,
              )
            }
          }}
          onDismiss={() => {
            if (!activeFilePath) return
            setChangedFiles((prev) => {
              const next = new Set(prev)
              next.delete(activeFilePath)
              return next
            })
          }}
        />
      )}

      <div className="term-content-area">
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
          <div className="term-file-empty">
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
