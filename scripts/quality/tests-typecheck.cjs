#!/usr/bin/env node
/**
 * tests/ 的类型检查闸（现在是硬零闸，CAP=0）
 *
 * 为什么要有这道门：`tsconfig.node.json` 与 `tsconfig.web.json` 的 include 都不含 tests/，
 * `npm run lint` 只扫 src，`.git/hooks/pre-commit` 只跑密钥/拓扑/协作三闸——
 * 也就是说 2900 条测试**从来没有被类型检查过**。产品改了字段名，测试不会红，
 * 它会继续用旧形状构造对象、断言一个不存在的东西，然后绿着。
 *
 * 为什么立闸时不清零、后来又清零了：2026-10-14 立闸时实测存量 200 条 / 70 个文件，
 * 一次性手改 70 个测试文件的风险（改坏断言、静默弱化判据）大于收益，所以先按
 * **“存量记账，新增即红”**扎住口子，再分族往下削：每族一个提交、每族复跑全量 vitest
 * 与被改到的 e2e 用例、并把 CAP 改成实测新数。削的过程本身就是找真隐患的过程
 * （恒真断言、as never 蒙过的形状不匹配、mock 没形参导致二十多条断言从没被检查过），
 * 这些是"一次性机械清零"拿不到的东西。CAP 轨迹记在下面的注释里。
 *
 * 用法：
 *   node scripts/quality/tests-typecheck.cjs              跑闸（超上限 exit 1）
 *   node scripts/quality/tests-typecheck.cjs --top 12     多看几条错误明细
 *   node scripts/quality/tests-typecheck.cjs --json p     另存明细（p 必须在仓库外）
 * 未知参数一律 exit 2：默认分支是"读文件/写报告"，打错一个字母就等于悄悄放行。
 *
 * 三道自证（2026-10-14 独立审查点出来的自己的盲区，都是"门恒绿但没在管东西"那一类）：
 *   1. 错误路径先归一化成仓库相对再分类；既不在 tests/ 也不在 src/ 的（scripts/、根配置
 *      被 import 拖进 program 之类）一律 exit 2 —— 原先这类会被并进"顺带的 src 侧"糊过去，
 *      而 src 侧那句明说"归 typecheck:node/web 管"，可那两个 config 里根本没有 scripts/。
 *   2. 覆盖面自证：tests/ 磁盘上的 .ts/.tsx 必须全部出现在 tsc 的 --listFilesOnly 里。
 *      少了就是 tsconfig 的 include 停止匹配某个子目录（改名、加 exclude 都会这样），
 *      那时这道门会扫得越来越少、错误数越来越好看，最后变成对着一堆没人看的文件报 0。
 *   3. `as never` 计数闸（AST，不是 grep）：#107 第七族那一类——类型与数据不一致时用
 *      as never 把话按住——是最贵的写法，因为它同时骗过 typecheck 和读代码的人。
 *      存量 76 处，只许降不许升。用 grep 会把我自己写的"原先是 as never"这类注释也算成
 *      违规，所以走编译器 AST 数真正的类型断言节点。
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '../..')
const TSCONFIG = 'tsconfig.tests.json'
/**
 * 存量上限（只算 tests/ 里的）。
 * 2026-10-14 立闸时 200 条 / 70 个文件；
 * 同日削掉"Page 变量名叫 window 遮蔽了 evaluate 回调里的浏览器全局"这一族（TS2551 24 条清零）→ 181；
 * 再削掉 16 个组件测试里冗余的 `import type {} from '@testing-library/jest-dom'`
 * （jest-dom v6 那份是全局声明不是模块，import 它必报 TS2306；matcher 的类型本来就由
 * tests/test-setup.ts 的 `import '@testing-library/jest-dom/vitest'` 全局带进来）→ 165；
 * 第三族是**量具自己坏了**：`expect(locator, { timeout })` 的第二个参数只认 message，
 * 5 处 e2e 把 timeout 写在那里 ⇒ 等待一直用默认 5 秒，写它的人以为给的是 15/20 秒；
 * 另有 3 处 `_electron.launch({ stdio: 'pipe' })` 这个选项 Playwright 不认（管道本来就接走了）。
 * 两类都换成真生效的写法 → 158 条 / 49 个文件；
 * 第四族是"夹具自己造了个产品没有的形状"（TS2353 / TS2352 共 11 条）：
 * `modelInstance.config` 的类型是 PersistedProviderConfig，`apiKey` 这个键已被 Omit 掉，
 * 测试却写 `{ ...config, apiKey: undefined }`——运行时真留了一个名为 apiKey 的键；
 * `AttentionTracker.getCurrent` 的 mock 没标返回类型，推断成 `{ since }`，喂 files/commands 就撞；
 * `fs.appendFile` 的 mock 没标形参，`calls[0][1]` 推断成 undefined，用例只能 `as string` 硬掰；
 * provider-baseurl-join 还在按 AI SDK V1 的 `mode: 'standard'` 调 doGenerate。
 * 四处都改成"按真实契约造"→ 146 条 / 44 个文件；
 * 第五族是 78 条"可能为空/unknown"，逐条看完分两类：
 * 一类是真隐患——夹具的 mock 没声明形参，calls[0][0] 是空元组，二十多条 entry.xxx
 * 从没被类型检查过（task-sediment 一个文件占 29 条）；e2e 的几何读数找不到节点时返回
 * null，null 参与 > 比较会被强转成 0，判据静默空过；ai-chat-live 用了没 import 的
 * e2eProfileDir，一旦有真 Key 开跑就是 ReferenceError；
 * 另一类是越界枚举值（mode: 'deep' 不在 AgentMode 里）。都按真实类型收窄或补齐，
 * 不靠 ! 和 as → 78 条 / 39 个文件；
 * 第六族继续清"mock/夹具的签名"：crash-guard 把 exit spy 存进
 * ReturnType<typeof vi.spyOn>（退化成 unknown 参数，七个用例赋值全对不上）、
 * db-native 的 Module._load（Node 真钩子，@types/node 没声明）、design-contract 的
 * catch(e) unknown 与报告缺键、pdf-exporter 的 printToPDF 形参、ui-tokens 的
 * split().pop()——都改成"一处收窄 + 说清为什么"。
 * 顺带抓到一次自伤：process.emit 摘下来直接调会丢 this，EventEmitter 读不到 _events，
 * 是那条用例把它红的（改 .call(process, ...)）。→ 51 条 / 34 个文件；
 * 第七族是"类型与数据不一致时有人用 as never 把话按住"，这类最贵：
 * hostile-write-entry-gate 的形态表声明成 Array<[string, string]> 却每行三个元素，
 * 结尾一个 as never ⇒ 循环里解出来的 secret 在类型上不存在，脱敏漏一整行也不会红；
 * ai-stream-stability 的消息夹具 as never ⇒ compactIfNeeded 的入参形状对不对没人知道；
 * risk-detector 断言 r.id === undefined，而 RiskItem 根本没有 id ⇒ 恒真，筛选项等于没筛；
 * task-protocol 的 mock 表把 stepCleanup/stepReturnResult 写了两遍（后写覆盖前写）；
 * button-truth-census / content-screenshot / wiring-verification 的辅助函数形参还叫 window，
 * 把 #107 第一族的尾巴收掉。→ 38 条 / 27 个文件；
 * 第八族是组件夹具跟不上 props 类型：ModelConfigSection 的 props 靠 as never 摊开、
 * ConnectDialog 的夹具还给 server 带 password（ServerListItem 有意 Omit 掉凭据）、
 * TooltipProvider 被写了一个它根本不接的 delayDuration（写了等于没写）、
 * LiveMessageRow 的 stepState 少两个必填项、审计夹具少 decisionTimeIso
 * ——那一项会被直接印进报告表格，缺了就是"决策时间 | undefined"。
 * → 30 条 / 21 个文件；
 * 第九族是"测试替身的签名与真模块脱钩"：IPC handler 表把余参写成 ...args: never[]，
 * 于是带参调用一律过不了检查、只能各处 as never；假 manager 的 onShellData 写成无参、
 * registerLocalTerminalHandlers 早就不收窗口了还硬塞一个 fakeWindow、
 * node:sqlite 的构造函数被当类型用、AST 测试在类型位置引用只在值位置 import 进来的 ts。
 * → 23 条 / 16 个文件；
 * 第十族是"读结果的人没收窄"：通用任务契约把 details 定成 Record<string, unknown>，
 * 周报那四条断言一直在比 unknown；能力档位表在测试里手抄了一份（本仓自己有单源表）；
 * ProviderCapabilities 加了必填 logprobs 而两处夹具没跟；CostStats 模块没 export；
 * 广播替身的窗口是 Record<string, unknown>、process.resourcesPath 当可写属性赋值、
 * ssh2 的 shell() 多传一个位置参数、真靶机那条 resizeShell 少传一个参数还断言 toBeDefined()。
 * → **0 条 / 0 个文件**。
 *
 * 现在是硬零闸：tests/ 里出现任何类型错误就红。要放宽只有一种正当理由——
 * 那条错误本身是量具在骗人，那就修量具，不要把 CAP 抬回去。
 */
