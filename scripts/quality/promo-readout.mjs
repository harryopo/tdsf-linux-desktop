#!/usr/bin/env node
/*
 * 对外发布物（GitHub Pages 宣传页）上那几个数字的复现器与对账闸。
 *
 * 为什么要有这个文件：2026-10-18 宣传页上线的端到端用例数写的是 59 通过 / 13 跳过，
 * 同条件重跑真值是 57 / 15——数字是上一轮抄过来的，没人当场量。
 * 从此对外数字只有一个出口：这个脚本。改页面先跑它，别凭记忆填。
 *
 *   node scripts/quality/promo-readout.mjs                    打印全部读数与测法
 *   node scripts/quality/promo-readout.mjs --check [路径]     与宣传页 + README + 架构图对账，不一致就非零退出
 *                                                          （README 那一面默认读仓库根那份，
 *                                                           单测用 --readme <夹具路径> 指到合成文档；
 *                                                           图那一面同理用 --diagram <夹具路径>，
 *                                                           不指就会绑上盘上那张真图）
 *   node scripts/quality/promo-readout.mjs --check-diagram    只与架构图对账（不跑 audit:ipc，CI 的 security-static job 走这条路）
 *
 * 为什么 README 也在对账面上（2026-10-19 加）：对外数字原先有三个载体，闸只管宣传页与架构图，
 * README 那一份没人管——同一天就撞上"README 与宣传页的用例数同时过期"。抄本永远比正本先漂，
 * 多一个载体就多一份责任。标签表只有一份（TABLE_ROWS），文档要抄就照它抄，抄漏或抄错都算失败。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const REPO = path.resolve(import.meta.dirname, '../..')
const DEFAULT_PROMO = path.resolve(REPO, '../harryopo.github.io/tdsf-linux-desktop/index.html')

const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' })

/** src 下被跟踪的 .ts / .tsx 文件数（不含 tests/，页面口径就是"源文件"） */
export function countSourceFiles(files) {
  return files.filter((f) => /\.(ts|tsx)$/.test(f) && f.startsWith('src/')).length
}

/** 契约表里登记的通道数，按 kind 分开数——生成物与契约的一致性由 ipc:check 钉 */
export function countContract(source) {
  const invoke = (source.match(/kind:\s*'invoke'/g) || []).length
  const event = (source.match(/kind:\s*'event'/g) || []).length
  return { invoke, event, total: invoke + event }
}

/**
 * 命令风险闸的词表规模。八张表逐项相加，护栏按子表键数计。
 * 只数"判定项"，不数注释键（_ 开头的那些是给人看的说明，不是判据）。
 */
export function countRuleVocabulary(rules) {
  const listKeys = [
    'protectedTargets',
    'powerCommands',
    'shellLaunchers',
    'readonlyCommands',
    'readonlyExtraCommands',
    'readonlyDenyVerbs',
    'prefixSkips',
    'argvRules',
  ]
  let total = 0
  const per = {}
  for (const k of listKeys) {
    const v = rules[k]
    const n = Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0
    per[k] = n
    total += n
  }
  const guards = rules.readonlyGuards || {}
  let guardCount = 0
  for (const group of Object.values(guards)) {
    if (group && typeof group === 'object') guardCount += Object.keys(group).length
  }
  per.readonlyGuards = guardCount
  total += guardCount
  return {
    vocabulary: total,
    per,
    detectors: (rules.denyBaseline && rules.denyBaseline.blockDetectors ? rules.denyBaseline.blockDetectors.length : 0),
    argvRules: Array.isArray(rules.argvRules) ? rules.argvRules.length : 0,
    protectedTargets: per.protectedTargets,
  }
}

/** 从 `npm run audit:ipc` 的中文报告里取通道数（那张报告本身是通道数的唯一出口） */
export function parseIpcAudit(text) {
  const req = text.match(/main 注册通道:\s*(\d+)/)
  const evt = text.match(/main 事件推送通道:\s*(\d+)/)
  if (!req || !evt) {
    throw new Error('audit:ipc 输出里没取到通道数——报告格式改了，这个复现器要跟着改，别改成静默返回 0')
  }
  return { request: Number(req[1]), event: Number(evt[1]), total: Number(req[1]) + Number(evt[1]) }
}

