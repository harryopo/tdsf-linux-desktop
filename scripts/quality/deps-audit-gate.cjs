#!/usr/bin/env node
/**
 * 依赖漏洞闸（2026-10-15 全维度系统审查 A11 + E4「CI 缺执行体」）
 *
 * 为什么需要它：审查量出 critical 5 / high 24 / moderate 17，而本仓当时**一条 audit 命令都没有**，
 * 于是"依赖有洞"这个结论只对"上次手动跑的人"负责。这道闸不假装能修好依赖（升级要动
 * package.json/lockfile/原生模块，归任务 #117，需用户点头），它只保证一件事：
 * **新出现的 high/critical 公告每轮都会把 CI 变红**，直到有人处置或明确登记。
 *
 * 判据只有一条（键 = 公告号:包名）：
 *   - 公告号:包名 不在 deps-audit-accepted.json 且 severity 属于 high/critical → 红（退出码 1）
 *   - moderate/low 的新公告 → 打印，不红（避免无关提交被噪声拦住；数字仍然可见）
 *   - 基线里的条目这次没再出现 → 打印"可以摘掉这一行了"，不红
 *
 * 为什么不是"漏洞总数上限"那种 ratchet：公告库每天变，昨天 0 今天可能 3，红的是没改过代码的人，
 * 结果只会教人绕闸。按公告号逐条认账才是能被维护的口径。
 *
 * fail-closed（一律退出码 2，绝不报"没问题"）：audit 跑不成、输出不是 JSON、缺键、
 * 看到的依赖数小到不像真的（镜像站没有 audit 端点时 pnpm 就是这么安静地什么也不说）。
 *
 * 用法：
 *   node scripts/quality/deps-audit-gate.cjs                 # 真跑 pnpm audit（要联网）
 *   node scripts/quality/deps-audit-gate.cjs --input a.json  # 喂存档的 audit JSON（测试/离线复算）
 *   node scripts/quality/deps-audit-gate.cjs --json          # 机器可读输出
 * 镜像站没有 audit 端点，所以取数固定走官方 registry。
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const BASELINE = path.join(__dirname, 'deps-audit-accepted.json')
/** 红牌严重度：新增这两档必须有人看一眼 */
const BLOCKING = new Set(['high', 'critical'])
/** 2026-10-15 实测 totalDependencies=1195；低于这个数说明 audit 没看到真树 */
const MIN_DEPENDENCIES = 800

/**
 * 把 audit 信封拆成判定要用的最小形状。
 * pnpm 会在 JSON 前面混进警告行，所以从第一个花括号起取。
 * @returns {{advisories: Array<{id: string, pkg: string, severity: string}>, total: number}}
 */
function parseEnvelope(rawText, source) {
  const start = rawText.indexOf('{')
  if (start < 0) throw new Error(`${source} 里没有 JSON（前 200 字：${rawText.slice(0, 200)}）`)
  let parsed
  try {
    parsed = JSON.parse(rawText.slice(start))
  } catch (e) {
    throw new Error(`${source} 的 JSON 解析失败：${e.message}`)
  }
  const { advisories, metadata } = parsed
  if (parsed.error && typeof parsed.error === 'object') {
    const msg = parsed.error.message || JSON.stringify(parsed.error)
    throw new Error(
      `${source} 返回错误信封：${msg}（审计端点或网络失败，不是"没有漏洞"；稍后重跑）`
    )
  }
  if (!advisories || typeof advisories !== 'object' || Array.isArray(advisories)) {
    throw new Error(`${source} 缺 advisories 映射（量具换了格式，判定要跟着改，不能当"没漏洞"）`)
  }
  const total = metadata && metadata.totalDependencies
  if (typeof total !== 'number' || !Number.isFinite(total)) {
    throw new Error(`${source} 缺 metadata.totalDependencies——没有分母的"0 命中"不作数`)
  }
  const list = Object.values(advisories).map((a) => ({
    id: a.github_advisory_id || `npm-${a.id}`,
    pkg: a.module_name,
    severity: a.severity
  }))
  for (const a of list) {
    if (!a.id || !a.pkg || !a.severity) {
      throw new Error(`${source} 有条公告缺公告号/包名/严重度，键对不上就等于漏判`)
    }
  }
  return { advisories: list, total }
}

/**
 * 纯判定：真值来自 parseEnvelope，已登记项来自基线。
 * @returns {{problems: string[], notes: string[], stats: object}}
 */
