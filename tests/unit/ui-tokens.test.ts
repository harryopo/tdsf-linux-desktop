/**
 * UI 令牌层（cc-gui 视觉语言）的机器可查判据
 *
 * 为什么要有这个文件：外壳重建期间有两套令牌并存（新 ui-tokens.css 与旧
 * trae-tokens.css）。要么把旧的那套删干净，要么把新的这套写歪。这里钉死四件事：
 *   1. 颜色类令牌在浅色块必须有覆写（或记进有理由的白名单）——浅色又是假的就死在这一步。
 *   2. 深浅两套的正文/次级/主按钮/状态色配对都要过 WCAG AA 4.5:1，不算"看着挺清楚"。
 *   3. 尺度（圆角/字号/时长/层级/间距）只能是既有档位，新增档位会被这条拦下。
 *   4. 不许把 JetBrains 宿主的 --idea-* / --vscode-* 兜底链搬进 Electron。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const TOKENS_FILE = path.join(ROOT, 'src/renderer/src/styles/ui-tokens.css')
const src = fs.readFileSync(TOKENS_FILE, 'utf8')

/** 相对仓库根、正斜杠的报告用路径（写成 split().pop() 的话 TS 说可能是 undefined） */
const rel = (p: string): string => p.slice(ROOT.length).replace(/\\/g, '/')

/** 去掉注释，避免把注释里的示例值当成声明 */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '')

