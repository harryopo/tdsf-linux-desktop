/**
 * 本机终端管理器（LocalPtyManager）判据
 *
 * 钉的是"通道身份与生命周期"，不是 node-pty 本身：
 *   1. 一条终端的输出只发给它的订阅者，退订后不再收到（W0 那类叠加回调缺陷）；
 *   2. 进程退出要把通道从表里摘掉并通知界面（不然留一个点不动的死标签）；
 *   3. Windows 上关终端必须走"杀整棵进程树"，不能只 kill 壳进程
 *      —— node-pty 的 ConPTY kill 会去 fork 一个没有控制台的子进程枚举进程列表，
 *      在 Electron 里那条路必崩（实测 AttachConsole failed），崩了就没杀干净子进程；
 *   4. node-pty 装不上的平台要给出**原因**，不是静默失败也不是把主进程带崩。
 *
 * PTY 与 taskkill 都从构造函数注入，所以这里跑的是真代码路径，不是把实现抄进测试。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// logger 会 import electron（单测环境里没有），给一个最小替身
vi.mock('electron', () => ({
  app: { getPath: () => require('node:os').tmpdir(), getName: () => 'tdsf-test', on: () => {} },
  ipcMain: { handle: () => {}, on: () => {}, removeAllListeners: () => {} },
  BrowserWindow: class {},
  shell: { openExternal: () => Promise.resolve() },
}))

import { LocalPtyManager, type LocalPtyDeps } from '@main/services/terminal/local-pty'

/** 假 PTY 进程：记录被写进/resize/kill/dispose 了什么，并能主动吐数据与退出 */
function makeFakeProc(pid = 4242) {
  const dataCbs: Array<(d: string) => void> = []
  const exitCbs: Array<(e: { exitCode: number }) => void> = []
  const proc = {
    pid,
    writes: [] as string[],
    resizes: [] as Array<[number, number]>,
    killed: false,
    disposed: false,
    write: (d: string) => proc.writes.push(d),
    resize: (cols: number, rows: number) => proc.resizes.push([cols, rows]),
    kill: () => {
      proc.killed = true
    },
    dispose: () => {
      proc.disposed = true
    },
    onData: (cb: (d: string) => void) => {
      dataCbs.push(cb)
      return { dispose: () => {} }
    },
    onExit: (cb: (e: { exitCode: number }) => void) => {
      exitCbs.push(cb)
      return { dispose: () => {} }
    },
    emit: (d: string) => dataCbs.forEach((cb) => cb(d)),
    exit: (code = 0) => exitCbs.forEach((cb) => cb({ exitCode: code })),
  }
  return proc
}

type FakeProc = ReturnType<typeof makeFakeProc>

let spawned: FakeProc[]
let manager: LocalPtyManager
let killedPids: number[]

function build(deps: Partial<LocalPtyDeps> = {}): void {
  spawned = []
  killedPids = []
  const mod = deps.loadPty
    ? undefined
    : {
        spawn: (file: string, args: string[], options: Record<string, unknown>) => {
          void file
          void args
          void options
          const p = makeFakeProc()
          spawned.push(p)
          return p as unknown as never
        },
      }
  manager = new LocalPtyManager({
    loadPty: deps.loadPty ?? (() => ({ mod: mod as never, error: null })),
    killProcessTree: deps.killProcessTree ?? ((pid) => void killedPids.push(pid)),
  })
}

beforeEach(() => {
  build()
})

describe('LocalPtyManager', () => {
  it('开一条终端拿到 shellId，输出只发给它的订阅者，退订后不再收', () => {
    const started = manager.startShell({ cols: 100, rows: 30 })
    expect('shellId' in started).toBe(true)
    if (!('shellId' in started)) return
    const shellId = started.shellId

    const got: string[] = []
    const off = manager.onShellData(shellId, (d) => got.push(d))
    spawned[0].emit('第一段')
    expect(got).toEqual(['第一段'])

    off()
    spawned[0].emit('第二段')
    expect(got, '退订后不该再收到（叠加订阅=输出翻倍那一类缺陷）').toEqual(['第一段'])
  })

  it('两条终端互不串流；关掉一条不影响另一条的订阅', () => {
    const a = manager.startShell()
    const b = manager.startShell()
    if (!('shellId' in a) || !('shellId' in b)) throw new Error('应该开出两条终端')
    const seenA: string[] = []
    const seenB: string[] = []
    manager.onShellData(a.shellId, (d) => seenA.push(d))
    manager.onShellData(b.shellId, (d) => seenB.push(d))

    spawned[0].emit('给A')
    spawned[1].emit('给B')
    expect(seenA).toEqual(['给A'])
    expect(seenB).toEqual(['给B'])

    expect(manager.closeShell(a.shellId)).toBe(true)
    spawned[1].emit('还给B')
    expect(seenB).toEqual(['给B', '还给B'])
    expect(manager.listShells()).toEqual([b.shellId])
  })

  it('进程退出：通道从表里摘掉，并通知界面（不留死标签）', () => {
    const started = manager.startShell()
    if (!('shellId' in started)) throw new Error('开终端失败')
    const exits: string[] = []
    manager.onShellExit((id) => exits.push(id))

    spawned[0].exit(0)

    expect(manager.listShells()).toEqual([])
    expect(exits, '退出必须通知出去，否则界面上留着点不动的标签').toEqual([started.shellId])
  })

  it('Windows 关终端走杀进程树 + dispose；其它平台直接 kill', () => {
    const started = manager.startShell()
    if (!('shellId' in started)) throw new Error('开终端失败')
    manager.closeShell(started.shellId)

    if (process.platform === 'win32') {
      expect(killedPids, 'Windows 必须杀整棵树（ConPTY 的 kill 路径不可靠）').toEqual([spawned[0].pid])
      expect(spawned[0].killed, '不该再走 node-pty 那条会 fork 崩掉的 kill').toBe(false)
    } else {
      expect(spawned[0].killed).toBe(true)
      expect(killedPids).toEqual([])
    }
    expect(spawned[0].disposed).toBe(true)
  })

  it('node-pty 装不上：getStatus 与 startShell 都给出原因，不抛也不静默', () => {
    build({ loadPty: () => ({ mod: null, error: 'NODE_MODULE_VERSION 不匹配' }) })
    expect(manager.getStatus()).toMatchObject({ available: false, reason: 'NODE_MODULE_VERSION 不匹配' })
    expect(manager.startShell()).toEqual({ error: 'NODE_MODULE_VERSION 不匹配' })
  })

  it('写与 resize 只认还开着的通道（注入自证：关掉的必须报不存在）', () => {
    const started = manager.startShell()
    if (!('shellId' in started)) throw new Error('开终端失败')
    manager.writeShell(started.shellId, 'ls\r')
    manager.resizeShell(started.shellId, 120, 40)
    expect(spawned[0].writes).toEqual(['ls\r'])
    expect(spawned[0].resizes).toEqual([[120, 40]])

    manager.closeShell(started.shellId)
    expect(() => manager.writeShell(started.shellId, 'x')).toThrow(/不存在|已关闭/)
    expect(() => manager.onShellData(started.shellId, () => {})).toThrow(/不存在|已关闭/)
  })

  it('closeAll 把开着的都收掉（退出清理那一步的真实行为）', () => {
    const a = manager.startShell()
    const b = manager.startShell()
    if (!('shellId' in a) || !('shellId' in b)) throw new Error('开终端失败')
    manager.closeAll()
    expect(manager.listShells()).toEqual([])
    expect(manager.isShellOpen(a.shellId)).toBe(false)
    expect(manager.isShellOpen(b.shellId)).toBe(false)
  })
})