/**
 * 从宣传页的"读数 / 值 / 怎么量的"表里取已发布的数字。
 * 取不到某一行就报错——"页面结构变了所以没比"必须算失败，不能算通过。
 */
export function parsePromoReadouts(html) {
  const rows = {}
  const re = /<td class="k">([^<]+)<\/td>\s*<td class="v">([\s\S]*?)<\/td>/g
  let m
  while ((m = re.exec(html))) {
    const label = m[1].trim()
    const digits = (m[2].match(/\d[\d,]*/) || [])[0]
    rows[label] = digits ? Number(digits.replace(/,/g, '')) : null
  }
  return rows
}

/** 页面读数 ↔ 本轮实测，返回不一致的条目 */
export function diffReadouts(page, measured) {
  const out = []
  for (const [label, want] of measured) {
    if (!(label in page)) {
      out.push({ label, got: '(页面里没有这一行)', want })
      continue
    }
    if (page[label] !== want) out.push({ label, got: page[label], want })
  }
  return out
}

/**
 * 从 markdown 表格里按标签取读数，返回 `标签 -> 该标签在文档里每一处出现的数字`。
 *
 * 为什么按"每一处"而不是只取第一处：一份文档里同一个数常被抄两遍（读数表一次、正文一次），
 * 只比第一处等于给第二处开了个不受管的出口——那正是这批数字漂开的老路。
 * 取数口径与宣传页一致：值单元里第一个数。
 */
export function parseMdReadoutRows(text, labels) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const occ = {}
  for (const label of labels) {
    const re = new RegExp('^\\|\\s*' + esc(label) + '\\s*\\|\\s*([^|]*)\\|', 'gm')
    occ[label] = [...text.matchAll(re)].map((h) => {
      const digits = (h[1].match(/\d[\d,]*/) || [])[0]
      return digits ? Number(digits.replace(/,/g, '')) : null
    })
  }
  return occ
}

/** 文档读数（含同一标签的多处抄本）↔ 本轮实测 */
export function diffMdReadouts(occ, measured) {
  const out = []
  for (const [label, want] of measured) {
    const vals = occ[label] || []
    if (!vals.length) {
      out.push({ label, got: '(文档里没有这一行)', want })
      continue
    }
    vals.forEach((got, i) => {
      if (got !== want) out.push({ label: vals.length > 1 ? label + '（第 ' + (i + 1) + ' 处）' : label, got, want })
    })
  }
  return out
}

/**
 * provider-factory 的 switch 分支数就是"支持几类端点"。
 * 数不到任何分支就报错——注册方式改了要同步这里，静默返回 0 比报错更坏。
 */
export function countProviderTypes(source) {
  const kinds = new Set([...source.matchAll(/^\s*case '([a-z-]+)':/gm)].map((m) => m[1]))
  if (kinds.size === 0) {
    throw new Error("provider-factory 里没数到 case 分支——注册方式改了，这个计数要跟着改")
  }
  return kinds.size
}

/**
 * 从 README 架构图里取抄走的读数。
 * 图上每一个数都是对外承诺，抄的地方越多越会漂，所以和宣传页一样纳入对账。
 * 取不到某一行就报错——"图改了措辞所以没比"必须算失败，不能算通过。
 */
