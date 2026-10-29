/**
 * tests/unit/loop-engineering-surface.test.ts — 循环工程那族的删除判据（#222）
 *
 * 为什么要有这一族判据：
 *   2026-10-25 实测发现，`loop:*` 这条链（主进程 IPC + 子 agent + 前端 hook）三处都在，
 *   但**渲染层没有任何一处调用它的启动函数**——Composer 把 loop 收成 `_loop` 弃用，
 *   AIPanel 只读 `loop.phase`。它管的多步自主编排与已经在跑的 PAOR 重复，而 PAOR 那颗
 *   「PAOR 自主循环」按钮才是真入口。连带后果落在两个决策页上：
 *     - DecisionPage 的采纳/修改/拒绝三处，correlationId 只从 loop 推送里来，推送永不到来
 *       ⇒ 三处都在第一行 return，用户点了没有任何反应；
 *     - DecisionDetailPage 的三处拿**历史记录 id**（`historyGet` 读回来的）去敲那扇门，
 *       而那扇门只认循环工程的 correlationId ⇒ 必然得到一句「主进程拒绝执行」。
 *   按钮真伪普查（tests/e2e/button-truth-census.spec.ts）抓不到这两族：决策中心那块面板是条件
 *   渲染（看不见就不判），详情页那颗点了**有反馈**（一句失败话），在普查口径里算"有反应=真按钮"。
 *   这是普查对"有反应但反应是拒绝"这一族的结构性失明，口径写进 docs/功能实景清单.md。
 *
 * 判决（用户 2026-10-25 选「全删」）：整删这一族，决策详情页回到"看历史 + 审计链 + 置信度"。
 * 真审批出口 paorApprove（全局审批条 + 终端权限条）必须完好，由第 4 条钉住防过度砍。
 *
 * 两条护栏都是本项目付过学费的：
 *   - 判据按"扫全树"取数，所以被检的通道名与键名**不许以字面量写进本文件**（否则自己进扫描面），
 *     一律运行时拼；扫描面只取 src/，不取 tests/。
 *   - 每条"应当 0 命中"都配一条"注入样本必须命中"的量具自证（第 5 条），扫不到东西时不许报绿。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')

interface Doc {
  name: string
  text: string
}

/** 运行时拼出来的十条通道名，避免本文件自己成为被扫样本 */
function channelNames(): string[] {
  const prefix = ['lo', 'op'].join('')
  const sep = [':'].join('')
  return ['start', 'confirm', 'cancel', 'llm-start', 'llm-done', 'step', 'decision', 'done', 'error', 'blocked'].map(
    (t) => `${prefix}${sep}${t}`
  )
}

/**
 * 键名形状而不是名单：`(on)?[Ll]oop + 大写字母开头`。
 * 为什么要这个宽度——preload 有两套写法，`index.ts` 里是 `loopStart` / `onLoopStep`，
 * `domains/events.ts` 里是 `loopStep` / `loopDecision`（没有 on 前缀）。只钉一种写法，
 * 删干净另一套时判据会照旧报绿（本项目在这条坑上摔过：一种形状的正则＝量具的半盲）。
 * 它同时不会误伤 `usePaorLoop`（Loop 后面没东西）与 `ssh-fixture-loopback`（后面是小写）。
 * 写第一版时这里踩过一次：`on?` 是「字母 o 加可选 n」而不是「可选的 on」，于是裸写法（`loopDecision`）
 * 一条也抽不到——第 5 条那个两向自证当场把它照出来了（该中的没中，判据自己红）。
 */
const KEY_SHAPE = /(^|[^A-Za-z])(?:on)?[Ll]oop[A-Z]/

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8')
}

/** 递归收集 src 下所有 .ts/.tsx 正文 */
function srcDocs(dir = 'src', out: Doc[] = []): Doc[] {
  const abs = path.join(ROOT, dir)
  if (!existsSync(abs)) return out
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      srcDocs(rel, out)
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push({ name: rel, text: read(rel) })
    }
  }
  return out
}

/** 在给定正文集里找某个 needle 的命中位置（file:行号） */
function scan(docs: Doc[], needle: string): string[] {
  const hits: string[] = []
  for (const doc of docs) {
    doc.text.split('\n').forEach((line, i) => {
      if (line.includes(needle)) hits.push(`${doc.name}:${i + 1}`)
    })
  }
  return hits
}

/** 同上，但按形状（正则）取数——用来抓"两种写法"这一族 */
function scanShape(docs: Doc[], re: RegExp): string[] {
  const hits: string[] = []
  for (const doc of docs) {
    doc.text.split('\n').forEach((line, i) => {
      if (re.test(line)) hits.push(`${doc.name}:${i + 1}`)
    })
  }
  return hits
}

const GONE_FILES = [
  'src/main/ipc/loop-engineering.ts',
  'src/main/core/agent/subagents/loop-engineering-subagent.ts',
  'src/main/core/agent/subagents/base.ts',
  'src/renderer/src/components/workbench/useLoopEngineering.ts',
  'scripts/test-loop-engineering-smoke.ts'
]

