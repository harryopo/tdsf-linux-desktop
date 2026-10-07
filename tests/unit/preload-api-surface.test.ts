/**
 * electronAPI 名字表面闸（阶段 D1 的安全网）
 *
 * 为什么要它：同一个暴露面在三个地方各存一份名字表——
 *   A. src/preload/index.ts 里 contextBridge.exposeInMainWorld('electronAPI', {…}) 的键（264 个，事实）
 *   B. src/preload/index.ts 末尾 export type ElectronAPI（喂 preload/index.d.ts）
 *   C. src/renderer/src/types/electron.d.ts 的 export interface ElectronAPI（渲染层真正吃的那份；
 *      实测过：两份 declare global 里生效的是这一份，所以 B 的漂移不会让 typecheck 报错）
 * 三份副本漂移的症状是"运行时方法在、类型里没"（渲染层只能 as any 或自己抄个局部接口，
 * SchedulerPanel 就自己抄了 scheduler 四条），或者"类型里写了、运行时没挂"（点下去没反应）。
 * typecheck / lint / 单测都看不见这类断链，而按域拆 preload 正好最容易碰断它。
 *
 * 三条断言各有分工：
 *   1) 快照：A 的名字集合必须等于 tests/unit/__fixtures__/preload-api-surface.txt。
 *      这条是拆分护栏——搬实现时少挂一个方法、名字打错、多挂一个，全在这里红。
 *   2) 无幻影：C 里不许声明 A 没有的方法（当前为 0，所以要求精确为 0）。
 *   3) 欠账只减不增：A 有而 C/B 没声明的，登记在下面两份名单里。加名字就红；
 *      补齐了会打印"可以从名单删掉"，但不会挡你——鼓励还债，不惩罚进度。
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

/** A 有、B（preload 自己的派生类型）没声明 —— 2026-10-07 实测登记 */
const MISSING_IN_PRELOAD_TYPE = [
  'agentPaor',
  'alertAck',
  'appExportModelStats',
  'appGetInfo',
  'bootGetState',
  'budgetAlerts',
  'credibilityAssess',
  'credibilityDag',
  'credibilityExportAudit',
  'credibilityExportAuditReport',
  'credibilityFormatAuditReport',
  'credibilityListAuditReports',
  'credibilityLoadAuditReport',
  'memoryAudit',
  'memoryDelete',
  'memoryList',
  'memorySearch',
  'modelToolCalls',
  'onAgentPaorIteration',
  'onAgentToolEvent',
  'onBootLoadingStage',
  'onPaorApprovalRequest',
  'onSandboxApprovalRequest',
  'onTaskPermissionApprovalRequest',
  'paorApprove',
  'riskCheck',
  'riskGetRules',
  'sandboxApprove',
  'terminalCompletionAccept',
  'terminalCompletionComplete',
  'terminalCompletionImport',
  'tutorialCheckpoints',
  'tutorialCleanupOrphans',
  'tutorialDiskInfo',
  'tutorialProgress',
  'tutorialRecommendPath',
  'tutorialResetCheckpoint',
  'tutorialStats',
  'tutorialUpdateProgress',
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
    const mistyped = exposed.filter((n) => !surface.preloadType.has(n))
    checkRatchet(undeclared, UNDECLARED_IN_RENDERER, '渲染层未声明')
    checkRatchet(mistyped, MISSING_IN_PRELOAD_TYPE, 'preload 派生类型未声明')
  })

  it('抽取器本身不是静默扫到 0 行（正样本 + 数量级）', () => {
    expect(exposed.length, '暴露面方法数太小，说明抽取器被改版打穿了').toBeGreaterThan(200)
    // 这几条是历史上真断过链、也真修过的位点，抽取器认不得它们就是量具坏了
    for (const probe of ['sshConnect', 'agentChat', 'providerGetDefault', 'configGet', 'diagnosticsGetLogs']) {
      expect(surface.exposed.has(probe), `抽取器没抓到 ${probe}`).toBe(true)
    }
    expect(surface.rendererType.has('sshConnect'), '渲染层类型抽取没抓到 sshConnect').toBe(true)
    expect(surface.preloadType.has('sshConnect'), 'preload 派生类型抽取没抓到 sshConnect').toBe(true)
  })
})
