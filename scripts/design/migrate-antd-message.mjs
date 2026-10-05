#!/usr/bin/env node
/**
 * antd 退出第 1 批：把 message.* 换成 sonner 的 toast.*
 *
 * 为什么先动这个：global.css 里那批 !important 是给 antd 组件硬压样式的，
 * 而 message 是命令式静态 API（不依赖组件树），换掉它风险最低 —— 换完
 * .ant-message-* 那组覆盖就能删。
 *
 * 规矩：
 * - 默认 dry-run，必须显式 --apply 才写盘。
 * - 只原地替换"从 antd 导入"那一条语句本身，绝不在文件里另找位置插行
 *   （上一版就是插到了多行 react import 的中间，把文件写坏了）。
 * - 一个文件里出现两条 antd import，或残留 message.loading 之类脚本没把握的用法，
 *   一律点名报出来交人工，不猜。
 *
 * 用法：node scripts/design/migrate-antd-message.mjs [--apply]
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const SRC = path.join(ROOT, 'src/renderer/src')
const apply = process.argv.includes('--apply')

const METHODS = { success: 'success', error: 'error', info: 'info', warning: 'warning', warn: 'warning' }
const ANTD_IMPORT = /import\s*\{([^}]*)\}\s*from\s*'antd';?/g

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(e.name)) acc.push(p)
  }
  return acc
}

const skipped = []
const manual = []
let filesTouched = 0
let callsRewritten = 0

for (const f of walk(SRC)) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/')
  const src = fs.readFileSync(f, 'utf8')

  const matches = [...src.matchAll(ANTD_IMPORT)]
  if (matches.length === 0) continue
  if (matches.length > 1) {
    skipped.push(`${rel} → 有 ${matches.length} 条 antd import，脚本不改多语句文件`)
    continue
  }
  const stmt = matches[0]
  const names = stmt[1].split(',').map((s) => s.trim()).filter(Boolean)
  if (!names.includes('message')) continue
  if (names.some((n) => /\bas\b/.test(n))) {
    skipped.push(`${rel} → antd import 里有别名，需人工确认`)
    continue
  }

  let out = src

  // 1) 调用点：message.success/.error/.info/.warning/.warn → toast.*
  out = out.replace(/\bmessage\.(success|error|info|warning|warn)\(/g, (_m, meth) => {
    callsRewritten++
    return `toast.${METHODS[meth]}(`
  })

  // 2) 脚本没把握的用法点名交人工（不做任何猜测性替换）
  const found = out.matchAll(/\bmessage\.([a-zA-Z]+)\(/g)
  const leftovers = [...new Set([...found].map((m) => m[1]))]
  if (leftovers.length) manual.push(`${rel} → message.${leftovers.join(' / message.')}`)

  // 3) 原地重写那条 antd import：message 摘掉，sonner 就顶在它原来的位置
  const rest = names.filter((n) => n !== 'message')
  const hadSemi = stmt[0].endsWith(';')
  const toastLine = `import { toast } from 'sonner'`
  const replacement =
    rest.length === 0
      ? alreadyImportsToast(out)
        ? ''
        : toastLine
      : alreadyImportsToast(out)
        ? `import { ${rest.join(', ')} } from 'antd'`
        : `import { ${rest.join(', ')} } from 'antd'\n${toastLine}`

  out = out.replace(stmt[0], replacement + (hadSemi && replacement ? ';' : ''))
  if (!replacement) out = out.replace(/\n\n/, '\n')

  if (out !== src) {
    filesTouched++
    if (apply) fs.writeFileSync(f, out, 'utf8')
  }
}

function alreadyImportsToast(text) {
  return /from 'sonner'/.test(text)
}

console.log('=== antd message → sonner toast（' + (apply ? '已写盘' : 'dry-run，加 --apply 才写盘') + '） ===')
console.log('处理文件 =', filesTouched, ' 调用点改写 =', callsRewritten)
if (manual.length) {
  console.log('需要手工处理（脚本不猜）：')
  for (const m of manual) console.log('  ' + m)
}
if (skipped.length) {
  console.log('跳过（形状超出脚本假设）：')
  for (const s of skipped) console.log('  ' + s)
}
