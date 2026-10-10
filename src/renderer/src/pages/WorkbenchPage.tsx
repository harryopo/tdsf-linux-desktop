/**
 * WorkbenchPage — AI 运维工作台（真数据主路径）
 *
 * // @ai-session: ai-claude-20260720-wb3
 * // @ai-task: overnight-phase-A-B-wire
 * // @redesign: 2026-07-23 1:1 对齐 workbench-disconnected.html / workbench-ai.html
 *
 * Boot → /workbench
 * - FileTree: sftpList
 * - EditorArea: TerminalView + sftpRead/Write
 * - AIPanel: agent:chat
 *
 * 1:1 重构说明（2026-07-23）：
 * - 当 activeSessionId 为 null（未连接 SSH）时，在 EditorArea 上方叠加设计稿版
 *   终端空状态浮层（终端窗口模拟 + "连接服务器" 按钮），不修改 EditorArea.tsx
 * - 浮层点击"连接服务器" → 跳转 /settings/ssh（保留 IPC 逻辑）
 * - 视觉尺寸严格对齐设计稿：Titlebar 40px / ActivityRail 48px / NavBtn 36×36 /
 *   FileTree 200px / AIPanel 560px / StatusBar 24px（由 Workbench.css 强制覆盖
 *   workbench-density.css 的错误覆盖）
 *
 * P1-3 工作台文件编辑能力（2026-07-25）：
 * - 关闭未保存文件时弹出三选项确认框，避免误丢数据
 * - "全部保存"按钮一键保存所有未保存文件
 * - 文件 Tab 右键菜单（关闭/关闭其他/关闭所有/全部保存）
 */
import { useCallback, useEffect, useState, type FC } from 'react'
import { toast } from 'sonner'
import { Button, Dialog, DialogContent, confirmDialog } from '@/ui'
import { PanelLeftOpen } from 'lucide-react'
import { WorkbenchTitlebar } from '@/components/workbench/WorkbenchTitlebar'
import FileTree, { type OpenFileRequest } from '@/components/workbench/FileTree'
import EditorArea, {
  createLoadingFileTab,
  fileTabId,
  shellTabId,
  isShellTab,
  type WorkbenchFileTab,
  type WorkbenchTabId,
} from '@/components/workbench/EditorArea'
import AIPanel from '@/components/workbench/AIPanel'
import { StatusBar } from '@/components/workbench/StatusBar'
import { WorkbenchLayout } from '@/shell/workbench-layout'
import { useServerStore } from '@/stores/server-store'
import { useTerminalStore } from '@/stores/terminal-store'
import { openLocalShell, openShell, sessionTitle, syncShells } from '@/terminal/shell-launcher'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import '@/styles/workbench-density.css'
import '@/components/workbench/Workbench.css'

