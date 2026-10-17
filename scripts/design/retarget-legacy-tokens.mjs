#!/usr/bin/env node
/**
 * 旧令牌层退场（视觉统一第一批）
 *
 * 页面级 CSS 里有 ~600 处 color/background 还在引用 --trae-* 旧令牌，
 * 旧令牌的字色与状态色按新 AA 口径全部偏低（真机量出"设置页 28 处不达标"就是它们）。
 * 逐处手改要改几百次，所以这里按"属性 + 令牌"两个维度做确定性改写：
 *
 *   color: var(--trae-text-default)        → var(--text-primary)
 *   color: var(--trae-text-secondary)      → var(--text-tertiary)
 *   color: var(--trae-text-tertiary)       → var(--text-muted)
 *   color: var(--trae-text-brand)          → var(--accent-text)
 *   color: var(--trae-bg-brand)            → var(--accent-text)   ← 按钮底令牌被当字色用的 40 处
 *   color: var(--trae-status-X-default)    → var(--status-X-text) ← 状态纯色当字色不到 AA
 *   background: var(--trae-bg-brand)       → var(--accent-solid)
 *   border-color: var(--trae-bg-brand)     → var(--trae-border-brand)
 *     ↑ 这条原先映射到裸 var(--accent)，是 44 处"品牌描边画成灰"的成因：--accent 随后在
 *       trae-tokens 的 shadcn 映射段被重定义成灰色悬停面。2026-10-17 改回品牌别名，
 *       并由 design-contract.mjs 的第 7 条盯着——brand 语义的别名一律不许解到裸 --accent。
 *   font-size: 9px|10px                    → var(--ui-font-micro)（11px，AA 底线）
 *
 * 只动这两类确定性映射；11–14px 的既有字号不动（它们本来就落在新字阶的取值里，
 * 强改成上一档会让一批面板溢出）。默认 dry-run，--apply 才写盘。
 *
 * 用法：node scripts/design/retarget-legacy-tokens.mjs [--apply]
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const SRC = path.join(ROOT, 'src/renderer/src')
const apply = process.argv.includes('--apply')

/** [正则, 替换, 说明] */
const RULES = [
  [/color:\s*var\(--trae-text-default\)/g, 'color: var(--text-primary)', '正文色'],
  [/color:\s*var\(--trae-text-secondary\)/g, 'color: var(--text-tertiary)', '次级说明色'],
  [/color:\s*var\(--trae-text-tertiary\)/g, 'color: var(--text-muted)', '弱化文字色'],
  [/color:\s*var\(--trae-text-brand\)/g, 'color: var(--accent-text)', '品牌文字色'],
  [/color:\s*var\(--trae-bg-brand\)/g, 'color: var(--accent-text)', '按钮底令牌被当字色'],
  [/color:\s*var\(--trae-status-success-default\)/g, 'color: var(--status-success-text)', '成功状态字色'],
  [/color:\s*var\(--trae-status-error-default\)/g, 'color: var(--status-error-text)', '错误状态字色'],
  [/color:\s*var\(--trae-status-warning-default\)/g, 'color: var(--status-warning-text)', '警告状态字色'],
  [/color:\s*var\(--trae-status-alert-default\)/g, 'color: var(--status-error-text)', '告警状态字色'],
  [/background(-color)?:\s*var\(--trae-bg-brand\)/g, 'background$1: var(--accent-solid)', '主按钮底'],
  [/border-color:\s*var\(--trae-bg-brand\)/g, 'border-color: var(--trae-border-brand)', '品牌描边'],
  [/font-size:\s*(9|10)px/g, 'font-size: var(--ui-font-micro)', '低于 AA 底线的字号'],
]

/** tsx 内联 style 的同源映射。属性名按 *[cC]olor 泛匹配：
 *  写死 color: 会漏掉 valueColor: / activeColor: 这类自定义属性名（真机量出 24px KPI 数字 2.79:1 就是漏网）。 */