const CAP = 0

/** `as never` 存量上限：2026-10-14 实测 76 处（AST 计数）。同样只许降不许升。 */
const AS_NEVER_CAP = 76

const argv = process.argv.slice(2)
let top = 6
let jsonOut = null
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--top') {
    const n = Number(argv[++i])
    if (!Number.isInteger(n) || n <= 0) {
      console.error(`[tests-typecheck] --top 要一个正整数，收到 ${JSON.stringify(argv[i])}`)
      process.exit(2)
    }
    top = n
  } else if (a === '--json') {
    jsonOut = argv[++i]
    if (!jsonOut) {
      console.error('[tests-typecheck] --json 后面要跟一个路径')
      process.exit(2)
    }
  } else {
    console.error(`[tests-typecheck] 未知参数：${a}（可用：--top N / --json <仓库外路径>）`)
    process.exit(2)
  }
}

const tscBin = path.join(REPO, 'node_modules', 'typescript', 'bin', 'tsc')
if (!fs.existsSync(tscBin)) {
  console.error('[tests-typecheck] 找不到本地 typescript，先 pnpm install（不能拿 npx 现下载当判据）')
  process.exit(2)
}

const run = spawnSync(process.execPath, [tscBin, '-p', TSCONFIG, '--pretty', 'false'], {
  cwd: REPO,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
const out = `${run.stdout ?? ''}${run.stderr ?? ''}`

const LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/

/**
 * tsc 输出的路径口径不稳（项目文件多为相对 cwd，lib 与被链接进来的依赖是绝对路径，
 * 换平台还有反斜杠）。归属判定必须先归一化成"仓库相对 + 正斜杠"，
 * 否则同一份代码在 CI 上会把 tests/ 的错误认成"别处的"，门就变成了摆设。
 * 返回 null 表示这个路径根本在仓库外。
 */
function relToRepo(p) {
  const abs = path.isAbsolute(p) ? p : path.resolve(REPO, p)
  const rel = path.relative(REPO, abs).split(path.sep).join('/')
  return rel === '' || rel.startsWith('..') ? null : rel
}

const errors = []
for (const line of out.split(/\r?\n/)) {
  const m = LINE.exec(line)
  if (!m) continue
  const rel = relToRepo(m[1])
  errors.push({
    file: rel ?? m[1].replace(/\\/g, '/'),
    outsideRepo: rel === null,
    line: +m[2],
    col: +m[3],
    code: m[4],
    text: m[5],
  })
}

/**
 * 量具自证：tsc 非零退出却一条都没解析出来，说明是我的正则/编码坏了，
 * 不是"测试干净了"。这种时候必须报不出结论，而不是放行。
 */
if (errors.length === 0 && run.status !== 0) {
  console.error('[tests-typecheck] tsc 非零退出但没解析到任何错误行 —— 量具坏了，别当通过')
  console.error(out.slice(0, 2000))
  process.exit(2)
}

/**
 * 只管 tests/ 那一片，但要认得出"哪片都不是"。
 * src/ 是被测试顺着 import 拖进 program 的，那部分归 typecheck:node / typecheck:web 管
 * （口径不同：src 侧有环境声明文件补着），这里只报个数当提醒，不计进上限。
 * 两处都不在的（scripts/、根配置、仓库外路径）不能并进"顺带的 src 侧"糊过去——
 * 那两个 config 的 include 里根本没有它们，一旦放行就等于这批错误没人记账，所以 exit 2。
 */
const inTests = errors.filter((e) => e.file.startsWith('tests/'))
const inSrc = errors.filter((e) => !e.outsideRepo && !e.file.startsWith('tests/') && e.file.startsWith('src/'))
const unknownScope = errors.filter((e) => e.outsideRepo || (!e.file.startsWith('tests/') && !e.file.startsWith('src/')))
if (unknownScope.length > 0) {
  console.error(
    `[tests-typecheck] 出现了既不在 tests/ 也不在 src/ 的类型错误 ${unknownScope.length} 条 —— ` +
      `这道门的账只管这两片，别把它当"顺带的 src 侧"过去。要么把那片纳入独立闸，要么收紧 program 口径。`
  )
  for (const e of unknownScope.slice(0, 10)) console.error(`    ${e.file}:${e.line} ${e.code} ${e.text}`)
  process.exit(2)
}
const testsFiles = new Set(inTests.map((e) => e.file))

/**
 * 覆盖面自证：磁盘上 tests 目录里每个 .ts/.tsx 都必须在 tsc 真的读进去的那批文件里。
 * 少一个说明 tsconfig.tests.json 的 include/exclude 停止匹配某个子目录了——
 * 那时错误数只会越来越好看，最后这道门是对着一堆没人检查的文件报 0。
 */
function listTestFilesOnDisk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) listTestFilesOnDisk(p, acc)
    else if (/\.tsx?$/.test(e.name)) acc.push(relToRepo(p))
  }
  return acc
}
const diskTests = listTestFilesOnDisk(path.join(REPO, 'tests'), [])
const filesRun = spawnSync(process.execPath, [tscBin, '-p', TSCONFIG, '--listFilesOnly'], {
  cwd: REPO,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
if (filesRun.status !== 0) {
  console.error('[tests-typecheck] tsc --listFilesOnly 失败，无法自证覆盖面（不是"通过"）')
  console.error(`${filesRun.stdout ?? ''}${filesRun.stderr ?? ''}`.slice(0, 1500))
  process.exit(2)
}
const scannedTests = new Set(
  (filesRun.stdout ?? '')
    .split(/\r?\n/)
    .map((l) => relToRepo(l.trim()))
    .filter((f) => f !== null && f.startsWith('tests/'))
)
const neverScanned = diskTests.filter((f) => !scannedTests.has(f))
if (diskTests.length === 0 || scannedTests.size === 0 || neverScanned.length > 0) {
  console.error(
    `[tests-typecheck] 覆盖面坏了：磁盘 ${diskTests.length} 个测试文件，` +
      `tsc 实际读进 ${scannedTests.size} 个，没被读到的 ${neverScanned.length} 个。空清单和漏读都不算通过。`
  )
  for (const f of neverScanned.slice(0, 15)) console.error(`    未受检：${f}`)
  process.exit(2)
}

/**
 * `as never` 计数（走 AST，不是 grep）：注释里写"原先是 as never"不该算违规，
 * 真正的类型断言节点才算。这些位置在产品契约改了之后不会红，只会把新错误按住。
 */
let ts
try {
  ts = require('typescript')
} catch {
  console.error('[tests-typecheck] 拿不到本地 typescript，as never 计数无法执行（不是"计数为 0"）')
  process.exit(2)
}
let asNever = 0
const asNeverHits = []
for (const rel of diskTests) {
  const text = fs.readFileSync(path.join(REPO, rel), 'utf8')
  const src = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true)
  const visit = (node) => {
    const isAssertion = ts.isAsExpression(node) || node.kind === ts.SyntaxKind.TypeAssertionExpression
    if (isAssertion && node.type && node.type.kind === ts.SyntaxKind.NeverKeyword) {
      asNever++
      asNeverHits.push(`${rel}:${src.getLineAndCharacterOfPosition(node.getStart()).line + 1}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(src)
}

const byCode = new Map()
const byFile = new Map()
for (const e of errors) {
  byCode.set(e.code, (byCode.get(e.code) ?? 0) + 1)
  byFile.set(e.file, (byFile.get(e.file) ?? 0) + 1)
}
const sorted = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])

console.log(
  `[tests-typecheck] tests/ 类型错误 ${inTests.length} 条 / 上限 ${CAP} / 涉及 ${testsFiles.size} 个文件` +
    `（tsc 退出码 ${run.status}；受检 ${scannedTests.size}/${diskTests.length} 个测试文件` +
    `${inSrc.length > 0 ? `；顺带带出 src 侧 ${inSrc.length} 条，归 typecheck:node/web 管` : ''}）`
)
console.log(
  `  as never（AST）${asNever} 处 / 上限 ${AS_NEVER_CAP}；错误码分布 top${top}: ` +
    sorted(byCode).slice(0, top).map(([k, v]) => `${k}=${v}`).join(' ')
)
console.log(`  文件 top${top}: ${sorted(byFile).slice(0, top).map(([k, v]) => `${path.basename(k)}=${v}`).join(' ')}`)
if (inTests.length > CAP) {
  console.log(`  tests/ 里的错误（前 20 条）：`)
  for (const e of inTests.slice(0, 20)) console.log(`    ${e.file}:${e.line}:${e.col} ${e.code} ${e.text}`)
}
if (asNever > AS_NEVER_CAP) console.log(`  新增的 as never：${asNeverHits.slice(AS_NEVER_CAP).join(' ')}`)

if (jsonOut) {
  const abs = path.resolve(REPO, jsonOut)
  if (abs.startsWith(REPO + path.sep)) {
    console.error('[tests-typecheck] --json 的目标在仓库内：明细里带源码路径与消息，别把它提交上去')
    process.exit(2)
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(
    abs,
    JSON.stringify(
      {
        cap: CAP,
        total: inTests.length,
        srcSideTotal: inSrc.length,
        asNeverCap: AS_NEVER_CAP,
        asNever,
        scannedTestFiles: scannedTests.size,
        diskTestFiles: diskTests.length,
        errors: inTests,
      },
      null,
      2
    ),
    'utf8'
  )
  console.log(`  明细已写到仓库外：${abs}`)
}

if (inTests.length > CAP) {
  console.error(
    `[tests-typecheck] FAIL：tests/ 比上限多 ${inTests.length - CAP} 条。要么改掉新增的那几条，` +
      `要么在文件头写清为什么存量必须涨（不许只改数字）。`
  )
  process.exit(1)
}
if (asNever > AS_NEVER_CAP) {
  console.error(
    `[tests-typecheck] FAIL：as never 比上限多 ${asNever - AS_NEVER_CAP} 处（${asNeverHits.slice(AS_NEVER_CAP).join(' ')}）。` +
      `它把"夹具形状和产品契约不一致"这句话按住了——见本文件头第七族那一段。按真实类型收窄，别加新的一处。`
  )
  process.exit(1)
}
process.exit(0)
