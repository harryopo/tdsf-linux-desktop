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
 *
 * 为什么债务刻度用 Node 原生遍历而不是 execSync('grep ... | wc -l')：
 * 外部 grep 不在 Windows 默认 PATH 里（只有装了 Git for Bash 的机器碰巧能跑），
 * 一旦缺席这条闸就抛异常、--json 输出为空，测试那边 JSON.parse('') 退化成 {}，
 * 整道门禁变成"看不见地在跑"。顺带消掉把正则拼进 shell 命令的注入面。
 */
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
/** 递归收集目录下的文件绝对路径；目录不存在就抛，不许"扫不到就当 0" */
function walkFiles(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    throw new Error(`债务刻度找不到扫描目录：${dir}`)
  }
  const out = []
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      out.push(...walkFiles(path.join(dir, e.name)))
    } else {
      out.push(path.join(dir, e.name))
    }
  }
  return out
}
/** include 形如 '*.tsx'，取扩展名；命中的文件内容缓存后复用 */
function scanFiles(include, where) {
  const ext = include.replace(/^\*/, '')
  const base = path.join(ROOT, where)
  return walkFiles(base)
    .filter((f) => f.endsWith(ext))
    .map((f) => ({ file: f, text: fs.readFileSync(f, 'utf8') }))
}
/** 等价于 grep -rl PATTERN --include=INCLUDE WHERE：命中过的文件个数 */
function countFiles(pattern, include = '*.tsx', where = 'src/renderer/src') {
  const rx = new RegExp(pattern)
  return scanFiles(include, where).filter((s) => rx.test(s.text)).length
}
/** 等价于 grep -rE PATTERN --include=INCLUDE WHERE | wc -l：按行计数，一行只算一次 */
function countLines(pattern, include = '*.tsx', where = 'src/renderer/src') {
  const rx = new RegExp(pattern)
  let lines = 0
  for (const s of scanFiles(include, where)) {
    for (const line of s.text.split(/\r?\n/)) if (rx.test(line)) lines += 1
  }
  return lines
}

const RATCHETS = [
  {
    name: '引用旧 --trae-* 令牌的 .tsx 文件数',
    now: countFiles('--trae-', '*.tsx'),
    cap: 60,
    why: '2026-10-11 W6 把三个页面里 12 处内联图标样式（含 --trae-icon-default / --trae-special-white）换成令牌工具类，实测 67→66；2026-10-17 修品牌令牌劫持时现量 64；2026-10-27 重做聊天可信度卡时按现量收到 61（那一轮把 ChatCredibility 的 --trae-status-* 分档色改成了 CSS 类）；同日面板第①笔把 MessageList 欢迎态那 12 处 trae 内联值换成 CSS 类，现量 60。旧令牌是"每页自己定字号颜色"的载体',
  },
  {
    name: '内联 style 里写 color/fontSize/background 的行数',
    now: countLines('style=\\{\\{[^}]*\\b(color|fontSize|background)\\b', '*.tsx'),
    cap: 94,
    why: '2026-10-11 W6 实测 125→113：currentColor 那类纯 no-op 直接删，尺寸/颜色并进 class（size-4 text-ink 等）；2026-10-13 收到 112；2026-10-17 现量 109；2026-10-27 重做聊天可信度卡，ConfidenceBreakdown 那 11 处内联上色（含实测 2.79:1 的 Dempster 徽标）并进 CSS 类，按现量收到 94。剩下的多是运行时算出来的颜色，那些本来就得内联',
  },
  {
    name: '还 import antd 的渲染层文件数',
    now: countFiles("from 'antd'", '*.tsx'),
    cap: 0,
    why: '2026-10-07 第 7 批退出 SshSettings 表单弹窗与 main.tsx 的 ConfigProvider，实测 2→0：渲染层已经一行 antd 都不引。再出现就是引回旧依赖',
  },
  {
    // 只禁 hover：聚焦时那一条主色描边（focus-within:border-accent-solid）与键盘焦点环
    // （focus-visible:ring-*）是"我现在能在哪儿打字"的可见性凭据（WCAG 2.4.7），不在禁列。
    name: 'hover 把描边或阴影环换成主色的写法',
    now: countLines('hover:(border|shadow)-\\S*(accent|brand)', '*.tsx'),
    cap: 0,
    why: '2026-10-27 面板第①笔后横扫抓到 3 处：Composer 卡 hover 换品牌蓝描边（还和 focus 同色，两种状态分不出来）并叠一圈 1px 蓝阴影、服务器菜单「添加新连接」hover 换主色虚线边、决策历史卡 hover 换主色描边。三处都改成"悬停只动底色/字色，不动描边色"后钉死为 0。用户 2026-10 明确说过最讨厌主色 hover 包边',
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

// ===== 7. 品牌语义的令牌与描边不许解到裸 --accent =====
/** 注释里写的 var(--accent) 是文档口吻不是引用；只剥 /* *\/ 块注释并保留换行（行号要对得上）。
 *  不剥 // 行注释：TSX 里的字符串常量（如带 // 的 URL）会跟着被吃掉，那会造成漏检。 */
function stripBlockComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
}
const BARE_ACCENT = /var\(--accent\)(?![-\w])/
/** Tailwind 写法同样会画成灰：border/ring/outline-accent（-solid 结尾的是品牌档，允许）*/
const GRAY_EDGE_CLASS = /(?:border|ring|outline)-accent(?![-\w])/
const GRAY_SHADOW_CLASS = /shadow-\[[^\]]*var\(--accent\)/
const brandHijack = []
for (const include of ['*.css', '*.tsx', '*.ts']) {
  for (const s of scanFiles(include, 'src/renderer/src')) {
    stripBlockComments(s.text)
      .split(/\r?\n/)
      .forEach((line, i) => {
        const isBrandAlias = /--[a-z0-9-]*brand[a-z0-9-]*\s*:/.test(line)
        const isEdgeDecl = /(border|outline)[\w-]*\s*:/.test(line)
        const hit =
          (BARE_ACCENT.test(line) && (isBrandAlias || isEdgeDecl)) ||
          GRAY_EDGE_CLASS.test(line) ||
          GRAY_SHADOW_CLASS.test(line)
        if (hit) brandHijack.push(`${path.relative(ROOT, s.file)}:${i + 1}  ${line.trim().slice(0, 120)}`)
      })
  }
}
if (brandHijack.length) {
  problems.push(
    `这些位置把裸 --accent 当品牌色用了（它在 shadcn 映射段是灰色悬停面，实测 #35373c，画出来等于没有状态）：\n` +
      brandHijack.map((b) => `      ${b}`).join('\n') +
      `\n    品牌描边用 --trae-border-brand / --accent-solid，品牌字色用 --accent-text。`,
  )
}

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
