/**
 * 依赖漏洞闸的可证伪判据（2026-10-15 全维度系统审查 A11 / E4）
 *
 * 这道闸要在 CI 里当红牌，所以它自己必须先被证明"会红"。全部走 --input 喂存档信封，
 * 因此判据不联网、不随公告库变化——真件形状来自 tests/fixtures/quality-gates/pnpm-audit-sample.json
 * （pnpm audit 真实输出的切片，字段名与整份输出一致），红牌都是在这份真件上做单点改动造出来的。
 *
 * 三类都要覆盖：
 *   A 该红的红（新 high/critical、已知公告号扩散到别的包）
 *   B 不该红的红不了（新 moderate 只打印；基线里的那条不许报）
 *   C 量具坏掉时绝不报"没问题"（解析不出、分母过小、参数打错 → 退出码 2）
 *
 * 2026-10-19 改过一处设计错：原先"真件切片必须放行"与"基线不少于 40 行"都是**把某一天的
 * 基线抄进断言**，于是"把已修的漏洞从基线里摘掉"这件好事会红四片测试（本轮依赖公告 46→1 就撞上了）。
 * 现在期望值从**当前基线 + 切片**现场推导：基线里的必须放行、不在的必须逐条点名，
 * 两边一起错的形状不再被写死。
 */
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')
const GATE = path.join(ROOT, 'scripts/quality/deps-audit-gate.cjs')
const FIXTURE = path.join(ROOT, 'tests/fixtures/quality-gates/pnpm-audit-sample.json')
const BASELINE = path.join(ROOT, 'scripts/quality/deps-audit-accepted.json')

interface GateResult {
  code: number
  json: {
    ok: boolean
    stats: { total: number; advisories: number; blocking: number; acceptedBaseline: number }
    problems: string[]
    notes: string[]
  }
  stdout: string
  stderr: string
}

/** 跑闸：非零退出是判据的一部分，所以不能让它把异常抛出去 */
function parseOut(stdout: string): GateResult['json'] {
  try {
    return JSON.parse(stdout) as GateResult['json']
  } catch {
    // 闸没跑成时 stdout 往往不是 JSON（旧脚本被语法错误打断就是这样）。
    // 这里兜一个空形状只为了让断言消息能带上原文，不参与判定。
    return { ok: false, stats: { total: 0, advisories: 0, blocking: 0, acceptedBaseline: 0 }, problems: [], notes: [] }
  }
}

function runGate(args: string[]): GateResult {
  try {
    const stdout = execFileSync(process.execPath, [GATE, ...args], { cwd: ROOT, encoding: 'utf8' })
    return { code: 0, json: parseOut(stdout), stdout, stderr: '' }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    const stdout = err.stdout || ''
    return { code: err.status ?? 1, json: parseOut(stdout), stdout, stderr: err.stderr || '' }
  }
}

let dir: string
/** 写一份临时信封给 --input，返回路径（每个用例自己造，互不污染） */
function writeEnvelope(obj: unknown, name: string): string {
  const p = path.join(dir, name)
  fs.writeFileSync(p, JSON.stringify(obj), 'utf8')
  return p
}

function envelopeOf(mutate?: (env: { advisories: Record<string, unknown> }) => void): unknown {
  const env = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as { advisories: Record<string, unknown> }
  if (mutate) mutate(env)
  return env
}

/** 造一条与真件同形的公告，只换公告号/包名/严重度 */
function advisory(id: string, pkg: string, severity: string): Record<string, unknown> {
  return {
    id: 999999999,
    github_advisory_id: id,
    module_name: pkg,
    severity,
    title: '测试注入的合成公告',
    vulnerable_versions: '>=0',
    findings: []
  }
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-deps-audit-'))
  if (!fs.existsSync(FIXTURE)) throw new Error(`缺真件切片：${FIXTURE}`)
})
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

/** 基线里的键（公告号:包名） */
function baselineKeys(): Set<string> {
  const doc = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as { 已接受: Array<{ id: string; pkg: string }> }
  return new Set(doc.已接受.map((r) => `${r.id}:${r.pkg}`))
}

