/**
 * AppearanceSettings — 外观设置
 *
 * 路由：/settings/appearance
 *
 * 设计稿：settings-appearance.html
 * - Card 1: 主题模式（深色/浅色/跟随系统）—— 带视觉预览的 radio 卡片
 * - Card 2: 强调色（8 个色板 + "当前: #xxx" 文字）
 * - Card 3: 字体设置（界面字体/代码字体/字号/行高）
 * - Card 4: 界面密度（紧凑/标准/宽松）—— radio 卡片
 * - Card 5: 代码高亮主题（One Dark/Monokai/Solarized Dark/GitHub Dark）—— 卡片网格 + 代码预览
 * - ActionBar: 保存 / 恢复默认
 *
 * 说明：主题预览与代码高亮预览的硬编码颜色为视觉演示内容（不同主题固有颜色），
 * 不属于 UI 主色，因此保留硬编码以正确呈现预览效果。
 *
 * 设置项通过 usePersistentState 接入主进程 IPC（configGet/configSet）持久化，
 * electronAPI 不可用时退化为内存默认值，UI 正常渲染。
 */
import { Moon, Type, LayoutGrid, Code2 } from 'lucide-react'
// v2.7 真实落地：外观设置改用 appearance-store（main.tsx Root 实时应用到 CSS 变量/属性），
// 替代此前 usePersistentState“真保存假生效”方案；强调色卡片无消费者已移除
import { useAppearanceStore } from '@/stores/appearance-store'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { settingsHeader } from './settings-sections'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSlider } from '@/components/settings/SettingsSlider'
import { SettingsActionBar } from '@/components/settings/SettingsActionBar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/trae/Select'
import { CODE_THEMES, CODE_THEME_IDS, resolveCodeTheme, type CodeThemeId } from '@shared/code-themes'
import { useThemeStore } from '@/stores/theme-store'
import { THEME_MODE_PREVIEWS as THEME_MODES } from '@shared/theme-mode-previews'
import { cn } from '@/components/trae/utils'
import './Settings.css'

type ThemeMode = 'dark' | 'light' | 'system'
type Density = 'compact' | 'standard' | 'comfortable'
/** 主题 id 与配色都在 src/shared/code-themes.ts，这里不再抄一份 */
type CodeTheme = CodeThemeId

const CODE_FONTS = [
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
  { value: 'Fira Code', label: 'Fira Code' },
  { value: 'Consolas', label: 'Consolas' },
  { value: 'Cascadia Code', label: 'Cascadia Code' },
]

interface CodeThemeOption {
  value: CodeTheme
  name: string
  /** 预览块背景色 */
  previewBg: string
  /** 预览块各语法颜色（kw 关键字 / fn 函数 / str 字符串数字 / com 注释 / var 变量 / base 默认文字） */
  colors: {
    base: string
    kw: string
    fn: string
    str: string
    com: string
    varC: string
  }
}

/**
 * 预览按当前界面明暗解析：「跟随界面」这一档在浅色下就是白底那副面孔，
 * 设置页看到的仍然是用户会得到的那一格（预览底 = 终端真实背景）。
 */
function buildCodeThemeOptions(mode: 'light' | 'dark'): CodeThemeOption[] {
  return CODE_THEME_IDS.map((id) => {
    const theme = resolveCodeTheme(id, mode)
    return {
      value: id,
      name: CODE_THEMES[id].label,
      previewBg: theme.terminal.background,
      colors: {
        base: theme.syntax.base,
        kw: theme.syntax.keyword,
        fn: theme.syntax.function,
        str: theme.syntax.string,
        com: theme.syntax.comment,
        varC: theme.syntax.variable,
      },
    }
  })
}


const DENSITIES: { value: Density; name: string; desc: string }[] = [
  { value: 'compact', name: '紧凑', desc: '减少间距，适合小屏幕' },
  { value: 'standard', name: '标准', desc: '平衡的间距与信息密度' },
  { value: 'comfortable', name: '宽松', desc: '增加间距，提升阅读舒适度' },
]

