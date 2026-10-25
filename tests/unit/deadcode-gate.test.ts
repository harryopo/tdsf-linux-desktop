/**
 * 死码闸的可证伪判据（2026-10-15 全维度系统审查 D6 / E4）
 *
 * 全部走 --input 喂 knip 存档 JSON，判据不跑 knip（那一下要一分钟，且它的读数随源码变）。
 * 信封形状取自 tests/fixtures/quality-gates/knip-sample.json（knip 真实输出的两个 issue 对象，
 * 14 个类别键齐全），注入项都在这份真件上做单点改动。
 *
 * 特意保留一条反向对照：exports 数量爆表也必须放行。
 * 本仓的惯例是"为了让单测能打到才 export"，这道闸若把 exports 设成红牌，
 * 就等于罚写测试的人——那正是"单点数字好看、整体变差"。
 */
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'

// 本文件的每条用例都要起一个真子进程跑门禁脚本：全量并行时 20 秒全局预算不够（现量见
// scripts/quality/subprocess-test-timeout.cjs 的文件头），所以只给这一份放宽。
vi.setConfig({ testTimeout: 60000 })

const ROOT = path.resolve(__dirname, '../..')
const GATE = path.join(ROOT, 'scripts/quality/deadcode-gate.cjs')
const FIXTURE = path.join(ROOT, 'tests/fixtures/quality-gates/knip-sample.json')

interface KnipIssue {
  file: string
  [category: string]: unknown
}

interface GateJson {
  ok: boolean
  caps: Record<string, number>
  counts: Record<string, number>
  info: Record<string, number>
  problems: string[]
  stats: { filesWithIssues: number; teethVerified: boolean }
}

function runGate(args: string[]): { code: number; json: GateJson | null; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [GATE, ...args], { cwd: ROOT, encoding: 'utf8' })
    return { code: 0, json: JSON.parse(stdout) as GateJson, stdout, stderr: '' }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    const stdout = err.stdout || ''
    let json: GateJson | null = null
    try {
      json = JSON.parse(stdout) as GateJson
    } catch {
      json = null
    }
    return { code: err.status ?? 1, json, stdout, stderr: err.stderr || '' }
  }
}

const REAL = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as { issues: KnipIssue[] }
/** knip 的下限判据要求"真的抽到了东西"，所以达标用例要把真件补足到下限文件数 */
const MIN_FILES = 60

/**
 * 造一份 knip 信封：真件的两个 issue 原样保留，再用真件的键集填空壳补足文件数，
 * 最后按 overrides 往某个类别里塞 N 条。
 */
function envelope(overrides?: Record<string, number>, fileCount = MIN_FILES): string {
  // 每条用例都从真件的深拷贝起步：直接改 REAL.issues[0] 会把注入项留给后面的用例，
  // 于是"上一案注入的断链"会让下一案该绿的用例红——顺序一变结果就变。
  const issues: KnipIssue[] = structuredClone(REAL.issues)
  const emptyTemplate: KnipIssue = structuredClone(REAL.issues[0])
  for (const k of Object.keys(emptyTemplate)) {
    if (Array.isArray(emptyTemplate[k])) emptyTemplate[k] = []
  }
  while (issues.length < fileCount) {
    issues.push({ ...emptyTemplate, file: `src/filler-${issues.length}.ts` })
  }
  if (overrides) {
    for (const [category, count] of Object.entries(overrides)) {
      issues[0][category] = Array.from({ length: count }, (_x, i) => ({ name: `inj-${i}` }))
    }
  }
  return JSON.stringify({ issues })
}

