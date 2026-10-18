/**
 * 对外读数复现器（scripts/quality/promo-readout.mjs）必须能被证伪。
 *
 * 起因：2026-10-18 宣传页上"命令规则词表项"写的是手数的 216，脚本实测 226——
 * 手算那版按一份**写死的护栏键清单**加数，漏了两组。这类错不会因为"我下次仔细点"而消失，
 * 所以把复现器钉住四件事：
 *   1. 护栏按分组现数，多一组就必须多算（杜绝再出现固定键清单）；
 *   2. audit:ipc 报告取不到通道数时报错，不许静默返回 0（0 命中要先证明扫得中东西）；
 *   3. 页面少了某一行 ⇒ 判"没比上"，不能因为"没取到所以没差异"而放行；
 *   4. 页面某个数字被改错 ⇒ 点名那一条，且只点名那一条。
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const MODULE_SPEC = '../../scripts/quality/promo-readout.mjs'

type Readouts = {
  countRuleVocabulary: (rules: unknown) => { vocabulary: number; per: Record<string, number>; detectors: number; argvRules: number; protectedTargets: number }
  countContract: (source: string) => { invoke: number; event: number; total: number }
  parseIpcAudit: (text: string) => { request: number; event: number; total: number }
  parsePromoReadouts: (html: string) => Record<string, number | null>
  diffReadouts: (page: Record<string, number | null>, measured: Array<[string, number]>) => Array<{ label: string; got: unknown; want: number }>
}

async function mod(): Promise<Readouts> {
  return (await import(/* @vite-ignore */ MODULE_SPEC)) as Readouts
}

const REPO = path.resolve(import.meta.dirname, '../..')
const realRules = () => JSON.parse(fs.readFileSync(path.join(REPO, 'src/main/core/command-rules.json'), 'utf8')) as Record<string, unknown>

/** 与页面同形的最小表：五行读数，供 3/4 两条判据用 */
function fakePage(overrides: Record<string, number> = {}) {
  const rows: Array<[string, number]> = [
    ['IPC 通道', 272],
    ['已登记契约的通道', 35],
    ['TypeScript / TSX 源文件', 508],
    ['命令规则词表项', 226],
    ['结构性拦截器', 8],
  ]
  return (
    '<table><tbody>' +
    rows
      .filter(([label]) => !(label in overrides) || overrides[label] !== undefined)
      .map(([label, v]) => `<tr><td class="k">${label}</td><td class="v">${overrides[label] ?? v}</td></tr>`)
      .join('\n') +
    '</tbody></table>'
  )
}
const MEASURED: Array<[string, number]> = [
  ['IPC 通道', 272],
  ['已登记契约的通道', 35],
  ['TypeScript / TSX 源文件', 508],
  ['命令规则词表项', 226],
  ['结构性拦截器', 8],
]

describe('promo-readout：词表计数', () => {
  it('护栏按分组现数：多塞一组必须多算（防"写死键清单"再犯）', async () => {
    const { countRuleVocabulary } = await mod()
    const base = countRuleVocabulary(realRules())
    const withExtra = structuredClone(realRules()) as Record<string, Record<string, unknown>>
    const guards = structuredClone(withExtra.readonlyGuards) as Record<string, unknown>
    guards.__probe = { 'a-cmd': ['x'], 'b-cmd': ['y'] }
    withExtra.readonlyGuards = guards
    const next = countRuleVocabulary(withExtra)
    expect(next.vocabulary - base.vocabulary, '新增两组护栏项却没多算，说明计数又回到固定键清单了').toBe(2)
  })

  it('分项加起来等于总数，且结构检测器/argv 规则都取到非零', async () => {
    const { countRuleVocabulary } = await mod()
    const r = countRuleVocabulary(realRules())
    expect(Object.values(r.per).reduce((a, b) => a + b, 0), '分项之和必须等于总数（有一项被双计或漏计就会不等）').toBe(r.vocabulary)
    expect(r.vocabulary).toBeGreaterThan(200)
    expect(r.detectors).toBe(8)
    expect(r.argvRules).toBe(7)
    expect(r.protectedTargets).toBe(15)
  })
})

describe('promo-readout：通道与契约', () => {
  it('audit:ipc 报告取不到行时报错，不静默返回 0', async () => {
    const { parseIpcAudit } = await mod()
    expect(() => parseIpcAudit('随便一段没有通道数的报告')).toThrow(/没取到通道数/)
    const ok = parseIpcAudit('main 注册通道:        232\nmain 事件推送通道:    40\n')
    expect(ok).toEqual({ request: 232, event: 40, total: 272 })
  })

  it('真实契约文件：invoke + event 等于总数，且两条都非零', async () => {
    const { countContract } = await mod()
    const src = fs.readFileSync(path.join(REPO, 'src/shared/ipc-contract.ts'), 'utf8')
    const c = countContract(src)
    expect(c.invoke).toBeGreaterThan(0)
    expect(c.event).toBeGreaterThan(0)
    expect(c.total).toBe(c.invoke + c.event)
  })
})

