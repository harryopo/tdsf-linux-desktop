/**
 * 终端底色与外壳画布同单源（2026-10-16 用户："终端的颜色不与其它的界面统一"）
 *
 * 病根：DESIGN.md 把 `--bg-primary` 定义为"画布：消息流、编辑器、终端"，
 * 而默认代码主题一直是 one-dark(#282c34)——终端于是永远是界面里一块颜色不同的蓝灰矩形。
 * 现在默认档是"跟随界面"(tdsf / tdsf-light)，底色必须等于那一头令牌的值。
 *
 * 这条判据**从 CSS 里读真值**再比，不写死两边数字：改令牌而忘了改色板、
 * 或反过来，都会当场红。（只写死 #1e1e1e 的判据等于给两边各发一张通行证。）
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  CODE_THEMES,
  CODE_THEME_IDS,
  FOLLOW_UI_THEME_ID,
  resolveCodeTheme,
  terminalContrast,
} from '@shared/code-themes'

const TOKENS_CSS = resolve(join(process.cwd(), 'src/renderer/src/styles/ui-tokens.css'))
const css = readFileSync(TOKENS_CSS, 'utf8')

/** 从令牌文件里读某个变量在明/暗哪一半的取值（浅色块从 :root[data-theme='light'] 起） */
function tokenValue(name: string, mode: 'light' | 'dark'): string {
  const cut = css.indexOf(":root[data-theme='light']")
  expect(cut, '令牌文件里找不到浅色块，这个读法要跟着改').toBeGreaterThan(-1)
  const block = mode === 'light' ? css.slice(cut) : css.slice(0, cut)
  const hit = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(block)
  expect(hit, `令牌文件里没有 --${name}（${mode}）`).toBeTruthy()
  return hit![1].toLowerCase()
}

describe('默认代码主题 = 外壳画布同底', () => {
  it('深色：tdsf 的终端底色就是 --bg-primary', () => {
    expect(CODE_THEMES[FOLLOW_UI_THEME_ID].terminal.background.toLowerCase()).toBe(
      tokenValue('bg-primary', 'dark'),
    )
  })

  it('浅色：tdsf-light 的终端底色就是浅色块的 --bg-primary', () => {
    expect(CODE_THEMES['tdsf-light'].terminal.background.toLowerCase()).toBe(
      tokenValue('bg-primary', 'light'),
    )
  })

  it('跟随界面这一档在浅色主题下自动换白底那副面孔', () => {
    expect(resolveCodeTheme(FOLLOW_UI_THEME_ID, 'dark').id).toBe(FOLLOW_UI_THEME_ID)
    expect(resolveCodeTheme(FOLLOW_UI_THEME_ID, 'light').id).toBe('tdsf-light')
  })

  it('用户点名的其它主题不许被明暗自动改掉', () => {
    expect(resolveCodeTheme('one-dark', 'light').id).toBe('one-dark')
    expect(resolveCodeTheme('github-dark', 'light').id).toBe('github-dark')
  })

  it('两副面孔的前后对比度都过 WCAG 正文线（4.5:1）', () => {
    for (const mode of ['dark', 'light'] as const) {
      const c = terminalContrast(FOLLOW_UI_THEME_ID, mode)
      expect(c, `${mode} 下终端正文对比度不够`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('设置页名单里有"跟随界面"、没有它的浅色分身', () => {
    expect(CODE_THEME_IDS).toContain(FOLLOW_UI_THEME_ID)
    expect(CODE_THEME_IDS).not.toContain('tdsf-light')
    // 但表里必须有那一格，否则浅色主题解析出来是 undefined
    expect(CODE_THEMES['tdsf-light']).toBeTruthy()
  })

  it('默认值真的指向这一档（改了表忘了默认等于没改）', async () => {
    const { APPEARANCE_DEFAULTS } = await import('@/stores/appearance-store')
    expect(APPEARANCE_DEFAULTS.codeTheme).toBe(FOLLOW_UI_THEME_ID)
  })
})
