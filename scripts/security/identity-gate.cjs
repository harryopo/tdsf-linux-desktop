#!/usr/bin/env node
/*
 * 身份暴露闸：仓库与历史里不许出现"作者是谁、哪所学校、打的什么比赛"这三类信息。
 *
 * 为什么要有它（2026-10-19）：一次普查抓到 24 个文件写着赛事名、关于页页脚印着校名与专业、
 * 引用文件里连真实姓名一起公开。这些都不是凭据，所以凭据类闸（secret-gate / topology-gate）
 * 一条都不管——而它们恰恰是最难撤销的那类暴露：进了 git 历史就永久可查。
 * 靠"下次注意"必然重犯，所以把它变成能自动跑红的门。
 *
 * 三类规则，各自的取舍不同：
 *   1. 通用形状规则（校名用词、赛事字样、"学号"字样）：规则本身不含任何具体身份值，
 *      所以可以安全地写进这份入库的脚本。
 *   2. 具体身份值（真实姓名、具体校名）：**清单不放本文件**——写进来就等于又公开一次。
 *      它们放在同目录的 identity-terms.local.json（已 gitignore，只留本机）。
 *      那份文件缺失时本闸**照跑通用规则并打印一行说明**，不许静默变成"只跑通用规则还自称全过"。
 *   3. 身份证 / 手机号形状：只按形状判，命中就报，由人判是真是假。
 *
 * 用法：
 *   node scripts/security/identity-gate.cjs              扫跟踪集
 *   node scripts/security/identity-gate.cjs --staged     扫暂存区（提交钩子用）
 *   node scripts/security/identity-gate.cjs --self-test  每条规则拿自己的样例串验一遍"闸有牙"
 */
'use strict'

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '../..')
const LOCAL_TERMS = path.join(__dirname, 'identity-terms.local.json')

/**
 * 规则定义文件自身不计入命中——它的正则字面量里就得写着"大学""比赛"这些词，
 * 否则没法判。这是同类闸的固有例外（打码规则不会把自己的打码串当凭据）。
 *
 * 但口子必须窄到"只有这两个路径"：豁免写成目录、写成通配、或者谁都能加一行，
 * 这道闸就名存实亡。tests/unit/identity-gate.test.ts 钉住这个清单不许变大。
 */
const SELF_EXEMPT = ['scripts/security/identity-gate.cjs', 'tests/unit/identity-gate.test.ts']

/**
 * 样例串一律用相邻字面量拼出来，源码里不出现完整形状（同仓规距：需要示例就拆开写，
 * 免得扫描器把夹具当真警报）。
 */
const RULES = [
  {
    name: '机构用词',
    re: /大学|学院|职业技术/,
    canary: ['大', '学'].join(''),
    echoTerm: true
  },
  {
    name: '赛事字样',
    re: /火山杯|参赛|评委|开源加分项|比赛/,
    canary: ['参', '赛'].join(''),
    echoTerm: true
  },
  {
    name: '学籍字样',
    re: /学号|班级名单|宿舍/,
    canary: ['学', '号'].join(''),
    echoTerm: true
  },
  {
    name: '身份证形状',
    re: /(?<![0-9Xx])[0-9]{17}[0-9Xx](?![0-9Xx])/,
    canary: '1'.repeat(17) + 'X',
    echoTerm: false
  },
  {
    // 2026-10-20 加：公开仓的门面文档里写过作者本人的 QQ 邮箱，结果被第三方工具爬去发冷邮件
    // （"Perch Scan" 那类自动扫公开仓再按模板群信的）。所以"个人邮箱形状"和姓名/校名同属一类暴露：
    // 不是凭据，但一旦公开就收不回来，而且会持续招信。
    // 只判国内个人邮箱域名的常见形状，不判通用 email——`@example.com` 这类教程夹具不能误伤。
    name: '个人邮箱形状',
    re: /(?<![0-9a-zA-Z])[0-9]{6,11}@(?:qq|163|126|foxmail|vip|sina|sohu|139|189)\.(?:com|cn)(?![a-zA-Z])/,
    canary: '12345678' + '90' + '@qq' + '.com',
    echoTerm: false
  }
]