/** 切片里 high/critical 且基线没登记的那些——所有期望值都从这里推，不写死任何一天的基线内容 */
function unregisteredFromFixture(): string[] {
  const env = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as {
    advisories: Record<string, { github_advisory_id?: string; id: number; module_name: string; severity: string }>
  }
  const accepted = baselineKeys()
  return Object.values(env.advisories)
    .filter((a) => a.severity === 'high' || a.severity === 'critical')
    .map((a) => `${a.github_advisory_id || `npm-${a.id}`}:${a.module_name}`)
    .filter((k) => !accepted.has(k))
    .sort()
}

/** 从闸的红牌文案里把 公告号:包名 抠回来，好与推导出的期望比对 */
function keysOf(problems: string[]): string[] {
  return problems.map((p) => (p.match(/(\S+:\S+?)（/) || ['', ''])[1]).sort()
}

/** 删掉切片里"基线没登记"的 high/critical，剩下的就是"每条都在基线里"的干净形状 */
function dropUnregistered(env: { advisories: Record<string, unknown> }): void {
  const accepted = baselineKeys()
  for (const [k, raw] of Object.entries(env.advisories)) {
    const a = raw as { github_advisory_id?: string; id: number; module_name: string; severity: string }
    if (a.severity !== 'high' && a.severity !== 'critical') continue
    if (!accepted.has(`${a.github_advisory_id || `npm-${a.id}`}:${a.module_name}`)) delete env.advisories[k]
  }
}

