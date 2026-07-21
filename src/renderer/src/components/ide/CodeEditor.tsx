/**
 * Monaco 代码编辑器组件 - CodeEditor（v0.8 IDE 工作台）
 *
 * 职责：
 * - 使用 @monaco-editor/react 渲染 VS Code 同款编辑器
 * - 双向绑定到 useIDEStore 的当前激活文件
 * - Ctrl+S 保存（调用 sftpWriteFile）
 * - 主题跟随（light/vs-dark）
 * - 加载中显示 Spin 占位
 *
 * 设计：
 * - onChange 立即更新 store（脏检测由 store 计算）
 * - 保存成功后 markSaved 重置 dirty
 * - 未激活文件不渲染（避免性能问题）
 */
import { useCallback, useMemo } from 'react'
import Editor, { loader } from '@monaco-editor/react'
import { Spin, message, Empty } from 'antd'
import { FileOutlined } from '@ant-design/icons'
import type { editor } from 'monaco-editor'
import { useIDEStore } from '../../stores/ide-store'
import { useServerStore } from '../../stores/server-store'
import { useThemeStore } from '../../stores/theme-store'
import { logger } from '../../utils/logger'
import './CodeEditor.css'

/** Monaco 主题映射（应用主题 → Monaco 主题） */
function getMonacoTheme(theme: 'light' | 'dark'): string {
  return theme === 'dark' ? 'vs-dark' : 'vs'
}

/**
 * CodeEditor 代码编辑器组件
 *
 * 监听 useIDEStore.activeFilePath，自动切换显示内容。
 */
const CodeEditor: React.FC = () => {
  const activeFilePath = useIDEStore((s) => s.activeFilePath)
  const openFiles = useIDEStore((s) => s.openFiles)
  const updateContent = useIDEStore((s) => s.updateContent)
  const markSaved = useIDEStore((s) => s.markSaved)
  const sessionId = useServerStore((s) => s.activeSessionId)
  const theme = useThemeStore((s) => s.theme)

  /** 当前激活的文件对象 */
  const activeFile = useMemo(() => {
    if (!activeFilePath) return null
    return openFiles.find((f) => f.path === activeFilePath) ?? null
  }, [activeFilePath, openFiles])

  /** 内容变更：立即写入 store */
  const handleChange = useCallback(
    (value: string | undefined) => {
      if (!activeFilePath) return
      updateContent(activeFilePath, value ?? '')
    },
    [activeFilePath, updateContent]
  )

  /** Ctrl+S 保存：调用 sftpWriteFile */
  const handleSave = useCallback(async () => {
    if (!activeFile || !sessionId) {
      void message.warning('无法保存：未连接服务器或无激活文件')
      return
    }
    try {
      await window.electronAPI.sftpWriteFile(
        sessionId,
        activeFile.path,
        activeFile.content
      )
      // 保存成功：重置 dirty + 同步 originalContent
      markSaved(activeFile.path, activeFile.content)
      void message.success(`已保存: ${activeFile.name}`)
      logger.info('CodeEditor', '保存文件成功', {
        path: activeFile.path,
        size: activeFile.content.length,
      })
    } catch (err) {
      void message.error(`保存失败: ${(err as Error).message}`)
      logger.error('CodeEditor', '保存文件失败', {
        path: activeFile.path,
        err: (err as Error).message,
      })
    }
  }, [activeFile, sessionId, markSaved])

  /** Monaco 编辑器挂载时配置 */
  const handleMount = useCallback(
    (
      _editor: editor.IStandaloneCodeEditor,
      monaco: typeof import('monaco-editor')
    ) => {
      // 注册 Ctrl+S 快捷键
      _editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
        () => void handleSave()
      )
      // 关闭默认 Cmd+S 浏览器保存
    },
    [handleSave]
  )

  /** 空状态：没有打开任何文件 */
  if (!activeFile) {
    return (
      <div className="code-editor-empty">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span className="code-editor-empty-text">
              从左侧文件树双击文件打开
            </span>
          }
        />
      </div>
    )
  }

  /** 加载中状态 */
  if (activeFile.isLoading) {
    return (
      <div className="code-editor-loading">
        <Spin tip="正在加载文件..." />
        <div className="code-editor-loading-path">{activeFile.path}</div>
      </div>
    )
  }

  return (
    <div className="code-editor-container">
      {/* Monaco 编辑器主体 */}
      <Editor
        height="100%"
        language={activeFile.language}
        value={activeFile.content}
        theme={getMonacoTheme(theme)}
        onChange={handleChange}
        onMount={handleMount}
        loading={<Spin tip="加载编辑器..." />}
        options={{
          // 字体
          fontFamily:
            'Menlo, Monaco, "Cascadia Code", "Courier New", monospace',
          fontSize: 13,
          lineHeight: 20,
          // 行号
          lineNumbers: 'on',
          lineNumbersMinChars: 4,
          // 缩进
          tabSize: 2,
          insertSpaces: true,
          detectIndentation: true,
          // 折叠
          folding: true,
          minimap: { enabled: false },
          // 自动布局
          automaticLayout: true,
          // 滚动
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          // 自动保存提示
          wordWrap: 'off',
          links: true,
          // 光标
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          // 选中
          roundedSelection: true,
          // 性能
          renderWhitespace: 'selection',
          renderControlCharacters: false,
          renderLineHighlight: 'all',
        }}
      />
      {/* 底部状态条：路径 + 大小 + dirty 标识 */}
      <div className="code-editor-statusbar">
        <span className="code-editor-status-path">
          <FileOutlined /> {activeFile.path}
        </span>
        <span className="code-editor-status-meta">
          {activeFile.content.length} chars · {activeFile.language}
          {activeFile.isDirty && (
            <span className="code-editor-status-dirty">● 未保存</span>
          )}
        </span>
        <button
          className="code-editor-save-btn"
          onClick={() => void handleSave()}
          disabled={!activeFile.isDirty}
        >
          保存 (Ctrl+S)
        </button>
      </div>
    </div>
  )
}

export default CodeEditor
