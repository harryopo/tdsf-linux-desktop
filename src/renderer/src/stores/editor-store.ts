/**
 * Editor Store — Monaco 编辑器状态（v2.0 Phase A + B）
 *
 * 职责：
 * - 持有当前 Monaco 编辑器光标位置（lineNumber / column）
 * - 持有当前选中文本（供 @命令划选注入，Phase B · Task B.4）
 * - 持有待注入 AIPanel 输入框的 @命令字符串（Phase B · Task B.4）
 * - 供 StatusBar 实时读取并展示 `Ln N, Col N`
 * - MonacoEditor onMount 时通过 setCursorPosition 写入
 *
 * 设计原则：
 * - 单一职责：仅存储编辑器状态，不耦合 Monaco 实例
 * - 性能：避免每次光标移动触发 React 重渲染（订阅按需）
 *
 * 方案书依据：v2.0 Phase A · StatusBar 实时光标位置 + Phase B · @命令划选注入
 */
import { create } from 'zustand'

/** 光标位置（与 Monaco editor.IPosition 兼容） */
export interface CursorPosition {
  /** 行号（1-based） */
  lineNumber: number
  /** 列号（1-based） */
  column: number
}

/** 选中文本类型（决定 @命令包装格式） */
export type SelectionType = 'file' | 'cmd' | 'code'

/** 选中文本状态（供 SelectionPopover 渲染 + @命令包装） */
export interface EditorSelection {
  /** 选中的文本内容 */
  text: string
  /** 选中来源类型：file=文件路径 / cmd=终端命令 / code=代码片段 */
  type: SelectionType
  /** 关联文件路径（type=file/code 时存在） */
  filePath?: string
}

/** Editor Store 状态接口 */
export interface EditorStoreState {
  /** 当前光标位置；null 表示无激活编辑器 */
  cursorPosition: CursorPosition | null
  /** 当前激活的文件路径（用于 StatusBar 展示） */
  activeFilePath: string | null
  /** 当前选中文本；null 表示无选中（Phase B · Task B.4） */
  selection: EditorSelection | null
  /** 待注入 AIPanel 输入框的 @命令字符串；null 表示无待注入（Phase B · Task B.4） */
  injectedAtCommand: string | null
  /** 设置光标位置（由 MonacoEditor onDidChangeCursorPosition 调用） */
  setCursorPosition: (pos: CursorPosition | null) => void
  /** 设置当前激活文件路径（由 EditorArea onTabChange 调用） */
  setActiveFilePath: (path: string | null) => void
  /** 设置选中文本（由 MonacoEditor onDidChangeCursorSelection / TerminalView onSelectionChange 调用） */
  setSelection: (sel: EditorSelection | null) => void
  /** 清除选中文本（SelectionPopover 注入后调用） */
  clearSelection: () => void
  /** 设置待注入 AIPanel 的 @命令字符串（由 SelectionPopover 调用） */
  setInjectedAtCommand: (cmd: string | null) => void
  /** 清除待注入 @命令（AIPanel 消费后调用） */
  clearInjectedAtCommand: () => void
}

/**
 * Editor Store — Zustand 单例
 *
 * 使用方式：
 * - 写入：`useEditorStore.getState().setCursorPosition({ lineNumber, column })`
 * - 读取：`const pos = useEditorStore((s) => s.cursorPosition)`
 */
export const useEditorStore = create<EditorStoreState>((set) => ({
  cursorPosition: null,
  activeFilePath: null,
  selection: null,
  injectedAtCommand: null,
  setCursorPosition: (pos) => set({ cursorPosition: pos }),
  setActiveFilePath: (path) => set({ activeFilePath: path }),
  setSelection: (sel) => set({ selection: sel }),
  clearSelection: () => set({ selection: null }),
  setInjectedAtCommand: (cmd) => set({ injectedAtCommand: cmd }),
  clearInjectedAtCommand: () => set({ injectedAtCommand: null }),
}))

export default useEditorStore
