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
import { Moon, Type, LayoutGrid, Code2, SlidersHorizontal, type LucideIcon } from 'lucide-react'
// v2.7 真实落地：外观设置改用 appearance-store（main.tsx Root 实时应用到 CSS 变量/属性），
// 替代此前 usePersistentState“真保存假生效”方案；强调色卡片无消费者已移除
import { useAppearanceStore } from '@/stores/appearance-store'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSlider } from '@/components/settings/SettingsSlider'
import { SettingsActionBar } from '@/components/settings/SettingsActionBar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/trae/Select'
import { cn } from '@/components/trae/utils'
import './Settings.css'

type ThemeMode = 'dark' | 'light' | 'system'
type Density = 'compact' | 'standard' | 'comfortable'
type CodeTheme = 'one-dark' | 'monokai' | 'solarized-dark' | 'github-dark'

interface ThemeModeOption {
  value: ThemeMode
  name: string
  desc: string
  /** 预览背景（CSS background 值，可能是渐变） */
  previewBg: string
  /** 预览中线条颜色 */
  lineColor: string
  /** 预览中底部块颜色 */
  blockColor: string
}

const THEME_MODES: ThemeModeOption[] = [
  {
    value: 'dark',
    name: '深色模式',
    desc: '适合夜间与低光环境',
    previewBg: 'linear-gradient(135deg,#1A1B1D 0%,#222427 100%)',
    lineColor: '#3A3D42',
    blockColor: '#2A2D31',
  },
  {
    value: 'light',
    name: '浅色模式',
    desc: '适合白天与高光环境',
    previewBg: 'linear-gradient(135deg,#F5F6F8 0%,#FFFFFF 100%)',
    lineColor: '#D1D5DB',
    blockColor: '#E5E7EB',
  },
  {
    value: 'system',
    name: '跟随系统',
    desc: '自动匹配操作系统偏好',
    previewBg: 'linear-gradient(135deg,#1A1B1D 0%,#222427 50%,#F5F6F8 50%,#FFFFFF 100%)',
    lineColor: 'transparent',
    blockColor: 'transparent',
  },
]

const UI_FONTS = [
  { value: 'SF Pro Text', label: 'SF Pro Text' },
  { value: 'Microsoft YaHei', label: 'Microsoft YaHei' },
  { value: 'PingFang SC', label: 'PingFang SC' },
]

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

const CODE_THEMES: CodeThemeOption[] = [
  {
    value: 'one-dark',
    name: 'One Dark',
    previewBg: '#1A1B1D',
    colors: {
      base: '#E0E3EE',
      kw: '#C678DD',
      fn: '#61AFEF',
      str: '#98C379',
      com: '#7F838C',
      varC: '#E06C75',
    },
  },
  {
    value: 'monokai',
    name: 'Monokai',
    previewBg: '#272822',
    colors: {
      base: '#F8F8F2',
      kw: '#F92672',
      fn: '#66D9EF',
      str: '#A6E22E',
      com: '#75715E',
      varC: '#F8F8F2',
    },
  },
  {
    value: 'solarized-dark',
    name: 'Solarized Dark',
    previewBg: '#002B36',
    colors: {
      base: '#93A1A1',
      kw: '#859900',
      fn: '#268BD2',
      str: '#2AA198',
      com: '#586E75',
      varC: '#93A1A1',
    },
  },
  {
    value: 'github-dark',
    name: 'GitHub Dark',
    previewBg: '#0D1117',
    colors: {
      base: '#C9D1D9',
      kw: '#FF7B72',
      fn: '#D2A8FF',
      str: '#A5D6FF',
      com: '#8B949E',
      varC: '#C9D1D9',
    },
  },
]

const DENSITIES: { value: Density; name: string; desc: string }[] = [
  { value: 'compact', name: '紧凑', desc: '减少间距，适合小屏幕' },
  { value: 'standard', name: '标准', desc: '平衡的间距与信息密度' },
  { value: 'comfortable', name: '宽松', desc: '增加间距，提升阅读舒适度' },
]

export function AppearanceSettings() {
  // v2.7：全部设置项来自 appearance-store（改动即时生效 + 自动持久化）
  const themeMode = useAppearanceStore((s) => s.themeMode)
  const uiFont = useAppearanceStore((s) => s.uiFont)
  const codeFont = useAppearanceStore((s) => s.codeFont)
  const fontSize = useAppearanceStore((s) => s.fontSize)
  const lineHeight = useAppearanceStore((s) => s.lineHeight)
  const density = useAppearanceStore((s) => s.density)
  const codeTheme = useAppearanceStore((s) => s.codeTheme)
  const setAppearance = useAppearanceStore((s) => s.setAppearance)
  const resetAppearance = useAppearanceStore((s) => s.resetAppearance)

  const setThemeMode = (v: ThemeMode) => setAppearance('themeMode', v)
  const setUiFont = (v: string) => setAppearance('uiFont', v)
  const setCodeFont = (v: string) => setAppearance('codeFont', v)
  const setFontSize = (v: number) => setAppearance('fontSize', v)
  const setLineHeight = (v: number) => setAppearance('lineHeight', v)
  const setDensity = (v: Density) => setAppearance('density', v)
  const setCodeTheme = (v: CodeTheme) => setAppearance('codeTheme', v)

  return (
    <div>
      <SettingsPageHeader
        icon={SlidersHorizontal as LucideIcon}
        title="外观"
        desc="主题、颜色与字体偏好"
      />

      <div className="set-panel-content">
        {/* Card 1: 主题模式（带视觉预览的 radio 卡片） */}
        <SettingsCard icon={Moon} title="主题模式" tag="theme.mode">
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
                      <span style={{ fontSize: 'var(--trae-body-xs-font-size)', color: 'var(--trae-text-secondary)' }}>Auto</span>
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
          <SettingsRow
            label="界面字体"
            desc="UI 界面使用的字体族"
            control={
              <div className="w-[180px]">
                <Select value={uiFont} onValueChange={setUiFont}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UI_FONTS.map((f) => (<SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            }
          />
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
        <SettingsCard icon={LayoutGrid} title="界面密度" tag="ui.density">
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
        <SettingsCard icon={Code2} title="代码高亮主题" tag="syntax.theme">
          <div className="set-code-grid">
            {CODE_THEMES.map((opt) => {
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