export function AppearanceSettings() {
  // v2.7：全部设置项来自 appearance-store（改动即时生效 + 自动持久化）
  const themeMode = useAppearanceStore((s) => s.themeMode)
  const codeFont = useAppearanceStore((s) => s.codeFont)
  const fontSize = useAppearanceStore((s) => s.fontSize)
  const lineHeight = useAppearanceStore((s) => s.lineHeight)
  const density = useAppearanceStore((s) => s.density)
  const codeTheme = useAppearanceStore((s) => s.codeTheme)
  const setAppearance = useAppearanceStore((s) => s.setAppearance)
  const resetAppearance = useAppearanceStore((s) => s.resetAppearance)
  /** 当前界面明暗：决定"跟随界面"那一格预览成深色还是浅色 */
  const uiTheme = useThemeStore((s) => s.theme)
  const codeThemeOptions = buildCodeThemeOptions(uiTheme)
  // tag 显示"当前选的是哪档"，不是内部配置键（theme.mode 这类词对用户没有意义）
  const themeModeLabel = THEME_MODES.find((opt) => opt.value === themeMode)?.name ?? ''
  const densityLabel = DENSITIES.find((opt) => opt.value === density)?.name ?? ''
  const codeThemeLabel = CODE_THEMES[codeTheme].label

  const setThemeMode = (v: ThemeMode) => setAppearance('themeMode', v)
  const setCodeFont = (v: string) => setAppearance('codeFont', v)
  const setFontSize = (v: number) => setAppearance('fontSize', v)
  const setLineHeight = (v: number) => setAppearance('lineHeight', v)
  const setDensity = (v: Density) => setAppearance('density', v)
  const setCodeTheme = (v: CodeTheme) => setAppearance('codeTheme', v)

  return (
    <div className="set-subpage">
      <SettingsPageHeader {...settingsHeader('/settings/appearance')} />

      <div className="set-subpage__body">
        {/* Card 1: 主题模式（带视觉预览的 radio 卡片） */}
        <SettingsCard icon={Moon} title="主题模式" tag={themeModeLabel}>
          <div className="set-theme-grid">
            {THEME_MODES.map((opt) => {
              const selected = themeMode === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setThemeMode(opt.value)}
                  className={cn('set-theme-card btn-press', selected && 'is-active')}
                >
                  {/* 视觉预览（60px 高，呈现主题色块与 mock 内容线条） */}
                  <div
                    className="set-theme-card__preview"
                    style={{ background: opt.previewBg }}
                  >
                    {opt.value !== 'system' ? (
                    <div className="flex flex-1 flex-col gap-1 p-2">
                      <div className="h-1 w-3/5 rounded-[2px]" style={{ background: opt.lineColor }} />
                      <div className="h-1 w-2/5 rounded-[2px]" style={{ background: opt.lineColor }} />
                      <div className="mt-auto h-2.5 rounded-[3px]" style={{ background: opt.blockColor }} />
                    </div>
                  ) : (
                    <div className="flex flex-1 items-center justify-center">
                      <span style={{ fontSize: 'var(--trae-body-xs-font-size)', color: 'var(--text-tertiary)' }}>Auto</span>
                    </div>
                  )}
                  </div>
                  {/* 名称 + 描述 + radio dot */}
                  <div className="set-theme-card__label">
                    <div className="min-w-0">
                      <div className="set-theme-card__name">
                        {opt.name}
                      </div>
                      <div className="set-theme-card__desc">
                        {opt.desc}
                      </div>
                    </div>
                    <span className="set-radio">
                      <span className="set-radio__dot" />
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </SettingsCard>

        {/* v2.7：强调色卡片已移除 —— 全仓无消费者（品牌 token 派生链未建），
            避免展示“选了没效果”的假设置；待品牌色派生机制落地后再恢复 */}

        {/* Card 3: 字体设置 */}
        <SettingsCard icon={Type} title="字体设置" tag="typography">
          {/* 界面字体不提供选择：字体族由 ui-tokens 的 --ui-family-ui 单源，
              可选界面字体会把首族换成未安装的 SF Pro Text，实测一屏三套族 */}
          <SettingsRow
            label="代码字体"
            desc="代码编辑器与终端使用的等宽字体"
            control={
              <div className="w-[180px]">
                <Select value={codeFont} onValueChange={setCodeFont}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CODE_FONTS.map((f) => (<SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            }
          />
          <SettingsRow
            label="字号"
            desc="界面文字基础大小"
            control={<SettingsSlider value={fontSize} min={10} max={16} step={1} suffix="px" onValueChange={setFontSize} />}
          />
          <SettingsRow
            label="行高"
            desc="正文文字行间距比例"
            control={<SettingsSlider value={lineHeight} min={1.0} max={2.0} step={0.1} precision={1} onValueChange={setLineHeight} />}
            isLast
          />
        </SettingsCard>

        {/* Card 4: 界面密度（radio 卡片） */}
        <SettingsCard icon={LayoutGrid} title="界面密度" tag={densityLabel}>
          <div className="set-density-grid">
            {DENSITIES.map((opt) => {
              const selected = density === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDensity(opt.value)}
                  className={cn('set-density-card btn-press', selected && 'is-active')}
                >
                  <div className="set-density-card__top">
                    <span className="set-density-card__name">
                      {opt.name}
                    </span>
                    <span className="set-radio">
                      <span className="set-radio__dot" />
                    </span>
                  </div>
                  <div className="set-density-card__desc">
                    {opt.desc}
                  </div>
                </button>
              )
            })}
          </div>
        </SettingsCard>

        {/* Card 5: 代码高亮主题（4 个卡片网格 + 代码预览） */}
        <SettingsCard icon={Code2} title="代码高亮主题" tag={codeThemeLabel}>
          <div className="set-code-grid">
            {codeThemeOptions.map((opt) => {
              const selected = codeTheme === opt.value
              const c = opt.colors
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCodeTheme(opt.value)}
                  className={cn('set-code-card btn-press', selected && 'is-active')}
                >
                  <div className="set-code-card__top">
                    <span className="set-code-card__name">
                      {opt.name}
                    </span>
                    <span className="set-radio">
                      <span className="set-radio__dot" />
                    </span>
                  </div>
                  {/* 代码预览块：呈现该主题下的语法高亮配色 */}
                  <div
                    className="set-code-preview"
                    // 主题色样本：这段代码的颜色就是"要看的东西"本身，
                    // 不按界面文字判对比度（ui-audit 会单独报豁免条数）
                    data-audit-exempt="code-theme-swatch"
                    style={{ background: opt.previewBg }}
                  >
                    <div style={{ color: c.base }}>
                      <span style={{ color: c.kw }}>const</span>{' '}
                      <span style={{ color: c.varC }}>x</span> ={' '}
                      <span style={{ color: c.fn }}>add</span>(
                      <span style={{ color: c.str }}>1</span>,{' '}
                      <span style={{ color: c.str }}>2</span>);
                    </div>
                    <div style={{ color: c.com }}>// {opt.name} theme</div>
                  </div>
                </button>
              )
            })}
          </div>
        </SettingsCard>

        <SettingsActionBar
          onReset={resetAppearance}
        />
      </div>
    </div>
  )
}
