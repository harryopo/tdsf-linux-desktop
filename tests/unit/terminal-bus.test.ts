// @vitest-environment jsdom
/**
 * terminal-bus 判据（W2：终端输出的唯一订阅点）
 *
 * 钉的是两件会静默坏掉的事：
 *   1. 视图挂上之前到达的输出不许丢 —— 开一条终端到 TerminalView 注册监听之间隔着几帧，
 *      远端开场那段（MOTD / 第一条回显）正好落在这几帧里。以前直接按组件订阅 IPC，
 *      这段字节是无声消失的，屏幕从第二条命令才有内容。
 *   2. IPC 事件全窗口只能订一次 —— 订两次就等于同一份输出写两遍（W0 修的那类缺陷）。
 * 另外钉住"查无此终端才去对账"：已知终端没人订阅时不该反复问主进程。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/** bus 只借 syncShells 去主进程对账，这里换掉，免得拖进 server-store/preload */
const { syncShells } = vi.hoisted(() => ({ syncShells: vi.fn(async () => {}) }))
vi.mock('@/terminal/shell-launcher', () => ({ syncShells }))
vi.mock('@/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

type DataCb = (shellId: string, data: string) => void

/** 假的 preload：记录被注册了几次（叠加订阅就是这里露馅），并留一个"主进程推数据"的口子 */
function makeFakeApi(): { installs: () => number; push: (shellId: string, data: string) => void } {
  const cbs: DataCb[] = []
  const api = {
    onTerminalData(cb: DataCb) {
      cbs.push(cb)
      return () => {
        const at = cbs.indexOf(cb)
        if (at >= 0) cbs.splice(at, 1)
      }
    },
  }
  ;(window as unknown as { electronAPI: unknown }).electronAPI = api
  return {
    installs: () => cbs.length,
    push: (shellId, data) => {
      for (const cb of [...cbs]) cb(shellId, data)
    },
  }
}

/** bus 是模块级状态，每条用例都要重新拿一份干净的 */
async function loadBus() {
  vi.resetModules()
  return (await import('@/terminal/terminal-bus')) as typeof import('@/terminal/terminal-bus')
}

let api: ReturnType<typeof makeFakeApi>

beforeEach(() => {
  api = makeFakeApi()
  syncShells.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
})

describe('terminal-bus', () => {
  it('没人订阅时先暂存，视图挂上一次性补写（开终端那几帧的输出不丢）', async () => {
    const bus = await loadBus()
    const { useTerminalStore } = await import('@/stores/terminal-store')
    // 场景就是真实的那个：标签已经建好（store 认识这条 shellId），
    // 但 TerminalView 还没挂上，此刻到的输出必须攒着
    useTerminalStore.getState().addShell({
      kind: 'ssh',
      shellId: 'known-later',
      sessionId: 's1',
      title: 'A',
      openedAt: 1,
    })
    bus.installTerminalBus()

    api.push('known-later', '第一段 ')
    api.push('known-later', '第二段')

    const got: string[] = []
    bus.subscribeShellData('known-later', (d) => got.push(d))
    expect(got.join(''), '补写必须把两段都还给视图').toBe('第一段 第二段')
  })

  it('有人订阅时直接转发，顺序不乱', async () => {
    const bus = await loadBus()
    bus.installTerminalBus()
    const { useTerminalStore } = await import('@/stores/terminal-store')
    useTerminalStore.getState().addShell({ kind: 'ssh', shellId: 'live', sessionId: 's1', title: 'A', openedAt: 1 })

    const got: string[] = []
    const off = bus.subscribeShellData('live', (d) => got.push(d))
    api.push('live', 'a')
    api.push('live', 'b')
    off()
    api.push('live', 'c')
    expect(got, '退订后不该再收到').toEqual(['a', 'b'])
  })

  it('installTerminalBus 调两次只注册一次 IPC（叠加订阅=输出翻倍，W0 那条规矩）', async () => {
    const bus = await loadBus()
    bus.installTerminalBus()
    bus.installTerminalBus()
    bus.installTerminalBus()
    expect(api.installs(), '注册次数必须正好 1').toBe(1)

    // 注入自证：假靶子推一条，视图只该收到一次，不是三次
    const { useTerminalStore } = await import('@/stores/terminal-store')
    useTerminalStore.getState().addShell({ kind: 'ssh', shellId: 'x', sessionId: 's1', title: 'A', openedAt: 1 })
    let hits = 0
    bus.subscribeShellData('x', () => {
      hits += 1
    })
    api.push('x', 'once')
    expect(hits).toBe(1)
  })

  it('查无此终端才去对账，而且一批输出只问一次', async () => {
    const bus = await loadBus()
    const { useTerminalStore } = await import('@/stores/terminal-store')
    useTerminalStore.getState().addShell({ kind: 'ssh', shellId: 'real', sessionId: 's1', title: 'A', openedAt: 1 })
    vi.useFakeTimers()
    bus.installTerminalBus()

    // 已知终端、视图恰好没挂上：只暂存，不该反复问主进程
    api.push('real', 'a')
    await vi.advanceTimersByTimeAsync(500)
    expect(syncShells, '已知终端不需要对账').not.toHaveBeenCalled()

    // 未知终端：连着来两个也只问一次（去抖）
    api.push('ghost1', 'b')
    api.push('ghost2', 'c')
    await vi.advanceTimersByTimeAsync(500)
    expect(syncShells).toHaveBeenCalledTimes(1)
  })

  it('暂存超过上限时丢最早的分片，保住最近那段', async () => {
    const bus = await loadBus()
    bus.installTerminalBus()
    const { useTerminalStore } = await import('@/stores/terminal-store')
    useTerminalStore.getState().addShell({ kind: 'ssh', shellId: 'big', sessionId: 's1', title: 'A', openedAt: 1 })

    const chunk = 'x'.repeat(20_000)
    const total = 60
    for (let i = 0; i < total; i += 1) api.push('big', chunk)
    api.push('big', 'TAIL')

    let received = ''
    bus.subscribeShellData('big', (d) => {
      received += d
    })
    expect(received.endsWith('TAIL'), '最近的内容必须在').toBe(true)
    expect(received.length, '超上限的旧内容必须被丢掉').toBeLessThan(chunk.length * total)
  })
})
