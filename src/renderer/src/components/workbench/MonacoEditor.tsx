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
import { useCallback, useEffect, useRef } from 'react'
// 必须在 <Editor> 之前完成：把 Monaco 从 CDN 换成本地 bundle（见该文件注释）
import '@/lib/monaco-setup'
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
  /**
   * 只读查看（W5）。
   *
   * 两个属性都要给：readOnly 只锁编辑，domReadOnly 才把底层 textarea 也关掉——
   * 少了后者，读屏与部分输入法仍能改文档内容。
   */
  readOnly?: boolean
  /**
   * 要跳到并高亮的那一行（1-based，#213 内容搜索结果）。
   *
   * 给同一个值不会重复跳（effect 依赖它）；WorkbenchPage 每次点结果都会写一个新值。
   */
  revealLine?: number
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
  readOnly = false,
  revealLine,
}) => {
  const setCursorPosition = useEditorStore((s) => s.setCursorPosition)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const decorationRef = useRef<string[]>([])

  /**
   * 跳到那一行并整行高亮。
   *
   * 两条路都要走这一处（真机 e2e 实测出来的）：
   * - 文件正文是异步读回来的，标签一 ready 才把 Monaco 挂上来。那一刻 `onMount`
   *   跑在本组件 effect 之后，只靠 effect 的话编辑器实例还不存在，行号就这么丢了；
   * - 已经开着的标签再点别的命中，走的是 effect 这条路。
   */
  const applyReveal = useCallback(
    (ed: editor.IStandaloneCodeEditor, m: typeof import('monaco-editor'), line: number) => {
      const maxLine = ed.getModel()?.getLineCount() ?? 0
      if (maxLine === 0) return
      const at = Math.min(Math.max(line, 1), maxLine)
      ed.revealLineInCenter(at)
      ed.setPosition({ lineNumber: at, column: 1 })
      decorationRef.current = ed.deltaDecorations(decorationRef.current, [
        {
          range: new m.Range(at, 1, at, 1),
          options: { isWholeLine: true, className: 'wb-file-hit-line' },
        },
      ])
      ed.focus()
    },
    [],
  )

  useEffect(() => {
    const ed = editorRef.current
    const monaco = monacoRef.current
    if (!ed || !monaco || revealLine === undefined) return
    applyReveal(ed, monaco, revealLine)
  }, [applyReveal, revealLine, value])

  const handleChange: OnChange = useCallback(
    (newValue) => {
      onChange?.(newValue ?? '')
    },
    [onChange],
  )

  const handleMount: OnMount = useCallback(
    (editorInstance, monaco) => {
      editorRef.current = editorInstance
      monacoRef.current = monaco
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

      // 带着行号进来的（内容搜索点的那一行）：此刻正文已经在，直接跳
      if (revealLine !== undefined) applyReveal(editorInstance, monaco, revealLine)

      onMount?.(editorInstance, monaco)
    },
    [applyReveal, onMount, onSave, revealLine, setCursorPosition],
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
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Microsoft YaHei', monospace",
        fontLigatures: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 2,
        automaticLayout: true,
        lineNumbers: 'on',
        renderWhitespace: 'selection',
        roundedSelection: false,
        scrollbar: { vertical: 'auto', horizontal: 'auto' },
        readOnly,
        domReadOnly: readOnly,
      }}
    />
  )
}

export default MonacoEditor
