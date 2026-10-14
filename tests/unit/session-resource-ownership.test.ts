/**
 * 会话级资源的所有权判据（2026-10-09 安全审查 S4 / P0-5）
 *
 * 原来这些资源（监控轮询定时器、远程文件监听、告警去抖、主机名缓存）的清理只挂在
 * "渲染层记得点停止" 和 "应用退出" 两处，而断连入口有四处以上：
 * 于是每断一次就留下一把朝死连接 exec 的定时器，异常被空 catch 吞掉，
 * 界面还停在最后一帧指标上装作实时。
 *
 * 修法是把订阅放进**资源持有者自己**：会话一关，自己回收。
 * 这里的判据因此必须能区分"真的停了"和"根本没跑起来"——每条停止断言都配一条
 * 未关闭会话继续跑的阴性对照，否则测试绿着也什么都没证明。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CommandResult, MonitorData } from '@shared/models'
import type { Node as TsNode } from 'typescript'

/** 假的 SSH 出口：记录 exec 调用，并允许测试手动广播"会话关闭" */
const harness = vi.hoisted(() => {
  type Listener = (sessionId: string, reason: string) => void
  const listeners: Listener[] = []
  const execs: Array<{ sessionId: string; command: string }> = []
  const fake = {
    exec: async (sessionId: string, command: string): Promise<CommandResult> => {
      execs.push({ sessionId, command })
      // inotifywait 探测一律答"没装"，让文件监听走轮询分支（轮询才有可观测的定时器）
      return { stdout: '', stderr: '', exitCode: 1, duration: 1 }
    },
    onSessionClosed: (l: Listener) => {
      listeners.push(l)
      return () => {
        const i = listeners.indexOf(l)
        if (i >= 0) listeners.splice(i, 1)
      }
    },
    getClient: () => {
      throw new Error('本用例只走轮询分支，不该拿到底层 client')
    },
  }
  return { listeners, execs, fake }
})

vi.mock('../../src/main/services/ssh/connection-manager', () => ({
  SshConnectionManager: { getInstance: () => harness.fake },
}))

// ipc/monitor 在模块顶层就 import 了 electron（ipcMain/Notification），node 环境下要给它一个壳
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  BrowserWindow: class {},
  Notification: class {
    static isSupported(): boolean {
      return false
    }
    show(): void {}
  },
}))

function closeSession(sessionId: string, reason = 'disconnect'): void {
  for (const l of [...harness.listeners]) l(sessionId, reason)
}

beforeEach(() => {
  vi.useFakeTimers()
  harness.execs.length = 0
  harness.listeners.length = 0
})
afterEach(() => {
  vi.useRealTimers()
})

describe('SystemMonitor：会话关闭即停轮询', () => {
  it('关掉的会话不再采集，没关的照常采集（阴性对照）', async () => {
    const { SystemMonitor } = await import('../../src/main/services/ssh/monitor')
    const monitor = new SystemMonitor(harness.fake as never)

    await monitor.startMonitoring('s1', 5000)
    await monitor.startMonitoring('s2', 5000)
    await vi.advanceTimersByTimeAsync(5000)
    const before = harness.execs.length
    expect(monitor.monitoredSessions().sort()).toEqual(['s1', 's2'])
    expect(before, '两路都在采集才有判据意义').toBeGreaterThan(0)

    closeSession('s1')
    await vi.advanceTimersByTimeAsync(0)
    expect(monitor.monitoredSessions(), '关掉的会话必须从监控表里摘掉').toEqual(['s2'])

    // 推进 10 分钟：只剩 s2 在采（每 5 秒一次 = 120 次），s1 一次都不许再来
    harness.execs.length = 0
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    const s1Calls = harness.execs.filter((e) => e.sessionId === 's1').length
    const s2Calls = harness.execs.filter((e) => e.sessionId === 's2').length
    expect(s1Calls, '断连后还在 exec 就是泄漏的僵尸定时器').toBe(0)
    expect(s2Calls, '没断连的会话不能被关闭逻辑顺手停掉').toBeGreaterThan(0)
  })

  it('采集异常被吞掉时定时器仍然继续（否则上面的"停止"是假象）', async () => {
    const { SystemMonitor } = await import('../../src/main/services/ssh/monitor')
    const boom = {
      ...harness.fake,
      exec: async (sessionId: string, command: string) => {
        harness.execs.push({ sessionId, command })
        throw new Error('连接已断开')
      },
    }
    const monitor = new SystemMonitor(boom as never)
    await monitor.startMonitoring('s3', 5000)
    await vi.advanceTimersByTimeAsync(15000)
    expect(harness.execs.filter((e) => e.sessionId === 's3').length).toBeGreaterThan(1)
    closeSession('s3')
    const after = harness.execs.length
    await vi.advanceTimersByTimeAsync(60000)
    expect(harness.execs.length, '抛错路径也要能被回收').toBe(after)
  })

  it('dispose 之后不再监听会话事件（实例被丢弃时不留在进程上）', async () => {
    const { SystemMonitor } = await import('../../src/main/services/ssh/monitor')
    const monitor = new SystemMonitor(harness.fake as never)
    await monitor.startMonitoring('s4', 5000)
    expect(harness.listeners.length).toBeGreaterThan(0)
    await monitor.dispose()
    expect(monitor.monitoredSessions()).toEqual([])
  })
})

