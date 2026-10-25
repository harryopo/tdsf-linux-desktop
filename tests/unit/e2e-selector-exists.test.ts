/**
 * e2e 里的类选择器必须在渲染层源码里真的会被渲染出来（2026-10-09 补）
 *
 * 起因：agent-tool-viz-ui.spec.ts 点的是 `.ai-composer-textarea`，
 * 而这个类**只存在于一条死 CSS 里**（改版前的样式，TSX 早就不写了）——
 * DOM 里永远没有它，于是那条用例一直在等一个不存在的元素。
 * 已有的 e2e-selector-freshness 只拦 `.ant-*` 这一种痕迹，拦不住"类名换成自家历史名"的同类问题。
 *
 * 判据：e2e 里当作选择器用的每个类名（不管是 `locator('.x')`、`waitForSelector('.x')`
 * 还是 `gotoRoute(win, hash, '.x')` 这种传参写法），都必须作为字符串出现在 src/renderer 的 .ts/.tsx 里
 * （即界面真的会带上这个类）。库自己生成的类（Monaco / xterm / recharts）走显式白名单，
 * 每条都写清是谁生成的——白名单不是豁免，是把"为什么可以不在源码里"记下来。
 *
 * 2026-10-09 第二次收紧：`mon-` 前缀写宽了，把早就死掉的 `.mon-main` 放过（Monaco 真实前缀是 `monaco-`）；
 * 同时把取数从"按调用名"改成"按字符串字面量"，否则传参写法继续漏网。
 */
