/**
 * 身份暴露闸（scripts/security/identity-gate.cjs）的常驻判据。
 *
 * 为什么要有这条测试（2026-10-19）：那次普查抓到 24 个文件写着赛事字样、
 * 关于页页脚印着校名与专业、引用文件里连真实姓名一起公开。它们不是凭据，
 * 凭据类闸一条都不管；而这类信息进了 git 历史就永久可查，是唯一撤不回的那类暴露。
 *
 * 三条判据一条都不能少：
 *   1. 阳性对照——每条规则必须抓得住自己的样例串（抓不住就是闸死了，比没闸更危险）；
 *   2. 跟踪集必须 0 命中；
 *   3. 具体身份值清单**不许入库**（那份文件一旦进跟踪集，就等于把答案贴在现场）。
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '../..')
const SCRIPT = path.join(REPO, 'scripts', 'security', 'identity-gate.cjs')
const LOCAL_TERMS = path.join(REPO, 'scripts', 'security', 'identity-terms.local.json')

function run(args: string[]) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return { rc: 0, out }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { rc: err.status ?? 1, out: (err.stdout || '') + (err.stderr || '') }
  }
}

describe('identity-gate：身份暴露闸', () => {
  it('阳性对照：每条规则都抓得住自己的样例串（闸必须是活的）', () => {
    const { rc, out } = run(['--self-test'])
    // 对照通过后仍会跑跟踪集扫描，所以这里认的是对照那一行，rc 由第二条用例判
    expect(out, out).toContain('条规则各自的样例串全部命中')
    expect([0, 1]).toContain(rc)
  })

  it('未知参数拒跑（打错一个字母不许把"扫暂存区"悄悄变成"扫跟踪集"）', () => {
    const { rc, out } = run(['--stage'])
    expect(rc, out).toBe(2)
    expect(out).toContain('不认识这些参数')
    expect(out).not.toContain('PASS')
  })

  it('跟踪集 0 命中（这条就是闸本体：谁再把身份写进入就红）', () => {
    const { rc, out } = run([])
    expect(out, out).toContain('身份暴露 0 处')
    expect(rc, out).toBe(0)
  })

  it('具体身份值清单不许进跟踪集', () => {
    const files = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).split(/\r?\n/)
    const rel = path.relative(REPO, LOCAL_TERMS).split(path.sep).join('/')
    expect(
      files.filter((f) => f === rel).length,
      '那份清单一旦入库，等于把"不许出现的东西"本身公开出去'
    ).toBe(0)
  })

  it('豁免口子只准写死到"规则定义文件本身"这两个路径（不许扩成目录或通配）', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8')
    const m = src.match(/const SELF_EXEMPT = \[([^\]]*)\]/)
    expect(m, '闸里必须能读到 SELF_EXEMPT 这份清单').not.toBeNull()
    const list = (m as RegExpMatchArray)[1]
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
    expect(list, '豁免清单当前是：' + JSON.stringify(list)).toEqual([
      'scripts/security/identity-gate.cjs',
      'tests/unit/identity-gate.test.ts'
    ])
    for (const p of list) {
      expect(p, '豁免项必须是具体文件，不是目录：' + p).toMatch(/\.[a-z]+$/)
      expect(p, '豁免项里不许出现通配：' + p).not.toMatch(/[*?]/)
      expect(fs.existsSync(path.join(REPO, p)), '豁免了一个不存在的文件就是空口子：' + p).toBe(true)
    }
  })

  it('本机缺具体身份值清单时，闸必须明说覆盖变窄（不许静默只剩通用规则）', () => {
    if (!fs.existsSync(LOCAL_TERMS)) return // 本机本来就没有，这条在 CI 上是空跑，如实说明
    const tmp = LOCAL_TERMS + '.tdsf-hidden'
    fs.renameSync(LOCAL_TERMS, tmp)
    try {
      const { out } = run([])
      expect(out).toContain('具体身份值清单缺失')
      expect(out).not.toMatch(/PASS.*11 条规则/)
    } finally {
      fs.renameSync(tmp, LOCAL_TERMS)
    }
  })
})
