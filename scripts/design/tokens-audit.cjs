#!/usr/bin/env node
/**
 * 设计令牌审计（阶段 E 的判据脚本）
 *
 * 计划里的 325 / 273 / 190 这几个数来自早期一次性人工统计，其中 325 已被实测推翻
 * （含死目录）。所以每步改动前后都跑这个脚本，用同一把尺子量，不靠记忆。
 *
 * 用法：node scripts/design/tokens-audit.cjs
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const RENDERER = path.join(ROOT, 'src/renderer/src')
const ENTRIES = [path.join(RENDERER, 'main.tsx'), path.join(ROOT, 'src/renderer/index.html')]

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else acc.push(p)
  }
  return acc
}

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/')

/** 解析 `@import '...'` 与 `import '...'`，返回绝对路径或 null（支持省略扩展名） */
function resolveCss(fromFile, spec) {
  const clean = spec.replace(/^['"]|['"];?$/g, '').split('?')[0]
  if (!clean || clean.startsWith('http') || clean.startsWith('~')) return null
  // 项目里两条别名：@/ → src/renderer/src，@shared/ → src/shared
  let target
  if (clean.startsWith('@/')) target = path.join(RENDERER, clean.slice(2))
  else if (clean.startsWith('@shared/')) target = path.join(ROOT, 'src/shared', clean.slice(8))
  else if (clean.startsWith('.') || path.isAbsolute(clean)) target = path.resolve(path.dirname(fromFile), clean)
  else return null // 裸包名（@fontsource/... 等）不参与图
  const base = target
  const candidates = [
    base,
    ...(/\.(css|tsx?|jsx?|html)$/.test(base) ? [] : ['.tsx', '.ts', '.jsx', '.js', '.css'].map((e) => base + e)),
  ]
  for (const c of candidates) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  return null
}

/** 剥掉块注释与行注释：注释里出现的 @import / import 字样不该算一条真实引用 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** 从入口出发把 CSS / TS / TSX 的引用关系走一遍，得到"真正参与构建"的文件集 */
function buildReachableSet() {
  const seen = new Set()
  const queue = ENTRIES.filter((f) => fs.existsSync(f))
  const cssImportRe = /@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/g
  const jsImportRe = /(?:^|\n)\s*import\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]/g
  const dynamicImportRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    if (!/\.(css|tsx?|jsx?|html)$/.test(file)) continue
    const src = stripComments(fs.readFileSync(file, 'utf8'))
    const specs = []
    for (const m of src.matchAll(cssImportRe)) specs.push(m[1].trim())
    for (const m of src.matchAll(jsImportRe)) specs.push(m[1])
    for (const m of src.matchAll(dynamicImportRe)) specs.push(m[1])
    for (const s of specs) {
      // tailwind.css 里 @import './trae-tokens.css' 这类相对路径直接解；
      // 裸包名（@fontsource/...）交给解析器返回 null
      const hit = resolveCss(file, s)
      if (hit) queue.push(hit)
    }
  }
  return seen
}

const reachable = buildReachableSet()
const allCss = walk(RENDERER).filter((f) => f.endsWith('.css'))
const activeCss = allCss.filter((f) => reachable.has(f))
const deadCss = allCss.filter((f) => !reachable.has(f))

const allTs = walk(RENDERER).filter((f) => /\.(ts|tsx)$/.test(f))

function countIn(file, re) {
  const src = fs.readFileSync(file, 'utf8')
  return (src.match(re) || []).length
}
function sumOver(files, re) {
  return files.reduce((n, f) => n + countIn(f, re), 0)
}

// ── 令牌定义与消费 ──────────────────────────────────────────────────────────
const tokenDefs = new Map() // --name -> [files]
for (const f of activeCss) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
    if (!tokenDefs.has(m[1])) tokenDefs.set(m[1], [])
    tokenDefs.get(m[1]).push(rel(f))
  }
}
const allSource = [...activeCss, ...allTs].map((f) => fs.readFileSync(f, 'utf8')).join('\n')
const consumed = (name) => (allSource.match(new RegExp(`var\\(${name.replace(/[-]/g, '\\-')}`, 'g')) || []).length

/**
 * 字阶消费情况。
 *
 * 本仓库的字阶命名是 --ui-font-*（规范旧稿里写的 --font-size-* 从未落地，
 * 也没有任何代码消费它），所以这里按真实命名统计，并单独数出
 * 组件里还剩多少处 text-[Npx] 这种绕过字阶的魔法字号。
 */
const fontSizeDefs = [...tokenDefs.keys()].filter((n) => /^--ui-font-/.test(n))
const fontSizeConsumed = fontSizeDefs.filter((n) => consumed(n) > 0)
const unusedFontTiers = fontSizeDefs.filter((n) => consumed(n) === 0)
let arbitraryTextSizes = 0
for (const f of allTs) {
  arbitraryTextSizes +=
    (fs.readFileSync(f, 'utf8').match(/text-\[[0-9.]+px\]/g) || []).length
}

