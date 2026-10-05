/**
 * 代码 / 终端配色单源（阶段 E5）
 *
 * 之前同一个主题存在两份表：TerminalView 里的 xterm ANSI 表、
 * 外观设置页里的语法预览表。两份各写一遍 hex，改一处忘一处，
 * 结果设置页预览的颜色和终端真正渲染出来的颜色不是一套
 * （one-dark 预览底 #1A1B1D、终端底 #0f1011 就是这么来的）。
 *
 * 现在一个主题一条记录：terminal 段喂 xterm，syntax 段喂设置页预览与代码高亮。
 * 预览底就是终端底，用户在设置页看到的即是他会得到的。
 */

export type CodeThemeId = 'one-dark' | 'monokai' | 'solarized-dark' | 'github-dark'

/** xterm ITheme 里我们真正管理的那几个槽位（键名与 xterm 保持一致） */
export interface TerminalPalette {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

/** 语法角色色（设置页预览与 MarkdownMessage 代码块共用） */
export interface SyntaxPalette {
  /** 正文 */
  base: string
  /** 关键字 */
  keyword: string
  /** 函数名 */
  function: string
  /** 字符串 */
  string: string
  /** 注释 */
  comment: string
  /** 变量 / 标识符 */
  variable: string
}

export interface CodeTheme {
  id: CodeThemeId
  label: string
  terminal: TerminalPalette
  syntax: SyntaxPalette
}

export const CODE_THEMES: Record<CodeThemeId, CodeTheme> = {
  'one-dark': {
    id: 'one-dark',
    label: 'One Dark',
    terminal: {
      background: '#282c34',
      foreground: '#abb2bf',
      cursor: '#528bff',
      cursorAccent: '#282c34',
      selectionBackground: 'rgba(82, 139, 255, 0.3)',
      black: '#282c34',
      red: '#e06c75',
      green: '#98c379',
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      brightBlack: '#5c6370',
      brightRed: '#e06c75',
      brightGreen: '#98c379',
      brightYellow: '#e5c07b',
      brightBlue: '#61afef',
      brightMagenta: '#c678dd',
      brightCyan: '#56b6c2',
      brightWhite: '#ffffff',
    },
    syntax: {
      base: '#abb2bf',
      keyword: '#c678dd',
      function: '#61afef',
      string: '#98c379',
      comment: '#7f848e',
      variable: '#e06c75',
    },
  },
  monokai: {
    id: 'monokai',
    label: 'Monokai',
    terminal: {
      background: '#272822',
      foreground: '#f8f8f2',
      cursor: '#f8f8f0',
      cursorAccent: '#272822',
      selectionBackground: 'rgba(248, 248, 242, 0.25)',
      black: '#272822',
      red: '#f92672',
      green: '#a6e22e',
      yellow: '#e6db74',
      blue: '#66d9ef',
      magenta: '#ae81ff',
      cyan: '#a1efe4',
      brightBlack: '#75715e',
      brightRed: '#f92672',
      brightGreen: '#a6e22e',
      brightYellow: '#e6db74',
      brightBlue: '#66d9ef',
      brightMagenta: '#ae81ff',
      brightCyan: '#a1efe4',
      brightWhite: '#f8f8f2',
    },
    syntax: {
      base: '#f8f8f2',
      keyword: '#f92672',
      function: '#66d9ef',
      string: '#e6db74',
      comment: '#75715e',
      variable: '#f8f8f2',
    },
  },
  'solarized-dark': {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    terminal: {
      background: '#002b36',
      foreground: '#93a1a1',
      cursor: '#93a1a1',
      cursorAccent: '#002b36',
      selectionBackground: 'rgba(147, 161, 161, 0.25)',
      black: '#002b36',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      brightBlack: '#586e75',
      brightRed: '#cb4b16',
      brightGreen: '#859900',
      brightYellow: '#b58900',
      brightBlue: '#268bd2',
      brightMagenta: '#6c71c4',
      brightCyan: '#2aa198',
      brightWhite: '#fdf6e3',
    },
    syntax: {
      base: '#93a1a1',
      keyword: '#859900',
      function: '#268bd2',
      string: '#2aa198',
      comment: '#586e75',
      variable: '#93a1a1',
    },
  },
  'github-dark': {
    id: 'github-dark',
    label: 'GitHub Dark',
    terminal: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#58a6ff',
      cursorAccent: '#0d1117',
      selectionBackground: 'rgba(88, 166, 255, 0.3)',
      black: '#0d1117',
      red: '#ff7b72',
      green: '#3fb950',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#bc8cff',
      cyan: '#39c5cf',
      brightBlack: '#8b949e',
      brightRed: '#ffa198',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#79c0ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#56d4dd',
      brightWhite: '#f0f6fc',
    },
    syntax: {
      base: '#c9d1d9',
      keyword: '#ff7b72',
      function: '#d2a8ff',
      string: '#a5d6ff',
      comment: '#8b949e',
      variable: '#c9d1d9',
    },
  },
}

export const CODE_THEME_IDS = Object.keys(CODE_THEMES) as CodeThemeId[]

/** 终端前景对背景的对比度（xterm 里这是最低可读性门槛，不是装饰问题） */
export function terminalContrast(id: CodeThemeId): number {
  const { background, foreground } = CODE_THEMES[id].terminal
  const lum = (hex: string): number => {
    const h = hex.replace('#', '')
    const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    const f = (c: number): number => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
    return 0.2126 * f(ch[0]) + 0.7152 * f(ch[1]) + 0.0722 * f(ch[2])
  }
  const [hi, lo] = [lum(foreground), lum(background)].sort((a, b) => b - a)
  return (hi + 0.05) / (lo + 0.05)
}
