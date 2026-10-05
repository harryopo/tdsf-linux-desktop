#!/usr/bin/env node
/**
 * 死 CSS 类名扫描
 *
 * 用法：node scripts/design/dead-css-classes.cjs <css 文件相对路径> [--delete]
 *   不带 --delete 只打印清单；带 --delete 会把零引用类的整条规则删掉并打印删除数。
 *
 * 为什么需要：外壳重建的进度要用"旧 CSS 还剩多少行"来量，而删样式最怕删多——
 * 类名可能是模板字符串拼出来的、可能只在别的 CSS 里被覆盖、可能是给 antd 内部结构用的。
 * 所以这里按三条保守规则判"死"：
 *   1. 该类名在 src/ 与 tests/ 的 ts/tsx/js/html 里零出现（含子串匹配，宁漏不误杀）
 *   2. 该选择器不含 antd 前缀（.ant-* 由组件库内部 DOM 决定，源码里搜不到）
 *   3. 该规则块里没有 !important 之外的层叠依赖线索（:where/:is/@media 里的规则不动）
 * 删完必须跑一遍 pnpm test 与真机截图，脚本不替你下结论。
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const target = process.argv[2]
const doDelete = process.argv.includes('--delete')

if (!target) {
  console.error('用法：node scripts/design/dead-css-classes.cjs <css 路径> [--delete]')
  process.exit(2)
}

const cssPath = path.join(ROOT, target)
if (!fs.existsSync(cssPath)) {
  console.error(`文件不存在：${target}`)
  process.exit(2)
}

/** 收集 src 与 tests 下所有可能引用类名的文本（排除 CSS 自身，避免自证存活） */
function collectRefs() {
  const exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.html'])
  const out = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'out' || e.name === 'dist') continue
        walk(p)
      } else if (exts.has(path.extname(e.name))) {
        out.push(fs.readFileSync(p, 'utf8'))
      }
    }
  }
  for (const d of ['src', 'tests']) {
    const abs = path.join(ROOT, d)
    if (fs.existsSync(abs)) walk(abs)
  }
  return out.join('\n')
}

const refs = collectRefs()
const css = fs.readFileSync(cssPath, 'utf8')

/**
 * 顶层规则块切分：只处理 `selector { ... }` 的扁平块，
 * @media/@keyframes 里的嵌套规则本轮不碰（判活风险更高）。
 */
function blocks(src) {
  const list = []
  let i = 0
  let topStart = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '@') {
      // 跳过整个 at-rule 块
      const brace = src.indexOf('{', i)
      if (brace === -1) break
      let depth = 1
      let j = brace + 1
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth++
        else if (src[j] === '}') depth--
        j++
      }
      i = j
      topStart = j
      continue
    }
    if (ch === '{') {
      const selector = src.slice(topStart, i)
      let depth = 1
      let j = i + 1
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth++
        else if (src[j] === '}') depth--
        j++
      }
      list.push({ selector, start: topStart, end: j })
      i = j
      topStart = j
      continue
    }
    i++
  }
  return list
}

const classNamesIn = (selector) => {
  const names = new Set()
  for (const m of selector.matchAll(/\.([A-Za-z_][\w-]*)/g)) names.add(m[1])
  return [...names]
}

const blocksToDrop = []
const alive = new Map()

for (const b of blocks(css)) {
  const selector = b.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim()
  if (!selector) continue
  const names = classNamesIn(selector)
  if (!names.length) continue
  if (names.some((n) => n.startsWith('ant-'))) continue
  // 选择器里只要有一个类名还在被引用，整条规则就留着（保守）
  const dead = names.every((n) => !refs.includes(n))
  if (dead) blocksToDrop.push(b)
  else for (const n of names) if (!refs.includes(n)) alive.set(n, selector)
}

const deadNames = [...new Set(blocksToDrop.flatMap((b) => classNamesIn(b.selector)))]

if (!doDelete) {
  console.log(`=== ${target} 零引用类名 ${deadNames.length} 个 ===`)
  for (const n of deadNames) console.log('  .' + n)
  if (alive.size) {
    console.log('（下面这些类名源码里没有，但同一条规则里还有活名字，故整条保留）')
    for (const [n, sel] of alive) console.log('  ~ .' + n + '  ← ' + sel.replace(/\s+/g, ' ').slice(0, 60))
  }
  process.exit(0)
}

let out = css
for (const b of blocksToDrop.reverse()) out = out.slice(0, b.start) + out.slice(b.end)
// 连续空行压成一行
out = out.replace(/\n{3,}/g, '\n\n')
fs.writeFileSync(cssPath, out, 'utf8')
const before = css.split('\n').length
const after = out.split('\n').length
console.log(`删除 ${blocksToDrop.length} 条零引用规则：${target} ${before} → ${after} 行（-${before - after}）`)
