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
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const MODULE_SPEC = '../../scripts/quality/promo-readout.mjs'

type Readouts = {
  countRuleVocabulary: (rules: unknown) => { vocabulary: number; per: Record<string, number>; detectors: number; argvRules: number; protectedTargets: number }
  countContract: (source: string) => { invoke: number; event: number; total: number }
  parseIpcAudit: (text: string) => { request: number; event: number; total: number }
  parsePromoReadouts: (html: string) => Record<string, number | null>
  parseMdReadoutRows: (text: string, labels: string[]) => Record<string, Array<number | null>>
  diffMdReadouts: (
    occ: Record<string, Array<number | null>>,
    measured: Array<[string, number]>
  ) => Array<{ label: string; got: unknown; want: number }>
  diffReadouts: (page: Record<string, number | null>, measured: Array<[string, number]>) => Array<{ label: string; got: unknown; want: number }>
  measure: () => unknown
  TABLE_ROWS: (m: unknown) => Array<[string, number]>
  MD_EXTRA_ROWS: (m: unknown) => Array<[string, number]>
  readRepoFacts: () => unknown
  countProviderTypes: (source: string) => number
  parseSvgClaims: (text: string) => Record<string, number>
  diffDiagram: (
    facts: unknown,
    svgText: string
  ) => { bad: Array<{ label: string; got: number; want: number }>; checked: number; svg: Record<string, number> }
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
 * README 架构图上的读数（2026-10-19 纳入对账）
 *
 * 为什么也纳入：图是手抄同一批数字的第二个载体。宣传页那次教训（216 vs 226）说明
 * "抄一份就漂一份"，多一个载体就多一份责任。图上七个数的来源是生成器
 * （scripts/docs/arch-diagram.py），要改数改生成器再重出图，别直接改 SVG。
 * 其中请求 / 事件两条要跑 audit:ipc，只有 --check 全量模式比得到；这里比另外五条。
 */
describe('promo-readout：与架构图对账', () => {
  const ARCH_SVG = path.join(REPO, 'docs', 'assets', 'architecture.svg')
  /** 与真图同形的最小夹具：七个数各占一行；传 null 表示"图上这一行没了" */
  const SVG_LINES = {
    请求: 'invoke 请求（232 条通道）',
    事件: '事件推送（40 条通道）',
    契约: '35 条已登记 zod 契约（其余未收口）',
    闸: '8 结构 + 7 argv + 226 词表',
    端点: '7 类兼容端点',
  }
  function fakeSvg(overrides: Partial<Record<keyof typeof SVG_LINES, string | null>> = {}): string {
    const kept: Record<keyof typeof SVG_LINES, string | null> = { ...SVG_LINES, ...overrides }
    return (Object.keys(kept) as Array<keyof typeof SVG_LINES>)
      .map((k) => kept[k])
      .filter((l): l is string => l !== null)
      .join('\n')
  }
  const FACTS = {
    contract: { total: 35 },
    rules: { vocabulary: 226, detectors: 8, argvRules: 7 },
    providers: 7,
  }

  it('七个数全取到 + 与实测一致时无差异（阳性对照：先证明解析器扫得中东西）', async () => {
    const { diffDiagram } = await mod()
    const r = diffDiagram(FACTS, fakeSvg())
    expect(Object.keys(r.svg).length, '一行都没取到就是解析器坏了，不是"没有差异"').toBe(7)
    expect(r.bad, JSON.stringify(r.bad)).toEqual([])
    expect(r.checked).toBe(5)
  })

  it('图上某个数错一个 ⇒ 只点名那一条', async () => {
    const { diffDiagram } = await mod()
    const r = diffDiagram(FACTS, fakeSvg({ 闸: '8 结构 + 7 argv + 216 词表' }))
    expect(r.bad.length).toBe(1)
    expect(r.bad[0].label).toBe('命令规则词表项')
    expect(r.bad[0].got).toBe(216)
    expect(r.bad[0].want).toBe(226)
  })

  it('图上少一行 ⇒ 报错，不许因为"没取到所以没差异"而放行', async () => {
    const { diffDiagram } = await mod()
    expect(() => diffDiagram(FACTS, fakeSvg({ 闸: null }))).toThrow(/架构图里没找到/)
  })

  it('provider-factory 数不到 case 分支 ⇒ 报错，不静默返回 0', async () => {
    const { countProviderTypes } = await mod()
    expect(() => countProviderTypes('export function f(x){ return x }')).toThrow(/没数到 case 分支/)
    expect(countProviderTypes("case 'a':\ncase 'b': {\ncase 'a':\n")).toBe(2)
  })

  it('仓库里那张真图与真文件对得上（这条就是常驻闸本体）', async () => {
    const { diffDiagram, readRepoFacts } = await mod()
    const r = diffDiagram(readRepoFacts(), fs.readFileSync(ARCH_SVG, 'utf8'))
    expect(r.bad, '图上的数与仓库实测不一致：改 scripts/docs/arch-diagram.py 再重出图').toEqual([])
    expect(r.checked).toBe(5)
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

  /**
   * 夹具页写在系统临时目录，**不读仓库旁边那份 harryopo.github.io 检出**。
   * 2026-10-18 CI 三条红就是踩在这里：默认路径指向仓库外的兄弟目录，
   * 本机有那份检出所以绿，CI 上没有 ⇒ 闸报"宣传页不在"，测试把闸的失败读成断言失败。
   * 五行基础读数取自 measure() 本身（不是手抄），所以源文件数这类会随提交变的数不会让本用例假红；
   * 标签表用模块导出的 TABLE_ROWS，测试与脚本不可能漂开。
   */
  let tmpDir = ''
  let baseRows: Array<[string, number]> = []
  let mdExtraRows: Array<[string, number]> = []
  /** 图那一面的夹具路径（见 beforeAll 里的说明：不指到夹具就会绑上盘上那张真图） */
  let diagramFixture = ''
  let diagramFixtureBad = ''
  const COUNT_ROWS: Array<[string, number]> = [
    ['单元与组件用例', 3264],
    ['端到端用例', 57],
  ]

  beforeAll(async () => {
    const m = await mod()
    const measured = m.measure()
    baseRows = m.TABLE_ROWS(measured)
    // README 那一面同样从模块取，不手抄标签
    mdExtraRows = m.MD_EXTRA_ROWS(measured)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-fixture-'))
    // 图夹具的数全部从 measure() 现取，理由与 fixtureMd 相同：手抄的数会让
    // "闸对不对"取决于"图这轮重出过没有"。七个标签的形状照 parseSvgClaims 的正则。
    const svgLines = [
      `invoke 请求（${measured.ipc.request} 条通道）`,
      `事件推送（${measured.ipc.event} 条通道）`,
      `${measured.contract.total} 条已登记 zod 契约（其余未收口）`,
      `${measured.rules.detectors} 结构 + ${measured.rules.argvRules} argv + ${measured.rules.vocabulary} 词表`,
      `${measured.providers} 类兼容端点`,
    ]
    diagramFixture = path.join(tmpDir, 'diagram.svg')
    fs.writeFileSync(diagramFixture, svgLines.join('\n') + '\n', 'utf8')
    // 反证用：只把词表那一个数改成相邻的另一个数（形状必须仍然取得到，
    // 否则报的是"图改了措辞"而不是"数对不上"，那条判据就考错了东西）
    diagramFixtureBad = path.join(tmpDir, 'diagram-bad.svg')
    fs.writeFileSync(
      diagramFixtureBad,
      svgLines
        .map((l) => (l === svgLines[3] ? l.replace(String(measured.rules.vocabulary), String(measured.rules.vocabulary + 1)) : l))
        .join('\n') + '\n',
      'utf8'
    )
  })
  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  /** 生成一张与真页同形的表；counts=false 时不写那两行用例数 */
  function fixture(name: string, counts: boolean, overrides: Record<string, number> = {}): string {
    const rows = counts ? [...baseRows, ...COUNT_ROWS] : baseRows
    const html =
      '<table><tbody>' +
      rows
        .map(([label, v]) => `<tr><td class="k">${label}</td><td class="v">${overrides[label] ?? v} 通过</td></tr>`)
        .join('\n') +
      '</tbody></table>'
    const p = path.join(tmpDir, name + '.html')
    fs.writeFileSync(p, html, 'utf8')
    return p
  }

  /**
   * 与真 README 同形的读数表夹具。
   * 为什么必须可指：README 那一面对的是**本轮传进来的用例数**，硬读盘上那份会让
   * "闸对不对"取决于"文档这轮改过没有"——CI 三条红就是这么来的（夹具喂 3264、真文档写着 3276）。
   */
  function fixtureMd(name: string, counts: boolean, overrides: Record<string, number> = {}): string {
    const rows = [...baseRows, ...mdExtraRows, ...(counts ? COUNT_ROWS : [])]
    const md =
      [
        '| 读数 | 值 | 怎么量的 |',
        '|---|---|---|',
        ...rows.map(([label, v]) => `| ${label} | ${overrides[label] ?? v} 通过 | 由 promo:check 现场算 |`),
      ].join('\n') + '\n'
    const p = path.join(tmpDir, name + '.md')
    fs.writeFileSync(p, md, 'utf8')
    return p
  }

  const COUNT_ARGS = ['--unit-passed', '3264', '--unit-skipped', '19', '--e2e-passed', '57', '--e2e-skipped', '15']

  it('四个都给 ⇒ 那两行纳入对账，PASS 行要说清"含两条用例数"', () => {
    const { rc, out } = run([
      '--check',
      fixture('all-four', true),
      '--readme',
      fixtureMd('all-four', true),
      '--diagram',
      diagramFixture,
      ...COUNT_ARGS,
    ])
    expect(rc, out).toBe(0)
    expect(out).toContain('含两条用例数')
    expect(out).toMatch(/宣传页 7 条读数/)
    // README 那一面比宣传页多两行（argv 规则 / Provider 类型），给足参数时是 9 条
    expect(out).toMatch(/README 9 条读数/)
  })

  it('README 与宣传页各抄一份时，比的是每一处：文档抄错只点名文档那一条', () => {
    const { rc, out } = run([
      '--check',
      fixture('md-only-wrong', true),
      '--readme',
      fixtureMd('md-only-wrong', true, { 命令规则词表项: 216 }),
      '--diagram',
      diagramFixture,
      ...COUNT_ARGS,
    ])
    expect(rc, out).toBe(1)
    expect(out).toContain('README 的读数与本轮实测对不上（1 条）')
    expect(out).toContain('命令规则词表项：文档写 216')
    expect(out).not.toContain('宣传页的读数与本轮实测对不上')
  })

  it('递一个错的用例数 ⇒ rc=1 且只点名那一条（不是整表红）', () => {
    const { rc, out } = run([
      '--check',
      fixture('wrong-unit', true),
      // README 夹具跟着参数写 3200，于是只有页面那一条对不上——证明点名是逐面的
      '--readme',
      fixtureMd('wrong-unit', true, { 单元与组件用例: 3200 }),
      '--diagram',
      diagramFixture,
      '--unit-passed',
      '3200',
      '--unit-skipped',
      '19',
      '--e2e-passed',
      '57',
      '--e2e-skipped',
      '15',
    ])
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
    const { rc, out } = run([
      '--check',
      '--unit-passed',
      'abc',
      '--unit-skipped',
      '19',
      '--e2e-passed',
      '57',
      '--e2e-skipped',
      '15',
    ])
    expect(rc, out).toBe(2)
    expect(out).toContain('必须是非负整数')
  })

  it('一个都不给 ⇒ 仍然放行，但必须明说那两条没纳入（不许读成"全对上了"）', () => {
    const { rc, out } = run([
      '--check',
      fixture('no-counts', false),
      '--readme',
      fixtureMd('no-counts', false),
      '--diagram',
      diagramFixture,
    ])
    expect(rc, out).toBe(0)
    expect(out).toContain('用例数两条未纳入')
    expect(out).not.toContain('含两条用例数')
  })

  it('--diagram 指的夹具里词表数写错 ⇒ 只点名架构图那一条（证明这个开关真被读，不是摆设）', () => {
    const { rc, out } = run([
      '--check',
      fixture('diagram-wrong', true),
      '--readme',
      fixtureMd('diagram-wrong', true),
      '--diagram',
      diagramFixtureBad,
      ...COUNT_ARGS,
    ])
    expect(rc, out).toBe(1)
    expect(out).toContain('架构图的读数与本轮实测对不上（1 条）')
    expect(out).toContain('命令规则词表项')
    expect(out).not.toContain('宣传页的读数与本轮实测对不上')
    expect(out).not.toContain('README 的读数与本轮实测对不上')
  })

  it('页面确实不在 ⇒ 报"宣传页不在"并红，不许当成通过（找不到可比的东西就是失败）', () => {
    const { rc, out } = run([
      '--check',
      path.join(tmpDir, 'does-not-exist.html'),
      '--readme',
      fixtureMd('absent-page', false),
    ])
    expect(rc, out).toBe(1)
    expect(out).toContain('宣传页不在')
  })

  it('README 不在 ⇒ 同样报失败并红（没有可比对象就不是"通过"）', () => {
    const { rc, out } = run([
      '--check',
      fixture('absent-readme', false),
      '--readme',
      path.join(tmpDir, 'no-such-readme.md'),
    ])
    expect(rc, out).toBe(1)
    expect(out).toContain('README 不在')
  })
})
