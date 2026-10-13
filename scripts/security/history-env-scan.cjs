#!/usr/bin/env node
/**
 * history-env-scan.cjs — 历史凭据回归闸：核对 .env.local 里的真值没有再出现在 git 历史中
 *
 * 为什么不是 secret-gate.cjs --all：那个闸只扫【已跟踪文件的当前内容】，按"形态"匹配，
 * 从不读 git 历史。2026-10-04 那份改写脚本把它的 --all 当成"扫全量历史"用，
 * 于是即便历史里还留着 root 口令，自检照样报 PASS ——一个不会失败的闸等于放行证。
 *
 * 本闸按"值"匹配（值从 .env.local 读，永不写进源码），命中的必是我们自己的真凭据，
 * 因此没有形态匹配那一类误报，可以放心让它红。
 *
 * 用法：
 *   node scripts/security/history-env-scan.cjs                 扫全历史（所有 ref）
 *   node scripts/security/history-env-scan.cjs --control <串>   阳性对照：证明扫描器扫得到东西
 *   node scripts/security/history-env-scan.cjs --values <路径>  换 env 值来源（测试用）
 *   node scripts/security/history-env-scan.cjs --anchor <路径>  换申报密钥文件（测试用）
 *   node scripts/security/history-env-scan.cjs --max-revs <N>   只扫最近 N 个提交树（结论会标注部分扫描）
 *
 * 无 .env.local / 无 git / 未知参数 / 申报文件解析不出值 → 一律 exit 1（fail-closed，不静默放行）。
 * 申报文件不存在是唯一允许的降级，且会打印"API 口令不在核对面内"。
 * 报告只出现文件路径与计数，绝不打印值本身。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const argv = process.argv.slice(2)
const controlIdx = argv.indexOf('--control')
const control = controlIdx < 0 ? null : argv[controlIdx + 1]
if (controlIdx >= 0 && !control) {
  console.error('--control 后面必须给一个已知存在于历史里的串（阳性对照）')
  process.exit(1)
}
const allowed = new Set(['--control', '--values', '--anchor', '--max-revs'])
if (control) allowed.add(control)
const unknown = argv.filter((a) => a.startsWith('-') && !allowed.has(a))
if (unknown.length) {
  console.error(
    '未知参数：' + unknown.join(' ') + '（只支持 --control <串>、--values <路径>、--anchor <路径> 与 --max-revs <N>）'
  )
  process.exit(1)
}

/**
 * --max-revs N：只扫最近 N 个提交树（判据测试用，全史一趟 13s）。
 *
 * 必须是正整数，且**用了它就必须在结论里写明是部分扫描**——
 * 部分扫描读成 CLEAN 等于一张放行证（同 --traked 那次拼错还照样 PASS 的教训）。
 */
const maxRevsIdx = argv.indexOf('--max-revs')
const maxRevsRaw = maxRevsIdx < 0 ? null : argv[maxRevsIdx + 1]
let maxRevs = 0
if (maxRevsIdx >= 0) {
  if (!maxRevsRaw || !/^[1-9][0-9]*$/.test(maxRevsRaw)) {
    console.error('--max-revs 必须是一个正整数，收到：' + (maxRevsRaw === undefined ? '（空）' : maxRevsRaw))
    process.exit(1)
  }
  maxRevs = Number(maxRevsRaw)
}

/** --values / --anchor：取参数值；缺值即红，不许悄悄退回默认路径 */
function optValue(flag) {
  const i = argv.indexOf(flag)
  if (i < 0) return null
  const v = argv[i + 1]
  if (!v || v.startsWith('-')) {
    console.error(flag + ' 后面必须跟一个路径')
    process.exit(1)
  }
  return v
}

const repo = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim()
if (!repo) {
  console.error('取不到 git 仓库根目录')
  process.exit(1)
}

const envPath = optValue('--values') || path.join(repo, '.env.local')
if (!fs.existsSync(envPath)) {
  console.error('缺少 ' + envPath + ' —— 无法核对真值，拒绝放行（fail-closed）')
  process.exit(1)
}

// 只取"口令类"的键。故意不含 HOST/USER：主机 IP 是拓扑信息不是凭据，
// 且它仍合法出现在若干已跟踪文件里（内网 RFC1918 地址，用户 2026-10-04 裁定可接受），
// 把它们算进来会让本闸长期红，而长期红的闸等于没有闸。
const SECRET_KEY = /(^|_)(PASSWORD|PASSPHRASE|SECRET|TOKEN|KEY)(_|$)/i
const values = []
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const eq = line.indexOf('=')
  if (eq < 0 || line.startsWith('#')) continue
  const key = line.slice(0, eq).trim()
  const val = line.slice(eq + 1).trim()
  if (val.length < 4) continue
  if (!SECRET_KEY.test(key)) continue
  values.push({ key, val })
}
if (!values.length) {
  console.error(envPath + ' 里没识别到任何凭据键（键名规则见 SECRET_KEY），拒绝放行')
  process.exit(1)
}