export function parseSvgClaims(text) {
  const grab = (re, label) => {
    const m = text.match(re)
    if (!m) throw new Error(`架构图里没找到「${label}」那行——图改了措辞就要同步这条对账，别让它静默漏比`)
    return Number(m[1])
  }
  return {
    请求通道: grab(/invoke 请求（(\d+) 条通道）/, 'invoke 请求'),
    事件通道: grab(/事件推送（(\d+) 条通道）/, '事件推送'),
    已登记契约的通道: grab(/(\d+) 条已登记 zod 契约/, '已登记 zod 契约'),
    命令规则词表项: grab(/\+ (\d+) 词表/, '词表'),
    结构性拦截器: grab(/(\d+) 结构 \+/, '结构性拦截'),
    'argv 规则': grab(/\+ (\d+) argv/, 'argv 规则'),
    'Provider 类型': grab(/(\d+) 类兼容端点/, '兼容端点'),
  }
}

const ARCH_SVG = path.join(REPO, 'docs', 'assets', 'architecture.svg')
const README_MD = path.join(REPO, 'README.md')

/** 读仓库文件（含 git ls-files）就能定出来的事实，不跑 audit:ipc */
export function readRepoFacts() {
  const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
  return {
    srcFiles: countSourceFiles(git(['ls-files']).trim().split('\n').map((s) => s.replace(/\\/g, '/'))),
    contract: countContract(read('src/shared/ipc-contract.ts')),
    rules: countRuleVocabulary(JSON.parse(read('src/main/core/command-rules.json'))),
    providers: countProviderTypes(read('src/main/core/agent/providers/provider-factory.ts')),
  }
}

/**
 * 架构图上那五个"读文件就能定"的数与仓库实测的对账。
 * 单独成函数是为了让单测也能直接调它——图是提交进仓库的，比对就不该只在本地手动跑。
 * 图上另外两个数（请求 / 事件通道）要跑 audit:ipc，只有 --check 全量模式比得到。
 */
export function diffDiagram(facts, svgText) {
  const svg = parseSvgClaims(svgText)
  const want = {
    已登记契约的通道: facts.contract.total,
    命令规则词表项: facts.rules.vocabulary,
    结构性拦截器: facts.rules.detectors,
    'argv 规则': facts.rules.argvRules,
    'Provider 类型': facts.providers,
  }
  if (facts.ipc) {
    want.请求通道 = facts.ipc.request
    want.事件通道 = facts.ipc.event
  }
  const bad = []
  for (const [label, v] of Object.entries(want)) {
    if (svg[label] !== v) bad.push({ label, got: svg[label], want: v })
  }
  return { bad, checked: Object.keys(want).length, svg }
}

export function measure() {
  const facts = readRepoFacts()
  // Windows 上 npm 是 .cmd 垫片，execFileSync 不带 shell 会 ENOENT（本机反复踩过的一条）。
  // 命令写成一整串、不传 args 数组：Node 24 对"shell:true + args"会发弃用告警。
  const ipc = parseIpcAudit(
    execFileSync('npm run audit:ipc', { cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, shell: true })
  )
  return { ...facts, ipc }
}

/** 导出的唯一理由：测试要用同一份标签表造夹具页，抄一份标签就会和这里漂开 */
export const TABLE_ROWS = (m) => [
  ['IPC 通道', m.ipc.total],
  ['已登记契约的通道', m.contract.total],
  ['TypeScript / TSX 源文件', m.srcFiles],
  ['命令规则词表项', m.rules.vocabulary],
  ['结构性拦截器', m.rules.detectors],
]

/**
 * README 比宣传页多比两行：argv 规则数与 Provider 类型数。
 * 这两项原先只在架构图上对账，而 README 的"判定分三层"表里也写着同样的数——
 * 文档抄了、闸没管，就还是漂。为什么不塞进 TABLE_ROWS：那两行宣传页上没有，
 * 加进去会让宣传页立刻报"没有这一行"，那是页面的问题不是数字的问题。
 */
export const MD_EXTRA_ROWS = (m) => [
  ['argv 规则', m.rules.argvRules],
  ['Provider 类型', m.providers],
]

