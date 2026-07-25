/**
 * SelectionPopover — 选中文本浮层（v2.0 Phase B · Task B.4）
 *
 * // @ai-session: ai-glm-20260722-phaseB-v2.0
 * // @ai-task: phaseB-inline-completion
 *
 * 职责：
 * - 监听 editor-store.selection，当选中文本时显示"发送到 AI"浮层按钮
 * - 点击后根据 selection.type 自动包装为 @命令：
 *   - file  → @file[${filePath}]
 *   - code  → @code[${selectedText}]
 *   - cmd   → @cmd[${selectedText}]
 * - 通过 setInjectedAtCommand 注入 AIPanel 输入框（AIPanel 消费后 clearInjectedAtCommand）
 *
 * 选中事件来源：
 * - Monaco onDidChangeCursorSelection → type='code' / 'file'（MonacoEditor onMount 注册）
 * - xterm onSelectionChange → type='cmd'（TerminalView 注册）
 *
 * 使用方式：
 *   <SelectionPopover />
 *   （在 EditorArea / Workbench 布局中渲染一次即可，全局浮层）
 *
 * 设计依据：v2.0 Phase B · Task B.4
 */
import { type FC, useCallback } from 'react'
import { Sparkles } from 'lucide-react'
import { useEditorStore } from '@/stores/editor-store'

/** @命令文本截断长度（超出部分用 … 省略，避免 @命令过长） */
const MAX_TEXT_LEN = 200

/**
 * 根据选中文本类型构造 @命令字符串
 * @param text 选中文本
 * @param type 选中类型
 * @param filePath 关联文件路径（可选）
 */
function buildAtCommand(
  text: string,
  type: 'file' | 'cmd' | 'code',
  filePath?: string,
): string {
  const truncated = text.length > MAX_TEXT_LEN ? `${text.slice(0, MAX_TEXT_LEN)}…` : text
  switch (type) {
    case 'file':
      // 文件路径选中 → @file[path]
      return `@file[${filePath ?? truncated}]`
    case 'cmd':
      // 终端命令选中 → @cmd[command]
      return `@cmd[${truncated}]`
    case 'code':
    default:
      // 代码片段选中 → @code[code]
      return `@code[${truncated}]`
  }
}

/**
 * SelectionPopover — 选中文本浮层
 *
 * 当 editor-store.selection 非 null 时，在右下角显示"发送到 AI"按钮。
 * 点击后构造 @命令并注入 store，AIPanel 监听 injectedAtCommand 并插入输入框。
 */
export const SelectionPopover: FC = () => {
  const selection = useEditorStore((s) => s.selection)
  const setInjectedAtCommand = useEditorStore((s) => s.setInjectedAtCommand)
  const clearSelection = useEditorStore((s) => s.clearSelection)

  /**
   * 处理"发送到 AI"点击
   * 1. 构造 @命令字符串
   * 2. 注入 store（AIPanel 消费）
   * 3. 清除选中（隐藏浮层）
   */
  const handleSendToAI = useCallback(() => {
    if (!selection) return
    const cmd = buildAtCommand(selection.text, selection.type, selection.filePath)
    setInjectedAtCommand(cmd)
    clearSelection()
  }, [selection, setInjectedAtCommand, clearSelection])

  // 无选中时不渲染
  if (!selection || !selection.text.trim()) return null

  // 选中文本预览（截断显示）
  const previewText =
    selection.text.length > 40 ? `${selection.text.slice(0, 40)}…` : selection.text

  // 类型标签
  const typeLabel = selection.type === 'cmd' ? '命令' : selection.type === 'file' ? '文件' : '代码'

  return (
    <div
      style={{
        position: 'fixed',
        right: 580,
        bottom: 80,
        zIndex: 999,
        background: 'var(--trae-bg-overlay-l2, #252526)',
        border: '1px solid var(--trae-border-default, #3c3c3c)',
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        maxWidth: 360,
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: 'var(--trae-text-secondary, #888)',
          background: 'var(--trae-bg-overlay-l3, #2d2d2d)',
          padding: '1px 6px',
          borderRadius: 3,
          flexShrink: 0,
        }}
      >
        {typeLabel}
      </span>
      <span
        style={{
          fontSize: 12,
          color: 'var(--trae-text-primary, #cccccc)',
          fontFamily: "'JetBrains Mono', monospace",
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 180,
        }}
        title={selection.text}
      >
        {previewText}
      </span>
      <button
        type="button"
        onClick={handleSendToAI}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 10px',
          fontSize: 12,
          border: '1px solid var(--trae-text-brand, #4aa8ff)',
          borderRadius: 4,
          background: 'var(--trae-text-brand, #4aa8ff)',
          color: 'var(--trae-special-white, #fff)',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <Sparkles size={12} />
        发送到 AI
      </button>
    </div>
  )
}

export default SelectionPopover
