/**
 * tests/unit/subagent-fleet-surface.test.ts — Subagent 编队收口（#218）
 *
 * 取证（2026-10-25，全部回代码核过）：
 * - `createAllSubagents()` 造出 9 个实例（coding/thinking/running/search/skill/methodology/history/
 *   knowledge/explore），只有 `supervisor.ts` 的 `this.subagents` 收着；
 * - 而读这份表的两个方法 `getSubagent()` / `listSubagents()` **在 src 与 tests 全仓零调用者**，
 *   `this.subagents` 唯一的真实读者是初始化时那行 `Object.keys(...).length` 的日志计数；
 * - 没有任何 LLM 工具、MCP 工具、IPC 通道或界面元素能派活给它们——`supervisor.ts` 的 docblock
 *   却写着「注册 8 个 Subagent（通过 Plan 阶段调度）」「跨 Subagent 协作 → Plan 阶段调度」。
 *   ⇒ 这一整套是"实例化了、没人按"的 2894 行，而且没有一条测试覆盖（本轮之前 tests/ 里连引用都没有）。
 * - 更要紧的是 `BaseSubagent.execute()` 的"审批闸门"：它先 `await this.doExecute(task)` 把任务**真的跑完**，
 *   再按 `isApprovalRequired`（默认对 `strength === 'deep'` 返回 true）把跑完的结果丢掉、换成一个
 *   `{success:false, error:'等待人工审批'}` 的占位返回，而 `requestApproval` 的默认实现只写日志、
 *   **从不推审批卡**。循环工程那条活链（`ipc/loop-engineering.ts:187` 调 `.execute(task)`，
 *   界面能选 deep）正好走在这条路上。真的闸门在 `agent-workflow.ts` 的 confirm 步，
 *   它在 execute **之前**暂停等人点卡片——所以 base 这段既拦不住任何东西，又把结果吃掉。
 *
 * 判决口径与 #193/#195/#216 一致：先问"那件事本来由谁做"。派活这件事现在由 supervisor 自己的
 * 工具环与 PAOR 编排做，这 9 个类是第二套没接上的编排 ⇒ 整删（代码留在 git 历史）。
 * 唯一的例外是 `loop-engineering-subagent`：它由 `ipc/loop-engineering.ts` 注册并在跑，
 * 它继承的 `base.ts` 与 `SubagentTask`/`SubagentResult`/`createSubagentTask` 必须留着（判据 4）。
 *
 * 判据各钉一件事：
 * 1. 行为判据（不是 grep）：deep 强度的任务跑完，结果必须原样回到调用方，不许被换成"等待人工审批"
 * 2. 九个不可达的类与那份注册表不许回来（文件面 + 类名面双向）
 * 3. supervisor 不许再有那两条没人按的 getter 与那份只用来数数的表
 * 4. 反过度砍：loop-engineering 这条活链与 base 的公共形状必须在；真闸门（confirm 在 execute 之前）必须在
 * 5. 五处文档不许再谎报"按名调度 / Plan 阶段调度 / 调度器还没有生产调用点 / agent-loader 在跑"
 * 6. 量具自证：把 getter 塞回一份源码样本必须被第 3 条抓到，干净的样本不被抓
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { BaseSubagent, createSubagentTask, type SubagentResult, type SubagentTask } from '@main/core/agent/subagents/base'
import { listSourceFiles, readSourceFile } from '../helpers/source-scan'

const ROOT = path.resolve(__dirname, '../..')
const SUB_DIR = path.join(ROOT, 'src/main/core/agent/subagents')

/** 本轮判死的九个类所在文件（loop-engineering 不在内——它是活链） */
const DEAD_FILES = [
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

const DEAD_CLASS_NAMES = [
  'CodingSubagent',
  'ThinkingSubagent',
  'RunningSubagent',
  'SearchSubagent',
  'SkillSubagent',
  'MethodologySubagent',
  'HistorySubagent',
  'KnowledgeSubagent',
  'ExploreSubagent',
]

/** 只取代码正文：注释里出现这些词是解释"为什么删了"，不算复活 */
function codeOnly(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
}

/** src 全树正文里搜某个符号（返回命中的相对路径） */
function hitsInSrc(needle: string): string[] {
  const out: string[] = []
  for (const file of listSourceFiles(path.join(ROOT, 'src'))) {
    if (codeOnly(readSourceFile(file)).includes(needle)) out.push(path.relative(ROOT, file))
  }
  return out
}

/** 判据 3 的实现体，抽成函数好被判据 6 拿合成样本复测 */
function supervisorWiring(text: string): string[] {
  const code = codeOnly(text)
  const banned = [
    'getSubagent(',
    'listSubagents()',
    'createAllSubagents()',
    'private readonly subagents',
  ]
  return banned.filter((b) => code.includes(b))
}

describe('Subagent 编队收口（#218）', () => {
  it('1. deep 强度跑完的任务，结果原样返回，不被"等待人工审批"顶掉', async () => {
    let ran = false
    class Probe extends BaseSubagent {
      readonly name = 'probe'
      readonly displayName = '探针子类'
      readonly description = '只为验证 execute() 的收尾行为，不注册到任何地方'
      protected async doExecute(task: SubagentTask): Promise<SubagentResult> {
        ran = true
        return {
          taskId: task.id,
          success: true,
          output: { finished: true },
          durationMs: 1,
        }
      }
    }
    const task = createSubagentTask('probe', '一次 deep 强度的任务', {}, { strength: 'deep' })
    const result = await new Probe().execute(task)

    // 这道断言钉的是"跑没跑"：旧代码确实跑完了，只是把结果丢了
    expect(ran, 'doExecute 没被执行——那这条判据测的就不是这条链').toBe(true)
    expect(result.success, '执行完了却报失败：审批分支把结果顶掉了').toBe(true)
    expect(JSON.stringify(result.output)).toContain('finished')
    expect(result.error ?? '', '结果里还带着那句占位文案').not.toContain('等待人工审批')
  })

  it('2. 九个不可达的类与那份注册表不许回来', () => {
    for (const name of DEAD_FILES) {
      expect(fs.existsSync(path.join(SUB_DIR, name)), `又出现了 ${name}`).toBe(false)
    }
    // 类名一律不许在 src 正文里出现（被 import 就是被接回去的第一种形状）
    for (const cls of DEAD_CLASS_NAMES) {
      expect(hitsInSrc(cls), `${cls} 被这些文件引用：`).toEqual([])
    }
    expect(hitsInSrc('createAllSubagents'), '注册表函数被接回去了').toEqual([])
  })

  it('3. supervisor 不许再有那两条没人按的 getter 与那份只用来数数的表', () => {
    const text = readSourceFile(path.join(ROOT, 'src/main/core/agent/supervisor.ts'))
    expect(supervisorWiring(text), '死接线又回来了').toEqual([])
  })

  it('4. 反过度砍：循环工程那条活链与真闸门必须还在', () => {
    expect(fs.existsSync(path.join(SUB_DIR, 'loop-engineering-subagent.ts'))).toBe(true)
    const ipc = codeOnly(readSourceFile(path.join(ROOT, 'src/main/ipc/loop-engineering.ts')))
    expect(ipc, 'ipc 侧不再调 .execute(task)，那 loop-engineering 就成了新的死码').toContain('.execute(task)')

    const base = codeOnly(readSourceFile(path.join(SUB_DIR, 'base.ts')))
    for (const shape of ['BaseSubagent', 'SubagentTask', 'SubagentResult', 'createSubagentTask']) {
      expect(base, `base 里 ${shape} 不见了`).toContain(shape)
    }
    // 真的把关在 workflow 里：confirm 必须在 execute 之前，否则命令已经跑完才问人
    const wf = codeOnly(readSourceFile(path.join(ROOT, 'src/main/core/agent-workflow.ts')))
    const confirmAt = wf.indexOf(`'confirm'`)
    const executeAt = wf.indexOf(`'execute'`)
    expect(confirmAt, 'workflow 里没有 confirm 步').toBeGreaterThan(-1)
    expect(executeAt, 'workflow 里没有 execute 步').toBeGreaterThan(-1)
    expect(confirmAt < executeAt, 'confirm 排到 execute 之后了——那等于先动手再问').toBe(true)
  })

  it('5. 各处文档不许再谎报这套编队在跑', () => {
    const docs: Array<[string, string[]]> = [
      ['README.md', ['8 个 Subagent 在总控里注册', '还没有生产调用点']],
      ['docs/功能实景清单.md', ['按名调度']],
      ['docs/长期优化目标.md', ['Subagent 本体与 supervisor 调度保留']],
    ]
    for (const [rel, needles] of docs) {
      const text = readSourceFile(path.join(ROOT, rel))
      expect(text, `${rel} 读不到——那不是判过了，那是没查`).not.toBe('')
      for (const needle of needles) {
        expect(text, `${rel} 里还写着「${needle}」`).not.toContain(needle)
      }
    }
    // supervisor 自己的门牌也不能再承诺"Plan 阶段调度 Subagent"
    const sup = readSourceFile(path.join(ROOT, 'src/main/core/agent/supervisor.ts'))
    expect(sup).not.toContain('通过 Plan 阶段调度')
    expect(sup).not.toContain('跨 Subagent 协作')
    // 正对照：删掉这件事本身必须在口径里留下出处，不然下一个人又会以为它还在
    for (const rel of ['README.md', 'docs/功能实景清单.md', 'docs/长期优化目标.md']) {
      expect(readSourceFile(path.join(ROOT, rel)), `${rel} 没写 #218 的出处`).toContain('#218')
    }
    // 那份 2026-07 的旧设计稿只在本地，公开仓里没有它——代码里不许再指向一个仓库外的路径
    expect(sup, 'supervisor 又把读者指向仓库里不存在的那份稿子').not.toContain('AGENT-BOUNDARY')
  })

  it('6. 量具自证：把 getter 塞回一份源码样本必须被第 3 条抓到', () => {
    expect(supervisorWiring('class S { getSubagent(n: string) { return null }\n')).not.toEqual([])
    expect(supervisorWiring('class S { readonly roles: string[] = [] }\n')).toEqual([])
  })
})
