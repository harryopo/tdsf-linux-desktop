#!/usr/bin/env node
/**
 * doc-links.cjs — 文档内部链接完整性闸（断链就红）
 *
 * 为什么现在要它：2026-10-18 仓库公开前把 174 份内部文档取消跟踪，
 * 当场量出 docs/INDEX.md 50 条引用里 47 条断、AGENTS.md 5 条全断、CLAUDE.md 4 条全断。
 * 这种断链不是写错的，是**搬完文档没人回头对链接**——每次搬目录都会重演一次，
 * 而公开仓的首页指着 47 个 404 是门面事故。所以钉成常驻闸，不靠下一次记得。
 *
 * 用法：
 *   node scripts/quality/doc-links.cjs                扫全部已入库 markdown，有断链 exit 1
 *   node scripts/quality/doc-links.cjs --self-test    阳性对照：注入一条必断的链接，必须被抓到
 *   node scripts/quality/doc-links.cjs --json         机器可读输出
 *
 * 判定口径（写死在这里，别猜）：
 *   - 只看真正的 markdown 链接 [文本](目标) 与图片 ![alt](目标)；
 *     行内代码里的路径不算（`docs/**` 这种 glob 和示例路径会制造大量假阳性）。
 *   - 跳过 http(s)/mailto/data/#锚点/以 / 开头的绝对路径。
 *   - 目标解析后必须落在仓库内且在 git 跟踪集里 —— 未跟踪 = 对访客不存在 = 断。
 *   - 指向仓库外（../../ 逃出去）单独一类报出来：本机看得到、访客永远看不到。
 *   - 围栏代码块（``` 与 ~~~）内的链接不判：那是示例，不是承诺。
 *   - 未知参数一律 exit 2（fail-closed，不许退到默认分支照样打印 PASS）。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const argv = process.argv.slice(2)
const SELF_TEST = argv.includes('--self-test')
const AS_JSON = argv.includes('--json')
const unknown = argv.filter((a) => a.startsWith('-') && a !== '--self-test' && a !== '--json')
if (unknown.length) {
  console.error('未知参数：' + unknown.join(' ') + '（只支持 --self-test 与 --json）')
  process.exit(2)
}

const repo = (spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout || '').trim()
if (!repo) {
  console.error('取不到仓库根目录（不在 git 仓库里？）')
  process.exit(2)
}

function trackedFiles() {
  const r = spawnSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20 })
  if (r.status !== 0) {
    console.error('git ls-files 失败：' + (r.stderr || '').trim())
    process.exit(2)
  }
  return new Set(r.stdout.split(/\r?\n/).filter(Boolean))
}

const LINK_RE = /!?\[[^\]]*\]\(\s*<?([^<>()\s]+)>?(?:\s+["'][^"']*["'])?\s*\)/g

/**
 * 一个链接目标的归类
 * @returns {{kind:'ok'|'dead'|'outside'|'skip', target:string}}
 */
