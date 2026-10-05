#!/usr/bin/env node
/**
 * 删掉"antd 组件根本没用过"的样式覆盖（阶段 E：活跃 !important 压到 80 以下）
 *
 * global.css 里一大把 .ant-* 覆盖是给早就不用的组件预留的（Table / Avatar / Tabs /
 * Timeline / Pagination / Slider / Progress / Statistic / Radio / Checkbox / DatePicker /
 * InputNumber ...）。它们不参与渲染，却计入"活跃 !important"，把真实待办数字顶上去。
 *
 * 判定口径保守：
 * - 组件在用与否，按"渲染层有没有从 'antd' 导入过它"这条硬事实算，不看猜的类名
 * - 一条规则里只要引用到一个还在用的组件、或引用到一个脚本认不出前缀的 .ant-*，整条保留
 * - 只动 global.css，不碰页面级 CSS（那些类名靠 dead-css-classes.cjs 按自家类判）
 *
 * 用法：node scripts/design/prune-antd-css.cjs [--apply]
 */
import * as fs from 'node:fs'
import * as path from 'path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const CSS = path.join(ROOT, 'src/renderer/src/styles/global.css')
const SRC = path.join(ROOT, 'src/renderer/src')
const apply = process.argv.includes('--apply')

/** CSS 类面前缀 → antd 组件名（导入名口径） */
const PREFIX_TO_COMPONENT = {
  'ant-alert': 'Alert',
  'ant-avatar': 'Avatar',
  'ant-badge': 'Badge',
  'ant-btn': 'Button',
  'ant-card': 'Card',
  'ant-checkbox': 'Checkbox',
  'ant-collapse': 'Collapse',
  'ant-descriptions': 'Descriptions',
  'ant-divider': 'Divider',
  'ant-drawer': 'Drawer',
  'ant-dropdown': 'Dropdown',
  'ant-empty': 'Empty',
  'ant-form': 'Form',
  'ant-input-number': 'InputNumber',
  'ant-input': 'Input',
  'ant-menu': 'Menu',
  'ant-modal': 'Modal',
  'ant-pagination': 'Pagination',
  'ant-picker': 'DatePicker',
  'ant-popover': 'Popover',
  'ant-progress': 'Progress',
  'ant-radio': 'Radio',
  'ant-result': 'Result',
  'ant-select': 'Select',
  'ant-slider': 'Slider',
  'ant-spin': 'Spin',
  'ant-statistic': 'Statistic',
  'ant-switch': 'Switch',
  'ant-table': 'Table',
  'ant-tabs': 'Tabs',
  'ant-tag': 'Tag',
  'ant-timeline': 'Timeline',
  'ant-tooltip': 'Tooltip',
  'ant-typography': 'Typography',
}

/** 静态方法类：不经过 JSX 导入，按真实调用点判（sonner 的 toast.* 不算 antd message） */
const STATIC_FAMILIES = {
  'ant-notification': /notification\.(open|success|error|info|warning)\(/,
  'ant-message': /message\.(open|success|error|info|warning|warn|loading)\(/,
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p)
  }
  return acc
}

const sourceFiles = walk(SRC)
/** 注释里的 message.* / notification.* 是说明文字不是调用，判活之前先剥注释 */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const allSource = sourceFiles.map((f) => stripComments(fs.readFileSync(f, 'utf8'))).join('\n')
const importedNames = new Set()
for (const m of allSource.matchAll(/import\s*\{([^}]*)\}\s*from\s*'antd'/g)) {
  for (let n of m[1].split(',')) {
    n = n.trim().replace(/^type\s+/, '').split(' as ')[0].trim()
    if (n) importedNames.add(n)
  }
}

const alive = (name) => importedNames.has(name)

/** 把 global.css 拆成 [注释/空白, 规则] 序列，只处理顶层规则块 */
const src = fs.readFileSync(CSS, 'utf8')
const rules = []
let i = 0
while (i < src.length) {
  const open = src.indexOf('{', i)
  if (open < 0) break
  // 选择器起点：上一条规则结束的 } 之后
  let start = src.lastIndexOf('}', open) + 1
  const selector = src.slice(start, open).trim()
  // 找到与之配对的 }
  let depth = 1
  let j = open + 1
  while (j < src.length && depth > 0) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') depth--
    j++
  }
  const body = src.slice(open + 1, j - 1)
  rules.push({ start, end: j, selector, body })
  i = j
}

const dead = []
const unknown = []
for (const r of rules) {
  const prefixes = [...new Set([...r.selector.matchAll(/\.ant-[a-z0-9-]+/g)].map((m) => {
    const parts = m[0].slice(1).split('-')
    // 逐段回退找已登记前缀（.ant-btn-primary → ant-btn）
    for (let k = parts.length; k > 1; k--) {
      const cand = parts.slice(0, k).join('-')
      if (PREFIX_TO_COMPONENT[cand] || STATIC_FAMILIES[cand]) return cand
    }
    return null
  }).filter(Boolean))]

  if (prefixes.length === 0) continue
  const unresolved = prefixes.filter((p) => !PREFIX_TO_COMPONENT[p] && !STATIC_FAMILIES[p])
  if (unresolved.length) {
    unknown.push(r.selector.slice(0, 60))
    continue
  }
  const anyAlive = prefixes.some((p) =>
    PREFIX_TO_COMPONENT[p]
      ? alive(PREFIX_TO_COMPONENT[p])
      : STATIC_FAMILIES[p].test(allSource),
  )
  if (!anyAlive) dead.push(r)
}

const beforeImportant = (src.match(/!important/g) || []).length
let after = src
for (const r of [...dead].reverse()) {
  after = after.slice(0, r.start) + after.slice(r.end)
}
const afterImportant = (after.match(/!important/g) || []).length

console.log('=== 删除零使用的 antd 样式覆盖（' + (apply ? '已写盘' : 'dry-run') + '） ===')
console.log('在用的 antd 导入名 =', [...importedNames].sort().join(', ') || '(无)')
console.log('待删规则 =', dead.length, ' 条；!important', beforeImportant, '→', afterImportant)
for (const r of dead) console.log('  -', r.selector.replace(/\s+/g, ' ').slice(0, 70))
if (unknown.length) {
  console.log('认不出前缀、按保守原则整条保留：')
  for (const u of unknown) console.log('  ?', u)
}
if (apply) fs.writeFileSync(CSS, after, 'utf8')