import { vi, describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

// 本文件的每条用例都要起一个真子进程跑门禁脚本：全量并行时 20 秒全局预算不够（现量见
// scripts/quality/subprocess-test-timeout.cjs 的文件头），所以只给这一份放宽。
vi.setConfig({ testTimeout: 60000 })

/** 第三方库自己注入 DOM 的类前缀（源码里当然找不到） */
const LIB_PREFIXES: Array<[string, string]> = [
  ['monaco-', 'Monaco 编辑器自己生成的 DOM'],
  ['xterm-', 'xterm.js 自己生成的 DOM'],
  ['recharts-', 'recharts 图表自己生成的 DOM'],
  ['rdp-', 'react-diff-view 生成的 DOM'],
]

/**
 * 不带那四个前缀、但同样是库自己注入 DOM 的类。
 *
 * 规矩与 LIB_PREFIXES 一样：每条必须写清是谁生成的（白名单不是豁免，是记录出处）。
 * 2026-10-25 加 `view-lines`：#213 的真机判据要证"编辑器真的滚到了命中那一行"，
 * 用的就是 Monaco 的行容器（Monaco 只渲染视口内的行，那一行的文字出现在这里才证明真跳过去了）。
 */
const LIB_CLASSES: Array<[string, string]> = [
  ['view-lines', 'Monaco 的行容器：node_modules/monaco-editor/esm/vs/editor/browser/viewParts/viewLines/viewLines.js:94 自己 setClassName'],
]

/**
 * 扫工作树，不扫 `git ls-files`。
 *
 * 原来用 ls-files，等于"新写的 spec 在提交之前不受检"——而恰好就是新写的代码最容易
 * 抄一个改版前的旧类名（`.ai-composer-textarea`、`.mon-main` 都是这么来的）。
 * e2e 跑的也是工作树里的当前代码，所以两侧统一按磁盘现状取数。
 */
function walkFiles(dir: string, exts: RegExp): string[] {
  const abs = path.join(process.cwd(), dir)
  if (!fs.existsSync(abs)) return []
  const out: string[] = []
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${ent.name}`
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules') continue
      out.push(...walkFiles(rel, exts))
    } else if (exts.test(ent.name)) {
      out.push(rel)
    }
  }
  return out
}

/** 收集 e2e 里用到的类名 → 出现位置 */
function collectClassSelectors(): Map<string, string[]> {
  const use = new Map<string, string[]>()
  for (const f of walkFiles('tests/e2e', /\.ts$/)) {
    const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8')
    for (const [cls, line] of classTokens(src)) {
      use.set(cls, [...(use.get(cls) ?? []), `${f}:${line}`])
    }
  }
  return use
}

function rendererSourceBlob(): string {
  return walkFiles('src/renderer', /\.(ts|tsx)$/)
    .map((f) => fs.readFileSync(path.join(process.cwd(), f), 'utf8'))
    .join('\n')
}

function isLibClass(cls: string): boolean {
  return LIB_PREFIXES.some(([p]) => cls.startsWith(p)) || LIB_CLASSES.some(([c]) => c === cls)
}

/**
 * 以"整个字符串字面量"为单位取选择器，而不是按 `locator(...)` 这种调用名取。
 *
 * 为什么要换：按调用名取只覆盖了 `locator` 和 `waitForSelector`，而 e2e 里存在
 * `gotoRoute(window, '#/monitor', '.mon-main')` 这类**把选择器当参数传下去**的写法，
 * 名字不在名单里就整条漏网（`.mon-main` 死选择器正是这样在 content-screenshot 里活下来的）。
 *
 * 代价是文件名也会长得像选择器（`'.png'`、`'.ai-credentials.local.json'`），
 * 所以按扩展名/目录名显式排除。这份排除清单是可见、可审的——它只挡文件名，
 * 不拿"已核实是假缺陷"当豁免理由。
 */
const NOT_A_SELECTOR = new Set([
  '.git',
  '.png',
  '.json',
  '.ts',
  '.tsx',
  '.js',
  '.cjs',
  '.mjs',
  '.css',
  '.html',
  '.md',
  '.log',
  '.txt',
  '.env',
])

/** 把注释内容抹成空格（换行保留，行号才不漂移） */
function blankComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, (m) => m.replace(/[^\n]/g, ' '))
}

/** 从一段源码里取出所有"以 . 开头且不是文件名"的字符串字面量中的类名 */
function classTokens(src: string): Array<[string, number]> {
  const out: Array<[string, number]> = []
  // 注释里的 `.foo` 不会被执行，扫它只会造出假红（acceptance-screenshots 的文件头
  // 就用反引号写了历史类名）。先把注释剥掉。
  const code = blankComments(src)
  const litRe = /(['"`])((?:(?!\1)[^\\\n])*)\1/g
  let lit: RegExpExecArray | null
  while ((lit = litRe.exec(code))) {
    const value = lit[2]
    if (!value.startsWith('.')) continue
    // 相对路径也以 '.' 开头（'../../release/x.exe' 会被拆出 'exe'），选择器里没有斜杠
    if (value.includes('/') || value.includes('\\')) continue
    const tailDot = value.lastIndexOf('.')
    if (tailDot > 0 && NOT_A_SELECTOR.has(value.slice(tailDot))) continue
    if (NOT_A_SELECTOR.has(value)) continue
    const clsRe = /\.([a-zA-Z][\w-]*)/g
    let m: RegExpExecArray | null
    while ((m = clsRe.exec(value))) {
      out.push([m[1], code.slice(0, lit.index).split('\n').length])
    }
  }
  return out
}