describe('循环工程一族（loop:* 那十通道 + 十个键）已整删，且没把真审批链一起砍掉（#222）', () => {
  it('1. 五个实现体与那份冒烟脚本都不在盘上，subagents 目录一起消失', () => {
    const stillThere = GONE_FILES.filter((rel) => existsSync(path.join(ROOT, rel)))
    expect(stillThere, '这些文件应随 #222 一起删掉').toEqual([])
    // base.ts 唯一的子类就是循环工程，子类没了它就成了半态
    expect(existsSync(path.join(ROOT, 'src/main/core/agent/subagents')), 'subagents 目录应随最后一个子类消失').toBe(
      false
    )
  })

  it('2. src 全树搜不到任何一条通道名，也搜不到任何一个 loop 形状键名', () => {
    const docs = srcDocs()
    expect(docs.length, '扫描面必须真的抽到源文件').toBeGreaterThan(200)
    const channelHits = channelNames().flatMap((n) => scan(docs, n))
    expect(channelHits, `还残留通道名：${channelHits.join(', ')}`).toEqual([])
    const shapeHits = scanShape(docs, KEY_SHAPE)
    expect(shapeHits, `还残留这条链的键名/类型名：${shapeHits.slice(0, 20).join(', ')}`).toEqual([])
  })

  it('3. 渲染层不再挂这个 hook，两个决策页也不再敲那扇门', () => {
    const hookNeedle = ['useLoop', 'Engineering'].join('')
    const panelDocs = [
      { name: 'a', text: read('src/renderer/src/components/workbench/AIPanel.tsx') },
      { name: 'c', text: read('src/renderer/src/components/workbench/Composer.tsx') }
    ]
    expect(scan(panelDocs, hookNeedle), 'AIPanel / Composer 不再挂这条死链').toEqual([])
    const confirmNeedle = ['loop', 'Confirm'].join('')
    const pageDocs = [
      { name: 'list', text: read('src/renderer/src/pages/DecisionPage.tsx') },
      { name: 'detail', text: read('src/renderer/src/pages/DecisionDetailPage.tsx') }
    ]
    expect(scan(pageDocs, confirmNeedle), '决策页还在敲循环工程的门').toEqual([])
    // 这两页整页都不许再出现这条链的形状（含 decision-loop-helpers 那族类型名）
    expect(scanShape(pageDocs, KEY_SHAPE), '决策页仍引用这条链的类型/事件').toEqual([])
  })

  it('4. 反过度砍：真审批链与真读数一条都不许跟着走', () => {
    // PAOR 才是产品里那条活的多步编排链，入口与内核都要在原位
    expect(read('src/main/core/agent/supervisor.ts')).toContain('runPaorLoop')
    expect(read('src/renderer/src/components/workbench/Composer.tsx')).toContain('paor.start')
    // 真审批出口：preload 键 + 全局审批条的调用点
    expect(read('src/preload/index.ts')).toContain('paorApprove')
    expect(read('src/renderer/src/components/layout/MainLayout.tsx')).toContain('paorApprove')
    // #281 之后这两样都不该回来：入站 MCP 工具表与它唯一的服务对象（工作流内核）
    for (const gone of ['src/main/core/agent-workflow.ts', 'src/main/services/mcp/tools/legacy-handlers.ts']) {
      expect(require('node:fs').existsSync(require('node:path').resolve(__dirname, '../..', gone)), `${gone} 又回来了——#281 的判决要重开`).toBe(false)
    }
    // 决策超时的真消费者搬到了审批等待器本身（设置页那条键不再挂在死内核上）
    expect(read('src/main/core/security/approval-request.ts')).toContain('setApprovalTimeoutSource')
    // 决策详情页仍然"读库里那一份 + 看审计链"，删的只是按不动的那三颗按钮
    const detail = read('src/renderer/src/pages/DecisionDetailPage.tsx')
    expect(detail).toContain('historyGet')
    expect(detail).toContain('historyAudit')
  })

  it('5. 量具自证：两种写法都要抽得到、邻近形状不许误伤', () => {
    const chans = channelNames()
    expect(chans).toHaveLength(10)
    const injected: Doc[] = [
      { name: 'canary', text: ['const A = {', `  START: '${chans[0]}',`, '  B: 1', '}'].join('\n') },
      { name: 'clean', text: 'const NOTHING = 1' }
    ]
    expect(chans.flatMap((c) => scan(injected, c)), '坏样本必须被抽出，且只抽出注入那一条').toEqual(['canary:2'])

    // 键名形状：index.ts 的 on 前缀写法与 domains/events.ts 的裸写法各一条，必须都命中
    const shapeDocs: Doc[] = [
      { name: 'on-style', text: '  onLoopStep: (cb) => subscribe(1, cb),' },
      { name: 'bare-style', text: '  loopDecision: (callback) => createListener(2, callback)' },
      { name: 'decoy-paor', text: 'import { usePaorLoop } from "./usePaorLoop"' },
      { name: 'decoy-lower', text: 'const target = "ssh-fixture-loopback"' },
      { name: 'decoy-word', text: 'this is a loop in the scheduler' }
    ]
    expect(scanShape(shapeDocs, KEY_SHAPE), '形状判据必须同时认得这两种写法').toEqual([
      'on-style:1',
      'bare-style:1'
    ])
  })

  it('6. 文档不再谎报这条链在跑，且改口带本轮编号', () => {
    const live = read('docs/功能实景清单.md')
    // A 档那行的原话形状是「…的 loopStart/Confirm/Cancel」，运行时拼以免自噬
    const rowNeedle = ['lo', 'op', 'Start'].join('') + '/' + 'Confirm' + '/' + 'Cancel'
    expect(live.includes(rowNeedle), '实景清单的 A 档不许再列这条没人启动的链').toBe(false)
    expect(live).toContain('#222')
    expect(read('README.md')).toContain('#222')
  })
})