function evaluate(env, acceptedKeys) {
  const problems = []
  const notes = []
  const seen = new Set()
  const stats = { total: env.total, advisories: env.advisories.length, blocking: 0, bySeverity: {} }

  for (const a of env.advisories) {
    const key = `${a.id}:${a.pkg}`
    seen.add(key)
    stats.bySeverity[a.severity] = (stats.bySeverity[a.severity] || 0) + 1
    if (acceptedKeys.has(key)) continue
    const line = `新公告 ${key}（${a.severity}）——${a.pkg}，未在基线登记`
    if (BLOCKING.has(a.severity)) {
      problems.push(line)
      stats.blocking++
    } else {
      notes.push(line)
    }
  }
  for (const key of acceptedKeys) {
    if (!seen.has(key)) notes.push(`基线条目 ${key} 这次没再出现，可以摘掉这一行`)
  }
  return { problems, notes, stats }
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE)) {
    throw new Error(`基线文件不存在：${BASELINE}——没有已登记清单，任何公告都会被判成新的，这是配置缺失不是清白`)
  }
  const doc = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
  const rows = doc['已接受']
  if (!Array.isArray(rows)) {
    throw new Error('基线文件里的「已接受」不是数组——形状变了，先修量具')
  }
  if (rows.length === 0) {
    // 空表可以合法（公告真修到 0），但必须留理由；否则和"有人把清单清空了"分辨不出来。
    const why = typeof doc['_空基线理由'] === 'string' ? doc['_空基线理由'].trim() : ''
    if (why.length < 20) {
      throw new Error('基线为空但没写 _空基线理由：空表可能是真修完，也可能是清单被清过，先写清原因')
    }
    return new Set()
  }
  const keys = new Set()
  for (const r of rows) {
    if (!r.id || !r.pkg) throw new Error(`基线有条目缺 id/pkg：${JSON.stringify(r).slice(0, 120)}`)
    const key = `${r.id}:${r.pkg}`
    if (keys.has(key)) throw new Error(`基线有重复行：${key}`)
    keys.add(key)
  }
  return keys
}

function runAudit() {
  // 镜像站没有 audit 端点（ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS），必须显式指官方 registry。
  // shell:true 是为了 Windows：pnpm 在那儿是 .cmd，不走 shell 直接 ENOENT。
  const r = spawnSync('pnpm audit --json --registry=https://registry.npmjs.org', {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 32 * 1024 * 1024
  })
  if (r.error) throw new Error(`pnpm audit 跑不起来：${r.error.message}`)
  const out = r.stdout || ''
  if (!out.trim()) {
    throw new Error(
      `pnpm audit 没有任何输出（退出码 ${r.status}）。这不是"没有漏洞"，是量具没工作：\n${(r.stderr || '').slice(0, 400)}`
    )
  }
  return out
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

  const accepted = loadBaseline()
  const raw = inputPath
    ? (() => {
        const abs = path.resolve(ROOT, inputPath)
        if (!fs.existsSync(abs)) throw new Error(`--input 指定的文件不存在：${abs}`)
        return fs.readFileSync(abs, 'utf8')
      })()
    : runAudit()

  const env = parseEnvelope(raw, inputPath ? inputPath : 'pnpm audit')
  if (env.total < MIN_DEPENDENCIES) {
    throw new Error(
      `audit 只看到 ${env.total} 个依赖（下限 ${MIN_DEPENDENCIES}）。要么 lockfile 没装全，要么 audit 端点换了口径——先修量具`
    )
  }

  const verdict = evaluate(env, accepted)

  // 阳性对照：塞一条"已知清单里没有的 critical"，必须变红。
  // 没变红＝这道闸没有牙（键的拼法、基线读取、严重度过滤任一处坏了都会静默放行）。
  const canaryId = 'GHSA-0000-0000-0000'
  const canaryEnv = {
    total: env.total,
    advisories: env.advisories.concat([{ id: canaryId, pkg: 'tdsf-gate-canary', severity: 'critical' }])
  }
  const canary = evaluate(canaryEnv, accepted)
  if (!canary.problems.some((p) => p.includes(canaryId))) {
    throw new Error('注入一条全新 critical 公告后闸仍然放行——依赖漏洞闸是摆设，先修它再谈结论')
  }

  const payload = {
    ok: verdict.problems.length === 0,
    stats: { ...verdict.stats, acceptedBaseline: accepted.size, teethVerified: true },
    problems: verdict.problems,
    notes: verdict.notes
  }
  if (asJson) console.log(JSON.stringify(payload, null, 2))
  else {
    const s = payload.stats
    console.log(
      `[deps-audit] 依赖树 ${s.total} 个 / 公告 ${s.advisories} 条（基线已登记 ${s.acceptedBaseline}）/ 新增红牌 ${s.blocking}`
    )
    for (const n of verdict.notes) console.log(`  · ${n}`)
    for (const p of verdict.problems) console.log(`  ✗ ${p}`)
    if (verdict.problems.length) {
      console.log('  处置：升级/替换该依赖（需用户批准，任务 #117），或确认可接受后写进 deps-audit-accepted.json')
    }
  }
  process.exit(verdict.problems.length ? 1 : 0)
}

module.exports = { parseEnvelope, evaluate, loadBaseline, BASELINE }

if (require.main === module) {
  try {
    main()
  } catch (e) {
    console.error(`[deps-audit] 闸没跑成（这不是"没有漏洞"）：${e.message}`)
    process.exit(2)
  }
}
