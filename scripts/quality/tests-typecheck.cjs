#!/usr/bin/env node
/**
 * tests/ 的类型检查闸（只降不升的 ratchet）
 *
 * 为什么要有这道门：`tsconfig.node.json` 与 `tsconfig.web.json` 的 include 都不含 tests/，
 * `npm run lint` 只扫 src，`.git/hooks/pre-commit` 只跑密钥/拓扑/协作三闸——
 * 也就是说 2900 条测试**从来没有被类型检查过**。产品改了字段名，测试不会红，
 * 它会继续用旧形状构造对象、断言一个不存在的东西，然后绿着。
 *
 * 为什么不是一次性清零：实测存量 200 条，分布在 70 个文件，大头是
 * "把 Page 变量命名成 window，evaluate 回调里的 window.location 被解析成 Page 的属性"
 * 与"可能为空没兜住"两类。批量改 70 个测试文件的风险（改坏断言、静默弱化判据）
 * 大于收益，所以先把口子扎住：**存量记账，新增即红**，之后每轮往下削一点。
 *
 * 用法：
 *   node scripts/quality/tests-typecheck.cjs              跑闸（超上限 exit 1）
 *   node scripts/quality/tests-typecheck.cjs --top 12     多看几条错误明细
 *   node scripts/quality/tests-typecheck.cjs --json p     另存明细（p 必须在仓库外）
 * 未知参数一律 exit 2：默认分支是"读文件/写报告"，打错一个字母就等于悄悄放行。
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
 * 是那条用例把它红的（改 .call(process, ...)）。→ **51 条 / 34 个文件**。
 * 往下改要连着做两件事：改测试 + 把这里改成新数（别留旧数当"还有余量"）。
 */
const CAP = 51

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
const errors = []
for (const line of out.split(/\r?\n/)) {
  const m = LINE.exec(line)
  if (!m) continue
  errors.push({ file: m[1].replace(/\\/g, '/'), line: +m[2], col: +m[3], code: m[4], text: m[5] })
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

const byCode = new Map()
const byFile = new Map()
for (const e of errors) {
  byCode.set(e.code, (byCode.get(e.code) ?? 0) + 1)
  byFile.set(e.file, (byFile.get(e.file) ?? 0) + 1)
}
const sorted = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])

/**
 * 只管 tests/ 那一片。测试会顺着 import 把 src 也拖进 program，
 * 那部分的错归 typecheck:node / typecheck:web 管（口径不同：src 侧有环境声明文件补着），
 * 这里只报个数当提醒，不计进上限——否则这道门会去管别人的账。
 */
const inTests = errors.filter((e) => e.file.startsWith('tests/'))
const inSrc = errors.length - inTests.length
const verdict = inTests.length <= CAP
console.log(
  `[tests-typecheck] tests/ 类型错误 ${inTests.length} 条 / 上限 ${CAP} / 涉及 ${byFile.size} 个文件` +
    `（tsc 退出码 ${run.status}${inSrc > 0 ? `；顺带带出 src 侧 ${inSrc} 条，归 typecheck:node/web 管` : ''}）`
)
console.log(`  错误码分布 top${top}: ${sorted(byCode).slice(0, top).map(([k, v]) => `${k}=${v}`).join(' ')}`)
console.log(`  文件 top${top}: ${sorted(byFile).slice(0, top).map(([k, v]) => `${path.basename(k)}=${v}`).join(' ')}`)
if (!verdict) {
  console.log(`  tests/ 里的错误（前 20 条）：`)
  for (const e of inTests.slice(0, 20)) console.log(`    ${e.file}:${e.line}:${e.col} ${e.code} ${e.text}`)
}

if (jsonOut) {
  const abs = path.resolve(REPO, jsonOut)
  if (abs.startsWith(REPO + path.sep)) {
    console.error('[tests-typecheck] --json 的目标在仓库内：明细里带源码路径与消息，别把它提交上去')
    process.exit(2)
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(
    abs,
    JSON.stringify({ cap: CAP, total: inTests.length, srcSideTotal: inSrc, errors: inTests }, null, 2),
    'utf8'
  )
  console.log(`  明细已写到仓库外：${abs}`)
}

if (!verdict) {
  console.error(
    `[tests-typecheck] FAIL：tests/ 比上限多 ${inTests.length - CAP} 条。要么改掉新增的那几条，` +
      `要么在文件头写清为什么存量必须涨（不许只改数字）。`
  )
  process.exit(1)
}
process.exit(0)
