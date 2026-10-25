/**
 * tests/unit/subagent-fleet-surface.test.ts — Subagent 编队收口的常驻判据（#218 立，#222 改形）
 *
 * 取证（2026-10-25，全部回代码核过）：
 * - 那份注册表造出 9 个实例（coding/thinking/running/search/skill/methodology/history/knowledge/explore），
 *   只有 `supervisor.ts` 的 `this.subagents` 收着；而读这份表的两个查找方法**在 src 与 tests 全仓零调用者**，
 *   `this.subagents` 唯一的真实读者是初始化时那行 `Object.keys(...).length` 的日志计数；
 * - 没有任何 LLM 工具、MCP 工具、IPC 通道或界面元素能派活给它们——`supervisor.ts` 的 docblock
 *   却写着「注册 8 个 Subagent（通过 Plan 阶段调度）」「跨 Subagent 协作 → Plan 阶段调度」。
 *   ⇒ 这一整套是"实例化了、没人按"的 2894 行，而且本轮之前 tests/ 里连引用都没有。
 * - 更要紧的是那份基类的"审批闸门"：它先 `await this.doExecute(task)` 把任务**真的跑完**，
 *   再按强度（deep 默认要审批）把跑完的结果丢掉、换成一个 `{success:false, error:'等待人工审批'}`
 *   的占位返回，而 `requestApproval` 的默认实现只写日志、**从不推审批卡**。
 *   真的把关在 `agent-workflow.ts` 的 confirm 步——它在动手**之前**暂停等人点卡片。
 *
 * 来历（2026-10-25 #222）：**原第 1 条已整删，不是改写。** 那条是行为判据（拿一个真的基类子类跑一次
 * deep 强度任务，断言结果原样返回、不被占位文案顶掉），它的被测主体是 `subagents/base.ts` 的 `execute()`。
 * #222 把 `base.ts` 连同它唯一的子类 `loop-engineering-subagent.ts`、`ipc/loop-engineering.ts`、
 * 前端那个 hook 与整条 `loop:*` 通道一起整删——判决理由是**渲染层没有任何一处能调用它的启动函数**
 * （Composer 把它收成弃用、AIPanel 只读 phase），它的多步编排与仍在跑的 PAOR 自主循环重复，
 * 挂在它上面的审批按钮点了必然落空。实现体不在盘上 ⇒ 这条判据失去对象：再留它就只能靠 import 一个
 * 不存在的模块去"复现"，那是假判据。那份基类的四个公共形状因此改由第 2 条按"全树零命中"钉住。
 * `ipc/loop-engineering.ts` 与那条链的文件面/通道面由同批的 `loop-engineering-surface.test.ts` 钉，
 * 本文件不重复钉，也就不重复咬。
 *
 * 判据各钉一件事：
 * 1. 两批删除的落点都不在盘上：`subagents/` 目录消失，九个类文件换目录也不算活着
 * 2. 九个类名 + 注册表/两个查找方法 + 那份基类的四个公共形状，在 **src 与 tests 全树正文**零命中
 *    （被扫的符号名一律运行时拼——本文件自己也在扫描面里，见下面第一条护栏）
 * 3. supervisor 不许再有那两条没人按的 getter 与那份只用来数数的表
 * 4. 反过度砍（#222 之后的真形状）：活着的那条编排链是 PAOR，主进程内核、界面入口与真审批出口
 *    都在原位；`agent-workflow.ts` 保得住的两条理由（仍服务 MCP 工具出口、仍消费决策超时）都要在场，
 *    且 confirm 仍排在 execute 之前。**已删的那条 loop 链一个字都不许在这里断言"还在"**
 * 5. 三份文档不许再谎报这套编队在跑，且 #218/#222 两轮的出处都要留号
 * 6. 量具自证：本文件那五个判据实现体逐个拿合成样本复测——塞回必须被抓，松形状与干净样本不误伤
 *
 * 两条护栏都是本项目付过学费的：
 * - 被扫的符号名一律**运行时拼**：本文件就在 src+tests 普查面里，写成字面量等于自己进靶场
 *   （第 2 条要么永远红，要么被迫把本文件从普查面里摘掉——那普查面就漏了一个文件）。
 * - 每条"应当零命中 / 应当没有"都由第 6 条配一份"注入样本必须命中"；扫不到东西时不许报绿。
 * - 判据按现状推，不抄任何一天的行数或文件名清单当基线：#222 之后 `subagents/` 整目录没了，
 *   上一版那句"loop-engineering 这条活链与 base 的公共形状必须在"就成了假判据（第 1 条同批删）。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { listSourceFiles, readSourceFile } from '../helpers/source-scan'

const ROOT = path.resolve(__dirname, '../..')

/** #218 判死的那九个实现体（按文件名在全树兜底——换目录复活同样是复活） */
const DEAD_FILE_BASENAMES = [
  'coding-subagent.ts',
  'thinking-subagent.ts',
  'running-subagent.ts',
  'search-subagent.ts',
  'skill-subagent.ts',
  'methodology-subagent.ts',
  'history-subagent.ts',
  'knowledge-subagent.ts',
  'explore-subagent.ts',
]

