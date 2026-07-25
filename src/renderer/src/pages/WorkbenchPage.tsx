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
 */
import { useCallback, useState, type FC } from 'react'
import { useNavigate } from 'react-router-dom'
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
import '@/styles/workbench-density.css'
import '@/components/workbench/Workbench.css'

export const WorkbenchPage: FC = () => {
  const navigate = useNavigate()
  const [activeTabId, setActiveTabId] = useState<WorkbenchTabId>('tab-terminal')
  const [activeFilePath, setActiveFilePath] = useState<string | undefined>()
  const [fileTabs, setFileTabs] = useState<WorkbenchFileTab[]>([])
  const [aiPanelVisible, setAiPanelVisible] = useState(true)

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

  const handleCloseFile = useCallback(
    (tabId: WorkbenchTabId) => {
      setFileTabs((prev) => prev.filter((t) => t.id !== tabId))
      if (activeTabId === tabId) {
        setActiveTabId('tab-terminal')
        setActiveFilePath(undefined)
      }
    },
    [activeTabId],
  )

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

  return (
    <div
      className="wb-shell flex h-full w-full flex-col overflow-hidden"
      aria-label="AI 工作台"
    >
      <WorkbenchTitlebar
        aiPanelVisible={aiPanelVisible}
        onToggleAI={() => setAiPanelVisible((v) => !v)}
        onToggleTerminal={() => setActiveTabId('tab-terminal')}
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
            onFileContentChange={handleFileContentChange}
            onFileLoaded={handleFileLoaded}
            onFileSaved={handleFileSaved}
          />
        </div>

        {aiPanelVisible && <AIPanel onClose={() => setAiPanelVisible(false)} />}
      </div>

      <StatusBar />
    </div>
  )
}

export default WorkbenchPage
