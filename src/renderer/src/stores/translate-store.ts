/**
 * 终端翻译状态管理 Store（Zustand）
 *
 * 职责：
 * - 管理翻译功能开关（enabled）
 * - 缓存当前选词信息（currentSelection）
 * - 持久化用户偏好（默认关闭，避免干扰正常使用）
 *
 * 面板展开状态不在这里：划词气泡的展开由 SelectionPopover 自己的 useState 管，
 * store 里那份 panelOpen / setPanelOpen 从来没有读者，2026-10-17 连同 setEnabled 一起删。
 *
 * 设计：
 * - 默认关闭，用户在 TerminalTabs 工具栏主动开启
 * - 选词信息仅内存保存（不持久化）
 * - 通过 zustand persist 持久化开关状态
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** 选词信息 */
interface TranslateSelection {
  /** 选中的文本 */
  text: string
  /** 屏幕坐标 X */
  screenX: number
  /** 屏幕坐标 Y */
  screenY: number
}

interface TranslateState {
  /** 是否启用翻译功能 */
  enabled: boolean
  /** 当前选词信息 */
  currentSelection: TranslateSelection | null

  // ===== Actions =====
  toggleEnabled: () => void
  setSelection: (sel: TranslateSelection | null) => void
  clear: () => void
}

export const useTranslateStore = create<TranslateState>()(
  persist(
    (set) => ({
      enabled: false,        // 默认关闭
      currentSelection: null,

      toggleEnabled: () => set((s) => ({
        enabled: !s.enabled,
        currentSelection: null,
      })),
      setSelection: (sel) => set({ currentSelection: sel }),
      clear: () => set({ currentSelection: null }),
    }),
    {
      name: 'tdsf-translate',
      // 只持久化 enabled，避免选词信息跨会话残留
      partialize: (state) => ({ enabled: state.enabled }),
    }
  )
)
