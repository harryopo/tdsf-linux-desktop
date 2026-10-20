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
 *   fontSize/lineHeight → documentElement CSS 变量（global.css body 消费）
 *   界面字体不再可选：全站唯一字体族由 ui-tokens 的 --ui-family-ui 单源，
 *   可选的"界面字体"会用 -apple-system 开头的栈覆盖它，实测造成一屏三套族
 *   density → html[data-density] 属性（global.css 密度规则消费）
 *   themeMode → theme-store（system 模式跟随 matchMedia）
 *   codeTheme/codeFont → TerminalView xterm 色板与字体 + code/pre CSS 变量
 */
import type { CodeThemeId } from '@shared/code-themes'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'dark' | 'light' | 'system'
export type Density = 'compact' | 'standard' | 'comfortable'
export type CodeTheme = CodeThemeId

/** 外观设置默认值（字号与 --ui-font-md 档一致，Trae 中等密度） */
export const APPEARANCE_DEFAULTS = {
  themeMode: 'dark' as ThemeMode,
  codeFont: 'JetBrains Mono',
  fontSize: 14,
  lineHeight: 1.5,
  density: 'standard' as Density,
  /**
   * 默认代码主题＝"跟随界面"（2026-10-16）。
   *
   * 以前默认 one-dark，底色 #282c34，而外壳画布令牌是 #1e1e1e——终端于是永远是界面里
   * 一块颜色不同的蓝灰矩形，用户第一眼就说"颜色不统一"。
   */
  codeTheme: 'tdsf' as CodeTheme,
}

/**
 * 代码字体选项 → 实际 font-family 栈。
 * 每条都在 monospace 之前放一个中文黑体族：Windows 的中文等宽默认字族是宋体，
 * 只写 `..., monospace` 的栈一旦混进中文就会掉成衬线（用户 2026-10-11 指出的"看到宋体"）。
 */
export const CODE_FONT_STACKS: Record<string, string> = {
  'JetBrains Mono': "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, 'Microsoft YaHei', monospace",
  'Cascadia Code': "'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, 'Microsoft YaHei', monospace",
  'Fira Code': "'Fira Code', 'JetBrains Mono', 'Cascadia Code', Consolas, 'Microsoft YaHei', monospace",
  Consolas: "Consolas, 'JetBrains Mono', 'Cascadia Code', 'Microsoft YaHei', monospace",
}

interface AppearanceState {
  themeMode: ThemeMode
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
    {
      name: 'tdsf-appearance-store',
      /**
       * v2：把"从没动过这个设置"的人从旧默认 one-dark 换到"跟随界面"。
       *
       * 判据只有"存下来的值恰好等于旧默认"这一条，所以故意选 One Dark 的人也会被换掉——
       * 代价是在外观设置里点一下就能换回来；不换的话这次"终端颜色统一"对老用户等于没发生。
       */
      version: 2,
      migrate: (persisted: unknown, from: number): AppearanceState => {
        const saved = (persisted ?? {}) as Partial<AppearanceState>
        if (from < 2 && saved.codeTheme === 'one-dark') saved.codeTheme = 'tdsf'
        return { ...APPEARANCE_DEFAULTS, ...saved } as AppearanceState
      },
    },
  ),
)

