/**
 * 浅色主题覆写完整性测试（阶段 E3 判据的机器可查部分）
 *
 * 计划里"浅色是假的"这件事，光靠截图看一眼不算验收——漏一个令牌，界面就有一块
 * 留在深色上。所以这条测试按"令牌级"钉住：
 *   1. :root 里定义的每一个**颜色类**令牌，只要被代码消费过，
 *      就必须在 :root[data-theme='light'] 里有覆写，或者显式记在"不随主题变"的白名单里
 *      （白名单每条要写理由，加一条就等于承认一处浅色盲区）。
 *   2. color-scheme 只能在令牌文件里声明，样式层不许再写一份（否则同一件事两份真值）。
 *   3. 浅色覆写里不许出现"和深色同值"的假覆写。
 *
 * 值链（--a: var(--b)）按链跟到底层色值判断，避免把派生令牌误报成盲区。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const TOKENS_FILE = path.join(ROOT, 'src/renderer/src/styles/trae-tokens.css')
const UI_TOKENS_FILE = path.join(ROOT, 'src/renderer/src/styles/ui-tokens.css')
const RENDERER = path.join(ROOT, 'src/renderer/src')

const src = fs.readFileSync(TOKENS_FILE, 'utf8')
const uiSrc = fs.readFileSync(UI_TOKENS_FILE, 'utf8')

function blockOf(text: string, re: RegExp): string {
  const m = re.exec(text)
  if (!m) throw new Error('令牌文件里找不到预期的选择器块：' + re)
  return m[1]
}
function decls(block: string, into: Map<string, string>): Map<string, string> {
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    if (!into.has(m[1])) into.set(m[1], m[2].trim())
  }
  return into
}

/**
 * 两个令牌文件合成一个命名空间：
 * ui-tokens.css 持有色值字面量（深浅两套），trae-tokens.css 的配色节已全部桥接到它。
 * 所以旧名字要跟着 var 链跨文件解析，否则每条桥接都会被误报成浅色盲区。
 */
const base = decls(
  blockOf(uiSrc, /:root,\s*\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/),
  decls(blockOf(src, /:root\s*\{([\s\S]*?)\n\}/), new Map<string, string>())
)
const light = decls(
  blockOf(uiSrc, /:root\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/),
  decls(blockOf(src, /:root\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/), new Map<string, string>())
)

const isColorValue = (v: string): boolean =>
  /^#[0-9a-f]{3,8}$/i.test(v) || /^rgba?\(/i.test(v) || /^hsla?\(/i.test(v)

/** 浅色下的有效值：覆写优先，没覆写就用基础值（桥接名靠目标在浅色下的值翻面） */
const lightMerged = new Map([...base, ...light])

/** 跟着 var() 链找底层值；链断了或成环都按"未知"处理 */
function resolvesToColor(name: string, seen = new Set<string>()): boolean {
  if (seen.has(name)) return false
  seen.add(name)
  const v = base.get(name)
  if (!v) return false
  if (isColorValue(v)) return true
  const ref = v.match(/var\((--[a-z0-9-]+)\b/)
  return ref ? resolvesToColor(ref[1], seen) : false
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.(css|ts|tsx)$/.test(e.name)) acc.push(p)
  }
  return acc
}
const consumers = walk(RENDERER)
  .filter((f) => f !== TOKENS_FILE)
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n')

/**
 * 令牌是否被浅色覆写覆盖：自己有覆写算覆盖；`var(--x)` 别名跟着目标算覆盖
 * （别名不覆写也会随目标翻面，把它算成盲区是误报）。
 */
