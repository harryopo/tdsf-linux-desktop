/**
 * EditorArea — 标签栏 + 多终端 + 远程文件编辑
 *
 * // @ai-session: ai-claude-20260720-wb3
 * // @ai-task: overnight-phase-B-editor-io
 *
 * - shell:*：一条打开的终端通道（同一条 SSH 连接可以有多个），全部挂着只显活跃的那个
 * - file:*：sftpReadFile / sftpWriteFile
 * - 一个都没有时是空态 + 主行动按钮（不再是三行灰字把人停在原地）
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ContextMenu,
  type ContextMenuEntry,
  Button,
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
} from '@/ui'
import { toast } from 'sonner'
import {
  Terminal as TerminalIcon,
  FileText,
  Save,
  Loader2,
  X,
  Languages,
  Monitor,
  Plus,
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
import { useTerminalStore, shellTabLabel, visibleShells } from '@/stores/terminal-store'
import { closeShell, openLocalShell, openShell, sessionTitle } from '@/terminal/shell-launcher'
import { Zap } from 'lucide-react'
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

/**
 * 编辑器区的一个标签页身份
 *
 * shell:<shellId> —— 一条打开的终端（一条 SSH 连接可以有多个）
 * file:<远程路径> —— 一个文件
 *
 * 以前这里是 `'tab-terminal'` 一个写死的哨兵：意味着"终端"永远只有一个格子，
 * 主进程也只给一条连接开一个 shell。2026-10-10 起身份换成 shellId，
 * 判断必须走 isShellTab()，不许再比较字面量。
 */
export type WorkbenchTabId = `shell:${string}` | `file:${string}`

/** 终端标签 id */
export function shellTabId(shellId: string): WorkbenchTabId {
  return `shell:${shellId}`
}

/** 从标签 id 还原 shellId（不是终端标签或没有标签时返回 null） */
export function shellIdOfTab(tabId: WorkbenchTabId | null): string | null {
  return tabId && tabId.startsWith('shell:') ? tabId.slice('shell:'.length) : null
}

/** 是不是终端标签 */
export function isShellTab(tabId: WorkbenchTabId | null): boolean {
  return tabId !== null && tabId.startsWith('shell:')
}

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
  /** 当前标签；null = 一个都没开（一个终端也没有、也没打开文件），显示空态 */
  activeTabId: WorkbenchTabId | null
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