let dir: string
function write(name: string, text: string): string {
  const p = path.join(dir, name)
  fs.writeFileSync(p, text, 'utf8')
  return p
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-deadcode-'))
  if (!fs.existsSync(FIXTURE)) throw new Error(`缺真件切片：${FIXTURE}`)
})
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('死码闸', () => {
  it('达标读数放行，且每次都自证过牙', () => {
    const r = runGate(['--input', path.relative(ROOT, write('pass.json', envelope())), '--json'])
    expect(r.stderr, `闸没跑成：${r.stderr.slice(0, 300)}`).toBe('')
    expect(r.code, r.json?.problems.join('\n')).toBe(0)
    expect(r.json?.ok).toBe(true)
    expect(r.json?.stats.teethVerified, '阳性对照没跑＝这道闸的红牌能力没人保证').toBe(true)
    expect(r.json?.stats.filesWithIssues).toBeGreaterThanOrEqual(MIN_FILES)
  })

  it('新增一个整文件没人引用必须红（files 上限 0）', () => {
    const p = write('files.json', envelope({ files: 1 }))
    const r = runGate(['--input', path.relative(ROOT, p), '--json'])
    expect(r.code, 'files 从 0 变 1 仍然放行，上限比较是摆设').toBe(1)
    expect(r.json?.problems.join('\n')).toMatch(/files（整文件没有任何引用者）现在 1 处/)
  })

  it('断链（unresolved）与未登记依赖（unlisted）必须红', () => {
    for (const category of ['unresolved', 'unlisted'] as const) {
      const r = runGate(['--input', path.relative(ROOT, write(`${category}.json`, envelope({ [category]: 2 }))), '--json'])
      expect(r.code, `${category} 涨了却没红`).toBe(1)
      expect(r.json?.problems.join('\n')).toMatch(new RegExp(`^.*${category}.*2 处`, 'm'))
    }
  })

  it('duplicates 的刻度挪了，这两条判据要跟着挪（所以数从闸自己嘴里取，不手抄）', () => {
    const probe = runGate(['--input', path.relative(ROOT, write('dup-probe.json', envelope({ duplicates: 0 }))), '--json'])
    expect(probe.code, probe.stderr).toBe(0)
    const cap = probe.json?.caps.duplicates
    // 断言不收窄类型，所以这里用 if + throw：拿不到上限就当场失败，
    // 而不是带着 undefined 去比，把"闸没报数"演成"刻度正常"
    if (typeof cap !== 'number') throw new Error('闸的 --json 没报出 duplicates 的上限，判据无从对齐')
    // 恰好等于上限 ⇒ 放行；多一条 ⇒ 红。建档时是 16，2026-10-20 清零后是 0，两条断言都不用改
    const atCap = runGate([
      '--input',
      path.relative(ROOT, write('dup-at-cap.json', envelope({ duplicates: cap }))),
      '--json',
    ])
    expect(atCap.code, `${cap} 条正踩在上限上，不该红`).toBe(0)
    const overCap = runGate([
      '--input',
      path.relative(ROOT, write('dup-over-cap.json', envelope({ duplicates: cap + 1 }))),
      '--json',
    ])
    expect(overCap.code, `第 ${cap + 1} 条 duplicates 没拦住`).toBe(1)
  })

  it('exports/types 爆表不拦（反向对照：不许罚"为了测试而导出"）', () => {
    const p = write('exports-huge.json', envelope({ exports: 9999, types: 5000 }))
    const r = runGate(['--input', path.relative(ROOT, p), '--json'])
    expect(r.code, '这两档只打印不拦，红了就是判据越界').toBe(0)
    expect(r.json?.info.exports, '注入的 9999 条没被如实打印出来').toBeGreaterThanOrEqual(9999)
    expect(r.json?.problems).toEqual([])
  })

  it('knip 抽到的文件少得不像真的 → 退出码 2，不许报没问题', () => {
    const r = runGate(['--input', path.relative(ROOT, write('sparse.json', envelope(undefined, 3)))])
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/没读到源码树/)
  })

  it('输出不是 JSON / 缺 issues / 文件不存在 → 一律 2', () => {
    expect(runGate(['--input', path.relative(ROOT, write('junk.txt', 'knip: not found'))]).code).toBe(2)

    const r = runGate(['--input', path.relative(ROOT, write('no-issues.json', JSON.stringify({ foo: 1 })))])
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/缺 issues 数组/)

    expect(runGate(['--input', 'tests/fixtures/nope.json']).code).toBe(2)
  })

  it('打错参数不静默放行（fail-closed）', () => {
    const r = runGate(['--check'])
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/不认识参数/)
  })
})
