#!/usr/bin/env node
/**
 * 设计契约闸：DESIGN.md 写的数字 == 代码里的数字，且债务只许降不许升
 *
 * 为什么要有这个：设计文档一旦和令牌文件漂移，后来的人就不知道该信谁（本项目真的漂过：
 * 文档写"圆角不超过 12px"，令牌已经是 6/10/14/18/22）。这里把两边对齐，并把
 * "还欠多少债"钉成只降不升的刻度。
 *
 * 用法：node scripts/design/design-contract.mjs          # 人看
 *      node scripts/design/design-contract.mjs --json   # 机器读
 * 解析不到某个声明 = 直接失败，不许"没找到就当通过"。
 */
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const DESIGN = read('DESIGN.md')
const TOKENS = read('src/renderer/src/styles/ui-tokens.css')
const TAILWIND = read('src/renderer/src/styles/tailwind.css')

const problems = []
const notes = []

/** 从 ui-tokens.css 取一个令牌的 dark 档值 */
function token(name) {
  const m = TOKENS.match(new RegExp(`--${name}:\\s*([^;]+);`))
  return m ? m[1].trim() : null
}

// ===== 1+2. DESIGN.md 里以表格声明的令牌，逐个对回 ui-tokens.css =====
// 文档格式约定：`| \`--ui-xxx-name\` | 12px | 用途 |`。写成表格而不是散文，是为了这条闸能解析。
const declared = [...DESIGN.matchAll(/^\|\s*`--ui-([a-z-]+)`\s*\|\s*(\d+)px\s*\|/gm)]
  .map((m) => ({ full: `--ui-${m[1]}`, tier: `ui-${m[1]}`, px: m[2] }))
if (declared.length < 14) {
  problems.push(`DESIGN.md 只解析到 ${declared.length} 行令牌表格（字阶 10 + 圆角 6 起步），表格格式改了要同步改这个闸`)
}
for (const { full, tier, px } of declared) {
  const actual = token(tier)
  if (actual === null) problems.push(`DESIGN.md 声明了 ${full}，ui-tokens.css 里没有这个令牌`)
  else if (actual !== `${px}px`) problems.push(`${full}：DESIGN.md 写 ${px}px，令牌实际 ${actual}`)
}
// 反向：令牌里有但文档没写的档位也算漂移（新增档位必须写进文档）
for (const prefix of ['ui-font', 'ui-radius']) {
  const inDoc = new Set(declared.map((d) => d.tier))
  const inCode = [...TOKENS.matchAll(new RegExp(`--${prefix}-([a-z-]+):`, 'g'))].map((m) => `${prefix}-${m[1]}`)
  const undocumented = [...new Set(inCode)].filter((t) => !inDoc.has(t))
  if (undocumented.length) problems.push(`这些令牌没写进 DESIGN.md 表格：${undocumented.join(', ')}`)
}

// ===== 3. 文档引用的 --ui-size-* / --ui-space-* 必须真的存在 =====
for (const name of new Set([...DESIGN.matchAll(/--(ui-(?:size|space)-[a-z-]+)/g)].map((m) => m[1]))) {
  if (token(name) === null) problems.push(`DESIGN.md 引用了 --${name}，ui-tokens.css 里没有`)
}

// ===== 4. tailwind 的 --text-* 档必须全部回落到 --ui-font-* =====
const badText = [...TAILWIND.matchAll(/--text-([a-z-]+?)(--line-height)?:\s*([^;]+);/g)].filter((m) => {
  const isLh = Boolean(m[2])
  return !m[3].includes(`var(--ui-${isLh ? 'lh' : 'font'}-`)
})
if (badText.length) problems.push(`tailwind.css 有 ${badText.length} 个 --text-* 档没回落到 ui 令牌`)

// ===== 5. 债务刻度（只许降不许升；每退一批把上限改小并写日期） =====
function countFiles(pattern, include, where = 'src/renderer/src') {
  try {
    const out = execSync(`grep -rl --include=${include} -- "${pattern}" ${where}`, { encoding: 'utf8' })
    return out.trim() ? out.trim().split(/\r?\n/).length : 0
  } catch (e) {
    // grep 没命中返回 1，是真·零；其它错误必须冒出来，不能当成 0
    if (e.status === 1) return 0
    throw e
  }
}
function countLines(pattern, include, where = 'src/renderer/src') {
  try {
    const out = execSync(`grep -rE --include=${include} -- "${pattern}" ${where} | wc -l`, { encoding: 'utf8' })
    return parseInt(out.trim(), 10)
  } catch (e) {
    if (e.status === 1) return 0
    throw e
  }
}

const RATCHETS = [
  {
    name: '引用旧 --trae-* 令牌的 .tsx 文件数',
    now: countFiles('--trae-', '*.tsx'),
    cap: 66,
    why: '2026-10-11 W6 把三个页面里 12 处内联图标样式（含 --trae-icon-default / --trae-special-white）换成令牌工具类，实测 67→66。旧令牌是"每页自己定字号颜色"的载体',
  },
  {
    name: '内联 style 里写 color/fontSize/background 的行数',
    now: countLines('style=\\{\\{[^}]*\\b(color|fontSize|background)\\b', '*.tsx'),
    cap: 113,
    why: '2026-10-11 W6 实测 125→113：currentColor 那类纯 no-op 直接删，尺寸/颜色并进 class（size-4 text-ink 等）。剩下的多是运行时算出来的颜色，那些本来就得内联',
  },
  {
    name: '还 import antd 的渲染层文件数',
    now: countFiles("from 'antd'", '*.tsx'),
    cap: 0,
    why: '2026-10-07 第 7 批退出 SshSettings 表单弹窗与 main.tsx 的 ConfigProvider，实测 2→0：渲染层已经一行 antd 都不引。再出现就是引回旧依赖',
  },
]

for (const r of RATCHETS) {
  if (r.now > r.cap) problems.push(`${r.name}：从 ${r.cap} 涨到 ${r.now}（${r.why}）`)
  else notes.push(`${r.name} ${r.now} / 上限 ${r.cap}${r.now < r.cap ? ' ← 可以收紧上限了' : ''}`)
}

// ===== 6. 页面自写标题栏 = 0（字号忽大忽小的根因） =====
const pagesDir = path.join(ROOT, 'src/renderer/src/pages')
const bespokeH1 = fs
  .readdirSync(pagesDir)
  .filter((f) => f.endsWith('.tsx') && f !== 'BootPage.tsx')
  .filter((f) => /<h1[\s>]/.test(fs.readFileSync(path.join(pagesDir, f), 'utf8')))
if (bespokeH1.length) problems.push(`这些页面还在自写 <h1>，必须改用 <PageHeader>：${bespokeH1.join(', ')}`)

const json = process.argv.includes('--json')
if (json) {
  console.log(JSON.stringify({ problems, notes }, null, 2))
} else {
  for (const n of notes) console.log('  ' + n)
  console.log('  页面自写 <h1> 0 个（PageHeader 是唯一入口）')
}
if (problems.length) {
  console.error('\n设计契约不成立：\n' + problems.map((p) => '  ✗ ' + p).join('\n'))
  console.error('\n要么改代码回到契约内，要么改 DESIGN.md 并在评审里说清为什么放宽。')
  process.exit(1)
}
// --json 模式下 stdout 只放 JSON，后面不能再打印人话（否则调用方 parse 不了）
if (!json) console.log('\nPASS：DESIGN.md 与令牌一致，债务刻度未回涨')
