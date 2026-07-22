/**
 * InlineCompletionProvider — Monaco 内联补全 Provider 注册器（v2.0 Phase B · Task B.2）
 *
 * // @ai-session: ai-glm-20260722-phaseB-v2.0
 * // @ai-task: phaseB-inline-completion
 *
 * 职责：
 * - 注册 Monaco InlineCompletionProvider（* 语言，所有文件生效）
 * - 通过 IPC llm:inline-completion 请求补全
 * - 渲染 ghost text（Monaco 默认行为）
 * - Tab 键接受补全 / Esc 键拒绝（Monaco 默认行为，无需额外实现）
 *
 * 使用方式：
 *   <InlineCompletionProvider editor={editor} monaco={monaco} />
 *   （在 MonacoEditor onMount 回调中渲染，editor/monaco 就绪后挂载）
 *
 * 设计依据：v2.0 Phase B · Task B.2
 */
import { useEffect, type FC } from 'react'
import type * as monaco from 'monaco-editor'
import { useEditorStore } from '@/stores/editor-store'

/** 光标上下文行数（前/后各 50 行） */
const CONTEXT_LINES = 50

/** InlineCompletionProvider Props */
interface InlineCompletionProviderProps {
  editor: monaco.editor.IStandaloneCodeEditor | null
  monaco: typeof import('monaco-editor') | null
}

/**
 * InlineCompletionProvider — 注册 Monaco 内联补全 Provider
 *
 * 该组件不渲染任何 UI，仅通过 useEffect 注册 Provider 并在卸载时 dispose。
 */
export const InlineCompletionProvider: FC<InlineCompletionProviderProps> = ({ editor, monaco }) => {
  const activeFilePath = useEditorStore((s) => s.activeFilePath)

  useEffect(() => {
    if (!editor || !monaco) return

    /**
     * Monaco InlineCompletionsProvider 实现
     *
     * provideInlineCompletions 由 Monaco 在光标停留 / 输入后触发，
     * 返回 { items: [{ insertText, range }] } 即可渲染 ghost text。
     */
    const provider = monaco.languages.registerInlineCompletionsProvider('*', {
      async provideInlineCompletions(model, position, _context, token) {
        // 1. 取消检查（用户已移动光标或组件卸载）
        if (token.isCancellationRequested) return { items: [] }

        // 2. 构建 InlineCompletionRequest
        const language = model.getLanguageId?.() ?? 'plaintext'
        const content = model.getValue()
        const lineCount = model.getLineCount()

        // 光标前 50 行
        const beforeStartLine = Math.max(1, position.lineNumber - CONTEXT_LINES)
        const contextBefore = model.getValueInRange({
          startLineNumber: beforeStartLine,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        })

        // 光标后 50 行
        const afterEndLine = Math.min(lineCount, position.lineNumber + CONTEXT_LINES)
        const contextAfter = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: afterEndLine,
          endColumn: afterEndLine === position.lineNumber ? model.getLineMaxColumn(position.lineNumber) : 1,
        })

        // 3. 调用 IPC 请求补全（超时 / 限流 / 缓存由主进程处理）
        let items: Array<{
          insertText: string
          range: {
            startLineNumber: number
            startColumn: number
            endLineNumber: number
            endColumn: number
          }
        }> = []
        try {
          items = await window.electronAPI.llmInlineCompletion({
            filePath: activeFilePath ?? model.uri.toString(),
            language,
            content,
            cursorLineNumber: position.lineNumber,
            cursorColumn: position.column,
            contextBefore,
            contextAfter,
          })
        } catch {
          // IPC 失败静默处理（不阻塞编辑）
          return { items: [] }
        }

        // 4. 二次取消检查（请求期间用户可能已移动光标）
        if (token.isCancellationRequested) return { items: [] }

        // 5. 转换为 Monaco InlineCompletion 格式
        const monacoItems = items.map((item) => ({
          insertText: item.insertText,
          range: new monaco.Range(
            item.range.startLineNumber,
            item.range.startColumn,
            item.range.endLineNumber,
            item.range.endColumn,
          ),
          // filterText / command 可选，不设置走默认行为
        }))

        return { items: monacoItems }
      },

      /**
       * 释放补全资源（Monaco 要求实现 disposeInlineCompletions）
       * 新版 Monaco API：原 freeInlineCompletions 已更名为 disposeInlineCompletions，
       * 接收 completions 与 reason 两个参数；本 Provider 无动态资源，留空实现。
       */
      disposeInlineCompletions(_completions, _reason) {
        // 无动态资源需要释放
      },
    })

    return () => {
      provider.dispose()
    }
  }, [editor, monaco, activeFilePath])

  // 该组件不渲染 UI，仅注册 Provider
  return null
}

export default InlineCompletionProvider