describe('依赖漏洞闸', () => {
  it('真件切片：基线里的一条不许报，基线外的必须逐条点名（期望值现场推导）', () => {
    const want = unregisteredFromFixture()
    expect(want.length, '切片里一条 high/critical 都不在基线外，这条判据就没有牙了（要么切片该换、要么基线被清空）').toBeGreaterThan(0)
    const r = runGate(['--input', path.relative(ROOT, FIXTURE).replace(/\\/g, '/'), '--json'])
    expect(r.stderr, `闸没跑成：${r.stderr.slice(0, 300)}`).toBe('')
    expect(r.json.stats.advisories, '切片应有 4 条公告，读数不对就是解析坏了').toBe(4)
    expect(r.json.stats.total).toBeGreaterThan(800)
    expect(keysOf(r.json.problems), `红牌不等于"基线外那一集"：\n${r.json.problems.join('\n')}`).toEqual(want)
    expect(r.code).toBe(1)
  })

  it('基线外的一条 critical 必须红，且点名公告号', () => {
    const p = writeEnvelope(
      envelopeOf((env) => {
        env.advisories['999999901'] = advisory('GHSA-0000-1111-2222', 'tdsf-canary', 'critical')
      }),
      'new-critical.json'
    )
    const r = runGate(['--input', path.relative(ROOT, p), '--json'])
    expect(r.code, '注入一条全新 critical 后闸没红——这道闸是摆设').toBe(1)
    expect(r.json.problems.join('\n')).toMatch(/GHSA-0000-1111-2222:tdsf-canary/)
    expect(r.json.stats.blocking, '红牌数 = 切片本身基线外的那些 + 注入的这一条')
      .toBe(unregisteredFromFixture().length + 1)
  })

  it('基线登记过的那几条必须放行（正向对照：已知项不该拦）', () => {
    const p = writeEnvelope(envelopeOf(dropUnregistered), 'accepted-only.json')
    const r = runGate(['--input', path.relative(ROOT, p), '--json'])
    expect(r.stderr, `闸没跑成：${r.stderr.slice(0, 300)}`).toBe('')
    expect(r.code, `基线里的项被拦了：\n${r.json.problems.join('\n')}`).toBe(0)
    expect(r.json.ok).toBe(true)
    expect(r.json.problems).toEqual([])
  })

  it('基线外的 moderate 只打印不拦（否则无关提交会被噪声钉红）', () => {
    const p = writeEnvelope(
      envelopeOf((env) => {
        dropUnregistered(env)
        env.advisories['999999902'] = advisory('GHSA-3333-4444-5555', 'tdsf-canary', 'moderate')
      }),
      'new-moderate.json'
    )
    const r = runGate(['--input', path.relative(ROOT, p), '--json'])
    expect(r.code, '新 moderate 不该把 CI 变红').toBe(0)
    expect(r.json.problems, 'moderate 不该进红牌集').toEqual([])
    expect(r.json.notes.join('\n'), '不红但必须看得见').toMatch(/GHSA-3333-4444-5555/)
  })

  // 基线为空（公告已清零）时没有"已登记公告号"可扩散；这条判据的前提不存在，明确跳过而不是造一个假基线。
  it.skipIf(baselineKeys().size === 0)('已登记的公告号扩散到别的包也算新红牌（键是 公告号:包名）', () => {
    // 用基线里真实存在的公告号（不是抄某一天的某一行）：同一号进了新包必须算新牌
    const id = [...baselineKeys()][0].split(':')[0]
    const p = writeEnvelope(
      envelopeOf((env) => {
        dropUnregistered(env)
        env.advisories['999999903'] = advisory(id, 'tdsf-probe-pkg', 'critical')
      }),
      'spread.json'
    )
    const r = runGate(['--input', path.relative(ROOT, p), '--json'])
    expect(r.code, '同一公告号进了新包却没被抓，口径就退化成"见过就算安全"').toBe(1)
    expect(r.json.problems.join('\n')).toMatch(new RegExp(`${id}:tdsf-probe-pkg`))
  })

  it('依赖树分母小得不像真的 → 退出码 2，不许报没问题', () => {
    const p = writeEnvelope(
      envelopeOf((env) => {
        ;(env as unknown as { metadata: { totalDependencies: number } }).metadata.totalDependencies = 12
      }),
      'tiny.json'
    )
    const r = runGate(['--input', path.relative(ROOT, p)])
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/先修量具/)
  })

  it('输出不是 JSON / 缺 advisories / 文件不存在 → 一律 2', () => {
    const junk = path.join(dir, 'junk.txt')
    fs.writeFileSync(junk, 'pnpm: command not found', 'utf8')
    expect(runGate(['--input', path.relative(ROOT, junk)]).code).toBe(2)

    const noAdv = path.join(dir, 'no-advisories.json')
    fs.writeFileSync(noAdv, JSON.stringify({ metadata: { totalDependencies: 1200 } }), 'utf8')
    const r = runGate(['--input', path.relative(ROOT, noAdv)])
    expect(r.code).toBe(2)
    expect(r.stderr, '缺键必须说清是量具变了，不是没漏洞').toMatch(/advisories/)

    expect(runGate(['--input', 'tests/fixtures/does-not-exist.json']).code).toBe(2)
  })

  it('审计端点超时返回 error 信封 → 退出码 2，且说清是网络/端点而不是格式变了', () => {
    const p = writeEnvelope(
      { error: { code: 23, message: 'The operation was aborted due to timeout' } },
      'audit-error.json'
    )
    const r = runGate(['--input', path.relative(ROOT, p)])
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/错误信封/)
    expect(r.stderr).toMatch(/timeout|超时|端点/)
  })

  it('打错参数不静默放行（fail-closed）', () => {
    const r = runGate(['--check'])
    expect(r.code, '未知参数走到默认分支＝把打错的命令当成有效授权').toBe(2)
    expect(r.stderr).toMatch(/不认识参数/)
  })

  it('基线文件自己也要有形状（每行都得说清"先放着"的理由；空表要写理由）', () => {
    const doc = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as {
      已接受: unknown[]
      _空基线理由?: string
    }
    expect(Array.isArray(doc.已接受)).toBe(true)
    const rows = doc.已接受 as Array<Record<string, string>>
    if (rows.length === 0) {
      // 空表只在"确实一条都不剩"时合法；必须留下理由，否则和"把清单清空"分辨不出来。
      expect(
        (doc._空基线理由 || '').trim().length,
        '基线为空时必须写 _空基线理由，说明是修完后的 0 条，不是把清单清过'
      ).toBeGreaterThanOrEqual(20)
      return
    }
    const keys = new Set(rows.map((r) => `${r.id}:${r.pkg}`))
    expect(keys.size, '基线有重复的 公告号:包名').toBe(rows.length)
    for (const r of rows) {
      expect(['critical', 'high', 'moderate', 'low'], `基线条目严重度不对：${r.id}`).toContain(r.severity)
      expect(r.acceptedAt, `基线条目缺登记日期：${r.id}`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect((r.why || '').length, `基线条目的理由太短，等于随手登记：${r.id}`).toBeGreaterThanOrEqual(20)
    }
    // 这里以前是"不少于 40 行"。那是把某一天的基线条数抄成判据：本轮把 46 条公告修到 1 条，
    // 四片测试当场红——修得越好反而越红，是判据写错了不是活干错了。
  })
})