/**
 * 第二路锚点：申报制的额外密钥（主要是模型 API 口令）。
 *
 * 为什么需要：应用把口令存在 userData 的 secure-storage.json 里，且是 safeStorage
 * 加密的（v10 封套），Node 脚本读不到明文 ⇒ .env.local 那一路锚不到它。
 * 于是"历史里没有我的 API 口令"这句话原本没有执行体：它只是没被核对过。
 * 这里让开发者把口令写进仓库根的 .secrets-anchor.local.json（已 gitignore），
 * 本闸按值去全历史核对。文件不存在时【大声跳过】，而不是假装干净。
 *
 * 格式：JSON 数组 ["<口令>", ...] 或对象 {"名字": "<口令>", ...}；值长度 ≥6 才收。
 * 存在却解析不出任何值 → 红（申报了却没核对 = 放行证）。
 */
const anchorPath = optValue('--anchor') || path.join(repo, '.secrets-anchor.local.json')
let declaredAnchors = 0
if (fs.existsSync(anchorPath)) {
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(anchorPath, 'utf8'))
  } catch (e) {
    console.error(anchorPath + ' 不是合法 JSON：' + e.message)
    process.exit(1)
  }
  const entries = Array.isArray(parsed)
    ? parsed.map((v, i) => ['anchor[' + i + ']', v])
    : Object.entries(parsed || {})
  let declared = 0
  for (const [key, val] of entries) {
    if (typeof val !== 'string' || val.trim().length < 6) continue
    values.push({ key: '申报:' + key, val: val.trim() })
    declared++
  }
  if (!declared) {
    console.error(anchorPath + ' 存在，但里面没有任何长度 ≥6 的申报值 —— 申报了就要核得动')
    process.exit(1)
  }
  declaredAnchors = declared
  console.log('申报密钥 ' + declared + ' 条纳入核对（来自 ' + path.basename(anchorPath) + '）')
} else {
  console.log(
    '⚠️ 未申报额外密钥（' +
      path.basename(anchorPath) +
      ' 不存在）：模型 API 口令不在本闸核对面内。要纳入核对，把口令写进该文件（已在 .gitignore 里）'
  )
}

function git(args) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
  if (r.error || r.status === undefined) {
    console.error('git ' + args[0] + ' 启动失败：' + (r.error ? r.error.message : ''))
    process.exit(1)
  }
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
const lines = (s) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)

// 全历史 blob 扫描：把 rev 分批传给 git grep（一次全给会在提交数上千时撞 Windows 命令行上限，
// 撞了之后 git 报错、grep 无命中，就会被当成"干净"放行 —— 那正是本闸要防的事）
function scanHistory(pattern) {
  const patFile = path.join(require('os').tmpdir(), 'tdsf-history-env-scan.pat')
  fs.writeFileSync(patFile, pattern + '\n', 'utf8')
  let revs = lines(git(['rev-list', '--all']).out)
  if (maxRevs && revs.length > maxRevs) revs = revs.slice(0, maxRevs)
  const hits = []
  try {
    const BATCH = 100
    for (let i = 0; i < revs.length; i += BATCH) {
      const chunk = revs.slice(i, i + BATCH)
      const r = git(['grep', '-l', '-F', '-f', patFile, ...chunk])
      // git grep：0=有命中 1=无命中 其它=真出错，必须当失败抛出
      if (r.code !== 0 && r.code !== 1) {
        console.error('git grep 异常退出 ' + r.code + '：' + r.out.slice(0, 200))
        process.exit(1)
      }
      hits.push(...lines(r.out))
    }
  } finally {
    fs.unlinkSync(patFile)
  }
  return { hits, revCount: revs.length }
}

const refs = lines(git(['for-each-ref', '--format=%(refname)']).out)
if (!refs.length) {
  console.error('仓库没有任何 ref，扫描无意义')
  process.exit(1)
}

if (control) {
  const { hits, revCount } = scanHistory(control)
  console.log('[阳性对照] 命中 ' + hits.length + ' 处 / 扫了 ' + revCount + ' 个提交树')
  if (!hits.length) {
    console.error('对照串在历史里必然存在却 0 命中 ⇒ 扫描器本身失效，本次结果不可信')
    process.exit(1)
  }
  console.log('结论: 扫描器可用 ✅')
  process.exit(0)
}

let bad = 0
for (const { key, val } of values) {
  const { hits, revCount } = scanHistory(val)
  const files = [...new Set(hits.map((s) => s.split(':').slice(1).join(':')))]
  if (hits.length) {
    bad++
    console.log('❌ ' + key + ' 出现在历史 ' + hits.length + ' 个提交树，文件：' + files.join(', '))
  } else {
    console.log('✅ ' + key + ' 在已扫的 ' + revCount + ' 个提交树里 0 命中')
  }
}

const scopeNote = maxRevs ? '（部分扫描：只核了最近 ' + maxRevs + ' 个提交树，不代表全历史）' : ''
console.log('\n核对键数 = ' + values.length + '（env ' + (values.length - declaredAnchors) + ' + 申报 ' + declaredAnchors + '），ref 数 = ' + refs.length + scopeNote)
if (bad) {
  console.error('结论: ' + bad + ' 个凭据真值仍可在 git 历史中读到（上面只列键名与文件，值未打印）')
  process.exit(1)
}
console.log('结论: CLEAN' + scopeNote + ' —— 已核对的 ' + values.length + ' 个凭据值都不在核过的历史里')
if (!declaredAnchors) {
  console.log('（覆盖面说明：本次只核对了 env 里的口令，模型 API 口令未申报、未核对）')
}
