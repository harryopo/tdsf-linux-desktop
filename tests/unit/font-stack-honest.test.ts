/**
 * 字体栈诚实闸（#62：用户在界面上看到了宋体）
 *
 * 为什么静态也要来一把：真机字族普查（ui-audit 的 CSS.getPlatformFontsForNode）
 * 量的是"当下渲染成什么"，但它要跑起来才量得到；而这类缺陷的形状很固定——
 * **栈里以 monospace 收尾却没排中文黑体族**。Windows 上中文等宽默认字族就是宋体，
 * 于是"英文挺好看、中文突然衬线"。写新栈的人未必每次都想得到要跑一次审计，所以这里当场拦。
 *
 * 判据形状：
 * 1. 任何字体栈都不许出现衬线字族名（sans-serif 里的 serif 不算）；
 * 2. 凡以 monospace 收尾的栈，monospace 之前必须已经排了一个中文黑体族；
 * 3. 抽取器自证：扫到的栈数量必须 >0，且对两条人造坏栈必须报出来
 *    （否则"0 处违规"可能只是没扫到东西）。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const CJK_SANS = /'?(Microsoft YaHei|PingFang SC|Noto Sans CJK|Source Han Sans|HarmonyOS Sans SC)'?/i
/** sans-serif 里的 serif 不算衬线，所以用负向后顾 */
const SERIF = /(?<!sans-)\bserif\b|SimSun|NSimSun|宋体|KaiTi|楷体|FangSong|仿宋|STSong|Times New Roman/i

interface Stack {
  file: string
  line: number
  value: string
}

function walk(dir: string, acc: string[] = []): string[] {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return acc
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.(css|tsx|ts)$/.test(e.name)) acc.push(p.split(path.sep).join('/'))
  }
  return acc
}

/**
 * 三种写法都要扫到：CSS 的 `font-family:`、TS/TSX 里的 `fontFamily: "..."`（内联 style 与
 * xterm/Monaco 配置），以及**令牌定义本身**（`--ui-family-*` / `--font-*` / `--app-code-font`）——
 * 真正决定中文落到哪个字族的是那几行，只扫 font-family 会整批漏掉。
 */
const STACK_RE =
  /(?:font-?[Ff]amily|--[\w-]*family[\w-]*|--font-[\w-]+|--app-code-font)\s*:\s*([^;]+)/g

