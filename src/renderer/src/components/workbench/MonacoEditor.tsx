/**
 * MonacoEditor — 基于 @monaco-editor/react 的代码编辑器
 *
 * // @ai-session: ai-glm-20260722-phaseA-v2.0
 * // @ai-task: phaseA-monaco-integration
 *
 * 功能：
 * - vs-dark 主题 + JetBrains Mono 字体
 * - Ctrl/Cmd+S 快捷键保存（onSave 回调）
 * - onDidChangeCursorPosition 实时上报到 editor-store（供 StatusBar 显示）
 * - onMount 注册 shell 语言配置（comments / brackets / autoClosingPairs）
 *
 * 方案书依据：v2.0 Phase A · Task A.2 / A.6
 */
import { useCallback } from 'react'
import Editor, { type OnMount, type OnChange } from '@monaco-editor/react'
import type { editor, languages } from 'monaco-editor'
import { useEditorStore } from '@/stores/editor-store'

/** 支持的语言标识 */
export type MonacoEditorLanguage =
  | 'shell'
  | 'python'
  | 'json'
  | 'yaml'
  | 'markdown'
  | 'ini'
  | 'plaintext'

/** MonacoEditor Props */
export interface MonacoEditorProps {
  /** 当前文本内容 */
  value: string
  /** 语言标识（用于语法高亮） */
  language: MonacoEditorLanguage
  /** 内容变更回调 */
  onChange?: (value: string) => void
  /** 编辑器挂载完成回调 */
  onMount?: (
    editor: editor.IStandaloneCodeEditor,
    monaco: typeof import('monaco-editor'),
  ) => void
  /** Ctrl/Cmd+S 触发的保存回调 */
  onSave?: () => void
  /** 文件路径（用于语言自动识别，可选） */
  path?: string
}

/** 注册 shell 语言配置（仅注册一次） */
let shellLanguageRegistered = false
function registerShellLanguage(monaco: typeof import('monaco-editor')) {
  if (shellLanguageRegistered) return
  shellLanguageRegistered = true

  // shell 语言 Monaco 默认未内置，注册基础配置即可获得高亮 + 括号匹配
  const languageConfig: languages.LanguageConfiguration = {
    comments: { lineComment: '#' },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  }
  try {
    monaco.languages.setLanguageConfiguration('shell', languageConfig)
  } catch {
    // 若 'shell' 语言未注册（极少见），尝试注册为 shell
    try {
      monaco.languages.register({ id: 'shell' })
      monaco.languages.setLanguageConfiguration('shell', languageConfig)
    } catch {
      // 静默失败：不阻塞编辑器主流程
    }
  }
}

const MonacoEditor: React.FC<MonacoEditorProps> = ({
  value,
  language,
  onChange,
  onMount,
  onSave,
  path,
}) => {
  const setCursorPosition = useEditorStore((s) => s.setCursorPosition)

  const handleChange: OnChange = useCallback(
    (newValue) => {
      onChange?.(newValue ?? '')
    },
    [onChange],
  )

  const handleMount: OnMount = useCallback(
    (editorInstance, monaco) => {
      // 注册 shell 语言配置（Task A.6）
      registerShellLanguage(monaco)

      // Ctrl/Cmd+S 保存快捷键
      if (onSave) {
        editorInstance.addCommand(
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
          onSave,
        )
      }

      // 光标位置实时上报到 editor-store（供 StatusBar 显示）
      editorInstance.onDidChangeCursorPosition((e) => {
        setCursorPosition({
          lineNumber: e.position.lineNumber,
          column: e.position.column,
        })
      })

      // 初始化光标位置为 1:1
      setCursorPosition({ lineNumber: 1, column: 1 })

      onMount?.(editorInstance, monaco)
    },
    [onMount, onSave, setCursorPosition],
  )

  return (
    <Editor
      value={value}
      language={language}
      path={path}
      theme="vs-dark"
      onChange={handleChange}
      onMount={handleMount}
      options={{
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
        fontLigatures: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 2,
        automaticLayout: true,
        lineNumbers: 'on',
        renderWhitespace: 'selection',
        roundedSelection: false,
        scrollbar: { vertical: 'auto', horizontal: 'auto' },
      }}
    />
  )
}

export default MonacoEditor
