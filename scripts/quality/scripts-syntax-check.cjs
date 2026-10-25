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
 * 2026-10-18 从 72 改成 53，因为**这个数原先量的是我这台机器的工作树**：
 * walk() 扫文件系统，把我那些未跟踪的 scratch 探针一起数进去（78 个），
 * CI 只有跟踪集（53 个）⇒ 从立闸那天起 CI 就一直红，而本地一直绿。
 * 现在扫描面改成从 `git ls-files` 取，本地与 CI 看到同一份名单，这个数才有意义。
 *
 * 2026-10-25 降到 51（#215）：#211（7c6d212）整删教程抓取/回填链时带走了 5 个 .cjs
 * （scripts/ 下 55 → 50，加仓库根那份 eslint.config.cjs 共 51），那一批没同批下调这把下限
 * ⇒ CI 从那一笔起连红两轮，而本地每次"全绿"都绕过了它——因为这把门只在 CI 里跑。
 * 补的执行体是 `pnpm gates:ci` 加常驻判据 `tests/unit/ci-gate-parity.test.ts`
 * （工作流里每一条 `node scripts/...` 都必须能从 package.json 里叫动，
 * 再出现"只在 CI 存在的门"当场红）。
 * 教训与 2026-10-18 那条是同一族：**下限必须是"两边同一份名单"的量出来的数，且合法整删要同批下调**，
 * 否则它红的时候没人分得清是扫描面被挡了还是本来就该少。
 */
const MIN_FILES = 51

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

/**
 * 扫描面 = 跟踪集里的 .cjs/.mjs（scripts/ 下 + 仓库根）。
 * 用 git 而不是走文件系统：CI 只有跟踪集，本地还有一堆未跟踪探针，
 * 两边名单不同会让"数量下限"变成一台机器的私有读数。
 */
const { spawnSync } = require('node:child_process')
const tracked = spawnSync('git', ['-c', 'core.quotePath=false', 'ls-files'], {
  cwd: REPO,
  encoding: 'utf8',
})
if (tracked.status !== 0) {
  console.error('[scripts-syntax] git ls-files 失败：' + (tracked.stderr || '').trim())
  process.exit(2)
}
const files = (tracked.stdout || '')
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((rel) => /\.(cjs|mjs)$/.test(rel))
  .filter((rel) => rel.startsWith('scripts/') || !rel.includes('/'))
  .map((rel) => path.join(REPO, rel))
  .filter((abs) => {
    if (fs.existsSync(abs)) return true
    // 跟踪集里有、磁盘上没有 = 本地被删了还没提交。跳过就是放行，这里直接判闸坏。
    console.error(`[scripts-syntax] 跟踪集里的 ${path.relative(REPO, abs)} 在磁盘上不存在`)
    return false
  })

if (files.length < MIN_FILES) {
  console.error(
    `[scripts-syntax] 受检文件 ${files.length} 个 < 下限 ${MIN_FILES} —— 扫描面缩了。` +
      `空清单、git 取不到跟踪集、或有人把闸脚本删了都不算通过，先查那份名单再谈结果。`
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