describe('promo-readout：与宣传页对账', () => {
  it('数字一致时无差异（阳性对照：先证明解析器取到了行）', async () => {
    const { parsePromoReadouts, diffReadouts } = await mod()
    const page = parsePromoReadouts(fakePage())
    expect(Object.keys(page).length, '一行都没取到就是解析器坏了，不是"没有差异"').toBe(MEASURED.length)
    expect(diffReadouts(page, MEASURED)).toEqual([])
  })

  it('页面某个数字错一个 ⇒ 只点名那一条', async () => {
    const { parsePromoReadouts, diffReadouts } = await mod()
    const page = parsePromoReadouts(fakePage({ '命令规则词表项': 216 }))
    const bad = diffReadouts(page, MEASURED)
    expect(bad.length).toBe(1)
    expect(bad[0].label).toBe('命令规则词表项')
    expect(bad[0].got).toBe(216)
    expect(bad[0].want).toBe(226)
  })

  it('页面少了某一行 ⇒ 判"没比上"，不许当成通过', async () => {
    const { parsePromoReadouts, diffReadouts } = await mod()
    const html = fakePage().replace(/<tr><td class="k">结构性拦截器<\/td>[\s\S]*?<\/tr>/, '')
    const bad = diffReadouts(parsePromoReadouts(html), MEASURED)
    expect(bad.length).toBe(1)
    expect(String(bad[0].got)).toContain('页面里没有这一行')
  })
})

/**
 * 用例数四个参数（2026-10-18 加）
 *
 * 为什么加：复现器原先故意不对账两条用例数（跑满套要几分钟，不该塞进秒级闸），
 * 结果是"委托给跑套件的人"——同一天两次撞上数字变了页面没动（3256→3260→3264）。
 * 现在跑完套件把四个数递回来，那两行就真进对账。
 * 关键是**半套数字比没有数字更危险**：只给两个的话，PASS 行会说"7 条都对上了"，
 * 而其中一条其实没参数。所以缺一个就 rc=2 拒跑。
 */
describe('promo-readout 用例数参数 —— 要么全给要么都不给', () => {
  const SCRIPT = path.join(REPO, 'scripts', 'quality', 'promo-readout.mjs')
  const run = (args: string[]) => {
    try {
      const out = execFileSync(process.execPath, [SCRIPT, ...args], {
        cwd: REPO,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return { rc: 0, out }
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string }
      return { rc: err.status ?? 1, out: (err.stdout || '') + (err.stderr || '') }
    }
  }
  const ALL = ['--check', '--unit-passed', '3264', '--unit-skipped', '19', '--e2e-passed', '57', '--e2e-skipped', '15']

  it('四个都给 ⇒ 那两行纳入对账，PASS 行要说清"含两条用例数"', () => {
    const { rc, out } = run(ALL)
    expect(rc, out).toBe(0)
    expect(out).toContain('含两条用例数')
    expect(out).toMatch(/宣传页 7 条读数/)
  })

  it('递一个错的用例数 ⇒ rc=1 且只点名那一条（不是整表红）', () => {
    const { rc, out } = run(ALL.map((a) => (a === '3264' ? '3200' : a)))
    expect(rc, out).toBe(1)
    expect(out).toContain('对不上（1 条）')
    expect(out).toContain('单元与组件用例')
    expect(out).not.toContain('端到端用例：')
  })

  it('只给两个 ⇒ rc=2 拒跑，并点名缺哪几个（半套数字不许换到 PASS）', () => {
    const { rc, out } = run(['--check', '--unit-passed', '3264', '--unit-skipped', '19'])
    expect(rc, out).toBe(2)
    expect(out).toContain('要么全给要么都不给')
    expect(out).toContain('--e2e-passed')
    expect(out).toContain('--e2e-skipped')
    expect(out).not.toContain('PASS')
  })

  it('参数不是整数 ⇒ rc=2（不许 Number() 把 abc 变成 NaN 后悄悄比出一个"不相等"）', () => {
    const { rc, out } = run(['--check', '--unit-passed', 'abc', '--unit-skipped', '19', '--e2e-passed', '57', '--e2e-skipped', '15'])
    expect(rc, out).toBe(2)
    expect(out).toContain('必须是非负整数')
  })

  it('一个都不给 ⇒ 仍然放行，但必须明说那两条没纳入（不许读成"全对上了"）', () => {
    const { rc, out } = run(['--check'])
    expect(rc, out).toBe(0)
    expect(out).toContain('用例数两条未纳入')
    expect(out).not.toContain('含两条用例数')
  })
})