/** 词根由片段拼出，见文件头第一条护栏 */
const SUB = ['Sub', 'agent'].join('')

/** 九个类名：被 import 就是被接回去的第一种形状 */
const DEAD_CLASS_NAMES = [
  'Coding',
  'Thinking',
  'Running',
  'Search',
  'Skill',
  'Methodology',
  'History',
  'Knowledge',
  'Explore',
].map((prefix) => prefix + SUB)

/**
 * 七个符号名 = #218 判死的注册表与两个查找方法 + #222 判死的那份基类的对外形状。
 * 这份清单就是第 6 条要逐个塞回样本验过的东西，加一个名字就多验一个。
 */
const DEAD_SYMBOLS = [
  ['Base', SUB].join(''), // 基类本体（#222）
  [SUB, 'Task'].join(''), // 入参形状（#222）
  [SUB, 'Result'].join(''), // 返回形状（#222）
  ['create', SUB, 'Task'].join(''), // 入参工厂（#222）
  ['createAll', SUB, 's'].join(''), // 那份没人派的注册表（#218）
  ['get', SUB].join(''), // 查找方法一（#218）
  ['list', SUB, 's'].join(''), // 查找方法二（#218）
]

const ALL_NEEDLES = [...DEAD_CLASS_NAMES, ...DEAD_SYMBOLS]

interface Doc {
  rel: string
  text: string
}

let corpusCache: Doc[] | null = null

/** src 与 tests 全树的 .ts/.tsx 正文，读一次缓存住（每条判据都跑全树，别把同一批文件读二十遍） */
function corpus(): Doc[] {
  if (corpusCache) return corpusCache
  const docs: Doc[] = []
  for (const dir of ['src', 'tests']) {
    for (const abs of listSourceFiles(path.join(ROOT, dir))) {
      docs.push({ rel: path.relative(ROOT, abs).split(path.sep).join('/'), text: readSourceFile(abs) })
    }
  }
  return (corpusCache = docs)
}

/**
 * 只取代码正文：注释里出现这些词是在解释"为什么删了"，不算复活。
 * 第 5 条读 .md 不经这里——文档本来就该写它删过什么。
 */
function codeOnly(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
}

/** 判据 2 的实现体：抽成纯函数，好让第 6 条拿合成样本复测同一个扫描 */
function scanDocs(docs: Doc[], needle: string): string[] {
  return docs.filter((d) => codeOnly(d.text).includes(needle)).map((d) => d.rel)
}

/** 判据 1 的实现体：按文件名在全树兜底 */
function findFilesByBasename(docs: Doc[], names: string[]): string[] {
  return docs.filter((d) => names.includes(path.basename(d.rel))).map((d) => d.rel)
}

/** 判据 3 的实现体：supervisor 里那四条死接线的形状（名字同样运行时拼） */
const BANNED_SHAPES = [
  ['get', SUB, '('].join(''),
  ['list', SUB, 's()'].join(''),
  ['createAll', SUB, 's()'].join(''),
  'private readonly subagents',
]

function supervisorWiring(text: string): string[] {
  const code = codeOnly(text)
  return BANNED_SHAPES.filter((b) => code.includes(b))
}

/** 判据 4 的那句顺序断言的实现体：confirm 必须排在 execute 之前，否则命令已经跑完才问人 */
function gateOrder(code: string): { confirmAt: number; executeAt: number } {
  return { confirmAt: code.indexOf(`'confirm'`), executeAt: code.indexOf(`'execute'`) }
}

/** 判据 5 的实现体：返回"还写着哪句谎 / 缺哪个出处"，空数组才是通过 */
function docGaps(text: string, lies: string[], provenances: string[]): string[] {
  return [
    ...lies.filter((lie) => text.includes(lie)).map((lie) => `仍写着「${lie}」`),
    ...provenances.filter((p) => !text.includes(p)).map((p) => `缺 ${p} 的出处`),
  ]
}

function readCode(rel: string): string {
  const text = readSourceFile(path.join(ROOT, rel))
  // 反过度砍那类判据最怕"文件没了，于是断言对着空串绿"——先证明真读到了东西
  expect(text, `${rel} 读不到——那不是判过了，那是没查`).not.toBe('')
  return codeOnly(text)
}