/**
 * 用例数四个参数：给了就把那两行也纳入对账。
 *
 * 为什么原先不纳入：跑满套要几分钟，不该塞进一个秒级对账闸里。但"不纳入"的实际后果是
 * 2026-10-18 一天内两次撞上"套件数字变了、页面没动"（3256→3260→3264），
 * 全靠人记得回头改。所以改成**调用方把刚量到的数递进来**，闸负责比，不负责跑。
 * fail-closed：要么四个都给，少一个就报错退出——半套数字比没有数字更危险，
 * 它会让人以为那两行也对过账。
 */
function readoutCounts(argv) {
  const keys = ['--unit-passed', '--unit-skipped', '--e2e-passed', '--e2e-skipped']
  const got = keys.map((k) => {
    const i = argv.indexOf(k)
    return i < 0 ? null : argv[i + 1]
  })
  const present = got.filter((v) => v !== null)
  if (!present.length) return null
  if (present.length !== keys.length) {
    const missing = keys.filter((k, i) => got[i] === null)
    throw new Error(
      '用例数四个参数要么全给要么都不给，缺：' + missing.join(' ') + '（半套数字会让人以为那两行也对过账）'
    )
  }
  for (const [k, v] of keys.map((k, i) => [k, got[i]])) {
    if (!/^[0-9]+$/.test(v)) throw new Error(k + ' 必须是非负整数，收到：' + v)
  }
  const [up, us, ep, es] = got.map(Number)
  return { up, us, ep, es }
}

/**
 * 端到端那一轮"新不新"的基准时间。
 *
 * 口径要正好等于"会让这轮端到端作废的改动"：应用代码（src/）与端到端规格本身（tests/e2e/）。
 * 不把整个 tests/ 算进来——第一次写这判据时我这么干了，结果 12:55 那轮真跑完后端去改了
 * tests/unit 里这个闸自己的判据，它就把自己的产物判成"改版前的一轮"，cry wolf。
 */
function newestSourceMtime() {
  const files = git(['ls-files'])
    .trim()
    .split('\n')
    .map((s) => s.replace(/\\/g, '/'))
    .filter((f) => f.startsWith('src/') || f.startsWith('tests/e2e/'))
  let m = 0
  for (const f of files) {
    try {
      m = Math.max(m, fs.statSync(path.join(REPO, f)).mtimeMs)
    } catch {
      /* 跟踪集里有盘上不在的文件（别人删了没提交）：跳过它，不影响取最大值 */
    }
  }
  return m
}

/**
 * 递进来的四个用例数必须是"刚跑完的那一轮"量的。
 *
 * 为什么补这一道：这个闸只比"页面上写的"与"调用方递进来的"，两者一致就 PASS——
 * 2026-10-20 我递的是昨天的端到端数（57 通过 / 15 跳过），页面照它的值改对了，
 * 于是三面全 PASS，而真值是重跑之后的 59 / 13。**一致的错数比不一致更危险**，
 * 因为它会让人以为这条数也对过账。
 * 判据用 Playwright 每次跑都会写的那份产物：文件必须在、必须是 passed、
 * 且不能比源码与测试的最新改动旧（旧的=跑的是改版前的包）。
 */
export function assertE2eRunFresh(artifactPath) {
  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      `端到端没有跑过的痕迹（${path.relative(REPO, artifactPath)} 不在）。` +
        '递进来的用例数就无从判新旧——先 `npx playwright test` 再来对账。'
    )
  }
  const st = fs.statSync(artifactPath)
  let run
  try {
    run = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  } catch (e) {
    throw new Error(`端到端产物解析不了（${e.message}）：${path.relative(REPO, artifactPath)}`)
  }
  if (run.status !== 'passed') {
    const n = Array.isArray(run.failedTests) ? run.failedTests.length : '?'
    throw new Error(`端到端产物写的是 ${JSON.stringify(run.status)}（失败 ${n} 条），不能拿它的数对外发布`)
  }
  const src = newestSourceMtime()
  if (st.mtimeMs < src) {
    throw new Error(
      `端到端产物比源码旧 ${((src - st.mtimeMs) / 60_000).toFixed(1)} 分钟` +
        '（产物 ' +
        new Date(st.mtimeMs).toISOString().slice(0, 16).replace('T', ' ') +
        ' UTC，源码更新在后）——那是改版前那一轮的数，先重跑'
    )
  }
  return st
}

