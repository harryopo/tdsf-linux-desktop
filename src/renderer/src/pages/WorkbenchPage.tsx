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
 * - 关闭未保存文件时弹出 Modal.confirm 二次确认，避免误丢数据
 * - "全部保存"按钮一键保存所有未保存文件
 * - 文件 Tab 右键菜单（关闭/关闭其他/关闭所有/全部保存）
 */
import { useCallback, useState, type FC } from 'react'
import { Modal, message } from 'antd'
import { WorkbenchTitlebar } from '@/components/workbench/WorkbenchTitlebar'
import FileTree, { type OpenFileRequest } from '@/components/workbench/FileTree'
import EditorArea, {
  createLoadingFileTab,
  fileTabId,
  type WorkbenchFileTab,
  type WorkbenchTabId,
} from '@/components/workbench/EditorArea'
import AIPanel from '@/components/workbench/AIPanel'
import { StatusBar } from '@/components/workbench/StatusBar'
import { useServerStore } from '@/stores/server-store'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import '@/styles/workbench-density.css'
import '@/components/workbench/Workbench.css'

export const WorkbenchPage: FC = () => {
  const [activeTabId, setActiveTabId] = useState<WorkbenchTabId>('tab-terminal')
  const [activeFilePath, setActiveFilePath] = useState<string | undefined>()
  const [fileTabs, setFileTabs] = useState<WorkbenchFileTab[]>([])
  const [aiPanelVisible, setAiPanelVisible] = useState(true)
  const activeSessionId = useServerStore((s) => s.activeSessionId)

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
        message.error('无法保存：无 SSH 会话或 sftpWriteFile 不可用')
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
        message.error(`保存 ${tab.name} 失败：${msg}`)
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
          setActiveTabId('tab-terminal')
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
      setActiveTabId('tab-terminal')
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
          setActiveTabId('tab-terminal')
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
      message.info('没有未保存的文件')
      return
    }
    let successCount = 0
    for (const tab of dirtyTabs) {
      const ok = await saveFile(tab)
      if (ok) successCount++
    }
    if (successCount === dirtyTabs.length) {
      message.success(`已保存全部 ${successCount} 个文件`)
    } else {
      message.warning(`已保存 ${successCount}/${dirtyTabs.length} 个文件，部分失败`)
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
    (keepTabId: WorkbenchTabId) => {
      const others = fileTabs.filter((t) => t.id !== keepTabId)
      const dirtyList = others.filter((t) => t.dirty && !t.loading && !t.error)
      const doClose = () => {
        setFileTabs((prev) => prev.filter((t) => t.id === keepTabId))
        // 若当前激活 tab 被关闭（理论上 keepTabId 是激活的，但兜底）
        if (activeTabId !== keepTabId && activeTabId !== 'tab-terminal') {
          setActiveTabId(keepTabId)
          setActiveFilePath(keepTabId.startsWith('file:') ? keepTabId.slice(5) : undefined)
        }
      }
      if (dirtyList.length === 0) {
        doClose()
        return
      }
      Modal.confirm({
        title: `丢弃 ${dirtyList.length} 个文件的未保存修改？`,
        content: `将关闭以下 ${dirtyList.length} 个文件并丢失所有未保存的更改：${dirtyList.map((t) => t.name).join('、')}`,
        okText: '丢弃并关闭',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: () => doClose(),
      })
    },
    [fileTabs, activeTabId],
  )

  /**
   * P1-4：关闭所有文件 Tab
   * - 关闭所有文件 tab（终端 tab 不在内，始终保留）
   * - 含 dirty 文件时先弹批量确认
   */
  const handleCloseAll = useCallback(() => {
    const dirtyList = fileTabs.filter((t) => t.dirty && !t.loading && !t.error)
    const doClose = () => {
      setFileTabs([])
      setActiveTabId('tab-terminal')
      setActiveFilePath(undefined)
    }
    if (dirtyList.length === 0) {
      doClose()
      return
    }
    Modal.confirm({
      title: `丢弃 ${dirtyList.length} 个文件的未保存修改？`,
      content: `将关闭全部 ${fileTabs.length} 个文件并丢失 ${dirtyList.length} 个文件的未保存更改：${dirtyList.map((t) => t.name).join('、')}`,
      okText: '丢弃并关闭全部',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => doClose(),
    })
  }, [fileTabs])

  return (
    <div
      className="wb-shell flex h-full w-full flex-col overflow-hidden"
      aria-label="AI 工作台"
    >
      <WorkbenchTitlebar
        aiPanelVisible={aiPanelVisible}
        onToggleAI={() => setAiPanelVisible((v) => !v)}
        onToggleTerminal={() => setActiveTabId('tab-terminal')}
        onSaveAll={() => void handleSaveAll()}
        hasUnsavedFiles={fileTabs.some((t) => t.dirty)}
      />

      <div className="wb-main-body flex min-h-0 flex-1 overflow-hidden">
        <FileTree activeFilePath={activeFilePath} onOpenFile={handleOpenFile} />

        {/* EditorArea 包裹层 */}
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

        {aiPanelVisible && <AIPanel onClose={() => setAiPanelVisible(false)} />}
      </div>

      <StatusBar />

      {/* P1-3：关闭未保存文件时三选项确认 Modal */}
      <Modal
        open={pendingCloseTab !== null}
        title="未保存的更改"
        okText="保存并关闭"
        cancelText="取消"
        onOk={() => void closePendingWithSave()}
        onCancel={() => setPendingCloseTabId(null)}
        okButtonProps={{ loading: closing }}
        maskClosable={false}
        keyboard={false}
        destroyOnClose
      >
        {pendingCloseTab && (
          <>
            <p>
              文件 <strong>{pendingCloseTab.name}</strong>（{pendingCloseTab.path}）
              有未保存的更改，关闭前是否保存？
            </p>
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                onClick={() => {
                  setPendingCloseTabId(null)
                  closePendingWithoutSave()
                }}
                className="ant-btn ant-btn-default ant-btn-dangerous"
                style={{ marginRight: 8 }}
              >
                不保存关闭
              </button>
              <span style={{ color: 'var(--trae-text-tertiary)', fontSize: 12 }}>
                点击"不保存关闭"将丢弃所有未保存的更改
              </span>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}

export default WorkbenchPage