function classify(fromFile, rawTarget, tracked) {
  const t = rawTarget.trim()
  if (!t) return { kind: 'skip', target: t }
  if (/^(https?:|mailto:|data:|ftp:|#)/i.test(t)) return { kind: 'skip', target: t }
  const clean = t.split('#')[0].split('?')[0]
  if (!clean) return { kind: 'skip', target: t }
  if (clean.startsWith('/')) return { kind: 'outside', target: clean }
  const abs = path.resolve(repo, path.dirname(fromFile), clean)
  const rel = path.relative(repo, abs).split(path.sep).join('/')
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { kind: 'outside', target: rel }
  return tracked.has(rel) ? { kind: 'ok', target: rel } : { kind: 'dead', target: rel }
}

/** 扫一份 markdown：跳过围栏代码块内的链接 */
function scanDoc(fromFile, text, tracked) {
  const out = []
  const lines = text.split(/\r?\n/)
  let fence = null
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const m = /^\s*(```+|~~~+)/.exec(line)
    if (m) {
      const mark = m[1][0]
      if (fence === null) fence = mark
      else if (fence === mark) fence = null
      continue
    }
    if (fence !== null) continue
    for (const hit of line.matchAll(LINK_RE)) {
      const c = classify(fromFile, hit[1], tracked)
      if (c.kind === 'dead' || c.kind === 'outside') out.push({ file: fromFile, line: i + 1, kind: c.kind, target: c.target })
    }
  }
  return out
}

/** 阳性对照：一把必断的链接，量具抓不到就说明它自己是死的 */
function selfTest(tracked) {
  const probe = 'PROBE.md'
  const bad = [
    '[断到仓库里没跟踪的地方](docs/definitely-not-a-real-file-9f3c2a.md)',
    '[逃到仓库外面](../../outside-host-file.md)',
    '[活的](README.md)',
    '不判它：`docs/no-glob-check.md` 与 [锚点](#标题) 与 [外链](https://example.com/a.md)',
    '```',
    '[围栏里的不判](docs/inside-fence-dead.md)',
    '```',
  ].join('\n')
  const hits = scanDoc(probe, bad, tracked)
  const dead = hits.filter((h) => h.kind === 'dead').map((h) => h.target)
  const outside = hits.filter((h) => h.kind === 'outside').map((h) => h.target)
  const problems = []
  if (!dead.includes('docs/definitely-not-a-real-file-9f3c2a.md')) problems.push('没抓到该抓的断链')
  if (!outside.length) problems.push('没抓到该抓的"指向仓库外"')
  if (dead.includes('README.md')) problems.push('把活链误报成断链')
  if (dead.some((d) => d.includes('no-glob-check') || d.includes('inside-fence') || d.includes('example.com')))
    problems.push('误判了不该判的东西（行内代码/围栏/外链/锚点）')
  console.log('[doc-links] 自检：抓到断链 ' + dead.length + ' 条、仓库外 ' + outside.length + ' 条，误报 0 才算通过')
  if (problems.length) {
    console.error('[doc-links] 量具失效：\n  - ' + problems.join('\n  - '))
    process.exit(1)
  }
  console.log('[doc-links] 自检 OK')
  process.exit(0)
}

const tracked = trackedFiles()
if (!tracked.size) {
  console.error('[doc-links] git 跟踪集是空的，扫描无意义')
  process.exit(2)
}
if (SELF_TEST) selfTest(tracked)

const docs = [...tracked].filter((f) => /\.md$/i.test(f))
if (!docs.length) {
  console.error('[doc-links] 跟踪集里没有一份 markdown，这条闸等于没有')
  process.exit(2)
}

const findings = []
for (const f of docs) {
  let text
  try {
    text = fs.readFileSync(path.join(repo, f), 'utf8')
  } catch {
    continue
  }
  findings.push(...scanDoc(f, text, tracked))
}

const dead = findings.filter((h) => h.kind === 'dead')
const outside = findings.filter((h) => h.kind === 'outside')

if (AS_JSON) {
  console.log(JSON.stringify({ docs: docs.length, dead, outside }, null, 2))
} else {
  const byTarget = new Map()
  for (const h of findings) {
    const k = h.kind + ' ' + h.target
    if (!byTarget.has(k)) byTarget.set(k, [])
    byTarget.get(k).push(h.file + ':' + h.line)
  }
  for (const [k, where] of [...byTarget].sort()) {
    console.log('  ' + k + '   ← ' + where.slice(0, 4).join(', ') + (where.length > 4 ? ' 等 ' + where.length + ' 处' : ''))
  }
  console.log(
    '[doc-links] 扫了 ' + docs.length + ' 份已入库 markdown：断链 ' + dead.length + ' 处、指向仓库外 ' + outside.length + ' 处'
  )
}

if (dead.length) {
  console.error('\n结论: FAIL —— 有 ' + dead.length + ' 处链接指向仓库里不存在或未跟踪的文件（访客点开就是 404）')
  process.exit(1)
}
console.log('结论: PASS —— 全部已入库 markdown 的相对链接都落在跟踪集里')