describe('e2e 类选择器必须存在于渲染层', () => {
  const selectors = collectClassSelectors()

  it('确实扫到了选择器（空集合不算通过）', () => {
    expect(selectors.size, 'tests/e2e 里应能扫到类选择器').toBeGreaterThan(15)
    // kb-page / set-page 只出现在"把选择器当参数或表字段传下去"的写法里，
    // 扫得到它们才证明取数面盖住了传参形式（旧的按调用名匹配就是在这里漏的）
    for (const k of ['kb-page', 'set-page', 'wb-main-layout']) {
      expect(selectors.has(k), `传参写法的类名也应被扫到：${k}`).toBe(true)
    }
  })

  it('阳性对照（取数面）：传参写法要扫得到，注释与文件名要挡得住', () => {
    const fixture = [
      "// 历史类名 .dead-in-comment 早就没了",
      "const exe = path.join('../../release/win-unpacked/App.exe')",
      "gotoRoute(win, '#/page', '.dead-as-param')",
      "win.locator('.dead-as-locator')",
      "const f = '.ai-credentials.local.json'",
    ].join('\n')
    const got = classTokens(fixture).map(([c]) => c)
    // 两种写法（传参 / 直接调用）都必须抓到
    expect(got).toContain('dead-as-param')
    expect(got).toContain('dead-as-locator')
    // 注释里的、相对路径拆出来的、文件名都不能算选择器——挡不住就是假红来源
    expect(got).not.toContain('dead-in-comment')
    expect(got).not.toContain('exe')
    expect(got).not.toContain('json')
  })

  it('阳性对照：源码里不存在的类必须被抓出来', () => {
    // 拿一个确定不存在的类喂进同一套判定，证明这个闸不是恒绿
    const srcBlob = rendererSourceBlob()
    expect(srcBlob).not.toContain('zz-definitely-not-a-class')
    const probe = new Map([['zz-definitely-not-a-class', ['probe:1']]])
    const missing = [...probe.keys()].filter((c) => !presentInSource(srcBlob, c) && !isLibClass(c))
    expect(missing).toEqual(['zz-definitely-not-a-class'])
    // 白名单本身也要能被证伪：mon- 曾宽到把死掉的 .mon-main 豁免掉，Monaco 真实前缀是 monaco-
    expect(isLibClass('mon-main'), 'mon- 不能再豁免任何类').toBe(false)
    expect(isLibClass('monaco-editor')).toBe(true)
  })

  it('LIB_CLASSES 每条写的出处要真能翻到（豁免必须可查，不是写句理由就放行）', () => {
    for (const [cls, reason] of LIB_CLASSES) {
      const file = /node_modules\/[^\s]+/.exec(reason)?.[0].replace(/[:：]\d+$/, '')
      expect(file, `${cls} 的理由里没给出可查的文件路径：${reason}`).toBeTruthy()
      const abs = path.join(process.cwd(), file as string)
      expect(fs.existsSync(abs), `${cls} 说的文件不存在：${file}`).toBe(true)
      const body = fs.readFileSync(abs, 'utf8')
      expect(body, `${file} 里找不到 ${cls}，这条豁免是编的`).toContain(cls)
    }
    // 同族的假类名不许被豁免：写进白名单的必须是逐名精确匹配
    expect(isLibClass('view-linez')).toBe(false)
    expect(isLibClass('view-lines')).toBe(true)
  })

  it('取数面不窄于 git 跟踪集（未提交的新 spec 也在检查范围内）', () => {
    const tracked = execFileSync('git', ['ls-files', 'tests/e2e'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .map((s) => s.trim().replace(/\\/g, '/'))
      .filter((f) => f.endsWith('.ts'))
    const onDisk = walkFiles('tests/e2e', /\.ts$/).map((f) => f.replace(/\\/g, '/'))
    for (const f of tracked) expect(onDisk).toContain(f)
    expect(onDisk.length, '磁盘扫描至少覆盖跟踪集').toBeGreaterThanOrEqual(tracked.length)
  })

  it('每个类选择器都能在渲染层源码里找到（除白名单里的库类）', () => {
    const srcBlob = rendererSourceBlob()
    const dead: string[] = []
    for (const [cls, where] of selectors) {
      if (isLibClass(cls)) continue
      if (!presentInSource(srcBlob, cls)) dead.push(`${cls}  ← ${where.join(', ')}`)
    }
    expect(dead, '这些类界面根本不会渲染出来，用例在等不存在的元素：\n' + dead.join('\n')).toEqual([])
  })
})

/** 类名是否作为独立字符串出现在源码里（className 里带的就是这些 token） */
function presentInSource(blob: string, cls: string): boolean {
  return new RegExp(`['"\`\\s.]${cls}['"\`\\s,]`).test(blob)
}
