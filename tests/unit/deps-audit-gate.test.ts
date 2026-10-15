/**
 * 依赖漏洞闸的可证伪判据（2026-10-15 全维度系统审查 A11 / E4）
 *
 * 这道闸要在 CI 里当红牌，所以它自己必须先被证明"会红"。全部走 --input 喂存档信封，
 * 因此判据不联网、不随公告库变化——真件形状来自 tests/fixtures/quality-gates/pnpm-audit-sample.json
 * （pnpm audit 真实输出的切片，字段名与整份输出一致），红牌都是在这份真件上做单点改动造出来的。
 *
 * 三类都要覆盖：
 *   A 该红的红（新 high/critical、已知公告号扩散到别的包）
 *   B 不该红的红不了（新 moderate 只打印；正常路径必须放行）
 *   C 量具坏掉时绝不报"没问题"（解析不出、分母过小、参数打错 → 退出码 2）
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

describe('依赖漏洞闸', () => {
  it('真件切片照基线放行（正向对照：已知项不该拦）', () => {
    const r = runGate(['--input', path.relative(ROOT, FIXTURE).replace(/\\/g, '/'), '--json'])
    expect(r.stderr, `闸没跑成：${r.stderr.slice(0, 300)}`).toBe('')
    expect(r.code, `已知公告被判成新的：\n${r.json.problems.join('\n')}`).toBe(0)
    expect(r.json.ok).toBe(true)
    expect(r.json.stats.advisories, '切片应有 3 条公告，读数不对就是解析坏了').toBe(3)
    expect(r.json.stats.total).toBeGreaterThan(800)
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
    expect(r.json.stats.blocking).toBe(1)
  })

  it('基线外的 moderate 只打印不拦（否则无关提交会被噪声钉红）', () => {
    const p = writeEnvelope(
      envelopeOf((env) => {
        env.advisories['999999902'] = advisory('GHSA-3333-4444-5555', 'tdsf-canary', 'moderate')
      }),
      'new-moderate.json'
    )
    const r = runGate(['--input', path.relative(ROOT, p), '--json'])
    expect(r.code, '新 moderate 不该把 CI 变红').toBe(0)
    expect(r.json.problems).toEqual([])
    expect(r.json.notes.join('\n'), '不红但必须看得见').toMatch(/GHSA-3333-4444-5555/)
  })

  it('已登记的公告号扩散到别的包也算新红牌（键是 公告号:包名）', () => {
    const p = writeEnvelope(
      envelopeOf((env) => {
        env.advisories['999999903'] = advisory('GHSA-xq3m-2v4x-88gg', 'protobufjs-copy', 'critical')
      }),
      'spread.json'
    )
    const r = runGate(['--input', path.relative(ROOT, p), '--json'])
    expect(r.code, '同一公告号进了新包却没被抓，口径就退化成"见过就算安全"').toBe(1)
    expect(r.json.problems.join('\n')).toMatch(/GHSA-xq3m-2v4x-88gg:protobufjs-copy/)
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

  it('打错参数不静默放行（fail-closed）', () => {
    const r = runGate(['--check'])
    expect(r.code, '未知参数走到默认分支＝把打错的命令当成有效授权').toBe(2)
    expect(r.stderr).toMatch(/不认识参数/)
  })

  it('基线文件自己也要有形状（防止有人把清单清空来"过闸"）', () => {
    const doc = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as { 已接受: unknown[] }
    expect(Array.isArray(doc.已接受)).toBe(true)
    const rows = doc.已接受 as Array<Record<string, string>>
    expect(rows.length, `基线只剩 ${rows.length} 行，多半是被误删`).toBeGreaterThanOrEqual(40)
    const keys = new Set(rows.map((r) => `${r.id}:${r.pkg}`))
    expect(keys.size, '基线有重复的 公告号:包名').toBe(rows.length)
    for (const r of rows) {
      expect(r.severity, `基线条目缺严重度：${r.id}`).toBeTruthy()
      expect(r.acceptedAt, `基线条目缺登记日期：${r.id}`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(r.why, `基线条目没写为什么先放着：${r.id}`).toBeTruthy()
    }
  })
})