/** 长文件一律走这个而不是 toContain：失败时回显整篇正文，会把真正那句话埋掉 */
function mustContain(text: string, needle: string, why: string): void {
  expect(text.includes(needle), `${why}（正文里已经搜不到「${needle}」）`).toBe(true)
}

describe('Subagent 编队收口（#218 立 / #222 改形）', () => {
  it('1. subagents 目录与那九个实现体都不在盘上', () => {
    // 正对照：同一个 existsSync 对活着的父目录必须报真，否则"报假"不等于"不在盘上"
    expect(fs.existsSync(path.join(ROOT, 'src/main/core/agent')), '父目录都不见了——那是工作树坏了，不是删过了').toBe(
      true
    )
    expect(
      fs.existsSync(path.join(ROOT, 'src/main/core/agent/subagents')),
      '目录又回来了——那份基类唯一的子类已在 #222 整删，留着它就是个没有子类的壳'
    ).toBe(false)
    expect(findFilesByBasename(corpus(), DEAD_FILE_BASENAMES), '九个类文件换了目录同样是复活').toEqual([])
  })

  it('2. 九个类名与注册表/查找方法/基类的公共形状，在 src 与 tests 全树正文零命中', () => {
    const docs = corpus()
    expect(docs.length, '普查一个文件都没抽到——那不是"零命中"，那是没扫').toBeGreaterThan(0)
    // 两个哨兵各证明半片扫描面真在场：src 侧与 tests 侧（后者同时证明本文件自净过）
    for (const sentinel of ['src/main/core/agent/supervisor.ts', 'tests/unit/subagent-fleet-surface.test.ts']) {
      expect(docs.some((d) => d.rel === sentinel), `普查面里没有 ${sentinel}——扫描口径坏了`).toBe(true)
    }
    for (const needle of ALL_NEEDLES) {
      expect(needle.length, '拼出来的名字不许是空串，空串在任何文件里都命中').toBeGreaterThan(0)
      expect(scanDocs(docs, needle), `${needle} 在这些文件里复活了`).toEqual([])
    }
  })

  it('3. supervisor 不许再有那两条没人按的 getter 与那份只用来数数的表', () => {
    expect(supervisorWiring(readCode('src/main/core/agent/supervisor.ts')), '死接线又回来了').toEqual([])
  })

  it('4. 反过度砍：活着的那条编排链（PAOR）与真闸门一条都不许跟着编队一起走', () => {
    // 产品里真正在跑的多步编排只有 PAOR：主进程内核 → 界面入口 → 真审批出口
    mustContain(readCode('src/main/core/agent/supervisor.ts'), 'runPaorLoop', 'PAOR 内核没了——那是把活链一起砍了')
    mustContain(
      readCode('src/renderer/src/components/workbench/Composer.tsx'),
      'paor.start',
      'Composer 上那颗 PAOR 入口没了'
    )
    mustContain(readCode('src/preload/index.ts'), 'paorApprove', '真审批出口那把 preload 键没了')
    mustContain(
      readCode('src/renderer/src/components/layout/MainLayout.tsx'),
      'paorApprove',
      '全局审批条不再应答真审批出口'
    )
    // agent-workflow.ts 保留的理由有两条，两条都要当场验：仍服务 MCP 工具出口、仍消费决策超时设置
    const wf = readCode('src/main/core/agent-workflow.ts')
    mustContain(wf, 'resolveConfirmTimeoutMs', '设置页那条决策超时就成了没人消费的读数')
    mustContain(wf, 'decision.decisionTimeout', 'workflow 不再读决策超时，那个设置就是摆设')
    mustContain(
      readCode('src/main/services/mcp/tools/legacy-handlers.ts'),
      'core/agent-workflow',
      'MCP 出口不再 import 它，agent-workflow 就成了新的死码'
    )
    const order = gateOrder(wf)
    expect(order.confirmAt, 'workflow 里没有 confirm 步').toBeGreaterThan(-1)
    expect(order.executeAt, 'workflow 里没有 execute 步').toBeGreaterThan(-1)
    expect(order.confirmAt < order.executeAt, 'confirm 排到 execute 之后了——那等于先动手再问').toBe(true)
  })

  it('5. 三份文档不许再谎报这套编队在跑，且两轮改口都要留出处', () => {
    // 只钉两档：旧谎报词不许在、本轮编号要在。**不钉任何具体句子**——这三份文档正被文档作者同步改口，
    // 钉句子等于替别人写文档，而且下一轮必然误红（实景清单那份的引旧句格式尤其扛不住窄 needle）。
    const targets: Array<[string, string[]]> = [
      ['README.md', ['8 个 Subagent 在总控里注册', '还没有生产调用点']],
      ['docs/功能实景清单.md', ['按名调度']],
      ['docs/长期优化目标.md', ['Subagent 本体与 supervisor 调度保留']],
    ]
    for (const [rel, lies] of targets) {
      const text = readSourceFile(path.join(ROOT, rel))
      expect(text, `${rel} 读不到——那不是判过了，那是没查`).not.toBe('')
      expect(docGaps(text, lies, ['#218', '#222']), `${rel} 的口径还差这些`).toEqual([])
    }
    // supervisor 自己的门牌也不能再承诺"Plan 阶段调度 Subagent"
    const sup = readSourceFile(path.join(ROOT, 'src/main/core/agent/supervisor.ts'))
    expect(sup, 'supervisor.ts 读不到——那不是判过了，那是没查').not.toBe('')
    expect(docGaps(sup, ['通过 Plan 阶段调度', '跨 Subagent 协作', 'AGENT-BOUNDARY'], []), 'supervisor 门牌又谎报起来').toEqual(
      []
    )
  })

  it('6. 量具自证：本文件五个判据实现体逐个拿合成样本复测', () => {
    // 判据 3：四类死接线逐个塞回，必须各自被报出；干净样本一条不报
    for (const shape of BANNED_SHAPES) {
      expect(supervisorWiring(`class S { ${shape} }\n`), `注入的「${shape}」没被抓到`).toEqual([shape])
    }
    expect(supervisorWiring('class S { readonly roles: string[] = [] }\n'), '干净样本被误伤').toEqual([])

    // 判据 2：十六个名字每一个都要真能匹配。名字拼错、片段接反、注释过滤过头，
    // 都会在这里红——而不是让第 2 条对着一片空命中报绿。
    for (const needle of ALL_NEEDLES) {
      const docs: Doc[] = [
        { rel: 'canary.ts', text: `export const use = ${needle}\n` },
        // 松形状：沾边但都不是那十六个名字（bySubagent / 小写目录名），必须一条不报
        { rel: 'near.ts', text: `const by${SUB} = {}\nconst subagents = 1\n` },
        // 注释豁免是文件头写明的口径：源码与测试里解释"曾叫什么、为什么删"不算复活
        { rel: 'note.ts', text: `// 曾叫 ${needle}，#218 已整删\n` },
      ]
      expect(scanDocs(docs, needle), `注入的 ${needle} 没被抓到——第 2 条那句"零命中"是假绿`).toEqual(['canary.ts'])
    }

    // 判据 1：换个目录复活也要被抓，正常文件名不误伤
    const resurrected: Doc[] = [{ rel: 'src/main/core/agent/挪到这里/coding-subagent.ts', text: '' }]
    const normal: Doc[] = [{ rel: 'src/main/core/agent/supervisor.ts', text: '' }]
    expect(
      findFilesByBasename(resurrected, DEAD_FILE_BASENAMES),
      '目录换了就抓不到——那第 1 条只防住了原路径'
    ).toEqual(['src/main/core/agent/挪到这里/coding-subagent.ts'])
    expect(findFilesByBasename(normal, DEAD_FILE_BASENAMES), '正常文件名被误伤').toEqual([])

    // 判据 4 那句顺序：把两步调了个儿的样本必须报"排在后面"，缺一步的样本要报 -1
    const reversed = `async run() { await this.runStep('execute', a); await this.runStep('confirm', b) }`
    const reversedOrder = gateOrder(reversed)
    expect(reversedOrder.confirmAt < reversedOrder.executeAt, '顺序判据反了也不红——那它压根没在看顺序').toBe(false)
    expect(gateOrder(`async run() { await this.runStep('plan', a) }`).confirmAt, '缺 confirm 时没报 -1').toBe(-1)

    // 判据 5：谎话与缺出处都要被抓，改好口径的样本不误伤
    const lying = '本工具注册了 8 个 Subagent 在总控里注册，还没有生产调用点。'
    const honest = '这套编队已于 2026-10-25 整删（#218 / #222），派发点在 supervisor 的工具环。'
    const lies = ['8 个 Subagent 在总控里注册', '还没有生产调用点']
    expect(docGaps(lying, lies, ['#218']), '谎报句与缺出处都没被抓——那第 5 条是恒绿的').toEqual([
      '仍写着「8 个 Subagent 在总控里注册」',
      '仍写着「还没有生产调用点」',
      '缺 #218 的出处',
    ])
    expect(docGaps(honest, ['按名调度'], ['#218', '#222']), '改好口径的样本被误伤').toEqual([])
  })
})
