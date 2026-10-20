#!/usr/bin/env node
/**
 * 死码/悬空引用闸（2026-10-15 全维度系统审查 D6 + E4「CI 缺执行体」）
 *
 * 现状：仓库里能量到 240 条未使用导出、185 个未使用导出类型，而 `pnpm deadcode` 一直带
 * --no-exit-code 跑，所以"死码在长"这件事没有任何执行体。这道闸不追求一次清干净
 * （清理要人批、要逐条确认，归任务 #117），只钉住四类不会误伤的东西不许变多。
 *
 * 钉这四类（上限只许降）：
 *   - unresolved / unlisted：import 了根本解析不到或没登记的模块——这是断链，不是风格问题
 *   - files：整文件没人引用（knip 当前读数 0，所以上限就是 0）
 *   - duplicates：同一文件里重复导出同名符号
 *   - binaries：脚本里调了没声明的外部命令
 *
 * 故意不钉 exports / types / dependencies：knip 看不见测试（tests 目录整个在 ignore 名单里）、
 * 也看不见 CSS 里的类名。实测 tailwindcss 就曾被它报成"未使用依赖"，而它是 postcss 在用。
 * 本仓的惯例是"为了让单测能打到而 export"，把这两档设成红牌只会逼人少写测试——
 * 那正是"为了单点数字好看损害整体"。它们的读数每轮打印，供 #117 决策。
 *
 * 用法：
 *   node scripts/quality/deadcode-gate.cjs                # 真跑 knip
 *   node scripts/quality/deadcode-gate.cjs --input k.json # 喂存档的 knip json（测试/离线复算）
 *   node scripts/quality/deadcode-gate.cjs --json
 * 退出码：0 放行 / 1 超上限 / 2 量具没工作（跑不起来、解析不出、抽到的东西少得不像真的）。
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')

/**
 * 四类上限（2026-10-15 实测：unresolved 0 / unlisted 0 / files 0 / duplicates 16 / binaries 0。
 * duplicates 在 2026-10-20 清到 0：那 16 组全是"组件/ store 同时给具名与 default 两份出口"，
 * 判据不是数文本，而是逐个数"谁在吃哪一份"（含 router 那种 `.then((m) => ({ default: m.X }))`
 * 的动态 import——它吃的是**具名**，按"动态 import 就是吃 default"想当然会把路由改红）。
 * 清零之后这一档就是硬零闸：再出现同文件双出口直接红。）
 */
const CAPS = { unresolved: 0, unlisted: 0, files: 0, duplicates: 0, binaries: 0 }
/** 每档的中文说明，红了要能看懂是哪一类 */
const MEANING = {
  unresolved: '引用了解析不到的模块（断链）',
  unlisted: '引用了未登记的依赖',
  files: '整文件没有任何引用者',
  duplicates: '同文件重复导出同名符号',
  binaries: '调用了未声明的外部命令'
}
/** knip 至少该在这些文件里有发现；少于这个数先疑它没读到源码树 */
const MIN_FILES_WITH_ISSUES = 50
/** 每轮都打印、但不设上限的档（理由见文件头） */
const INFORMATIVE = ['exports', 'types', 'dependencies', 'devDependencies']

function runKnip() {
  // shell:true 为 Windows：pnpm 是 .cmd，不走 shell 直接 ENOENT。
  // --no-exit-code 让 knip 有发现时也正常退出，判定完全交给本脚本。
  const r = spawnSync('pnpm exec knip --reporter json --no-exit-code', {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 32 * 1024 * 1024
  })
  if (r.error) throw new Error(`knip 跑不起来：${r.error.message}`)
  const out = r.stdout || ''
  if (!out.trim()) {
    throw new Error(
      `knip 没有任何输出（退出码 ${r.status}）。这不是"没有死码"，是量具没工作：\n${(r.stderr || '').slice(0, 400)}`
    )
  }
  return out
}

/**
 * knip 的 json 是"每个文件一条 issue，各类符号放在数组里"，这里按类别汇总成计数。
 * @returns {{counts: Record<string, number>, filesWithIssues: number}}
 */