const TerminalPanel: FC<{
  /** 当前 SSH 会话；null = 还没连上任何主机 */
  sessionId: string | null
  /** 本面板是否可见（非活跃标签时隐藏但保留滚动缓冲） */
  visible: boolean
  /** 点"新建终端"：由父层负责真正开一条通道并报告失败原因 */
  onOpenShell: () => void
  /** 点"开一个本机终端"：同样由父层报告失败原因 */
  onOpenLocalShell: () => void
}> = ({ sessionId, visible, onOpenShell, onOpenLocalShell }) => {
  const navigate = useNavigate()
  // 同一条连接上的多个终端：全部挂着，只把活跃的那个显示出来（保住各自的滚动缓冲）
  const shells = useTerminalStore((s) => s.shells)
  const activeShellId = useTerminalStore((s) => s.activeShellId)
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

  // 本机终端不受会话影响，永远在这一屏里（见 visibleShells 的说明）
  const sessionShells = visibleShells(shells, sessionId)

  if (sessionShells.length > 0) {
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
            <Zap aria-hidden className="term-pending-cmd-icon size-3" />
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
              <X aria-hidden className="size-3" />
            </button>
          </div>
        )}
        {/* 终端视图：包裹层 flex:1 确保高度占满剩余空间（.terminal-view 为 height:100%） */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {sessionShells.map((shell) => (
            <TerminalView
              key={shell.shellId}
              shellId={shell.shellId}
              kind={shell.kind}
              visible={visible && shell.shellId === activeShellId}
            />
          ))}
        </div>
        {/* v0.8.0 选词翻译浮层（createPortal 到 body，全局唯一实例） */}
        <SelectionPopover />
      </div>
    )
  }
  // 空态必须给下一步（DESIGN.md §5）：以前这里只有三行灰字，人停在原地不知道点哪儿
  return (
    <div className="term-empty">
      <TerminalIcon />
      <div className="term-empty-text">
        {sessionId ? '这条连接还没开终端' : '终端待连接'}
      </div>
      <div className="term-empty-hint">
        {sessionId
          ? '一个终端跑一个任务；并排看输出就再开一个'
          : '本机终端不用连服务器就能练命令；要管远程机器再去 SSH 设置连一台'}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {sessionId ? (
          <Button variant="solid" size="sm" onClick={onOpenShell}>
            <Plus aria-hidden className="size-3" />
            在这台主机开一个终端
          </Button>
        ) : (
          <Button variant="solid" size="sm" onClick={onOpenLocalShell}>
            <Plus aria-hidden className="size-3" />
            开一个本机终端
          </Button>
        )}
        {sessionId ? (
          <Button variant="outline" size="sm" onClick={onOpenLocalShell}>
            开一个本机终端
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => void navigate('#/settings/ssh')}>
            去连接服务器
          </Button>
        )}
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
  const navigate = useNavigate()
  const setActiveFilePath = useEditorStore((s) => s.setActiveFilePath)
  const setCursorPosition = useEditorStore((s) => s.setCursorPosition)
  const [savingId, setSavingId] = useState<string | null>(null)

  /** 外部变更提示：path 集合（表示该文件有未处理的外部变更） */
  const [changedFiles, setChangedFiles] = useState<Set<string>>(new Set())
  /** path → watchId 映射（null 表示 fileWatchStart 进行中）；用于 fileWatchStop */
  const watchIdMapRef = useRef<Map<string, string | null>>(new Map())

  /** 本机这一窗口开着的终端（按会话过滤后才是标签） */
  const shells = useTerminalStore((s) => s.shells)
  const setActiveShell = useTerminalStore((s) => s.setActiveShell)

  /** 这一屏的终端标签：本机终端永远在，远端只显示当前会话的 */
  const sessionShells = useMemo(
    () => visibleShells(shells, activeSessionId),
    [shells, activeSessionId],
  )

  /**
   * 新开一个终端
   *
   * 失败一定要 toast：以前这类"点了没动静"最难查——主进程抛的原因被渲染层吞了，
   * 用户只看到标签少一个。
   */
  /** 开一条本机终端（不连 SSH 也能敲命令；不可用时把原因显示出来） */
  const handleOpenLocalShell = useCallback(async () => {
    const result = await openLocalShell()
    if (!result.ok) {
      toast.error(`本机终端开不出来：${result.reason}`)
      return
    }
    onTabChange(shellTabId(result.shellId))
  }, [onTabChange])

  const handleOpenShell = useCallback(async () => {
    if (!activeSessionId) return
    const result = await openShell(activeSessionId, sessionTitle(activeSessionId))
    if (!result.ok) {
      toast.error(`开终端失败：${result.reason}`)
      return
    }
    onTabChange(shellTabId(result.shellId))
  }, [activeSessionId, onTabChange])

  /** 关一个终端：只关这条通道，SSH 连接与其它终端不动 */
  const handleCloseShell = useCallback((shellId: string) => {
    void closeShell(shellId)
  }, [])

  const tabs = useMemo(() => {
    const list: Array<{
      id: WorkbenchTabId
      label: string
      /** local / ssh 决定标签图标，file 是文件 */
      kind: 'local' | 'ssh' | 'file'
      dirty?: boolean
    }> = [
      ...sessionShells.map((s) => ({
        id: shellTabId(s.shellId),
        label: shellTabLabel(s, sessionShells),
        kind: s.kind,
      })),
      ...fileTabs.map((f) => ({
        id: f.id,
        label: f.dirty ? `${f.name} •` : f.name,
        kind: 'file' as const,
        dirty: f.dirty,
      })),
    ]
    return list
  }, [sessionShells, fileTabs])

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
    (tabId: WorkbenchTabId): ContextMenuEntry[] => {
      const otherCount = fileTabs.filter((t) => t.id !== tabId).length
      return [
        {
          key: 'close',
          label: '关闭',
          disabled: !onCloseFile,
          onSelect: () => onCloseFile?.(tabId),
        },
        {
          key: 'close-others',
          label: `关闭其他${otherCount > 0 ? ` (${otherCount})` : ''}`,
          disabled: !onCloseOthers || otherCount === 0,
          onSelect: () => onCloseOthers?.(tabId),
        },
        {
          key: 'close-all',
          label: `关闭所有${fileTabs.length > 0 ? ` (${fileTabs.length})` : ''}`,
          disabled: !onCloseAll || fileTabs.length === 0,
          onSelect: () => onCloseAll?.(),
        },
      ]
    },
    [fileTabs, onCloseFile, onCloseOthers, onCloseAll],
  )

  return (
    <div className="term-editor-area">
      <div
        className="term-tab-bar"
        role="tablist"
        aria-label="编辑器标签"
        onKeyDown={(e) => {
          // 既然对外声明了 tablist，方向键就得真的能换标签（只用鼠标点不算能用）
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          const order = tabs.map((t) => t.id)
          if (activeTabId === null) return
          const at = order.indexOf(activeTabId)
          if (at < 0 || order.length < 2) return
          const step = e.key === 'ArrowRight' ? 1 : order.length - 1
          const next = order[(at + step) % order.length]
          e.preventDefault()
          onTabChange(next)
          // 焦点跟着走，否则键盘用户按完方向键，光标还停在旧标签上
          requestAnimationFrame(() => {
            document.querySelector<HTMLElement>(`[data-tab-id="${next}"]`)?.focus()
          })
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const shellId = shellIdOfTab(tab.id)
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
                role="tab"
                aria-selected={isActive}
                data-tab-id={tab.id}
                onClick={() => {
                  // 切到终端标签时同步 store 的活跃指针：AI 面板与决策页
                  // 的"投进终端"读的是它，不同步就会把命令打进上一个终端里
                  if (shellId) setActiveShell(shellId)
                  onTabChange(tab.id)
                }}
              >
                {tab.kind === 'local' ? (
                  <Monitor aria-hidden />
                ) : tab.kind === 'ssh' ? (
                  <TerminalIcon aria-hidden />
                ) : (
                  <FileText aria-hidden />
                )}
                <span className="term-tab-label">{tab.label}</span>
              </button>
              <button
                type="button"
                title={shellId ? '关闭终端' : '关闭'}
                className="term-tab-close"
                aria-label={shellId ? `关闭终端 ${tab.label}` : `关闭 ${tab.label}`}
                onClick={(e) => {
                  e.stopPropagation()
                  if (shellId) handleCloseShell(shellId)
                  else onCloseFile?.(tab.id)
                }}
              >
                <X />
              </button>
            </div>
          )
          // P1-4：文件 Tab 支持右键菜单（关闭 / 关闭其他 / 关闭所有）；
          // 终端标签不放那套菜单——它的"关闭其他"语义会让人误关掉正在跑任务的终端
          if (!shellId) {
            return (
              <ContextMenu key={tab.id} items={buildFileContextMenuItems(tab.id)}>
                {tabInner}
              </ContextMenu>
            )
          }
          return tabInner
        })}
        {/*
          新建终端：两个语义都给（用户明确要求）
          - 同一条 SSH 连接上能真开两个终端（一个跑服务、一个看日志）
          - 连一台新主机（去 SSH 设置，那儿是凭据与连接的唯一入口）
          以前这里是两个 A 级死按钮（"分屏（开发中）""更多（开发中）"），纯装饰无 handler。
          触发器叫"新建终端菜单"而不是"新建终端"：空态里已经有那个主行动按钮，
          两个同名控件读屏里分不开（e2e 的 strict-mode 也是这么发现的）。
        */}
        <Menu>
          <MenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="term-tab-new shrink-0"
              title="新建终端菜单"
              aria-label="新建终端菜单"
              data-dom-id="workbench-new-terminal"
            >
              <Plus aria-hidden className="size-3.5" />
            </Button>
          </MenuTrigger>
          <MenuContent align="start" className="min-w-[260px]">
            <MenuItem
              disabled={!activeSessionId}
              title={activeSessionId ? undefined : '先连接一台服务器，才能在这台主机上再开一个终端'}
              onSelect={() => void handleOpenShell()}
            >
              <span className="text-md text-ink">在这台主机再开一个终端</span>
            </MenuItem>
            <MenuItem onSelect={() => void handleOpenLocalShell()}>
              <span className="text-md text-ink">开一个本机终端</span>
            </MenuItem>
            <MenuItem onSelect={() => navigate('#/settings/ssh')}>
              <span className="text-md text-ink">连接新主机</span>
            </MenuItem>
          </MenuContent>
        </Menu>
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
              toast.error(
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
        {activeTabId && isShellTab(activeTabId) ? (
          <TerminalPanel
            sessionId={activeSessionId}
            visible
            onOpenShell={() => void handleOpenShell()}
            onOpenLocalShell={() => void handleOpenLocalShell()}
          />
        ) : activeFile ? (
          <FileEditorPanel
            tab={activeFile}
            saving={savingId === activeFile.id}
            onChange={(c) => onFileContentChange?.(activeFile.id, c)}
            onSave={() => void handleSave()}
          />
        ) : (
          // 空态给下一步（DESIGN.md §5）：光写"从左侧打开文件"等于把人说服在原地
          <div className="term-file-empty">
            <div>从左侧文件树打开远程文件，或开一个终端</div>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <Button size="sm" variant="solid" onClick={() => void handleOpenLocalShell()}>
                <Plus aria-hidden className="size-3" />
                开一个本机终端
              </Button>
              {activeSessionId ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleOpenShell()}
                >
                  在这台主机再开一个终端
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate('#/settings/ssh')}
                >
                  去连接服务器
                </Button>
              )}
            </div>
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
