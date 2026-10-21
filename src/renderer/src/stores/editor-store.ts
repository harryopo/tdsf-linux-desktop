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
import type { WorkbenchFileTab, WorkbenchTabId } from '@/components/workbench/EditorArea'

type Updater<T> = T | ((prev: T) => T)

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
  /** 待注入 AIPanel 输入框的 @命令字符串；null 表示无待注入（Phase B · Task B.4） */
  injectedAtCommand: string | null
  /**
   * 打开的文件标签与当前标签
   *
   * 放在 store 里而不是 WorkbenchPage 的 useState：MainLayout 用
   * `key={pathname}` 强制整页重挂（为了入场动画），切到设置页再回来，
   * 组件内 state 全丢——未保存的编辑内容一起消失（2026-10-21 审查 E2）。
   */
  fileTabs: WorkbenchFileTab[]
  activeTabId: WorkbenchTabId | null
  setFileTabs: (updater: Updater<WorkbenchFileTab[]>) => void
  setActiveTabId: (updater: Updater<WorkbenchTabId | null>) => void
  /** 设置光标位置（由 MonacoEditor onDidChangeCursorPosition 调用） */
  setCursorPosition: (pos: CursorPosition | null) => void
  /** 设置当前激活文件路径（由 EditorArea onTabChange 调用） */
  setActiveFilePath: (path: string | null) => void
  /** 设置待注入 AIPanel 的 @命令字符串（由 SelectionPopover 调用） */
  setInjectedAtCommand: (cmd: string | null) => void
  /** 清除待注入 @命令（AIPanel 消费后调用） */
  clearInjectedAtCommand: () => void
}

/**
 * 这个标签该用哪个 SSH 会话读写：标签自己记的优先。
 *
 * 标签记了会话而当前会话不同，说明用户切到了另一台机。此时**不能**拿当前会话
 * 去写同一个路径——那会把 A 机的文件内容写进 B 机（2026-10-21 审查时发现）。
 */
export function fileTabSessionId(
  tab: Pick<WorkbenchFileTab, 'sessionId'>,
  activeSessionId: string | null
): string | null {
  return tab.sessionId ?? activeSessionId
}

export function canSaveFileTab(
  tab: Pick<WorkbenchFileTab, 'sessionId'>,
  activeSessionId: string | null
): boolean {
  return !tab.sessionId || !activeSessionId || tab.sessionId === activeSessionId
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
  injectedAtCommand: null,
  fileTabs: [],
  activeTabId: null,
  setFileTabs: (updater) =>
    set((s) => ({
      fileTabs: typeof updater === 'function' ? updater(s.fileTabs) : updater,
    })),
  setActiveTabId: (updater) =>
    set((s) => ({
      activeTabId: typeof updater === 'function' ? updater(s.activeTabId) : updater,
    })),
  setCursorPosition: (pos) => set({ cursorPosition: pos }),
  setActiveFilePath: (path) => set({ activeFilePath: path }),
  setInjectedAtCommand: (cmd) => set({ injectedAtCommand: cmd }),
  clearInjectedAtCommand: () => set({ injectedAtCommand: null }),
}))