// ── 主题能力 ────────────────────────────────────────────────────────────────
const themeSelectors = []
for (const f of activeCss) {
  const src = fs.readFileSync(f, 'utf8')
  for (const m of src.matchAll(/\[data-theme[^\]]*\]|prefers-color-scheme/g)) {
    themeSelectors.push(`${rel(f)} → ${m[0]}`)
  }
}
const colorSchemeHardcoded = []
for (const f of activeCss) {
  const src = fs.readFileSync(f, 'utf8')
  for (const m of src.matchAll(/color-scheme\s*:\s*[^;]+/g)) colorSchemeHardcoded.push(`${rel(f)} → ${m[0]}`)
}

// ── 引用了但从未定义的变量（令牌断链）────────────────────────────────────
const defined = new Set()
for (const f of activeCss) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1])
}
// TS/TSX 里也会定义：内联 style 的 '--x': value 与 setProperty('--x', ...)
for (const f of allTs) {
  const src = fs.readFileSync(f, 'utf8')
  for (const m of src.matchAll(/['"](--[a-z0-9-]+)['"]\s*:/gi)) defined.add(m[1])
  for (const m of src.matchAll(/setProperty\(\s*['"](--[a-z0-9-]+)['"]/gi)) defined.add(m[1])
}
const undefinedRefs = new Map()
for (const f of [...activeCss, ...allTs]) {
  // 注释里写的 var(--trae-*) 是文档口吻，不是引用；先剥注释再扫
  const src = stripComments(fs.readFileSync(f, 'utf8'))
  // 外部提供的变量（Radix 注入尺寸、Tailwind 内部 --tw-*）不算本仓断链
  const external = /^--(radix-|tw-|shadow-|animate-)/
  for (const m of src.matchAll(/var\((--[a-z0-9-]+)(?![${])/gi)) {
    if (defined.has(m[1]) || external.test(m[1])) continue
    if (!undefinedRefs.has(m[1])) undefinedRefs.set(m[1], [])
    undefinedRefs.get(m[1]).push(rel(f))
  }
}

// ── 硬编码颜色（浅色主题下不会跟着翻面的残留源）───────────────────────────
const HEX = /#[0-9a-fA-F]{3,8}\b/g
const hexByFile = []
for (const f of activeCss) {
  if (rel(f).endsWith('styles/trae-tokens.css')) continue
  const src = stripComments(fs.readFileSync(f, 'utf8'))
  const n = (src.match(HEX) || []).length
  if (n) hexByFile.push({ file: rel(f), n })
}
hexByFile.sort((a, b) => b.n - a.n)
const hexTotal = hexByFile.reduce((s, x) => s + x.n, 0)

// ── 报告 ────────────────────────────────────────────────────────────────────
const importantActive = sumOver(activeCss, /!important/g)
const importantDead = sumOver(deadCss, /!important/g)
const textPx = sumOver(allTs, /text-\[\d+(\.\d+)?px\]/g)
const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F2FF}]/gu
let emojiHits = []
for (const f of [...allTs, ...activeCss]) {
  const src = fs.readFileSync(f, 'utf8')
  src.split(/\r?\n/).forEach((line, i) => {
    const m = line.match(emojiRe)
    if (m) emojiHits.push(`${rel(f)}:${i + 1} ${m.join('')}`)
  })
}

console.log('=== 阶段 E 令牌审计 ===')
console.log(`CSS 文件：总 ${allCss.length} / 入口可达 ${activeCss.length} / 不可达 ${deadCss.length}`)
for (const f of deadCss) console.log(`  死 CSS: ${rel(f)}（!important ${countIn(f, /!important/g)}）`)
console.log(`活跃 !important = ${importantActive}（死目录另有 ${importantDead}，不计入基线）`)
console.log(`text-[Npx] 任意值 = ${textPx}`)
console.log(
  `--ui-font-* 字阶：定义 ${fontSizeDefs.length} 档，被组件消费 ${fontSizeConsumed.length} 档` +
    (unusedFontTiers.length ? `（未被消费：${unusedFontTiers.join(', ')}）` : '') +
    `；绕过字阶的 text-[Npx] = ${arbitraryTextSizes} 处`,
)
for (const n of fontSizeDefs) console.log(`  ${n}: var() 消费 ${consumed(n)} 次`)
console.log(`[data-theme] / prefers-color-scheme 命中 = ${themeSelectors.length}`)
for (const t of themeSelectors.slice(0, 12)) console.log(`  ${t}`)
console.log('color-scheme 声明：')
for (const t of colorSchemeHardcoded) console.log(`  ${t}`)
console.log(`硬编码十六进制色（trae-tokens 之外）= ${hexTotal}，分布在 ${hexByFile.length} 个文件`)
for (const x of hexByFile.slice(0, 12)) console.log(`  ${x.file} : ${x.n}`)
console.log(`引用了但未定义的 CSS 变量（断链）= ${undefinedRefs.size}`)
for (const [name, where] of undefinedRefs) {
  console.log(`  ${name} ← ${[...new Set(where)].slice(0, 4).join(', ')}`)
}
console.log(`emoji 命中 = ${emojiHits.length}`)
for (const e of emojiHits.slice(0, 12)) console.log(`  ${e}`)