export const WorkbenchPage: FC = () => {
  /**
   * 当前标签：null = 一个终端也没开、也没打开文件（显示空态）
   *
   * 以前初值是写死的 'tab-terminal'，隐含"终端永远只有一个格子"。
   * 现在终端标签是 shell:<shellId>，开几个就有几个。
   */
  const [activeTabId, setActiveTabId] = useState<WorkbenchTabId | null>(null)
  const [activeFilePath, setActiveFilePath] = useState<string | undefined>()
  const [fileTabs, setFileTabs] = useState<WorkbenchFileTab[]>([])
  const [aiPanelVisible, setAiPanelVisible] = useState(true)
  // v2.11：资源管理器折叠态（与 AI 面板对齐，折叠后显一条细边栏可再展开）
  const [fileTreeCollapsed, setFileTreeCollapsed] = useState(false)
  const activeSessionId = useServerStore((s) => s.activeSessionId)
  const activeShellId = useTerminalStore((s) => s.activeShellId)

  /** 关掉文件标签后回哪儿：有终端就回当前终端，一个都没有就是空态 */
  const terminalFallbackTab = useCallback((): WorkbenchTabId | null => {
    const id = useTerminalStore.getState().activeShellId
    return id ? shellTabId(id) : null
  }, [])

  /**
   * 主进程/启动器那边开出一个新终端时，工作台跟着切过去
   *
   * 只在"当前没标签或正看某个终端"时跟：用户正在看文件时不抢焦点，
   * 否则在设置页点一下连接就把人从文件上拽走。
   */
  useEffect(() => {
    if (!activeShellId) return
    setActiveTabId((prev) => (prev === null || isShellTab(prev) ? shellTabId(activeShellId) : prev))
  }, [activeShellId])

  /**
   * 进工作台 / 换会话时和主进程对一次终端表
   *
   * 标签的真值在主进程（它才有那些 ssh2 通道），界面这份只是投影。
   * 页重载、别的窗口开的终端，都靠这一次对账补回来；主进程已关的则被摘掉。
   */
  useEffect(() => {
    void syncShells().catch((err: unknown) => {
      console.warn('[WorkbenchPage] 终端标签对账失败', err)
    })
  }, [activeSessionId])

  /** 终端钮：有终端就聚焦，一个都没有就开一个（点了必须有反应） */
  const focusOrOpenTerminal = useCallback(async () => {
    const store = useTerminalStore.getState()
    // 活跃终端不分本机与远端：只要主进程那边还认，就聚焦它
    if (store.activeShellId && store.shells.some((s) => s.shellId === store.activeShellId)) {
      store.setActiveShell(store.activeShellId)
      setActiveTabId(shellTabId(store.activeShellId))
      return
    }
    if (!activeSessionId) {
      // 没连服务器也能用：本机终端就是为这一步准备的（点了必须有反应，
      // 而不是把人支到设置页去）
      const local = await openLocalShell()
      if (!local.ok) toast.error(`开不出终端：${local.reason}`)
      return
    }
    const result = await openShell(activeSessionId, sessionTitle(activeSessionId))
    if (!result.ok) toast.error(`开终端失败：${result.reason}`)
  }, [activeSessionId])

  const handleOpenFile = useCallback((req: OpenFileRequest) => {
    const id = fileTabId(req.path)
    setFileTabs((prev) => {
      if (prev.some((t) => t.id === id)) return prev
      return [...prev, createLoadingFileTab(req)]
    })
    setActiveTabId(id)
    setActiveFilePath(req.path)
  }, [])

  const handleTabChange = useCallback((tabId: WorkbenchTabId) => {
    setActiveTabId(tabId)
    if (tabId.startsWith('file:')) {
      setActiveFilePath(tabId.slice('file:'.length))
    } else {
      setActiveFilePath(undefined)
    }
  }, [])

  /**
   * 保存单个文件到远程（P1-3：从 EditorArea 抽出共用保存逻辑，
   * 供"全部保存"、关闭前保存等场景复用）
   */
  const saveFile = useCallback(
    async (tab: WorkbenchFileTab): Promise<boolean> => {
      if (!activeSessionId || !isElectronAPIAvailable() || !window.electronAPI.sftpWriteFile) {
        toast.error('无法保存：无 SSH 会话或 sftpWriteFile 不可用')
        return false
      }
      try {
        await window.electronAPI.sftpWriteFile(activeSessionId, tab.path, tab.content)
        setFileTabs((prev) =>
          prev.map((t) =>
            t.id === tab.id
              ? { ...t, content: tab.content, original: tab.content, dirty: false, error: undefined }
              : t,
          ),
        )
        return true
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(`保存 ${tab.name} 失败：${msg}`)
        return false
      }
    },
    [activeSessionId],
  )

  /**
   * 待关闭确认的 Tab（P1-3：未保存文件关闭前二次确认，受控 Modal 用）
   * - null：无待确认 Tab，Modal 不显示
   * - WorkbenchTabId：该 Tab 已修改未保存，Modal 显示，等待用户选择
   */
  const [pendingCloseTabId, setPendingCloseTabId] = useState<WorkbenchTabId | null>(null)
  const pendingCloseTab = pendingCloseTabId
    ? fileTabs.find((t) => t.id === pendingCloseTabId) ?? null
    : null
  const [closing, setClosing] = useState(false)

  /**
   * 关闭文件 Tab（P1-3：未保存时弹出二次确认，避免误丢数据）
   *
   * 行为：
   * - 文件未修改（dirty=false）/ 加载中 / 加载失败 → 直接关闭
   * - 文件已修改（dirty=true）→ 设置 pendingCloseTabId 触发 Modal 显示
   */
  const handleCloseFile = useCallback(
    (tabId: WorkbenchTabId) => {
      const target = fileTabs.find((t) => t.id === tabId)
      if (!target) return
      const directClose = () => {
        setFileTabs((prev) => prev.filter((t) => t.id !== tabId))
        if (activeTabId === tabId) {
          setActiveTabId(terminalFallbackTab())
          setActiveFilePath(undefined)
        }
      }
      if (target.loading || target.error || !target.dirty) {
        directClose()
        return
      }
      // 已修改未保存 → 弹三选项确认 Modal
      setPendingCloseTabId(tabId)
    },
    [activeTabId, fileTabs],
  )

  /** 关闭确认 Modal 内部：直接关闭 Tab（不保存） */
  const closePendingWithoutSave = useCallback(() => {
    if (!pendingCloseTabId) return
    const tabId = pendingCloseTabId
    setPendingCloseTabId(null)
    setFileTabs((prev) => prev.filter((t) => t.id !== tabId))
    if (activeTabId === tabId) {
      setActiveTabId(terminalFallbackTab())
      setActiveFilePath(undefined)
    }
  }, [pendingCloseTabId, activeTabId])

  /** 关闭确认 Modal 内部：保存并关闭 */
  const closePendingWithSave = useCallback(async () => {
    if (!pendingCloseTab) return
    setClosing(true)
    try {
      const ok = await saveFile(pendingCloseTab)
      if (ok) {
        const tabId = pendingCloseTab.id
        setPendingCloseTabId(null)
        setFileTabs((prev) => prev.filter((t) => t.id !== tabId))
        if (activeTabId === tabId) {
          setActiveTabId(terminalFallbackTab())
          setActiveFilePath(undefined)
        }
      }
      // 保存失败：保持 Modal 打开，让用户决定
    } finally {
      setClosing(false)
    }
  }, [pendingCloseTab, saveFile, activeTabId])

  /**
   * 全部保存（P1-3：一键保存所有未保存文件，绑定到 WorkbenchTitlebar 的"全部保存"按钮）
   */
  const handleSaveAll = useCallback(async () => {
    const dirtyTabs = fileTabs.filter((t) => t.dirty && !t.loading && !t.error)
    if (dirtyTabs.length === 0) {
      toast.info('没有未保存的文件')
      return
    }
    let successCount = 0
    for (const tab of dirtyTabs) {
      const ok = await saveFile(tab)
      if (ok) successCount++
    }
    if (successCount === dirtyTabs.length) {
      toast.success(`已保存全部 ${successCount} 个文件`)
    } else {
      toast.warning(`已保存 ${successCount}/${dirtyTabs.length} 个文件，部分失败`)
    }
  }, [fileTabs, saveFile])

  const handleFileContentChange = useCallback((tabId: WorkbenchTabId, content: string) => {
    setFileTabs((prev) =>
      prev.map((t) =>
        t.id === tabId
          ? { ...t, content, dirty: content !== t.original }
          : t,
      ),
    )
  }, [])

  const handleFileLoaded = useCallback(
    (tabId: WorkbenchTabId, content: string, error?: string) => {
      setFileTabs((prev) =>
        prev.map((t) =>
          t.id === tabId
            ? {
                ...t,
                content: error ? t.content : content,
                original: error ? t.original : content,
                loading: false,
                error,
                dirty: false,
              }
            : t,
        ),
      )
    },
    [],
  )

  const handleFileSaved = useCallback((tabId: WorkbenchTabId, content: string) => {
    setFileTabs((prev) =>
      prev.map((t) =>
        t.id === tabId
          ? { ...t, content, original: content, dirty: false, error: undefined }
          : t,
      ),
    )
  }, [])

  /**
   * P1-4：关闭其他文件 Tab
   * - 跳过当前 tab，关闭其余所有文件
   * - 含 dirty 文件时先弹批量确认"丢弃 N 个文件的未保存修改"
   */
  const handleCloseOthers = useCallback(
    async (keepTabId: WorkbenchTabId) => {
      const others = fileTabs.filter((t) => t.id !== keepTabId)
      const dirtyList = others.filter((t) => t.dirty && !t.loading && !t.error)
      const doClose = () => {
        setFileTabs((prev) => prev.filter((t) => t.id === keepTabId))
        // 若当前激活 tab 被关闭（理论上 keepTabId 是激活的，但兜底）
        if (activeTabId !== keepTabId && activeTabId !== null && !isShellTab(activeTabId)) {
          setActiveTabId(keepTabId)
          setActiveFilePath(keepTabId.startsWith('file:') ? keepTabId.slice(5) : undefined)
        }
      }
      if (dirtyList.length === 0) {
        doClose()
        return
      }
      const ok = await confirmDialog({
        title: `丢弃 ${dirtyList.length} 个文件的未保存修改？`,
        description: `将关闭以下 ${dirtyList.length} 个文件并丢失所有未保存的更改：${dirtyList.map((t) => t.name).join('、')}`,
        okText: '丢弃并关闭',
        danger: true,
      })
      if (ok) doClose()
    },
    [fileTabs, activeTabId],
  )

  /**
   * P1-4：关闭所有文件 Tab
   * - 关闭所有文件 tab（终端 tab 不在内，始终保留）
   * - 含 dirty 文件时先弹批量确认
   */
  const handleCloseAll = useCallback(async () => {
    const dirtyList = fileTabs.filter((t) => t.dirty && !t.loading && !t.error)
    const doClose = () => {
      setFileTabs([])
      setActiveTabId(terminalFallbackTab())
      setActiveFilePath(undefined)
    }
    if (dirtyList.length === 0) {
      doClose()
      return
    }
    const ok = await confirmDialog({
      title: `丢弃 ${dirtyList.length} 个文件的未保存修改？`,
      description: `将关闭全部 ${fileTabs.length} 个文件并丢失 ${dirtyList.length} 个文件的未保存更改：${dirtyList.map((t) => t.name).join('、')}`,
      okText: '丢弃并关闭全部',
      danger: true,
    })
    if (ok) doClose()
  }, [fileTabs])

  return (
    <div
      className="wb-shell flex h-full w-full flex-col overflow-hidden"
      aria-label="AI 工作台"
    >
      <WorkbenchTitlebar
        aiPanelVisible={aiPanelVisible}
        onToggleAI={() => setAiPanelVisible((v) => !v)}
        onToggleTerminal={() => void focusOrOpenTerminal()}
        terminalActive={isShellTab(activeTabId)}
        onSaveAll={() => void handleSaveAll()}
        hasUnsavedFiles={fileTabs.some((t) => t.dirty)}
      />

      <WorkbenchLayout
        className="wb-main-body"
        treeOpen={!fileTreeCollapsed}
        aiOpen={aiPanelVisible}
        tree={
          <FileTree
            activeFilePath={activeFilePath}
            onOpenFile={handleOpenFile}
            onCollapse={() => setFileTreeCollapsed(true)}
          />
        }
        editor={
          <div className="flex h-full min-h-0 min-w-0">
            {fileTreeCollapsed ? (
              <button
                type="button"
                title="展开资源管理器"
                aria-label="展开资源管理器"
                onClick={() => setFileTreeCollapsed(false)}
                className="flex w-7 shrink-0 items-start justify-center border-r border-line bg-panel pt-2 text-ink-mute transition-colors hover:bg-hover hover:text-ink"
              >
                <PanelLeftOpen className="size-4" />
              </button>
            ) : null}
            <div className="wb-editor-wrap relative flex min-w-0 flex-1 flex-col">
              <EditorArea
                activeTabId={activeTabId}
                onTabChange={handleTabChange}
                fileTabs={fileTabs}
                onCloseFile={handleCloseFile}
                onCloseOthers={handleCloseOthers}
                onCloseAll={handleCloseAll}
                onFileContentChange={handleFileContentChange}
                onFileLoaded={handleFileLoaded}
                onFileSaved={handleFileSaved}
              />
            </div>
          </div>
        }
        ai={aiPanelVisible ? <AIPanel onClose={() => setAiPanelVisible(false)} /> : undefined}
      />

      <StatusBar />

      {/* P1-3：关闭未保存文件时三选项确认 */}
      <Dialog
        open={pendingCloseTab !== null}
        onOpenChange={(next) => !next && setPendingCloseTabId(null)}
      >
        <DialogContent
          title="未保存的更改"
          description="「不保存关闭」将丢弃该文件所有未保存的更改"
          closeOnOverlayClick={false}
          footer={
            <>
              <Button
                variant="danger"
                disabled={closing}
                onClick={() => {
                  setPendingCloseTabId(null)
                  closePendingWithoutSave()
                }}
              >
                不保存关闭
              </Button>
              <Button disabled={closing} onClick={() => setPendingCloseTabId(null)}>
                取消
              </Button>
              <Button variant="solid" disabled={closing} onClick={() => void closePendingWithSave()}>
                {closing ? '保存中…' : '保存并关闭'}
              </Button>
            </>
          }
        >
          {pendingCloseTab && (
            <p className="text-md text-ink">
              文件 <strong className="font-semibold text-ink-strong">{pendingCloseTab.name}</strong>
              （{pendingCloseTab.path}）有未保存的更改，关闭前是否保存？
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default WorkbenchPage
