#!/usr/bin/env node
/**
 * topology-gate.cjs — 内网拓扑值回归闸（把 §A5 的判据变成真会失败的闸）
 *
 * 为什么需要它：计划 §A5 写的判据是「secret-gate.cjs --all 命中 0」，
 * 但那个闸只有【形态】规则（PEM、厂商 token 前缀、带引号的口令赋值），
 * 一条 IP 规则都没有 ⇒ 无论代码里有没有把虚拟机地址抄回去，它都恒报 0 命中。
 * 一个不会失败的闸等于放行证（同 2026-10-08 那两轮 D4 / C 基准的发现）。
 *
 * 本闸按【值】匹配：锚定值从值文件（默认仓库根 .env.local）的 HOST 类键读，仓库里不存真值。
 * 两条腿，扫描面不同：
 * - 代码腿：只扫【已跟踪代码】。锚定值来自本机 .env.local，仓库里不存真值，所以代码腿永远
 *   要求 0 命中；2026-10-04 曾裁定"RFC1918 留在内部文档里可接受"，那条豁免是给文档的，不是给代码的。
 * - 文档腿（2026-10-17 加）：内网地址出现在已入库 markdown 里的数量闸，原先钉 11 行存量。
 *   2026-10-18 公开仓收口把那批内部文档全部取消跟踪后，上限改钉 0——公开仓不该有任何内网地址。
 *   上限仍是"数量"而不是"存在性"：真要回暖和豁免，改这一个常量并在评审里说明，别把腿拆掉。
 *   （history-env-scan.cjs 同样只核【已入库】这一面，模型密钥在 SecureStore 里，结构上不进仓。）
 *
 * 用法：
 *   node scripts/security/topology-gate.cjs                  用仓库根的 .env.local
 *   node scripts/security/topology-gate.cjs --values <路径>   指定值来源（测试与 CI 用）
 *   node scripts/security/topology-gate.cjs --control <串>    阳性对照：该串必须命中，否则闸是死的
 *   node scripts/security/topology-gate.cjs --no-values-ok    无值时大声跳过（pre-commit 用，见 install-hooks.cjs）
 *
 * 参数名不能叫 --env-file：那是 node 自己的内置开关，会被 node 先吃掉（实测 rc=9，根本进不到本脚本）。
 * 未知参数 / git 异常 → 一律 exit 1（fail-closed，不静默放行）。
 * 无值文件与无锚定值默认也 exit 1；只有 --no-values-ok 才降级为"跳过"，且结论写 SKIPPED 不写 CLEAN。
 * 报告只出现文件、行号、键名和掩码后的值，绝不打印真值。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

function fail(msg) {
  console.error('[topology-gate] ' + msg)
  process.exit(1)
}

/** 只锚定「主机地址」这一族键。用户名不锚：真值常是 root 这类短词，扫代码必然淹没在误报里 */
const HOST_KEY = /(^|_)HOSTS?(_|$)/i

/** 明显是占位而不是真值的形状 */
const PLACEHOLDER_RE =
  /placeholder|sample|example|dummy|fake|changeme|replace|your[-_]|xxx+|\*{3,}|<[^>]*>|\$\{|process\.env|import\.meta|REDACTED/i

/**
 * 值能不能当锚点
 *
 * 短值会淹没在误报里。7 字符下限覆盖 IPv4 最短真值（1.1.1.1 就是 7），又排掉绝大多数标识符；
 * 真要把短值管起来，应该按具体键名单加，而不是放低阈值。
 */
function isAnchorable(val) {
  if (val.length < 7) return false
  if (PLACEHOLDER_RE.test(val)) return false
  return true
}

/** 扫描面：只扫代码，不扫文档与本闸自身（自身注释里会出现 IP 这个词，但不含真值） */
const CODE_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|json|py|sh|ya?ml|toml|properties)$/
const EXCLUDE_RE = /(^|\/)(docs|\.claude|node_modules)\//
const SELF = /topology-gate\.cjs$/

