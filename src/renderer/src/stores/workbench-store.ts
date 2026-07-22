/**
 * Workbench Store — 工作台 Tab 持久化（v2.0 Phase C Task C.4）
 *
 * 职责：
 * - 持有打开的编辑器 Tab 列表 + 激活 Tab ID（远程路径作为唯一 ID）
 * - Zustand persist + electron-store 适配（通过 IPC configGet/configSet）
 * - 应用重启后自动恢复上次打开的 Tab
 *
 * 设计依据：
 * - 工程约定「远程路径作为唯一 ID：同时用于 Tree key 和 Tab key」
 * - 不修改 WorkbenchPage.tsx（Task C.4 约束），由 WorkbenchPage 自行接入
 *
 * 行数约束：≤ 150 行（Task C.4）
 */
import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'

/** 编辑器 Tab 元数据 */
export interface EditorTab {
  /** 远程文件路径（唯一 ID） */
  path: string
  /** 文件名（path 最后一段，用于 Tab 标题） */
  name: string
  /** 是否有未保存修改 */
  dirty: boolean
  /** 上次激活时间戳（用于 LRU 排序） */
  lastActiveAt: number
}

/** Workbench Store 状态接口 */
export interface WorkbenchStoreState {
  /** 打开的 Tab 列表（顺序即 Tab 顺序） */
  tabs: EditorTab[]
  /** 激活 Tab 的 path；null 表示无激活 */
  activeTabPath: string | null
  /** 打开文件（已存在则激活，不存在则追加） */
  openTab: (path: string, name?: string) => void
  /** 关闭 Tab */
  closeTab: (path: string) => void
  /** 设置激活 Tab */
  setActiveTab: (path: string) => void
  /** 标记 Tab dirty 状态 */
  setTabDirty: (path: string, dirty: boolean) => void
  /** 清空所有 Tab */
  closeAllTabs: () => void
}

/** electron-store 适配器：通过 IPC configGet/configSet 持久化 */
const electronStoreAdapter: StateStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      const value = await window.electronAPI.configGet<string>(key)
      return value ?? null
    } catch {
      return null
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      await window.electronAPI.configSet(key, value)
    } catch {
      // 忽略写入失败（electron-store 可能未就绪）
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      await window.electronAPI.configSet(key, null)
    } catch {
      // 忽略删除失败
    }
  },
}

/** 转 JSON 字符串适配（zustand persist 通过 createJSONStorage 包装 StateStorage） */
const jsonStorage = createJSONStorage(() => electronStoreAdapter)

/** 从 path 提取文件名 */
function basename(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx >= 0 ? path.slice(idx + 1) : path
}

/** Workbench Store 单例 */
export const useWorkbenchStore = create<WorkbenchStoreState>()(
  persist(
    (set) => ({
      tabs: [],
      activeTabPath: null,

      openTab: (path, name) =>
        set((state) => {
          const exists = state.tabs.find((t) => t.path === path)
          const now = Date.now()
          if (exists) {
            return {
              tabs: state.tabs.map((t) => (t.path === path ? { ...t, lastActiveAt: now } : t)),
              activeTabPath: path,
            }
          }
          const newTab: EditorTab = {
            path,
            name: name ?? basename(path),
            dirty: false,
            lastActiveAt: now,
          }
          return { tabs: [...state.tabs, newTab], activeTabPath: path }
        }),

      closeTab: (path) =>
        set((state) => {
          const idx = state.tabs.findIndex((t) => t.path === path)
          if (idx === -1) return state
          const tabs = state.tabs.filter((t) => t.path !== path)
          let activeTabPath = state.activeTabPath
          if (state.activeTabPath === path) {
            // 优先激活右侧 Tab，其次左侧，最后无激活
            const next = tabs[idx] ?? tabs[idx - 1] ?? null
            activeTabPath = next ? next.path : null
          }
          return { tabs, activeTabPath }
        }),

      setActiveTab: (path) =>
        set((state) => ({
          activeTabPath: path,
          tabs: state.tabs.map((t) => (t.path === path ? { ...t, lastActiveAt: Date.now() } : t)),
        })),

      setTabDirty: (path, dirty) =>
        set((state) => ({
          tabs: state.tabs.map((t) => (t.path === path ? { ...t, dirty } : t)),
        })),

      closeAllTabs: () => set({ tabs: [], activeTabPath: null }),
    }),
    {
      name: 'workbench-tabs',
      storage: jsonStorage,
      // partialize 只持久化数据字段（tabs + activeTabPath），方法由 create 回调在 rehydrate 时重新生成
      // zustand persist 类型要求返回完整 S，用 Pick 断言满足类型约束
      partialize: (state) =>
        ({ tabs: state.tabs, activeTabPath: state.activeTabPath }) as WorkbenchStoreState,
    }
  )
)

export default useWorkbenchStore
