/**
 * Editor Store — Monaco 编辑器状态（v2.0 Phase A）
 *
 * 职责：
 * - 持有当前 Monaco 编辑器光标位置（lineNumber / column）
 * - 供 StatusBar 实时读取并展示 `Ln N, Col N`
 * - MonacoEditor onMount 时通过 setCursorPosition 写入
 *
 * 设计原则：
 * - 单一职责：仅存储光标位置，不耦合 Monaco 实例
 * - 性能：避免每次光标移动触发 React 重渲染（订阅按需）
 *
 * 方案书依据：v2.0 Phase A · StatusBar 实时光标位置
 */
import { create } from 'zustand'

/** 光标位置（与 Monaco editor.IPosition 兼容） */
export interface CursorPosition {
  /** 行号（1-based） */
  lineNumber: number
  /** 列号（1-based） */
  column: number
}

/** Editor Store 状态接口 */
export interface EditorStoreState {
  /** 当前光标位置；null 表示无激活编辑器 */
  cursorPosition: CursorPosition | null
  /** 当前激活的文件路径（用于 StatusBar 展示） */
  activeFilePath: string | null
  /** 设置光标位置（由 MonacoEditor onDidChangeCursorPosition 调用） */
  setCursorPosition: (pos: CursorPosition | null) => void
  /** 设置当前激活文件路径（由 EditorArea onTabChange 调用） */
  setActiveFilePath: (path: string | null) => void
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
  setCursorPosition: (pos) => set({ cursorPosition: pos }),
  setActiveFilePath: (path) => set({ activeFilePath: path }),
}))

export default useEditorStore
