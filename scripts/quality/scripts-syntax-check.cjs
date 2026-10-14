#!/usr/bin/env node
/**
 * scripts/ 与根目录工具的语法闸（只解析，不执行）
 *
 * 为什么要有这道门：`npm run lint` 只扫 src，`pnpm typecheck` 只看两个 tsconfig，
 * `pnpm types:tests` 只管 tests/。也就是说**门禁链自己**（scripts 下这些 .cjs/.mjs,
 * 承担密钥闸/拓扑闸/设计闸/契约闸的脚本）从来没被任何检查看过一眼。
 *
 * 触发本轮的直接证据：2026-10-14 给 tests-typecheck 加注释时，我在块注释里写了一段
 * 通配路径，路径末尾那对"星号紧跟斜杠"把注释提前关掉了，整个脚本变成语法错误。
 * 那天是我正好跑了它才发现；如果只写完就提交，这道门会**安静地不再工作**——
 * 它 exit 码非零，但没人跑它就没人知道它坏了。（同一类病：门坏了 ≠ 门通过。）
 *
 * 用法：
 *   node scripts/quality/scripts-syntax-check.cjs            跑闸
 * 未知参数一律 exit 2（默认分支是"读文件"，打错一个字母就等于悄悄放行）。
 */
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '../..')

/**
 * 受检文件数下限（只许降不许升的反向判据：少了说明扫描面被什么挡住了）。
 * 2026-10-14 实测 72 个（scripts 下 67 + 仓库根 5）。
 */
const MIN_FILES = 72

const argv = process.argv.slice(2)
if (argv.length > 0) {
  console.error(`[scripts-syntax] 未知参数：${argv.join(' ')}（本闸无参数）`)
  process.exit(2)
}

let ts
try {
  ts = require('typescript')
} catch {
  console.error('[scripts-syntax] 拿不到本地 typescript —— 这是量具坏了，不是"没有语法错误"')
  process.exit(2)
}

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.(cjs|mjs)$/.test(e.name)) acc.push(p)
  }
  return acc
}

const files = walk(path.join(REPO, 'scripts'), [])
for (const e of fs.readdirSync(REPO, { withFileTypes: true })) {
  if (e.isFile() && /\.(cjs|mjs)$/.test(e.name)) files.push(path.join(REPO, e.name))
}

if (files.length < MIN_FILES) {
  console.error(
    `[scripts-syntax] 受检文件 ${files.length} 个 < 下限 ${MIN_FILES} —— 扫描面缩了。` +
      `空清单或被什么目录规则挡住都不算通过，先查 walk 逻辑再谈结果。`
  )
  process.exit(2)
}

let bad = 0
for (const abs of files) {
  const rel = path.relative(REPO, abs).split(path.sep).join('/')
  const text = fs.readFileSync(abs, 'utf8')
  // ScriptKind.JS：这些是纯 JS 工具（.cjs/.mjs 由扩展名决定模块语义，这里只做语法解析）
  const src = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  for (const d of src.parseDiagnostics || []) {
    bad++
    const lc = src.getLineAndCharacterOfPosition(d.start)
    console.log(`  ${rel}:${lc.line + 1} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`)
  }
}

console.log(`[scripts-syntax] 受检 ${files.length} 个 .cjs/.mjs，语法错误 ${bad} 处`)
if (bad > 0) {
  console.error(`[scripts-syntax] FAIL：${bad} 处语法错误。这些脚本是门禁链自己，坏了就不会说话。`)
  process.exit(1)
}
process.exit(0)
