#!/usr/bin/env node
/**
 * 字号收敛（阶段 E 判据）
 *
 * 把渲染层里写死的 text-[Npx] 换成 ui-tokens 的字阶（text-micro/caption/sm/md/
 * composer/title/head/display）。规范里定义了字阶、代码却一处没消费，全靠魔法数字。
 *
 * 默认只打印将要改什么（dry-run）；要真写盘必须显式加 --apply。
 * 遇到映射表里没有的尺寸直接报错退出，不静默跳过——
 * 静默跳过等于把"还有多少没收敛"这个数字做小。
 *
 * 用法：node scripts/design/converge-text-sizes.cjs [--apply]
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const TARGET_DIR = path.join(ROOT, 'src/renderer/src')

/** 现用尺寸 → 字阶 token（px 值完全一致的优先；不一致的在下面打印出来供复核） */
const MAP = {
  '9px': 'text-micro', // 10px，最小档上调 1px（原 9px 在 1x 屏上几乎读不清）
  '10px': 'text-micro',
  '11px': 'text-caption',
  '12px': 'text-sm',
  '13px': 'text-md',
  '14px': 'text-composer',
  '15px': 'text-title',
  '16px': 'text-head',
  '28px': 'text-display',
  '30px': 'text-display', // 28px，KPI 大数字统一到展示档
}

const apply = process.argv.includes('--apply')

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.tsx$/.test(e.name)) acc.push(p)
  }
  return acc
}

const before = {}
const after = {}
const drift = []
let files = 0
let sites = 0

for (const f of walk(TARGET_DIR)) {
  const src = fs.readFileSync(f, 'utf8')
  const found = src.match(/text-\[[0-9.]+px\]/g) ?? []
  if (found.length === 0) continue
  files++
  let out = src
  for (const token of found) {
    const px = token.slice('text['.length + 1, -1)
    const name = token.match(/text-\[([0-9.]+px)\]/)[1]
    const repl = MAP[name]
    if (!repl) {
      console.error(`${path.relative(ROOT, f).replace(/\\/g, '/')} 里有未登记尺寸 text-[${name}]`)
      process.exitCode = 1
      continue
    }
    before[name] = (before[name] ?? 0) + 1
    after[repl] = (after[repl] ?? 0) + 1
    sites++
    out = out.split(token).join(repl)
    if (px !== '10px' && px !== '11px' && px !== '12px' && px !== '13px' && px !== '14px' && px !== '15px' && px !== '16px') {
      drift.push(`${path.relative(ROOT, f).replace(/\\/g, '/')}：text-[${name}] → ${repl}`)
    }
  }
  if (apply && out !== src) fs.writeFileSync(f, out, 'utf8')
}

console.log('=== 字号收敛' + (apply ? '（已写盘）' : '（dry-run，加 --apply 才写盘）') + ' ===')
console.log('涉及文件 =', files, ' 替换点 =', sites)
console.log('改前：', Object.entries(before).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join('  '))
console.log('改后：', Object.entries(after).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join('  '))
if (drift.length) {
  console.log('尺寸有变动的位置（需要真机复核）：')
  for (const d of [...new Set(drift)]) console.log('  ' + d)
}
if (process.exitCode) console.error('\nFAIL：存在未登记尺寸')
