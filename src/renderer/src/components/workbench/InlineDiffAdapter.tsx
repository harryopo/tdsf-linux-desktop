/**
 * InlineDiffAdapter — Monaco Diff 视图适配器（v2.0 Phase B · Task B.3）
 *
 * // @ai-session: ai-glm-20260722-phaseB-v2.0
 * // @ai-task: phaseB-inline-completion
 *
 * 职责：
 * - AI 输出代码块时，以 Diff 视图（Modal/Overlay）展示 original vs modified
 * - 借鉴 Cline 的 diff view 设计：渲染 inline diff + Accept All / Reject All 按钮
 * - Accept 调用 onAccept，Reject 调用 onReject
 *
 * 使用方式：
 *   <InlineDiffAdapter
 *     editor={editor} monaco={monaco}
 *     originalContent={oldText} modifiedContent={newText}
 *     visible={show} onAccept={handleAccept} onReject={handleReject}
 *   />
 *
 * 设计依据：v2.0 Phase B · Task B.3
 */
import { type FC, useCallback } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import type * as monaco from 'monaco-editor'
import { Check, X } from 'lucide-react'

/** InlineDiffAdapter Props */
interface InlineDiffAdapterProps {
  /** 当前 Monaco 编辑器实例（用于语言推断，可选） */
  editor: monaco.editor.IStandaloneCodeEditor | null
  /** Monaco 模块（用于 DiffEditor onMount） */
  monaco: typeof import('monaco-editor') | null
  /** 原始内容 */
  originalContent: string
  /** 修改后内容 */
  modifiedContent: string
  /** 接受 diff 回调 */
  onAccept: () => void
  /** 拒绝 diff 回调 */
  onReject: () => void
  /** 是否可见 */
  visible: boolean
  /** 语言标识（默认 plaintext） */
  language?: string
}

/**
 * InlineDiffAdapter — Diff 视图 Modal
 *
 * 当 visible=true 时，以固定定位覆盖编辑器区域，展示 DiffEditor + 操作按钮栏。
 * 点击 Accept All 触发 onAccept；点击 Reject All 触发 onReject。
 */
export const InlineDiffAdapter: FC<InlineDiffAdapterProps> = ({
  originalContent,
  modifiedContent,
  onAccept,
  onReject,
  visible,
  language = 'plaintext',
}) => {
  /**
   * 处理 Accept
   * 调用方（EditorArea）应在 onAccept 中：
   * 1. 将 modifiedContent 写入编辑器
   * 2. 调用 llmApplyDiff（如需落盘）
   * 3. 关闭 Modal
   */
  const handleAccept = useCallback(() => {
    onAccept()
  }, [onAccept])

  /** 处理 Reject */
  const handleReject = useCallback(() => {
    onReject()
  }, [onReject])

  if (!visible) return null

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 1000,
        background: 'var(--trae-bg-base, #1e1e1e)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 操作按钮栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          background: 'var(--trae-bg-overlay-l2, #252526)',
          borderBottom: '1px solid var(--trae-border-default, #3c3c3c)',
          flexShrink: 0,
        }}
      >
        <span style={{ color: 'var(--trae-text-primary, #cccccc)', fontSize: 13, fontWeight: 500 }}>
          AI 代码变更预览
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={handleAccept}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 12px',
              fontSize: 12,
              border: '1px solid var(--trae-status-success-default, #4ec9b0)',
              borderRadius: 4,
              background: 'var(--trae-status-success-default, #4ec9b0)',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            <Check size={14} />
            Accept All
          </button>
          <button
            type="button"
            onClick={handleReject}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 12px',
              fontSize: 12,
              border: '1px solid var(--trae-status-error-default, #f48771)',
              borderRadius: 4,
              background: 'transparent',
              color: 'var(--trae-status-error-default, #f48771)',
              cursor: 'pointer',
            }}
          >
            <X size={14} />
            Reject All
          </button>
        </div>
      </div>

      {/* DiffEditor：渲染 inline diff 视图 */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <DiffEditor
          original={originalContent}
          modified={modifiedContent}
          language={language}
          theme="vs-dark"
          options={{
            readOnly: true,
            renderSideBySide: false,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  )
}

export default InlineDiffAdapter
