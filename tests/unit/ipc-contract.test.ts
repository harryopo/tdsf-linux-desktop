/**
 * 契约闸：src/shared/ipc-contract.ts 是跨进程通道的事实源
 *
 * 立这条的理由很具体：给对话加 terminalContext 那一次，同时改了 4 个文件
 * （preload 实现、preload 声明、渲染层 electron.d.ts、主进程 handler），
 * 少改一处就是运行时 undefined。这类"手写签名互为副本"的洞只有闸能拦，
 * 靠约定一定会烂。
 *
 * 刻度只降不升：未纳入契约的 invoke 位点数量往下钉，新增通道不登记契约就红。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { IPC_CONTRACT, assertContractArgs, contractFor } from '@main/../shared/ipc-contract'
import { renderContractFile } from '../../scripts/ipc/render-contract'
import { preloadAll, preloadWiring } from './preload-sources'

const ROOT = path.resolve(__dirname, '../..')
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const PRELOAD = preloadWiring(ROOT)
const PRELOAD_ALL = preloadAll(ROOT)
const GENERATED = read('src/renderer/src/types/generated/ipc-contract.ts')
const TYPES = read('src/renderer/src/types/electron.d.ts')

/**
 * 未纳入契约的 invoke 位点上限（只降不升）。
 * 2026-10-07 建闸时实测 220；2026-10-10 W2 把交互式 Shell 那 6 条通道
 * （start/close/list/write/run-authored/resize）全部登记进契约并改走 invokeChecked，
 * 实测降到 200 —— 新通道一律进契约是这波的硬要求，别再拿余量去接新东西。
 * 2026-10-17 boot:get-state 登记进契约并改走 invokeChecked，实测降到 199。
 */
const UNCONTRACTED_CAP = 199

describe('ipc 契约本体', () => {
  it('通道名全部来自 ipc-channels 常量表，没有手写字符串', () => {
    const table = read('src/shared/ipc-channels.ts')
    const known = new Set([...table.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]))
    const bogus = IPC_CONTRACT.filter((c) => !known.has(c.channel)).map((c) => `${c.api} → ${c.channel}`)
    expect(bogus, `契约里这些通道在常量表里找不到：\n${bogus.join('\n')}`).toEqual([])
  })

  it('方法名不重复，判别联合的两支都非空', () => {
    const apis = IPC_CONTRACT.map((c) => c.api)
    expect(new Set(apis).size, 'api 名有重复').toBe(apis.length)
    expect(IPC_CONTRACT.some((c) => c.kind === 'invoke'), '应有 invoke 支').toBe(true)
    expect(IPC_CONTRACT.some((c) => c.kind === 'event'), '应有 event 支').toBe(true)
  })

  it('生成物与契约一致（改了契约没 pnpm ipc:gen 就红）', () => {
    expect(GENERATED, 'types/generated/ipc-contract.ts 与契约不一致，跑 pnpm ipc:gen').toBe(renderContractFile())
  })
})

describe('入参校验真的在挡（负向对照）', () => {
  it('少传/多传参数都抛，不是静默放过', () => {
    expect(() => assertContractArgs('agentChat', [[{ role: 'user', content: 'hi' }], undefined, undefined, undefined])).not.toThrow()
    expect(() => assertContractArgs('agentChat', [])).toThrow(/第 1 个参数/)
    expect(() =>
      assertContractArgs('agentChat', [[{ role: 'user', content: 'hi' }], 'p', 'standard', 's', 't', '多出来的第六个'])
    ).toThrow(/契约只声明/)
  })

  it('类型用错当场抛，错误里带通道参数名', () => {
    expect(() => assertContractArgs('providerGet', [42])).toThrow(/providerGet 第 1 个参数 id/)
    expect(() => assertContractArgs('providerSave', [{ id: 'x' }])).toThrow(/第 1 个参数 config/)
    expect(() => assertContractArgs('providerSave', [{ id: 'x', name: 'n', type: 'deepseek', model: 'm' }])).not.toThrow()
  })

  it('未纳入契约的通道直接放行（存量还在逐步搬，闸不拦旧账）', () => {
    expect(() => assertContractArgs('someLegacyThing', ['whatever'])).not.toThrow()
  })
})

describe('契约确实被用起来（不是写了摆着）', () => {
  it('preload 走封装调用，校验点落在最近一层', () => {
    // 拆域后"引契约"这件事落在 preload/ipc-util.ts，所以查整棵 preload 树而不是单个文件
    expect(PRELOAD_ALL).toContain("from '../shared/ipc-contract'")
    // 拆域后 invokeChecked 的定义在 ipc-util.ts（不在这段文本里），所以这里不能再"减掉一处定义"
    const checked = (PRELOAD.match(/invokeChecked[<(]/g) ?? []).length
    const direct = (PRELOAD.match(/assertContractArgs\(/g) ?? []).length
    expect(checked, 'preload 里走契约封装的调用数').toBeGreaterThanOrEqual(IPC_CONTRACT.filter((c) => c.kind === 'invoke').length - 1)
    expect(direct, 'preload 里直接校验的调用数（多参数位点）').toBeGreaterThanOrEqual(1)
  })

  it('渲染层类型来自生成物，且不再手写已契约的方法', () => {
    // extends 列表里现在还带着从实现派生的 PreloadElectronAPI，所以按"列表含这两个生成物接口"判
    expect(TYPES).toMatch(
      /export interface ElectronAPI extends [^{]*ContractedInvokeApi[^{]*ContractedEventApi/
    )
    for (const c of IPC_CONTRACT) {
      const handWritten = new RegExp(`^\\s{2}${c.api}\\(`, 'm').test(TYPES)
      expect(handWritten, `${c.api} 又回到 electron.d.ts 手写了，签名应在契约里改`).toBe(false)
    }
  })

  it(`未纳入契约的 invoke 位点只降不升（当前上限 ${UNCONTRACTED_CAP}）`, () => {
    const all = (PRELOAD.match(/ipcRenderer\.invoke\(/g) ?? []).length
    const contracted = (PRELOAD.match(/invokeChecked[<(]/g) ?? []).length
    const uncovered = all - contracted
    expect(
      uncovered,
      `还有 ${uncovered} 个 ipcRenderer.invoke 位点没进契约（上限 ${UNCONTRACTED_CAP}）。新通道请一并登记 src/shared/ipc-contract.ts`
    ).toBeLessThanOrEqual(UNCONTRACTED_CAP)
  })

  it('contractFor 查得到每个方法（防 api 名打错）', () => {
    for (const c of IPC_CONTRACT) expect(contractFor(c.api), c.api).toBe(c)
  })
})
