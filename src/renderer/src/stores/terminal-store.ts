/**
 * 终端状态管理 Store（Zustand）
 *
 * 职责：
 * - 管理多标签终端的 Tab 列表
 * - 跟踪当前活跃的 Tab ID
 * - 提供 Tab 的增删改查操作
 *
 * 每个 Tab 对应一个 SSH 会话，包含 sessionId 和显示标题。
 * 终端实例本身由 TerminalView 组件管理生命周期，Store 只管理 Tab 元数据。
 */
import { create } from 'zustand'

/** 终端 Tab 数据结构 */
export interface TerminalTab {
  /** Tab 唯一标识 */
  id: string
  /** 关联的 SSH 会话 ID */
  sessionId: string
  /** 关联的服务器 ID */
  serverId: string
  /** Tab 显示标题（通常为服务器名称） */
  title: string
  /** 是否已激活 */
  active: boolean
  /** 创建时间戳 */
  createdAt: number
}

/** 终端 Store 状态接口 */
interface TerminalState {
  /** Tab 列表 */
  tabs: TerminalTab[]
  /** 当前活跃 Tab ID */
  activeTabId: string | null

  // ===== Actions =====
  /** 添加新 Tab */
  addTab: (tab: TerminalTab) => void
  /** 移除 Tab */
  removeTab: (tabId: string) => void
  /** 设置活跃 Tab */
  setActiveTab: (tabId: string) => void
  /** 更新 Tab 标题 */
  updateTabTitle: (tabId: string, title: string) => void
  /** 关闭其他 Tab */
  closeOtherTabs: (tabId: string) => void
  /** 获取当前活跃 Tab */
  getActiveTab: () => TerminalTab | null
}

/** 终端 Store */
export const useTerminalStore = create<TerminalState>()((set, get) => ({
  tabs: [],
  activeTabId: null,

  // 添加新 Tab
  addTab: (tab) =>
    set((state) => ({
      // 新 Tab 设为活跃，其他 Tab 取消活跃
      tabs: [...state.tabs.map((t) => ({ ...t, active: false })), tab],
      activeTabId: tab.id,
    })),

  // 移除 Tab
  removeTab: (tabId) =>
    set((state) => {
      const newTabs = state.tabs.filter((t) => t.id !== tabId)
      // 如果移除的是当前活跃 Tab，则激活最后一个 Tab
      let newActiveTabId = state.activeTabId
      if (state.activeTabId === tabId) {
        newActiveTabId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null
      }
      return {
        tabs: newTabs.map((t, idx) => ({
          ...t,
          active: t.id === newActiveTabId,
        })),
        activeTabId: newActiveTabId,
      }
    }),

  // 设置活跃 Tab
  setActiveTab: (tabId) =>
    set((state) => ({
      tabs: state.tabs.map((t) => ({
        ...t,
        active: t.id === tabId,
      })),
      activeTabId: tabId,
    })),

  // 更新 Tab 标题
  updateTabTitle: (tabId, title) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, title } : t
      ),
    })),

  // 关闭其他 Tab
  closeOtherTabs: (tabId) =>
    set((state) => ({
      tabs: state.tabs
        .filter((t) => t.id === tabId)
        .map((t) => ({ ...t, active: true })),
      activeTabId: tabId,
    })),

  // 获取当前活跃 Tab
  getActiveTab: () => {
    const state = get()
    return state.tabs.find((t) => t.id === state.activeTabId) ?? null
  },
}))
