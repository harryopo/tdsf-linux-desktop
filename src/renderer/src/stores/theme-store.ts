/**
 * 主题状态管理 Store（Zustand）
 *
 * 职责：
 * - 管理亮色/暗黑主题切换
 * - 持久化用户主题选择到 localStorage
 * - 监听系统主题偏好（首次使用时跟随系统）
 *
 * 持久化策略：
 * - key='tdsf-theme-store'，仅持久化 theme 字段
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** 主题类型 */
type Theme = 'light' | 'dark'

/** 主题 Store 状态接口 */
interface ThemeState {
  /** 当前主题 */
  theme: Theme
  /** 是否已初始化（用于判断是否需要读取系统偏好） */
  initialized: boolean

  // ===== Actions =====
  /** 切换主题 */
  toggleTheme: () => void
  /** 设置指定主题 */
  setTheme: (theme: Theme) => void
  /** 初始化：若未选择过主题则跟随系统偏好 */
  initFromSystem: () => void
}

/** 读取系统暗黑模式偏好 */
const getSystemTheme = (): Theme => {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

/** 主题 Store */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      initialized: false,

      // 切换主题
      toggleTheme: () =>
        set((state) => ({
          theme: state.theme === 'light' ? 'dark' : 'light',
        })),

      // 设置指定主题
      setTheme: (theme) => set({ theme }),

      // 初始化：若未初始化过，则跟随系统偏好
      initFromSystem: () => {
        if (!get().initialized) {
          set({
            theme: getSystemTheme(),
            initialized: true,
          })
        }
      },
    }),
    {
      name: 'tdsf-theme-store',
      partialize: (state) => ({
        theme: state.theme,
        initialized: state.initialized,
      }),
    }
  )
)