function main(argv) {
  const check = argv.includes('--check')
  const diagramOnly = argv.includes('--check-diagram')
  if (check && diagramOnly) {
    console.error('FAIL --check 与 --check-diagram 只能选一个（前者要跑 audit:ipc，后者不跑）')
    return 2
  }
  // 图那一面也必须能指到夹具：单测喂的是合成读数，硬读盘上那张真 SVG
  // 会让"闸对不对"取决于"图这轮重出过没有"（2026-10-20 整删之后两条用例就是这么白的红）。
  const diagramIdx = argv.indexOf('--diagram')
  const diagramPath = diagramIdx >= 0 ? path.resolve(argv[diagramIdx + 1]) : ARCH_SVG
  if (!fs.existsSync(diagramPath)) {
    console.error(`FAIL 架构图不在：${diagramPath}\n     同上，没有可比对象就是失败。`)
    return 1
  }
  if (diagramOnly) {
    const r = diffDiagram(readRepoFacts(), fs.readFileSync(diagramPath, 'utf8'))
    if (r.bad.length) {
      console.error(`FAIL 架构图的读数与仓库实测对不上（${r.bad.length} 条）：`)
      for (const b of r.bad) console.error(`  ${b.label}：图上 ${b.got}，实测 ${b.want}`)
      console.error('  重新出图：python scripts/docs/arch-diagram.py（数字改在生成器里，别手改 SVG）')
      return 1
    }
    console.log(
      `PASS 架构图 ${r.checked} 个读数与仓库实测一致` +
        '（请求 / 事件两条通道数要跑 audit:ipc，只有 --check 全量模式比得到）'
    )
    return 0
  }
  const argAfter = argv[argv.indexOf('--check') + 1]
  const promoPath = check && argAfter && !argAfter.startsWith('-') ? path.resolve(argAfter) : DEFAULT_PROMO
  // README 那一面也必须能指到夹具：单测喂的是合成用例数（3264），
  // 硬读盘上那份真 README（3276）会让"闸对不对"变成"文档这轮改没改过"，测试与文档就绑死漂了。
  const readmeIdx = argv.indexOf('--readme')
  const readmePath = readmeIdx >= 0 ? path.resolve(argv[readmeIdx + 1]) : README_MD
  const m = measure()
  let counts
  try {
    counts = readoutCounts(argv)
  } catch (e) {
    console.error('FAIL ' + e.message)
    return 2
  }
  // 递了用例数，就得同时交出"这数是刚跑的"凭据：Playwright 那份 run 产物必须新于源码。
  // 单测用 --e2e-artifact 指到夹具（理由与 --readme / --diagram 同一条：不许绑盘上产物）。
  let e2eStamp = null
  if (counts) {
    const artIdx = argv.indexOf('--e2e-artifact')
    const artifactPath = artIdx >= 0 ? path.resolve(argv[artIdx + 1]) : path.join(REPO, 'test-results', '.last-run.json')
    try {
      e2eStamp = assertE2eRunFresh(artifactPath)
    } catch (e) {
      console.error('FAIL ' + e.message)
      return 1
    }
  }

  if (!check) {
    console.log('对外读数（本轮实测）')
    console.log(`  IPC 通道            ${m.ipc.total}（${m.ipc.request} 请求-响应 + ${m.ipc.event} 事件推送）  测法：npm run audit:ipc`)
    console.log(`  已登记契约的通道    ${m.contract.total}（${m.contract.invoke} invoke + ${m.contract.event} event）  测法：src/shared/ipc-contract.ts 条目数`)
    console.log(`  源文件              ${m.srcFiles}  测法：git ls-files src 里 .ts/.tsx 计数`)
    console.log(`  规则词表项          ${m.rules.vocabulary}  分项：${JSON.stringify(m.rules.per)}`)
    console.log(`  结构性拦截器        ${m.rules.detectors}　argv 规则 ${m.rules.argvRules}　受保护根级路径 ${m.rules.protectedTargets}`)
    console.log(`  Provider 类型       ${m.providers}  测法：provider-factory 的 switch 分支数`)
    console.log('  用例数不在这个脚本里算（要跑满套）。跑完把四个数递回来一起对账，')
    console.log('  并交出"这数是刚跑的"凭据——端到端产物默认读 test-results/.last-run.json，比源码旧就拒收：')
    console.log(
      '    npm run promo:check -- --unit-passed N --unit-skipped M --e2e-passed P --e2e-skipped Q [--e2e-artifact 路径]'
    )
    return 0
  }

  if (!fs.existsSync(promoPath)) {
    console.error(`FAIL 宣传页不在：${promoPath}\n     对账必须有页面可比；找不到文件就是失败，不是跳过。`)
    return 1
  }
  if (!fs.existsSync(readmePath)) {
    console.error(`FAIL README 不在：${readmePath}\n     同上，没有可比对象就是失败。`)
    return 1
  }
  const page = parsePromoReadouts(fs.readFileSync(promoPath, 'utf8'))
  const rows = TABLE_ROWS(m)
  if (counts) {
    // 形状必须是 [标签, 数字]：parsePromoReadouts 从 .v 单元里取第一个数，
    // 所以页面写 "3264 通过" 会被读成 3264。这里比的是那个数，不是整串文案。
    rows.push(['单元与组件用例', counts.up])
    rows.push(['端到端用例', counts.ep])
  }
  const bad = diffReadouts(page, rows)
  const mdRows = rows.concat(MD_EXTRA_ROWS(m))
  const mdOcc = parseMdReadoutRows(fs.readFileSync(readmePath, 'utf8'), mdRows.map(([l]) => l))
  const mdBad = diffMdReadouts(mdOcc, mdRows)
  const dia = diffDiagram(m, fs.readFileSync(diagramPath, 'utf8'))
  if (bad.length) {
    console.error(`FAIL 宣传页的读数与本轮实测对不上（${bad.length} 条）：`)
    for (const b of bad) console.error(`  ${b.label}：页面写 ${b.got}，实测 ${b.want}`)
    console.error('  改页面，别改这个脚本——除非你确认页面上的口径本来就该变。')
  }
  if (mdBad.length) {
    console.error(`FAIL README 的读数与本轮实测对不上（${mdBad.length} 条）：`)
    for (const b of mdBad) console.error(`  ${b.label}：文档写 ${b.got}，实测 ${b.want}`)
    console.error('  改文档那一行，标签照 TABLE_ROWS 抄；别在这里另起一套口径。')
  }
  if (dia.bad.length) {
    console.error(`FAIL 架构图的读数与本轮实测对不上（${dia.bad.length} 条）：`)
    for (const b of dia.bad) console.error(`  ${b.label}：图上 ${b.got}，实测 ${b.want}`)
    console.error('  重新出图：python scripts/docs/arch-diagram.py（数字改在生成器里，别手改 SVG）')
  }
  if (bad.length || mdBad.length || dia.bad.length) return 1
  console.log(
    `PASS 宣传页 ${rows.length} 条读数与本轮实测一致` +
      (counts
        ? '（含两条用例数，数字由调用方从刚跑完的套件递进来；' +
          '端到端那两条的新鲜度按 Playwright 产物判：' +
          new Date(e2eStamp.mtimeMs).toISOString().slice(0, 16).replace('T', ' ') +
          ' UTC）'
        : '（用例数两条未纳入：跑完套件加 --unit-passed/--unit-skipped/--e2e-passed/--e2e-skipped 再对一次）')
  )
  console.log(`PASS README ${mdRows.length} 条读数与本轮实测一致（同一标签在文档里抄了多处，逐处比）`)
  console.log(`PASS 架构图 ${dia.checked} 条读数与本轮实测一致（含请求 / 事件两条通道数）`)
  return 0
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2))
}
