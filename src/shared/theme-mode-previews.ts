/**
 * 主题模式选择卡的预览色
 *
 * 这里的色值是**故意写死的字面量**，不是第二份配色真值：
 * 选择卡要展示"深色/浅色各长什么样"，必须与用户当前所处的模式无关，
 * 所以不能引用 --bg-primary 这类会随 data-theme 翻转的令牌
 * （在深色下预览"浅色模式"就会两块都变深，选择卡失去意义）。
 *
 * 取值与 ui-tokens.css 的两套主题对齐；那边换色时这里要跟着改，
 * tests/unit/code-themes-single-source.test.ts 会盯住消费者文件里不许再散落色值。
 */

export interface ThemeModePreview {
  value: 'dark' | 'light' | 'system'
  name: string
  desc: string
  /** 预览背景（CSS background 值，可能是渐变） */
  previewBg: string
  /** 预览中的分隔线颜色 */
  lineColor: string
  /** 预览中底部块颜色 */
  blockColor: string
}

export const THEME_MODE_PREVIEWS: ThemeModePreview[] = [
  {
    value: 'dark',
    name: '深色模式',
    desc: '适合夜间与低光环境',
    previewBg: 'linear-gradient(135deg,#1e1e1e 0%,#252526 100%)',
    lineColor: '#333333',
    blockColor: '#2b2d31',
  },
  {
    value: 'light',
    name: '浅色模式',
    desc: '适合白天与高光环境',
    previewBg: 'linear-gradient(135deg,#f3f3f3 0%,#ffffff 100%)',
    lineColor: '#d0d0d0',
    blockColor: '#e8e8e8',
  },
  {
    value: 'system',
    name: '跟随系统',
    desc: '自动匹配操作系统偏好',
    previewBg: 'linear-gradient(135deg,#1e1e1e 0%,#252526 50%,#f3f3f3 50%,#ffffff 100%)',
    lineColor: 'transparent',
    blockColor: 'transparent',
  },
]