function parseReport(rawText, source) {
  const start = rawText.indexOf('{')
  if (start < 0) throw new Error(`${source} 里没有 JSON（前 200 字：${rawText.slice(0, 200)}）`)
  let parsed
  try {
    parsed = JSON.parse(rawText.slice(start))
  } catch (e) {
    throw new Error(`${source} 的 JSON 解析失败：${e.message}`)
  }
  if (!Array.isArray(parsed.issues)) {
    throw new Error(`${source} 缺 issues 数组——knip 换了输出格式，判定要跟着改，不能当"0 命中"`)
  }
  const counts = {}
  for (const it of parsed.issues) {
    if (!it || typeof it !== 'object' || !it.file) throw new Error(`${source} 有条 issue 没有 file 字段`)
    for (const [k, v] of Object.entries(it)) {
      if (Array.isArray(v)) counts[k] = (counts[k] || 0) + v.length
    }
  }
  return { counts, filesWithIssues: parsed.issues.length }
}

/**
 * 纯判定：给计数和上限，返回红牌清单。
 */
function evaluate(counts, caps) {
  const problems = []
  for (const [key, cap] of Object.entries(caps)) {
    const now = counts[key] || 0
    if (now > cap) {
      problems.push(`${key}（${MEANING[key] || key}）现在 ${now} 处 / 上限 ${cap}，只许降不许涨`)
    }
  }
  return problems
}

function main() {
  const argv = process.argv.slice(2)
  let inputPath = null
  let asJson = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') asJson = true
    else if (a === '--input') {
      inputPath = argv[++i]
      if (!inputPath) throw new Error('--input 后面要跟文件路径')
    } else throw new Error(`不认识参数：${a}（本闸只有 --input / --json）`)
  }

  const raw = inputPath
    ? (() => {
        const abs = path.resolve(ROOT, inputPath)
        if (!fs.existsSync(abs)) throw new Error(`--input 指定的文件不存在：${abs}`)
        return fs.readFileSync(abs, 'utf8')
      })()
    : runKnip()

  const report = parseReport(raw, inputPath || 'knip')
  if (report.filesWithIssues < MIN_FILES_WITH_ISSUES) {
    throw new Error(
      `knip 只在 ${report.filesWithIssues} 个文件里有发现（下限 ${MIN_FILES_WITH_ISSUES}）。` +
        '多半是它没读到源码树（配置或路径变了），此时"0 超上限"没有意义'
    )
  }

  const problems = evaluate(report.counts, CAPS)

  // 阳性对照：造一条"新增未引用文件 + 断链"的读数，必须变红。
  // 不验这一步，上限比较写错方向（>= 变 <=）也能长期看起来"全绿"。
  const canary = evaluate({ ...report.counts, files: (report.counts.files || 0) + 1, unresolved: 1 }, CAPS)
  if (canary.length < 2) {
    throw new Error('注入"新增一个未引用文件 + 一条断链"后闸没有同时报两条红——上限比较没有牙，先修它')
  }

  const info = {}
  for (const k of INFORMATIVE) info[k] = report.counts[k] || 0

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ok: problems.length === 0,
          caps: CAPS,
          counts: report.counts,
          info,
          problems,
          stats: { filesWithIssues: report.filesWithIssues, teethVerified: true }
        },
        null,
        2
      )
    )
  } else {
    console.log(
      `[deadcode] knip 抽到 ${report.filesWithIssues} 个文件有发现；受管五档 ` +
        Object.keys(CAPS)
          .map((k) => `${k}=${report.counts[k] || 0}/${CAPS[k]}`)
          .join(' ')
    )
    console.log(`  不设上限（理由见脚本头）：${Object.entries(info).map(([k, v]) => `${k}=${v}`).join(' ')}`)
    for (const p of problems) console.log(`  ✗ ${p}`)
    if (problems.length) console.log('  处置：修掉新增的那几处；确实是误报就改 knip.json 的口径并在提交信息里说明')
  }
  process.exit(problems.length ? 1 : 0)
}

module.exports = { parseReport, evaluate, CAPS }

if (require.main === module) {
  try {
    main()
  } catch (e) {
    console.error(`[deadcode] 闸没跑成（这不是"没有死码"）：${e.message}`)
    process.exit(2)
  }
}
