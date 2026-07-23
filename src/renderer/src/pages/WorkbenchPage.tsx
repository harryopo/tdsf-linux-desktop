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
import { Plug } from 'lucide-react'
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
import { useServerStore } from '@/stores/server-store'
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

  // 未连接 SSH 时显示设计稿版终端空状态浮层（data-dom-id="connect-server-btn"）
  const activeSessionId = useServerStore((s) => s.activeSessionId)
  const isDisconnected = !activeSessionId

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

  // 跳转 SSH 设置页（保留现有 IPC 路径：ConnectDialog 在 WorkbenchTitlebar 内）
  const handleConnectServer = useCallback(() => {
    navigate('/settings/ssh')
  }, [navigate])

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
        <ActivityRail activeId={activeNav} onNavigate={handleNavigate} />
        <FileTree activeFilePath={activeFilePath} onOpenFile={handleOpenFile} />

        {/* EditorArea 包裹层：未连接 SSH 时叠加设计稿版空状态浮层 */}
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

          {isDisconnected && (
            <div
              className="wb-term-empty-overlay"
              role="status"
              aria-label="终端未连接"
            >
              {/* 终端窗口模拟卡片（240px 宽，3 圆点 + "terminal" 文字 + 等待光标） */}
              <div className="wb-term-empty-mock">
                <div className="wb-term-empty-mock-header">
                  <span className="wb-term-empty-mock-dot" />
                  <span className="wb-term-empty-mock-dot" />
                  <span className="wb-term-empty-mock-dot" />
                  <span className="wb-term-empty-mock-title">terminal</span>
                </div>
                <div className="wb-term-empty-mock-body">
                  <div>
                    $ <span className="wb-term-empty-mock-prompt">等待SSH连接...</span>
                  </div>
                </div>
              </div>

              {/* 标题 + 副标题 */}
              <div>
                <div className="wb-term-empty-title">终端未连接</div>
                <div className="wb-term-empty-subtitle">
                  连接SSH服务器后，终端将自动打开
                </div>
              </div>

              {/* 连接服务器按钮（data-dom-id 对齐设计稿 workbench-ai.html） */}
              <button
                type="button"
                title="连接服务器"
                aria-label="连接服务器"
                data-dom-id="connect-server-btn"
                className="wb-term-empty-connect-btn"
                onClick={handleConnectServer}
              >
                <Plug className="size-3" />
                连接服务器
              </button>
            </div>
          )}
        </div>

        {aiPanelVisible && <AIPanel onClose={() => setAiPanelVisible(false)} />}
      </div>

      <StatusBar />
    </div>
  )
}

export default WorkbenchPage