/**
 * 在一段文本里找串，逐行给行号
 *
 * 纯函数、单独导出，是为了让单测能塞已知的坏样本（证伪用），不必往仓库里写临时脏文件。
 */
function scanText(file, text, needle) {
  const hits = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].indexOf(needle) >= 0) hits.push({ file, line: i + 1 })
  }
  return hits
}

function scanContents(items, needle) {
  const hits = []
  for (const it of items) {
    if (typeof it.content !== 'string') continue
    hits.push(...scanText(it.file, it.content, needle))
  }
  return hits
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** 这个值是不是 RFC1918 私网地址（只有它值得推出网段；公网 IP 当锚点时推网段没有意义） */
function isPrivateIpv4(v) {
  const m = IPV4_RE.exec(v)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  return a === 172 && b >= 16 && b <= 31
}

/**
 * 从锚定值推出它所在的 /24 前缀（"192.168.45." 这种）。
 *
 * 为什么要推网段而不是只钉那一个值：闸原先只按精确值匹配，于是实验机同段的
 * 网关 .2 与广播 .255 大摇大摆留在代码里，闸一路报 CLEAN——**钉一个值等于只防那一个值**。
 * 泄露一个内网地址真正暴露的是"这张网长什么样"，所以按段判。
 */
function subnetPrefixes(values) {
  const out = new Set()
  for (const v of values) {
    const m = IPV4_RE.exec(v)
    if (!m || !isPrivateIpv4(v)) continue
    out.add(m[1] + '.' + m[2] + '.' + m[3] + '.')
  }
  return [...out].sort()
}

/** 按 /24 前缀扫：命中"同段任意地址"，并把命中的到底是哪个地址的结构报出来（不报完整值） */
function scanContentsSubnet(items, prefix) {
  const re = new RegExp(prefix.replace(/\./g, '\\.') + '\\d{1,3}', 'g')
  const hits = []
  for (const it of items) {
    if (typeof it.content !== 'string') continue
    const lines = it.content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const m = lines[i].match(re)
      if (m) hits.push({ file: it.file, line: i + 1, lastOctet: m[0].slice(prefix.length) })
    }
  }
  return hits
}

function mask(value) {
  if (value.length <= 8) return '****(len' + value.length + ')'
  return value.slice(0, 3) + '****' + value.slice(-2) + '(len' + value.length + ')'
}

/**
 * 参数白名单解析：未知参数必须报错退出，不能落到默认分支继续跑
 * （2026-10-04 那次把 --tracked 拼成 --traked，脚本照样跑完并打印 PASS，就是这种默认分支留下的放行证）
 */
function parseArgs(argv) {
  const out = { values: null, control: null, noValuesOk: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--values' || a === '--control') {
      const val = argv[i + 1]
      if (!val || val.startsWith('-')) fail(a + ' 后面必须跟一个值')
      if (a === '--values') out.values = val
      else out.control = val
      i += 1
    } else if (a === '--no-values-ok') {
      out.noValuesOk = true
    } else if (a.startsWith('-')) {
      fail('未知参数：' + a + '（只支持 --values <路径>、--control <串> 与 --no-values-ok）')
    } else {
      fail('不接受位置参数：' + a)
    }
  }
  return out
}

function runGit(args) {
  const r = spawnSync('git', args, { encoding: 'utf8' })
  if (r.error || r.status === undefined) {
    fail('git ' + args[0] + ' 启动失败：' + (r.error ? r.error.message : '未知'))
  }
  if (r.status !== 0) {
    fail('git ' + args[0] + ' 退出码 ' + r.status + '：' + String(r.stderr || '').slice(0, 200))
  }
  return r.stdout
}

/**
 * 文档腿：内网地址在已入库 markdown 里的命中行数上限
 *
 * 2026-10-04 定的是 11（"RFC1918 留在内部文档可接受"），因为那时 docs/ 下 287 份内部文档都入库。
 * 2026-10-18 仓库要公开，那批文档已取消跟踪（archive/competition/handoff/reports 等），
 * 现量命中 **0 行** ⇒ 上限跟着降到 0：旧的豁免对象已经不在扫描面里，留着 11 就是
 * 给"往公开文档里写内网地址"预留 11 行的空子（地板不随掏空重算，等于没闸）。
 */
