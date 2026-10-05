#!/usr/bin/env node
/**
 * 统计"活跃 CSS 里的 !important"数量（阶段 E 判据：< 80）
 *
 * 只数真正参与渲染的 .css（src 下全部，含组件样式），并剥掉注释——
 * 注释里交代"某条已经删了"不算残留。基线口径固定，方便逐批对数。
 *
 * 用法：node scripts/design/count-important.mjs [上限]
 * 给了上限且超标时退出码 1，没给上限只报告。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const cap = Number(process.argv[2] ?? NaN)

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) walk(p, acc)
    else if (e.name.endsWith('.css')) acc.push(p)
  }
  return acc
}

const rows = []
let total = 0
for (const rel of walk('src')) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const n = (src.match(/!important/g) || []).length
  if (n > 0) rows.push({ rel, n })
  total += n
}

rows.sort((a, b) => b.n - a.n)
console.log('=== 活跃 !important 分布 ===')
for (const r of rows) console.log(String(r.n).padStart(4), r.rel)
console.log('合计', total, `（${rows.length} 个文件）`)

if (Number.isFinite(cap)) {
  if (total > cap) {
    console.log(`FAIL：${total} > ${cap}`)
    process.exit(1)
  }
  console.log(`PASS：${total} <= ${cap}`)
}