function covered(name: string, seen = new Set<string>()): boolean {
  if (seen.has(name)) return false
  seen.add(name)
  if (light.has(name)) return true
  const v = base.get(name)
  if (!v) return false
  const ref = v.match(/var\((--[a-z0-9-]+)\b/)
  return ref ? covered(ref[1], seen) : false
}

/**
 * 不随主题翻转的令牌：几何、动效、字体族，以及"本来就设计成跨主题固定"的色板。
 * 每条都要写理由——它就是在承认"这块浅色下保持原值"。
 */
const THEME_NEUTRAL: Record<string, string> = {
  '--trae-accent-teal': 'viz 系列色板：图表/标签的分类色，靠色相区分而非明度，两主题共用同一组饱和色',
  '--trae-accent-coral': 'viz 系列色板，同 teal',
  '--trae-accent-amber': 'viz 系列色板，同 teal',
  '--trae-accent-lime': 'viz 系列色板，同 teal',
  '--trae-accent-cyan': 'viz 系列色板，同 teal',
  '--trae-accent-blue': 'viz 系列色板，同 teal',
  '--trae-accent-magenta': 'viz 系列色板，同 teal',
  '--trae-accent-violet': 'viz 系列色板，同 teal',
  '--trae-accent-slate': 'viz 系列色板，同 teal',
  '--trae-special-white': '纯白前景，只用在主色按钮/徽章文字上，跨主题固定',
  '--trae-shader-bg': '启动着色动画底：固定黑，避免首屏闪白（动画只持续一次入场）',
  '--trae-shader-fg': '启动着色动画前景，与 shader-bg 成对，跨主题固定',
  '--trae-shader-brand': '启动着色动画的品牌光晕，跨主题固定',
  '--trae-shader-muted': '启动着色动画暗部，与 shader-bg 成对',
  '--trae-shader-muted-foreground': '启动着色动画弱前景，与 shader-bg 成对',
  '--trae-brand-3': '品牌色阶第 3 档：色阶 1-10 是固定梯度，语义层要浅色应引用 --trae-bg-brand 而不是色阶',
}

describe('浅色主题令牌覆写完整性', () => {
  const colorTokens = [...base.keys()].filter((n) => resolvesToColor(n))
  const consumedColor = colorTokens.filter((n) => consumers.includes(`var(${n})`))

  it('浅色覆写块确实存在且非空', () => {
    expect(light.size).toBeGreaterThan(20)
  })

  it('被消费的颜色令牌都有浅色覆写（或记入有理由的白名单）', () => {
    const missing = consumedColor
      .filter((n) => !covered(n) && !(n in THEME_NEUTRAL))
      .map((n) => `${n} = ${base.get(n)}`)
    expect(missing, `浅色盲区 ${missing.length} 处:\n${missing.join('\n')}`).toEqual([])
  })

  it('白名单里的令牌确实是无主题色的（防止拿白名单当遮羞布）', () => {
    const abusing = Object.keys(THEME_NEUTRAL).filter((n) => {
      const v = base.get(n)
      // 背景/文字/边框/状态这类语义色必须跟主题走，不许进白名单
      return /--(bg-|text-|border-|status-|icon-|shadow-)/.test(n) || !v
    })
    expect(abusing).toEqual([])
    for (const [n, why] of Object.entries(THEME_NEUTRAL)) {
      expect(why.length, `${n} 的白名单理由没写`).toBeGreaterThan(3)
    }
  })

  it('没有"和深色同值"的假覆写', () => {
    // 只比两边都是色值字面量的：桥接（var(...)）本来就靠目标翻面，算成假覆写是误报。
    // 只管 --trae- 这一族：ui-tokens 的自有令牌由 tests/unit/ui-tokens.test.ts 负责，
    // 两边各管各的命名空间，合并 map 只用来跟 var 链。
    const fake = [...light]
      .filter(([n, v]) => {
        const d = base.get(n)
        return (
          n.startsWith('--trae-') &&
          d !== undefined &&
          isColorValue(d) &&
          isColorValue(v) &&
          d.toLowerCase() === v.toLowerCase()
        )
      })
      .map(([n]) => n)
    expect(fake, `这些令牌覆写了但值没变:\n${fake.join('\n')}`).toEqual([])
  })

  it('color-scheme 只在令牌文件里声明，且深浅各一次', () => {
    const schemes = [...src.matchAll(/color-scheme\s*:\s*([a-z ]+);/g)].map((m) => m[1].trim())
    expect(schemes.sort()).toEqual(['dark', 'light'])
    // 令牌层有两个文件：ui-tokens.css 是新外壳的唯一色值源，trae-tokens.css 是尚未重建页面的旧源。
    // 外壳全部重建完的最后一个提交里删掉后者，这条白名单同步收成一份。
    const TOKEN_FILES = new Set([
      TOKENS_FILE,
      path.join(ROOT, 'src/renderer/src/styles/ui-tokens.css'),
    ])
    const offenders = walk(RENDERER)
      .filter((f) => f.endsWith('.css') && !TOKEN_FILES.has(f))
      // 只认 CSS 声明：JS 里的 matchMedia('(prefers-color-scheme: dark)') 是读系统偏好，不是第二份真值
      .filter((f) =>
        /(^|[^-])color-scheme\s*:/.test(
          fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
        )
      )
      .map((f) => path.relative(ROOT, f))
    expect(offenders, '样式层又写了一份 color-scheme').toEqual([])
  })

  it('浅色下文字与背景的对比度达标（WCAG AA 4.5:1）', () => {
    const lum = (hex: string): number => {
      const h = hex.replace('#', '')
      const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
      const f = (c: number): number => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const ratio = (a: string, b: string): number => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
      return (x + 0.05) / (y + 0.05)
    }
    /** 跟 var 链取到最终 hex（桥接名要跨文件解析到 ui-tokens 的字面量） */
    const hexOf = (name: string, map: Map<string, string>, seen = new Set<string>()): string | null => {
      const v = map.get(name)
      if (!v) return null
      if (/^#[0-9a-f]{3,8}$/i.test(v)) return v
      const ref = v.match(/var\((--[a-z0-9-]+)\b/)
      if (!ref || seen.has(ref[1])) return null
      seen.add(ref[1])
      return hexOf(ref[1], map, seen)
    }
    const pairs: [string, string, string][] = [
      ['--trae-text-default', '--trae-bg-base-default', '正文 / 画布'],
      ['--trae-text-secondary', '--trae-bg-base-default', '次级文字 / 画布'],
      ['--trae-text-default', '--trae-bg-base-secondary', '正文 / 卡片'],
      ['--trae-text-secondary', '--trae-bg-base-secondary', '次级文字 / 卡片'],
      ['--trae-text-onbrand', '--trae-bg-brand', '按钮文字 / 主色'],
      ['--trae-status-error-default', '--trae-bg-base-default', '错误色 / 画布'],
      ['--trae-status-success-default', '--trae-bg-base-default', '成功色 / 画布'],
    ]
    const bad = pairs
      .map(([fg, bg, label]) => {
        const f = hexOf(fg, lightMerged)
        const b = hexOf(bg, lightMerged)
        if (!f || !b) return { label, r: -1 }
        return { label, r: Number(ratio(f, b).toFixed(2)) }
      })
      .filter((x) => x.r < 4.5)
    expect(bad, `浅色对比度不足 4.5:1 的组合（r=-1 表示跟 var 链取不到 hex）:\n${JSON.stringify(bad)}`).toEqual([])
  })
})