const DOCS_HIT_CAP = 0
/** 扫描面：所有已入库 markdown（含根目录 README/AGENTS 与 docs/**），不含代码——代码那条腿已经管住了 */
const DOCS_SPEC = ['--', '*.md', 'docs']

/**
 * 数一个锚定值在文档里命中多少行
 *
 * 走 git grep -c（按行、纯串匹配）而不是把 287 份文档读进 Node：这条闸挂在提交钩子上，每次都跑。
 * 不带版本号＝扫工作树，所以"这次就要提交的新文档"当场算数，不会拖到下一次红。
 */
function countInDocs(repo, val) {
  const r = spawnSync('git', ['grep', '-c', '-F', val, ...DOCS_SPEC], { cwd: repo, encoding: 'utf8' })
  if (r.error) fail('git grep 启动失败：' + r.error.message)
  // 1 = 没命中，这是合法结果不是错误；其它非 0 才是真失败
  if (r.status !== 0 && r.status !== 1) {
    fail('git grep 退出码 ' + r.status + '：' + String(r.stderr || '').slice(0, 200))
  }
  let lines = 0
  let files = 0
  for (const l of String(r.stdout || '').split(/\r?\n/)) {
    const m = l.match(/^(.+?):(\d+)$/)
    if (!m) continue
    files++
    lines += Number(m[2])
  }
  return { lines, files }
}

/**
 * 读锚定值。返回 null 表示"这台机器没有可锚定的真值"，只在 opts.noValuesOk 时发生。
 *
 * 为什么留这个口子：本闸按【值】比对，值来自开发者自己的 .env.local（不入库）。
 * 新克隆没有这个文件，此时默认红等于给全仓库发一张永久红灯——而红到没人跑的闸就是没有闸。
 * 所以 hook 传 --no-values-ok：没值就大声跳过，但结论只能写 SKIPPED，不许写 CLEAN。
 * 有值的时候这个开关不改变任何判定（缺值 ≠ 值不存在于代码里）。
 */
function loadAnchors(envPath, noValuesOk) {
  if (!fs.existsSync(envPath)) {
    if (noValuesOk) {
      console.log('[topology-gate] 跳过：值来源 ' + envPath + ' 不存在，本机没有可锚定的内网地址')
      return null
    }
    fail('缺少值来源 ' + envPath + ' —— 没有真值就无法核对，拒绝放行（fail-closed）')
  }
  const anchors = []
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const eq = line.indexOf('=')
    if (eq < 0 || line.trimStart().startsWith('#')) continue
    const key = line.slice(0, eq).trim()
    const val = line.slice(eq + 1).trim()
    if (!HOST_KEY.test(key)) continue
    if (!isAnchorable(val)) continue
    anchors.push({ key, val })
  }
  if (!anchors.length) {
    if (noValuesOk) {
      console.log('[topology-gate] 跳过：' + envPath + ' 里没有可锚定的 HOST 值（键名规则 ' + HOST_KEY + '，长度 ≥7，非占位）')
      return null
    }
    fail(envPath + ' 里没有可锚定的 HOST 值（键名规则 ' + HOST_KEY + '，长度 ≥7，非占位）')
  }
  return anchors
}

/** 取被跟踪文件的当前工作树内容；读不到（二进制等）给 null，由 scanContents 跳过 */
function collectScanSet(repoRoot) {
  const files = runGit(['ls-files'])
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((f) => CODE_EXT_RE.test(f) && !EXCLUDE_RE.test(f) && !SELF.test(f))
  return files.map((file) => {
    let content = null
    try {
      content = fs.readFileSync(path.join(repoRoot, file), 'utf8')
    } catch {
      content = null
    }
    return { file, content }
  })
}

