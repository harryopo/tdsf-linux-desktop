/**
 * IDE 工作台主入口 - IDEPage（v0.8）
 *
 * 布局结构（嵌入 MainLayout 中栏）：
 * ┌─────────────────────────────────────────────┐
 * │  FileTree  │  EditorTabs                    │
 * │  260px     │  ───────────────────────────  │
 * │            │  CodeEditor (Monaco)           │
 * │            │  flex-1                       │
 * └────────────┴───────────────────────────────┘
 *
 * 职责：
 * - 左侧 FileTree：远程文件浏览、双击打开
 * - 中间 EditorTabs + CodeEditor：多 Tab + Monaco 编辑器
 * - 复用 MainLayout 的右栏 ChatPanel 提供 AI 对话
 *
 * 路由：/ide
 */
import { useEffect } from 'react'
import FileTree from './FileTree'
import EditorTabs from './EditorTabs'
import CodeEditor from './CodeEditor'
import { useServerStore } from '../../stores/server-store'
import { useIDEStore } from '../../stores/ide-store'
import './IDEPage.css'

/** IDEPage IDE 工作台主组件 */
const IDEPage: React.FC = () => {
  const sessionId = useServerStore((s) => s.activeSessionId)
  const setRootPath = useIDEStore((s) => s.setRootPath)

  /** 会话切换时，重置根路径为 '/'（避免上一个会话的路径残留） */
  useEffect(() => {
    if (sessionId) {
      setRootPath('/')
    }
  }, [sessionId, setRootPath])

  return (
    <div className="ide-page">
      {/* 左侧文件树 */}
      <aside className="ide-page-sidebar">
        <FileTree />
      </aside>

      {/* 中间编辑器区 */}
      <main className="ide-page-main">
        <EditorTabs />
        <CodeEditor />
      </main>
    </div>
  )
}

export default IDEPage