const TSX_RULES = [
  [/([a-zA-Z]*[cC]olor:\s*)'var\(--trae-text-default\)'/g, "$1'var(--text-primary)'", '正文色'],
  [/([a-zA-Z]*[cC]olor:\s*)'var\(--trae-text-secondary\)'/g, "$1'var(--text-tertiary)'", '次级说明色'],
  [/([a-zA-Z]*[cC]olor:\s*)'var\(--trae-text-tertiary\)'/g, "$1'var(--text-muted)'", '弱化文字色'],
  [/([a-zA-Z]*[cC]olor:\s*)'var\(--trae-text-brand\)'/g, "$1'var(--accent-text)'", '品牌文字色'],
  [/([a-zA-Z]*[cC]olor:\s*)'var\(--trae-bg-brand\)'/g, "$1'var(--accent-text)'", '按钮底令牌被当字色'],
  [/([a-zA-Z]*[cC]olor:\s*)'var\(--trae-status-success-default\)'/g, "$1'var(--status-success-text)'", '成功状态字色'],
  [/([a-zA-Z]*[cC]olor:\s*)'var\(--trae-status-error-default\)'/g, "$1'var(--status-error-text)'", '错误状态字色'],
  [/([a-zA-Z]*[cC]olor:\s*)'var\(--trae-status-warning-default\)'/g, "$1'var(--status-warning-text)'", '警告状态字色'],
  [/([a-zA-Z]*[cC]olor:\s*)'var\(--trae-status-alert-default\)'/g, "$1'var(--status-error-text)'", '告警状态字色'],
  [/(background(?:Color)?:\s*)'var\(--trae-bg-brand\)'/g, "$1'var(--accent-solid)'", '主按钮底'],
  [/fontSize:\s*(9|10)\b/g, 'fontSize: 11', '低于 AA 底线的字号'],
  // Tailwind 任意值写法：text-[var(--trae-*)] / bg-[var(--trae-bg-brand)]
  [/text-\[var\(--trae-(?:bg-brand|text-brand)\)\]/g, 'text-(--accent-text)', 'Tailwind 品牌字色'],
  [/text-\[var\(--trae-status-error-default\)\]/g, 'text-(--status-error-text)', 'Tailwind 错误字色'],
  [/text-\[var\(--trae-status-success-default\)\]/g, 'text-(--status-success-text)', 'Tailwind 成功字色'],
  [/text-\[var\(--trae-status-warning-default\)\]/g, 'text-(--status-warning-text)', 'Tailwind 警告字色'],
  [/text-\[var\(--trae-text-secondary\)\]/g, 'text-ink-dim', 'Tailwind 次级字色'],
  [/text-\[var\(--trae-text-tertiary\)\]/g, 'text-ink-mute', 'Tailwind 弱化字色'],
  [/text-\[var\(--trae-text-default\)\]/g, 'text-ink', 'Tailwind 正文字色'],
  [/bg-\[var\(--trae-bg-brand\)\]/g, 'bg-accent-solid', 'Tailwind 主按钮底'],
  [/bg-\[var\(--trae-bg-overlay-l3\)\]/g, 'bg-hover', 'Tailwind 浮层底'],
]

function walk(dir, exts, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, exts, acc)
    else if (exts.some((x) => e.name.endsWith(x))) acc.push(p)
  }
  return acc
}

const counts = new Map()
let filesTouched = 0

for (const file of [...walk(SRC, ['.css']), ...walk(SRC, ['.tsx'])]) {
  const rules = file.endsWith('.tsx') ? TSX_RULES : RULES
  let src = fs.readFileSync(file, 'utf8')
  const before = src
  for (const [re, to, label] of rules) {
    src = src.replace(re, (...args) => {
      counts.set(label, (counts.get(label) || 0) + 1)
      // 捕获组为空时（`background:` 没带 `-color`）不能留 "$1" 字面量，
      // 否则写出 background$1: 这种无效属性，CSS 静默丢掉整条声明。
      return /\$1/.test(to) ? to.replace('$1', args[1] ?? '') : to
    })
  }
  if (src !== before) {
    filesTouched++
    if (apply) fs.writeFileSync(file, src, 'utf8')
  }
}

const total = [...counts.values()].reduce((a, b) => a + b, 0)
console.log(`=== 旧令牌改写（${apply ? '已写盘' : 'dry-run'}）===`)
console.log(`文件 ${filesTouched} 个，改写 ${total} 处`)
for (const [label, n] of [...counts].sort((a, b) => b[1] - a[1])) {
  console.log(String(n).padStart(4), label)
}