module.exports = {
  scanText,
  scanContents,
  scanContentsSubnet,
  subnetPrefixes,
  isPrivateIpv4,
  isAnchorable,
  mask,
  loadAnchors,
  parseArgs,
  collectScanSet,
  countInDocs,
  runGit,
  HOST_KEY,
  CODE_EXT_RE,
  EXCLUDE_RE,
  DOCS_HIT_CAP,
  DOCS_SPEC,
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2))
  const repo = runGit(['rev-parse', '--show-toplevel']).trim()
  if (!repo) fail('取不到仓库根目录')

  const items = collectScanSet(repo)
  if (!items.length) fail('git ls-files 里没有任何可扫的代码文件，扫描无意义')

  if (opts.control) {
    const found = scanContents(items, opts.control)
    console.log(
      '[topology-gate] 阳性对照：扫了 ' + items.length + ' 个代码文件，对照串命中 ' + found.length + ' 处'
    )
    if (!found.length) {
      fail('对照串在代码里必然存在却 0 命中 ⇒ 扫描器本身失效，本次结果不可信')
    }
    console.log('结论: 扫描器可用')
    process.exit(0)
  }

  const anchors = loadAnchors(
    opts.values ? path.resolve(opts.values) : path.join(repo, '.env.local'),
    opts.noValuesOk
  )
  if (anchors === null) {
    console.log('结论: SKIPPED —— 本机无锚定值，本闸这次没有核对任何东西')
    process.exit(0)
  }
  console.log('[topology-gate] 代码文件 ' + items.length + ' 个，锚定值 ' + anchors.length + ' 个')

  const bad = []
  for (const { key, val } of anchors) {
    const found = scanContents(items, val)
    if (found.length) bad.push({ key, val, found, rule: '锚定值原样出现' })
  }
  // 同网段腿：钉一个值只防得住那一个值。实验机同 /24 里的网关/广播地址同样是拓扑信息。
  const subnets = subnetPrefixes(anchors.map((a) => a.val))
  for (const p of subnets) {
    const found = scanContentsSubnet(items, p)
    if (found.length)
      bad.push({
        key: '同网段 ' + mask(p.slice(0, -1) + '.x'),
        val: p + '*',
        found,
        rule: '锚定值所在 /24 里的其它地址',
      })
  }
  if (bad.length) {
    for (const b of bad) {
      const where = b.found
        .slice(0, 10)
        .map((h) => h.file + ':' + h.line)
        .join(', ')
      console.log('  ✗ ' + b.key + ' 硬编码在被跟踪代码里（' + b.rule + '）：' + where)
    }
    console.log('\n结论: ' + bad.length + ' 组内网拓扑值出现在代码中 —— 改回从环境变量/本地凭据文件读')
    process.exit(1)
  }
  console.log(
    '结论: CLEAN —— 锚定的内网地址与它所在的 /24 都没有写进代码（网段腿覆盖 ' + subnets.length + ' 段）'
  )

  // 文档腿：代码干净之后再看文档。这条不判"存在"（那是 2026-10-04 已裁定的豁免），只钉数量。
  const docSet = runGit(['ls-files', ...DOCS_SPEC])
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
  if (!docSet.length) fail('文档腿扫不到任何已入库 markdown，这条腿等于没有（扫描面参数改了？）')
  let docLines = 0
  for (const { val } of anchors) docLines += countInDocs(repo, val).lines
  console.log(
    '[topology-gate] 文档腿：' +
      docSet.length +
      ' 份已入库 markdown，锚定值命中 ' +
      docLines +
      ' 行（上限 ' +
      DOCS_HIT_CAP +
      ' 行；上限 0 = 公开仓不接受任何内网地址出现在已入库文档里，多一行就红）'
  )
  if (docLines > DOCS_HIT_CAP) {
    console.log(
      '\n结论: 文档里的内网地址比裁定的存量多 ' +
        (docLines - DOCS_HIT_CAP) +
        ' 行 —— 要么把新加的那行改成占位/环境变量名，要么在评审里说明并抬高 DOCS_HIT_CAP'
    )
    process.exit(1)
  }
}
