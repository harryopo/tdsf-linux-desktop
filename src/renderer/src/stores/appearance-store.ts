/**
 * appearance-store — 外观设置全局状态（v2.7 设置真实落地）
 *
 * 背景：此前外观设置通过 usePersistentState 写入 electron-store，
 * 但全仓库没有任何消费者读取这些 key —— 所有设置项"真保存、假生效"。
 *
 * 本 store 是外观设置的唯一权威：
 * - zustand persist（localStorage）即时生效 + 跨启动恢复
 * - 每次变更 fire-and-forget 双写 configSet（保持 GeneralSettings"导出数据"兼容）
 * - 应用点在 main.tsx Root：
 *   fontSize/lineHeight/uiFont → documentElement CSS 变量（global.css body 消费）
 *   density → html[data-density] 属性（global.css 密度规则消费）
 *   themeMode → theme-store（system 模式跟随 matchMedia）
 *   codeTheme/codeFont → TerminalView xterm 色板与字体 + code/pre CSS 变量
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'dark' | 'light' | 'system'
export type Density = 'compact' | 'standard' | 'comfortable'
export type CodeTheme = 'one-dark' | 'monokai' | 'solarized-dark' | 'github-dark'

/** 外观设置默认值（与设计稿 settings-appearance.html 一致） */
export const APPEARANCE_DEFAULTS = {
  themeMode: 'dark' as ThemeMode,
  uiFont: 'SF Pro Text',
  codeFont: 'JetBrains Mono',
  fontSize: 13,
  lineHeight: 1.5,
  density: 'standard' as Density,
  codeTheme: 'one-dark' as CodeTheme,
}

/** UI 字体选项 → 实际 font-family 栈 */
export const UI_FONT_STACKS: Record<string, string> = {
  'SF Pro Text': "-apple-system, 'SF Pro Text', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  'Segoe UI': "'Segoe UI', -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  'PingFang SC': "'PingFang SC', -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif",
  'Microsoft YaHei': "'Microsoft YaHei', -apple-system, 'Segoe UI', 'PingFang SC', sans-serif",
  'System UI': "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
}

/** 代码字体选项 → 实际 font-family 栈 */
export const CODE_FONT_STACKS: Record<string, string> = {
  'JetBrains Mono': "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace",
  'Cascadia Code': "'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, monospace",
  'Fira Code': "'Fira Code', 'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
  Consolas: "Consolas, 'JetBrains Mono', 'Cascadia Code', monospace",
}

interface AppearanceState {
  themeMode: ThemeMode
  uiFont: string
  codeFont: string
  fontSize: number
  lineHeight: number
  density: Density
  codeTheme: CodeTheme
  /** 更新单个设置项（即时生效 + 双写 electron-store 保持导出兼容） */
  setAppearance: <K extends keyof typeof APPEARANCE_DEFAULTS>(
    key: K,
    value: (typeof APPEARANCE_DEFAULTS)[K],
  ) => void
  /** 恢复全部默认值 */
  resetAppearance: () => void
}

/** 双写 electron-store 的 key 映射（与旧 usePersistentState key 保持一致） */
const CONFIG_KEY_MAP: Record<keyof typeof APPEARANCE_DEFAULTS, string> = {
  themeMode: 'appearance.theme',
  uiFont: 'appearance.uiFont',
  codeFont: 'appearance.codeFont',
  fontSize: 'appearance.fontSize',
  lineHeight: 'appearance.lineHeight',
  density: 'appearance.density',
  codeTheme: 'appearance.codeTheme',
}

/** fire-and-forget 写回 electron-store（失败仅 warn，不阻塞 UI） */
function mirrorToConfig(key: keyof typeof APPEARANCE_DEFAULTS, value: unknown): void {
  try {
    window.electronAPI?.configSet?.(CONFIG_KEY_MAP[key], value)?.catch?.((err: unknown) => {
      console.warn(`[AppearanceStore] configSet ${CONFIG_KEY_MAP[key]} 失败`, err)
    })
  } catch {
    // 非 Electron 环境静默
  }
}

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      ...APPEARANCE_DEFAULTS,
      setAppearance: (key, value) => {
        set({ [key]: value } as Partial<AppearanceState>)
        mirrorToConfig(key, value)
      },
      resetAppearance: () => {
        set({ ...APPEARANCE_DEFAULTS })
        ;(Object.keys(APPEARANCE_DEFAULTS) as Array<keyof typeof APPEARANCE_DEFAULTS>).forEach(
          (k) => mirrorToConfig(k, APPEARANCE_DEFAULTS[k]),
        )
      },
    }),
    { name: 'tdsf-appearance-store' },
  ),
)

export default useAppearanceStore