function readLocalTerms() {
  if (!fs.existsSync(LOCAL_TERMS)) return null
  const raw = JSON.parse(fs.readFileSync(LOCAL_TERMS, 'utf8'))
  const terms = Array.isArray(raw.terms) ? raw.terms : []
  if (!terms.length) throw new Error('[identity-gate] ' + LOCAL_TERMS + ' 存在但 terms 是空数组——空清单不等于通过')
  return terms.map((t) => ({ name: '具体身份值:' + (t.label || '未标注'), re: new RegExp(escapeRe(t.value), 'g'), value: t.value }))
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 具体身份值命中时绝不回显原值，连首尾字都不给（给了就能靠长度与首字反推） */
function mask(value) {
  return '<' + value.length + ' 字，值不回显>'
}

function collect(scope) {
  if (scope === 'staged') {
    const diff = execFileSync('git', ['diff', '--cached', '-U0', '--no-color'], {
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    })
    const out = []
    let file = ''
    for (const line of diff.split('\n')) {
      const m = line.match(/^\+\+\+ b\/(.*)$/)
      if (m) {
        file = m[1]
        continue
      }
      if (line.startsWith('+') && !line.startsWith('+++') && file && !SELF_EXEMPT.includes(file))
        out.push({ where: file + ' (新增行)', text: line.slice(1) })
    }
    return out
  }
  // 跟踪集：让 git 自己列文件，逐个读——规则原样在本地比对，不经过 shell 拼串
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
  const out = []
  for (const f of files) {
    if (SELF_EXEMPT.includes(f)) continue // 规则定义文件不计（见 SELF_EXEMPT 上方说明）
    let text
    try {
      text = fs.readFileSync(path.join(REPO, f), 'utf8')
    } catch {
      continue // 符号链接或已删除的暂存条目
    }
    text.split('\n').forEach((line, i) => out.push({ where: f + ':' + (i + 1), text: line }))
  }
  return out
}

/** 只有"通用词表里的词"可以原样回显（它们本身不是身份值）；形状类与具体值类一律掩码 */
function canEcho(rule) {
  return rule.echoTerm === true && !rule.name.startsWith('具体身份值')
}

function scan(items, rules) {
  const hits = []
  for (const rule of rules) {
    const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g')
    for (const it of items) {
      const m = it.text.match(re)
      if (!m) continue
      hits.push({ rule: rule.name, where: it.where, sample: canEcho(rule) ? m[0] : mask(m[0]) })
    }
  }
  return hits
}

function selfTest() {
  const bad = []
  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g')
    if (!re.test(rule.canary)) bad.push(rule.name)
  }
  if (bad.length) {
    console.error('[identity-gate] FAIL 这几条规则连自己的样例串都抓不住，闸是死的：' + bad.join('、'))
    return 1
  }
  console.log('[identity-gate] 阳性对照：' + RULES.length + ' 条规则各自的样例串全部命中')
  return 0
}

function main(argv) {
  // 未知参数一律拒跑：打错一个字母就把"扫暂存区"变成"扫跟踪集"，那是往反方向失败
  const KNOWN = ['--self-test', '--staged']
  const unknown = argv.filter((a) => a.startsWith('-') && !KNOWN.includes(a))
  if (unknown.length) {
    console.error('[identity-gate] FAIL 不认识这些参数：' + unknown.join(' ') + '（支持：' + KNOWN.join(' / ') + '）')
    return 2
  }
  const self = argv.includes('--self-test')
  const staged = argv.includes('--staged')
  if (self) {
    const rc = selfTest()
    if (rc) return rc
  }

  const local = readLocalTerms()
  const rules = local ? RULES.concat(local) : RULES

  const items = collect(staged ? 'staged' : 'tracked')
  const hits = scan(items, rules)

  console.log(
    '[identity-gate] 规则定义文件豁免 ' + SELF_EXEMPT.length + ' 个（正则字面量里就写着这些词，不计入命中）：' +
      SELF_EXEMPT.join('、')
  )

  if (!local) {
    console.log(
      '[identity-gate] 注意：具体身份值清单缺失（' +
        path.relative(REPO, LOCAL_TERMS) +
        '，本机文件，不入库），本轮只跑 ' +
        RULES.length +
        ' 条通用规则——真实姓名与具体校名这一层没有覆盖到。'
    )
  }
  if (hits.length) {
    // 先按规则归并再逐条列：一上来就截断会把"其实只有两处的最要紧那一族"藏进省略号里
    const byRule = new Map()
    for (const h of hits) byRule.set(h.rule, (byRule.get(h.rule) || 0) + 1)
    console.error('[identity-gate] FAIL 命中 ' + hits.length + ' 处（只报规则名与位置，具体身份值已掩码）：')
    for (const [rule, n] of byRule.entries()) console.error('  · ' + rule + '：' + n + ' 处')
    for (const h of hits) console.error('  [' + h.rule + '] ' + h.where + ' → ' + h.sample)
    console.error('  这类信息进了 git 历史就永久可查，改法只有一种：把身份从中性表述里拿掉。')
    return 1
  }
  console.log(
    '[identity-gate] PASS 扫了 ' + items.length + ' 行、' + rules.length + ' 条规则，身份暴露 0 处' +
      (staged ? '（暂存区）' : '（跟踪集）')
  )
  return 0
}

if (require.main === module) process.exitCode = main(process.argv.slice(2))
