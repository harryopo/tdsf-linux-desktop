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