/** 值可能带引号：TSX 里是字符串字面量（结尾还有 `",`），CSS 令牌则直接以 'Inter' 开头 */
function cleanValue(raw: string): string {
  return raw
    .trim()
    .replace(/[,)\s]+$/, '')
    .replace(/^["']/, '')
    .replace(/["']$/, '')
    .trim()
}

/**
 * 展开 `var()` 的兜底段。
 * `font-family: var(--app-code-font, 'JetBrains Mono', Consolas, monospace)` 里真正生效的
 * 是兜底那一段——整条跳过就等于给这类栈开了盲区；纯引用（没有逗号）才交给令牌定义去扫。
 */
function expandVar(v: string): string | null {
  if (!v.startsWith('var(')) return v
  const inner = v.slice(4, v.lastIndexOf(')'))
  const comma = inner.indexOf(',')
  if (comma === -1) return null
  return inner.slice(comma + 1).trim() || null
}

function collectStacks(files: string[]): Stack[] {
  const out: Stack[] = []
  for (const rel of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    text.split(/\r?\n/).forEach((raw, i) => {
      const line = raw.replace(/\/\*.*?\*\//g, '').replace(/^\s*(\/\/|\*)+.*$/, '')
      for (const m of line.matchAll(STACK_RE)) {
        const cleaned = cleanValue(m[1])
        if (!cleaned || cleaned === 'inherit') continue
        const value = expandVar(cleaned)
        if (!value) continue
        out.push({ file: rel, line: i + 1, value })
      }
    })
  }
  return out
}

/** 一条栈的违规清单（空数组 = 这条栈诚实） */
function violations(stack: Stack): string[] {
  const bad: string[] = []
  if (SERIF.test(stack.value)) bad.push('栈里出现衬线字族')
  const monoAt = stack.value.toLowerCase().indexOf('monospace')
  if (monoAt > -1 && !CJK_SANS.test(stack.value.slice(0, monoAt))) {
    bad.push('以 monospace 收尾却没在它前面排中文黑体族（中文会掉成宋体）')
  }
  return bad
}

describe('字体栈不许把中文兜进衬线', () => {
  const stacks = collectStacks(walk('src/renderer/src'))

  it('抽取器扫得到东西（扫到 0 条就是量具坏了，不是通过）', () => {
    // 2026-10-11 实测 10 条真栈（令牌 3 + 全局 code/pre + var 兜底 + 内联 style + xterm/Monaco）；
    // 掉到 8 以下说明抽取面被改版削掉了，而不是"大家都不写栈了"
    expect(stacks.length, '一条字体栈都没扫到，先怀疑正则被改版打穿').toBeGreaterThanOrEqual(8)
    // 这几处是真在定栈的位点，认不出就是抽取器坏了
    for (const probe of ['ui-tokens.css', 'global.css', 'Settings.css']) {
      expect(
        stacks.some((s) => s.file.includes(probe)),
        `没扫到 ${probe} 里的字体栈`
      ).toBe(true)
    }
  })

  it('外观页可选的代码字体栈也诚实（用户一选就全站生效，坏栈会被放大）', () => {
    const text = fs.readFileSync(
      path.join(ROOT, 'src/renderer/src/stores/appearance-store.ts'),
      'utf8'
    )
    const block = text.match(/CODE_FONT_STACKS[\s\S]*?\n\}/)
    expect(block, 'appearance-store 里找不到 CODE_FONT_STACKS，口径变了').toBeTruthy()
    const opts = [...block![0].matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1])
    expect(opts.length, '代码字体选项少于 4 个说明抽取没对上').toBeGreaterThanOrEqual(4)
    const hits = opts.flatMap((v) =>
      violations({ file: 'appearance-store.ts', line: 0, value: v }).map((w) => `${w} — "${v}"`)
    )
    expect(hits, `这些可选栈会把中文兜成宋体：\n${hits.join('\n')}`).toEqual([])
  })

  it('阴性对照：人造的两条坏栈必须被报出来', () => {
    expect(violations({ file: 'x', line: 1, value: "'JetBrains Mono', monospace" })).toEqual([
      '以 monospace 收尾却没在它前面排中文黑体族（中文会掉成宋体）',
    ])
    expect(violations({ file: 'x', line: 1, value: 'SimSun, serif' })).toEqual([
      '栈里出现衬线字族',
    ])
    // 反过来：sans-serif 不该被当成衬线
    expect(violations({ file: 'x', line: 1, value: "'Microsoft YaHei', system-ui, sans-serif" })).toEqual([])
  })

  it('全仓每一条字体栈都诚实', () => {
    const hits = stacks.flatMap((s) => violations(s).map((why) => `${s.file}:${s.line} — ${why} — "${s.value}"`))
    expect(hits, `这些栈会把中文兜成宋体：\n${hits.join('\n')}`).toEqual([])
  })

  it('代码栈只有一份（不再开"混排档"，避免两份栈各自漂移）', () => {
    const tokens = fs.readFileSync(path.join(ROOT, 'src/renderer/src/styles/ui-tokens.css'), 'utf8')
    const families = [...tokens.matchAll(/^\s*(--ui-family-[a-z-]+):/gm)].map((m) => m[1])
    expect(families.sort()).toEqual(['--ui-family-code', '--ui-family-ui'])
    // 混排档删干净了：留着名字却没有定义，用它的地方会静默回退
    const whole = walk('src/renderer/src')
      .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'))
      .join('\n')
    expect(whole).not.toContain('ui-family-code-cjk')
    expect(whole).not.toContain('font-code-cjk')
  })
})
