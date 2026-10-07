/**
 * electronAPI 名字表面闸（阶段 D1 的安全网）
 *
 * 起因：同一个暴露面曾经在三处各存一份名字表——
 *   A. src/preload/index.ts 里暴露对象的键（264 个，唯一事实）
 *   B. 同文件末尾手写的 export type ElectronAPI（约 510 行）
 *   C. src/renderer/src/types/electron.d.ts 的 export interface ElectronAPI
 * 而 B 是靠暴露对象末尾那句 `as unknown as ElectronAPI` 糊过去的：强转让 TS 不再比对实现与类型，
 * 所以 B 漂了 39 条也没人报错。C 是渲染层真正吃的那份（实测两份 declare global 里它生效），漂了 19 条，
 * 症状就是 SchedulerPanel 自己在组件里抄了个四条的局部接口。
 *
 * 现在 B 改成 `export type ElectronAPI = typeof electronApi`（由实现派生，副本消失），
 * 本闸因此要三件事：
 *   1) 快照：A 的名字集合必须等于 tests/unit/__fixtures__/preload-api-surface.txt。
 *      这条是后面按域拆分的护栏——搬漏一个方法、名字打错、多挂一个，都在这儿红。
 *   2) 派生不许回退：类型必须还是 typeof 实现，且不许再用 as unknown as 把不一致糊掉。
 *   3) 无幻影 + 欠账只减不增：C 不许声明 A 没有的方法；A 有而 C 没声明的登记在下面这份名单里，
 *      加名字就红，补齐了会打印"可以从名单删掉"但不挡你。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { readSurface } from '../../scripts/ipc/api-surface'

const ROOT = path.resolve(__dirname, '../..')
const SNAPSHOT = path.join(ROOT, 'tests/unit/__fixtures__/preload-api-surface.txt')

/** A 有、C（渲染层类型）没声明 —— 2026-10-07 实测登记 */
const UNDECLARED_IN_RENDERER = [
  'diagnosticsClear',
  'diagnosticsGetFindings',
  'diagnosticsGetLogs',
  'diagnosticsGetReport',
  'diagnosticsGetStats',
  'diagnosticsIngestTest',
  'diagnosticsSetEnabled',
  'onDiagnosticsLogBatch',
  'onSchedulerStatusChange',
  'promptfooListTests',
  'promptfooRunEval',
  'promptfooRunRedTeam',
  'schedulerList',
  'schedulerToggle',
  'schedulerTrigger',
  'tutorialCheckpoints',
  'tutorialCleanupOrphans',
  'tutorialDiskInfo',
  'tutorialResetCheckpoint',
]

function checkRatchet(current: string[], recorded: string[], label: string): void {
  const grown = current.filter((n) => !recorded.includes(n))
  expect(grown, `${label} 变多了：${grown.join(', ')}。新暴露的方法必须同时补类型声明`).toEqual([])
  const paidOff = recorded.filter((n) => !current.includes(n))
  if (paidOff.length) {
    console.log(`[api-surface] ${label} 已补齐 ${paidOff.length} 条，可从名单删除：${paidOff.join(', ')}`)
  }
}

describe('electronAPI 名字表面', () => {
  const surface = readSurface(ROOT)
  const exposed = [...surface.exposed].sort()

  it('暴露面与快照逐名相等（按域拆分时的主护栏）', () => {
    const want = fs.readFileSync(SNAPSHOT, 'utf8').trim().split(/\r?\n/)
    const added = exposed.filter((n) => !want.includes(n))
    const removed = want.filter((n) => !exposed.includes(n))
    expect(added, `新挂上 window.electronAPI 但没进快照：${added.join(', ')}。确认要加就重跑快照`).toEqual([])
    expect(removed, `快照里有、现在没挂上：${removed.join(', ')}。拆文件时漏搬了` ).toEqual([])
  })

  it('渲染层类型不许声明运行时不存在的方法（幻影）', () => {
    const phantom = [...surface.rendererType].filter((n) => !surface.exposed.has(n)).sort()
    expect(phantom, `electron.d.ts 声明了 ${phantom.length} 个没挂上的方法：${phantom.join(', ')}`).toEqual([])
  })

  it('两份类型副本的欠账只减不增', () => {
    const undeclared = exposed.filter((n) => !surface.rendererType.has(n))
    checkRatchet(undeclared, UNDECLARED_IN_RENDERER, '渲染层未声明')
  })

  it('preload 的类型由实现派生，且没有 as unknown as 强转兜住漂移', () => {
    expect(surface.derived.ok, surface.derived.why).toBe(true)
  })

  it('抽取器本身不是静默扫到 0 行（正样本 + 数量级）', () => {
    expect(exposed.length, '暴露面方法数太小，说明抽取器被改版打穿了').toBeGreaterThan(200)
    // 这几条是历史上真断过链、也真修过的位点，抽取器认不得它们就是量具坏了
    for (const probe of ['sshConnect', 'agentChat', 'providerGetDefault', 'configGet', 'diagnosticsGetLogs']) {
      expect(surface.exposed.has(probe), `抽取器没抓到 ${probe}`).toBe(true)
    }
    expect(surface.rendererType.has('sshConnect'), '渲染层类型抽取没抓到 sshConnect').toBe(true)
  })
})
