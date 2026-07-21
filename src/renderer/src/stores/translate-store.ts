/**
 * 终端翻译状态管理 Store（Zustand）
 *
 * 职责：
 * - 管理翻译功能开关（enabled）
 * - 缓存当前选词信息（currentSelection）
 * - 控制翻译面板展开状态（panelOpen）
 * - 持久化用户偏好（默认关闭，避免干扰正常使用）
 *
 * 设计：
 * - 默认关闭，用户在 TerminalTabs 工具栏主动开启
 * - 选词信息仅内存保存（不持久化）
 * - 通过 zustand persist 持久化开关状态
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** 选词信息 */
export interface TranslateSelection {
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
  /** 翻译面板是否展开 */
  panelOpen: boolean

  // ===== Actions =====
  setEnabled: (v: boolean) => void
  toggleEnabled: () => void
  setSelection: (sel: TranslateSelection | null) => void
  setPanelOpen: (open: boolean) => void
  clear: () => void
}

export const useTranslateStore = create<TranslateState>()(
  persist(
    (set) => ({
      enabled: false,        // 默认关闭
      currentSelection: null,
      panelOpen: false,

      setEnabled: (v) => set({ enabled: v, currentSelection: null, panelOpen: false }),
      toggleEnabled: () => set((s) => ({
        enabled: !s.enabled,
        currentSelection: null,
        panelOpen: false,
      })),
      setSelection: (sel) => set({ currentSelection: sel }),
      setPanelOpen: (open) => set({ panelOpen: open }),
      clear: () => set({ currentSelection: null, panelOpen: false }),
    }),
    {
      name: 'tdsf-translate',
      // 只持久化 enabled，避免选词信息跨会话残留
      partialize: (state) => ({ enabled: state.enabled }),
    }
  )
)
