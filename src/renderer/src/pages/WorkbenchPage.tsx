/**
 * WorkbenchPage — AI 运维工作台（真数据主路径）
 *
 * // @ai-session: ai-claude-20260720-wb3
 * // @ai-task: overnight-phase-A-B-wire
 *
 * Boot → /workbench
 * - FileTree: sftpList
 * - EditorArea: TerminalView + sftpRead/Write
 * - AIPanel: agent:chat
 */
import { useCallback, useState, type FC } from 'react'
import { useNavigate } from 'react-router-dom'
import { WorkbenchTitlebar } from '@/components/workbench/WorkbenchTitlebar'
import { ActivityRail, type NavId } from '@/components/workbench/ActivityRail'
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

const NAV_ROUTE_MAP: Record<NavId, string> = {
  home: '/workbench',
  tutorial: '/tutorial',
  decision: '/history',
  monitor: '/monitor',
  knowledge: '/knowledge',
  history: '/history',
  logs: '/logs',
  settings: '/settings',
}

export const WorkbenchPage: FC = () => {
  const navigate = useNavigate()
  const [activeNav, setActiveNav] = useState<NavId>('home')
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

  const handleNavigate = useCallback(
    (id: NavId) => {
      setActiveNav(id)
      const path = NAV_ROUTE_MAP[id]
      if (path && path !== '/workbench') navigate(path)
    },
    [navigate],
  )

  return (
    <div
      className="wb-shell flex h-full w-full flex-col overflow-hidden"
      aria-label="AI 工作台"
    >
      <WorkbenchTitlebar
        aiPanelVisible={aiPanelVisible}
        onToggleAI={() => setAiPanelVisible((v) => !v)}
      />

      <div className="wb-main-body flex min-h-0 flex-1 overflow-hidden">
        <ActivityRail activeId={activeNav} onNavigate={handleNavigate} />
        <FileTree activeFilePath={activeFilePath} onOpenFile={handleOpenFile} />
        <EditorArea
          activeTabId={activeTabId}
          onTabChange={handleTabChange}
          fileTabs={fileTabs}
          onCloseFile={handleCloseFile}
          onFileContentChange={handleFileContentChange}
          onFileLoaded={handleFileLoaded}
          onFileSaved={handleFileSaved}
        />
        {aiPanelVisible && <AIPanel onClose={() => setAiPanelVisible(false)} />}
      </div>

      <StatusBar />
    </div>
  )
}

export default WorkbenchPage