function decls(blockRe: RegExp): Map<string, string> {
  const m = blockRe.exec(code)
  if (!m) throw new Error('令牌文件里找不到预期的选择器块：' + blockRe)
  const out = new Map<string, string>()
  for (const d of m[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    if (!out.has(d[1])) out.set(d[1], d[2].trim())
  }
  return out
}

// 深色块：:root,[data-theme='dark']{...}；浅色块：:root[data-theme='light']{...}
const dark = decls(/:root,\s*\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/)
const light = decls(/:root\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/)

const isColor = (v: string): boolean =>
  /^#[0-9a-f]{3,8}$/i.test(v) || /^rgba?\(/i.test(v) || /^hsla?\(/i.test(v)

function resolve(name: string, map: Map<string, string>, seen = new Set<string>()): string | null {
  const v = map.get(name)
  if (!v) return null
  if (isColor(v)) return v
  const ref = v.match(/var\((--[a-z0-9-]+)\b/)
  if (!ref || seen.has(ref[1])) return null
  seen.add(ref[1])
  return resolve(ref[1], map, seen)
}

const colorNames = [...dark.keys()].filter((n) => isColor(dark.get(n)!))

/**
 * 浅色下刻意保持不变的令牌：反白字（按钮上的白字两边都是白）。
 * 每条必须写理由——它是在承认一处"浅色下不翻面"。
 */
const LIGHT_STAYS: Record<string, string> = {
  '--text-on-accent': '主按钮白字：深浅两侧按钮底都压到足够暗，白字两边都过 4.5',
  '--bubble-user-text': '用户气泡内文字：气泡底色本身跟主题换，文字固定白',
}

/** 取 hex 的相对亮度（WCAG sRGB） */
function lum(hex: string): number | null {
  const h = hex.replace('#', '')
  if (!/^[0-9a-f]{3,8}$/i.test(h)) return null
  const full = (h.length === 3 ? h.split('').map((c) => c + c).join('') : h).slice(0, 6)
  const ch = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
  const f = (c: number): number => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * f(ch[0]) + 0.7152 * f(ch[1]) + 0.0722 * f(ch[2])
}

function ratio(fg: string, bg: string): number | null {
  const [a, b] = [lum(fg), lum(bg)]
  if (a === null || b === null) return null
  const [hi, lo] = [a, b].sort((m, n) => n - m)
  return (hi + 0.05) / (lo + 0.05)
}

/** 对比度配对：[前景, 背景, 说明]。加一对就多一道保险，删一对要能说清为什么。 */
const CONTRAST_PAIRS: [string, string, string][] = [
  ['--text-primary', '--bg-primary', '正文 / 画布'],
  ['--text-primary', '--bg-secondary', '正文 / 面板'],
  ['--text-primary', '--bg-elevated', '正文 / 浮层'],
  ['--text-secondary', '--bg-primary', '强调文字 / 画布'],
  ['--text-tertiary', '--bg-primary', '摘要文字 / 画布'],
  ['--text-tertiary', '--bg-hover', '摘要文字 / hover 底（最浅的一档背景）'],
  ['--text-tertiary', '--bg-active', '摘要文字 / active 底'],
  ['--text-muted', '--bg-primary', '时间戳 / 画布'],
  ['--text-muted', '--bg-elevated', '时间戳 / 浮层'],
  ['--text-muted', '--bg-active', '时间戳 / active 底'],
  ['--text-placeholder', '--bg-tertiary', '输入占位 / 输入底'],
  ['--text-placeholder', '--bg-elevated', '输入占位 / 浮层输入底'],
  ['--accent-text', '--bg-primary', '链接 / 画布'],
  ['--text-on-accent', '--accent-solid', '主按钮文字 / 按钮底'],
  ['--status-success', '--bg-primary', '成功色 / 画布'],
  ['--status-warning', '--bg-primary', '警告色 / 画布'],
  ['--status-error', '--bg-primary', '错误色 / 画布'],
  ['--status-danger', '--bg-primary', '危险色 / 画布'],
  // chip / banner 里的文字用 -text 档：纯色状态字压在 soft 底上实测只有 2.16–3.9:1
  ['--status-success-text', '--bg-elevated', '成功 chip 文字 / 浮层'],
  ['--status-warning-text', '--bg-elevated', '警告 chip 文字 / 浮层'],
  ['--status-error-text', '--bg-elevated', '错误 chip 文字 / 浮层'],
  ['--status-danger-text', '--bg-elevated', '危险 chip 文字 / 浮层'],
  ['--status-info-text', '--bg-elevated', '信息 chip 文字 / 浮层'],
  ['--status-success-text', '--bg-hover', '成功 chip 文字 / hover 底'],
  ['--status-error-text', '--bg-hover', '错误 chip 文字 / hover 底'],
  ['--bubble-user-text', '--bubble-user-bg', '用户气泡文字 / 气泡底'],
  ['--role-assistant', '--bg-primary', 'AI 角色标识色 / 画布'],
]

describe('ui-tokens.css（cc-gui 令牌层）', () => {
  it('深色块与浅色块都存在，且浅色覆写不是一句空话', () => {
    expect(dark.size).toBeGreaterThan(60)
    expect(light.size).toBeGreaterThan(40)
  })

  it('每个颜色令牌都有浅色覆写（或记入有理由的白名单）', () => {
    const missing = colorNames
      .filter((n) => !light.has(n) && !(n in LIGHT_STAYS))
      .map((n) => `${n} = ${dark.get(n)}`)
    expect(missing, `浅色盲区 ${missing.length} 处：\n${missing.join('\n')}`).toEqual([])
  })

  it('白名单只允许"反白字"这一类，语义背景/文字/状态色不许进', () => {
    const abusing = Object.keys(LIGHT_STAYS).filter(
      (n) => !/--(text-on|bubble-user-text)/.test(n) || !dark.has(n)
    )
    expect(abusing).toEqual([])
    for (const [n, why] of Object.entries(LIGHT_STAYS)) {
      expect(why.length, `${n} 没写白名单理由`).toBeGreaterThan(3)
    }
  })

  it('浅色覆写不许和深色同值（假覆写）', () => {
    // 只比"两边都是色值字面量"的：别名（var(--x)）本来就靠目标翻面，
    // 把它算成假覆写是误报，它的正确性由上面的覆盖率和下面的对比度负责。
    const fake = [...light]
      .filter(([n, v]) => {
        const d = dark.get(n)
        if (!d || LIGHT_STAYS[n]) return false
        return isColor(d) && isColor(v) && d.toLowerCase() === v.toLowerCase()
      })
      .map(([n]) => n)
    expect(fake, `覆写了但值没变：\n${fake.join('\n')}`).toEqual([])
  })

  it('深浅两套的 14 组文字/背景配对全部过 WCAG AA 4.5:1', () => {
    const bad: string[] = []
    for (const theme of ['dark', 'light'] as const) {
      const map = theme === 'dark' ? dark : light
      for (const [fgName, bgName, label] of CONTRAST_PAIRS) {
        const fg = resolve(fgName, map)
        const bg = resolve(bgName, map)
        if (!fg || !bg) {
          bad.push(`${theme} ${label}：取不到色值（${fgName} 或 ${bgName}）`)
          continue
        }
        const r = ratio(fg, bg)
        if (r === null) bad.push(`${theme} ${label}：不是可计算的 hex（${fg} / ${bg}）`)
        else if (r < 4.5) bad.push(`${theme} ${label}：${fg} on ${bg} = ${r.toFixed(2)}:1`)
      }
    }
    expect(bad, `对比度不足 4.5:1：\n${bad.join('\n')}`).toEqual([])
  })

  it('尺度只允许既有档位，不许随手加档', () => {
    const scaleOf = (prefix: string): string[] =>
      [...dark.keys()].filter((n) => n.startsWith(prefix)).map((n) => dark.get(n)!)

    // Apple 美学刻度：6 行内 / 10 控件 / 14 卡片 / 18 面板 / 22 气泡 + pill。
    // 嵌套遵守 concentricity：内层圆角 = 外层圆角 − 内缩距离，算出 ≤0 就用直角。
    const allowed = new Set(['6px', '10px', '14px', '18px', '22px', '999px'])
    const radii = scaleOf('--ui-radius-')
    expect(radii.length).toBe(6)
    expect(radii.filter((v) => !allowed.has(v))).toEqual([])

    // 字号：Trae 中等密度档 11/12/13/14/15/16/17/20 + 展示档 30 + 启动页字标 44。10px 整档已废（AA 底线）
    expect(
      scaleOf('--ui-font-').filter((v) => !/^(11|12|13|14|15|16|17|20|30|44)px$/.test(v))
    ).toEqual([])
    expect(scaleOf('--ui-font-').filter((v) => parseInt(v, 10) < 11)).toEqual([])

    // 时长三档 / 层级六档
    expect(scaleOf('--ui-dur-').sort()).toEqual(['150ms', '200ms', '300ms'])
    expect(scaleOf('--ui-z-').length).toBe(6)

    // 间距是 cc-gui 的事实档位（2/4/6/8/12/16/20/24）：6 是"图标-文字"档，不是随手加出来的
    const spaceSteps = new Set([2, 4, 6, 8, 12, 16, 20, 24])
    const spaces = scaleOf('--ui-space-').map((v) => parseInt(v, 10))
    expect(spaces.filter((n) => !spaceSteps.has(n))).toEqual([])
    expect(spaces.length).toBe(8)
  })

  it('JetBrains 宿主变量兜底没有被搬进来', () => {
    expect(code).not.toMatch(/--(idea|vscode)-/)
  })

  it('color-scheme 只在令牌层，且本文件深浅各一次', () => {
    const schemes = [...code.matchAll(/color-scheme\s*:\s*([a-z ]+);/g)].map((m) => m[1].trim())
    expect(schemes.sort()).toEqual(['dark', 'light'])
  })

  // 注释配对（本文件与 tailwind.css 各踩过一次提前闭合）不在这里查：
  // tests/unit/css-comment-balance.test.ts 横扫 src 下全部 CSS，两处各写一遍只会漂移。
})

describe('字阶单源（阶段 E6）', () => {
  const RENDERER = path.join(ROOT, 'src/renderer/src')

  function tsxFiles(dir: string, acc: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) tsxFiles(p, acc)
      else if (/\.tsx$/.test(e.name)) acc.push(p)
    }
    return acc
  }

  it('组件里不许再出现绕过字阶的 text-[Npx]', () => {
    const hits = tsxFiles(RENDERER)
      .filter((f) => /text-\[[0-9.]+px\]/.test(fs.readFileSync(f, 'utf8')))
      .map(rel)
    expect(hits.length, `这些文件还在写死字号：\n${hits.join('\n')}`).toBe(0)
  })

  /**
   * 状态色分两档：裸档（--status-error）画图形，*-text 档写文字。
   * 裸档在深色底上够亮，但当文字用在浅色主题就只有 3.7:1，过不了 AA——
   * 2026-10-07 就是真机审计抓到连接对话框的必填星号 3.74:1 才补的这条闸。
   */
  it('可见文字不许用裸状态色，只许用校准过的 *-text 档', () => {
    const RAW = /\btext-(error|warning|success|info)\b(?!-)/
    const hits: string[] = []
    for (const f of tsxFiles(RENDERER)) {
      const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/)
      lines.forEach((line, i) => {
        if (!RAW.test(line)) return
        // 图标那一行必带 size-N（图形按 3:1 判），只有文字行才要求 *-text
        if (/\bsize-\d/.test(line)) return
        hits.push(`${rel(f)}:${i + 1}  ${line.trim().slice(0, 90)}`)
      })
    }
    expect(hits, `这些可见文字用的裸状态色达不到 AA：\n${hits.join('\n')}`).toEqual([])
  })

  it('页面不许自写标题栏：h1 只能出自 ui/PageHeader（BootPage 的字标除外）', () => {    const hits = tsxFiles(path.join(RENDERER, 'pages'))
      .filter((f) => !f.endsWith('BootPage.tsx'))
      .filter((f) => /<h1[\s>]/.test(fs.readFileSync(f, 'utf8')))
      .map(rel)
    expect(
      hits.length,
      `这些页面还在自写 <h1>，改用 <PageHeader>：\n${hits.join('\n')}`
    ).toBe(0)
  })

  it('tailwind 的 --text-* 档位全部回落到 ui-tokens 的字号/行高刻度', () => {
    const tw = fs.readFileSync(path.join(RENDERER, 'styles/tailwind.css'), 'utf8')
    const pairs = [...tw.matchAll(/--text-([a-z-]+?)(--line-height)?:\s*([^;]+);/g)]
    expect(pairs.length).toBeGreaterThan(0)
    for (const m of pairs) {
      const isLh = Boolean(m[2])
      // 没有例外档：展示档的行高也曾写成 36px 定值，2026-10-05 起统一回落到 --ui-lh-* 刻度
      expect(
        m[3].trim(),
        `${isLh ? '行高' : '字号'}档没有回落到 --ui-${isLh ? 'lh' : 'font'}-*：${m[0]}`,
      ).toMatch(new RegExp(`var\\(--ui-${isLh ? 'lh' : 'font'}-`))
    }
  })

  it('字号刻度与行高刻度成对存在（避免字号换了行高没换）', () => {
    const tw = fs.readFileSync(path.join(RENDERER, 'styles/tailwind.css'), 'utf8')
    const sizes = [...code.matchAll(/(--ui-font-[a-z]+)\s*:/g)].map((m) => m[1].replace('--ui-font-', ''))
    expect(sizes.length).toBeGreaterThanOrEqual(9)
    for (const bare of sizes) {
      if (bare === 'display') continue // 展示档行高按设计定值 36px，不取比例刻度
      expect(tw, `--ui-font-${bare} 在 tailwind 里没有成对的 --text-${bare}--line-height`).toContain(
        `--text-${bare}--line-height`,
      )
    }
  })
})