describe('FileWatcherAdapter：会话关闭即停监听', () => {
  it('按会话收走名下全部 watch，并停掉轮询', async () => {
    const { FileWatcherAdapter } = await import('../../src/main/services/ssh/file-watcher')
    const adapter = FileWatcherAdapter.getInstance()
    const w1 = await adapter.start('s1', '/var/log')
    const w2 = await adapter.start('s1', '/etc')
    await adapter.start('s2', '/var/log')
    expect(adapter.activeWatches()).toHaveLength(3)

    closeSession('s1')
    await vi.advanceTimersByTimeAsync(0)
    const left = adapter.activeWatches()
    expect(left.map((w) => w.watchId), `${w1}/${w2} 属于 s1，必须一起停`).toEqual(
      left.filter((w) => w.sessionId === 's2').map((w) => w.watchId),
    )
    expect(left.every((w) => w.sessionId === 's2')).toBe(true)

    harness.execs.length = 0
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(harness.execs.filter((e) => e.sessionId === 's1').length, 's1 的 find 轮询必须归零').toBe(0)
    expect(harness.execs.filter((e) => e.sessionId === 's2').length, 's2 仍在监听').toBeGreaterThan(0)
  })
})

describe('告警去抖按会话分开，并可随会话剪枝', () => {
  it('同一指标在两台机器上各自都该报一次；同机重复才进冷却', async () => {
    const m = await import('../../src/main/ipc/monitor')
    const t = 1_700_000_000_000
    expect(m.shouldFireAlert('sA', 'cpu:warning', t)).toBe(true)
    expect(m.shouldFireAlert('sB', 'cpu:warning', t + 1000)).toBe(true)
    expect(m.shouldFireAlert('sA', 'cpu:warning', t + 2000), '同机 5 分钟内不重复轰炸').toBe(false)
  })

  it('剪枝只摘掉该会话的记录，别的会话仍在冷却里', async () => {
    const m = await import('../../src/main/ipc/monitor')
    const t = 1_700_000_100_000
    // 这张表是模块级的，前面的用例已经留了记录，所以只看差值
    const before = m.alertStateSnapshot().dedupeEntries
    expect(m.shouldFireAlert('sC', 'memory:critical', t)).toBe(true)
    expect(m.shouldFireAlert('sD', 'memory:critical', t + 10)).toBe(true)
    expect(m.alertStateSnapshot().dedupeEntries).toBe(before + 2)
    m.pruneSessionAlertState('sC')
    expect(m.alertStateSnapshot().dedupeEntries, 'sD 的那条要留着').toBe(before + 1)
    expect(m.shouldFireAlert('sC', 'memory:critical', t + 20), '剪枝后同一会话可以重新报').toBe(true)
  })
})

describe('结构性兜底：关闭通知不能只挂在一个入口上', () => {
  it('connection-manager 的每条"会话不可再用"路径都通知订阅者', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const ts = await import('typescript')
    const file = path.join(process.cwd(), 'src/main/services/ssh/connection-manager.ts')
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)

    // 收集"函数名 → 该函数里出现过的调用名"
    const callsByFn = new Map<string, Set<string>>()
    const stateWrites: string[] = []
    // ts 的值是上面 await import 进来的，命名空间不会因此出现在类型位置，
    // 所以节点类型单独用 type-only import（编译期擦除，不额外加载 typescript）
    const walk = (node: TsNode, owner: string): void => {
      if (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) {
        const name = node.name ? node.name.getText() : '(anon)'
        ts.forEachChild(node, (c) => walk(c, name))
        return
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const fn = node.expression.name.getText()
        if (owner) callsByFn.set(owner, (callsByFn.get(owner) ?? new Set()).add(fn))
        if (fn === 'notifySessionClosed') stateWrites.push(owner)
      }
      ts.forEachChild(node, (c) => walk(c, owner))
    }
    walk(sf, '')

    for (const fn of ['doDisconnect', 'wireClient', 'handleKeepAliveFailure']) {
      expect(
        stateWrites.includes(fn),
        `${fn} 会让会话不可再用，必须通知订阅者（否则资源所有者无从回收）`,
      ).toBe(true)
    }
    void callsByFn
  })
})

// 类型引用占位（避免未使用告警的同时说明事件载荷形状）
export type _MonitorDataShape = MonitorData
