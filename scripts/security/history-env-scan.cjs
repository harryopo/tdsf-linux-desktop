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
 *
 * 无 .env.local / 无 git / 未知参数 → 一律 exit 1（fail-closed，不静默放行）。
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
const allowed = new Set(['--control'])
if (control) allowed.add(control)
const unknown = argv.filter((a) => a.startsWith('-') && !allowed.has(a))
if (unknown.length) {
  console.error('未知参数：' + unknown.join(' ') + '（只支持 --control <串>）')
  process.exit(1)
}

const repo = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim()
if (!repo) {
  console.error('取不到 git 仓库根目录')
  process.exit(1)
}

const envPath = path.join(repo, '.env.local')
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
  console.error('.env.local 里没识别到任何凭据键（键名规则见 SECRET_KEY），拒绝放行')
  process.exit(1)
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
  const revs = lines(git(['rev-list', '--all']).out)
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
    console.log('✅ ' + key + ' 全历史 0 命中（' + revCount + ' 个提交树）')
  }
}

console.log('\n核对键数 = ' + values.length + '，ref 数 = ' + refs.length)
if (bad) {
  console.error('结论: ' + bad + ' 个 env 真值仍可在 git 历史中读到')
  process.exit(1)
}
console.log('结论: CLEAN —— .env.local 的凭据值都不在 git 历史里')
