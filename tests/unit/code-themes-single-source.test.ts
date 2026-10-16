/**
 * 代码 / 终端配色单源判据（阶段 E5）
 *
 * 换掉单源之前，同一个主题在两个文件里各写一遍 hex（xterm 一份、设置页预览一份），
 * 结果预览色和真实终端色不是一套。这里钉住：
 *   1. 表里每个主题、每个槽位都是合法 hex（rgba 只允许出现在选区色）
 *   2. 终端前景对背景的对比度过 4.5:1（终端是干活的地方，看不清等于不能用）
 *   3. 两个消费者不许再自带色值——出现 6 位 hex 就是又抄了一份
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { CODE_THEMES, CODE_THEME_IDS, terminalContrast } from '@shared/code-themes'

const ROOT = path.resolve(__dirname, '../..')
const HEX = /^#[0-9a-f]{6}$/i
const HEX_OR_RGBA = /^(#[0-9a-f]{6}|rgba?\([\d.,\s]+\))$/i

const ANSI_SLOTS = [
  'background', 'foreground', 'cursor', 'cursorAccent',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
] as const
const SYNTAX_ROLES = ['base', 'keyword', 'function', 'string', 'comment', 'variable'] as const

describe('code-themes 单源', () => {
  it('id 名单与表键一致：四个第三方主题 + 跟随界面的 tdsf，一个都不能少', () => {
    // tdsf-light 是给"跟随界面"用的内部色板，不进用户名单（理由见 terminal-color-single-source.test.ts）
    expect(CODE_THEME_IDS.slice().sort()).toEqual([
      'github-dark',
      'monokai',
      'one-dark',
      'solarized-dark',
      'tdsf',
    ])
    for (const id of CODE_THEME_IDS) expect(CODE_THEMES[id].id).toBe(id)
  })

  it('每个槽位都是合法色值', () => {
    const bad: string[] = []
    for (const id of CODE_THEME_IDS) {
      const t = CODE_THEMES[id]
      for (const slot of ANSI_SLOTS) if (!HEX.test(t.terminal[slot])) bad.push(`${id}.terminal.${slot}=${t.terminal[slot]}`)
      if (!HEX_OR_RGBA.test(t.terminal.selectionBackground)) bad.push(`${id}.selectionBackground`)
      for (const role of SYNTAX_ROLES) if (!HEX.test(t.syntax[role])) bad.push(`${id}.syntax.${role}=${t.syntax[role]}`)
      // 语法正文色必须等于终端前景，否则预览与终端又是两套
      if (t.syntax.base !== t.terminal.foreground) bad.push(`${id}: syntax.base 与 terminal.foreground 不一致`)
    }
    expect(bad, `色值问题：\n${bad.join('\n')}`).toEqual([])
  })

  it('终端前景对背景过 WCAG AA 4.5:1', () => {
    const bad = CODE_THEME_IDS.map((id) => ({ id, r: Number(terminalContrast(id).toFixed(2)) })).filter((x) => x.r < 4.5)
    expect(bad, `对比度不足：\n${JSON.stringify(bad)}`).toEqual([])
  })

  it('消费者不再自带色板（终端与外观设置页里不许出现 6 位 hex）', () => {
    const files = [
      'src/renderer/src/components/terminal/TerminalView.tsx',
      'src/renderer/src/pages/AppearanceSettings.tsx',
    ]
    const offenders: string[] = []
    for (const f of files) {
      const text = fs
        .readFileSync(path.join(ROOT, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      const hits = text.match(/#[0-9a-fA-F]{6}\b/g) ?? []
      if (hits.length) offenders.push(`${f} → ${[...new Set(hits)].join(', ')}`)
    }
    expect(offenders, `又抄了一份色值：\n${offenders.join('\n')}`).toEqual([])
  })
})
