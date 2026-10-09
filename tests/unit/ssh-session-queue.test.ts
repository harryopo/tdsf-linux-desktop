/**
 * 会话操作串行队列判据（2026-10-09 安全审查 S4 / P1-1）
 *
 * 判据不是"跑起来没报错"，而是**同时执行数**：串行化失效只表现为两个操作叠在一起跑，
 * 结果都还"成功"，所以必须直接量并发。为了让这条断言可被证伪，这里把旧算法原样复刻一份
 * 当对照——它必须测出 2，否则说明这个量具看不见并发，那"新算法=1"也不算数。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SessionQueue } from '../../src/main/services/ssh/session-queue'

/** 记录同时在执行的操作数 */
function concurrencyMeter(): { run: <T>(fn: () => Promise<T>) => Promise<T>; peak: () => number } {
  let live = 0
  let max = 0
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      live++
      max = Math.max(max, live)
      try {
        return await fn()
      } finally {
        live--
      }
    },
    peak: () => max,
  }
}

/** 旧实现（connection-manager 里的写法）：前一个 wrapper 完成时把别人的队尾置 null */
function legacyRun(
  state: { pendingOp: Promise<unknown> | null },
  meter: ReturnType<typeof concurrencyMeter>,
  fn: () => Promise<unknown>,
): Promise<unknown> {
  const prev = state.pendingOp ?? Promise.resolve()
  const next = prev.then(() => fn(), () => fn())
  state.pendingOp = next.then(
    () => {
      state.pendingOp = null
    },
    () => {
      state.pendingOp = null
    },
  )
  return meter.run(fn)
}

const gate = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('SessionQueue 串行化', () => {
  it('三个操作排队跑，同时执行数恒为 1', async () => {
    const q = new SessionQueue({ opTimeoutMs: 10_000 })
    const meter = concurrencyMeter()
    const order: string[] = []
    const op = (name: string, ms: number) =>
      q.run('s1', async () => {
        await meter.run(async () => {
          await gate(ms)
          order.push(name)
        })
      })

    const all = Promise.all([op('a', 100), op('b', 50), op('c', 10)])
    await vi.advanceTimersByTimeAsync(300)
    await all

    expect(order, '必须按入队顺序执行').toEqual(['a', 'b', 'c'])
    expect(meter.peak(), '串行化生效的唯一证据是同时执行数=1').toBe(1)
    expect(q.snapshot('s1'), '排空后 key 要被回收，不留在 Map 里').toBeNull()
  })

  it('对照：旧算法在同一段时序下会测出并发 2（说明这条判据真能抓出问题）', async () => {
    const state: { pendingOp: Promise<unknown> | null } = { pendingOp: null }
    const meter = concurrencyMeter()
    const call = (ms: number) =>
      legacyRun(state, meter, async () => {
        await gate(ms)
      })
    // 先把三个操作都登记好再推时间：它们要等定时器才落地，
    // 在这里 await 就等于等一个没人推的东西（上一版就是这么把自己跑到超时的）
    const pending = [call(100), call(50), call(10)]
    await vi.advanceTimersByTimeAsync(300)
    await Promise.all(pending)
    expect(meter.peak(), '旧算法没测出并发就说明量具坏了').toBeGreaterThan(1)
  })

  it('一个操作卡死时，预算用尽后队列继续走，卡死那步以失败收场', async () => {
    const q = new SessionQueue({ opTimeoutMs: 1000 })
    const hung = q.run('s2', () => new Promise<never>(() => {}))
    const second = q.run('s2', async () => 'done')
    // 断言先挂上再推时间：拒绝在定时器里发生，处理器晚一步挂就等于造一条 unhandled rejection
    const hungCheck = expect(hung, '卡死那步必须报错，不能假装完成').rejects.toThrow(/超时/)
    const secondCheck = expect(second, '预算用尽后队列要能继续走').resolves.toBe('done')

    await vi.advanceTimersByTimeAsync(1100)
    await Promise.all([hungCheck, secondCheck])
  })

  it('前一步抛错不挡住后面的操作（连接失败后仍要能断开）', async () => {
    const q = new SessionQueue({ opTimeoutMs: 5000 })
    const first = q.run('s3', async () => {
      throw new Error('握手失败')
    })
    const second = q.run('s3', async () => 42)
    const firstCheck = expect(first).rejects.toThrow('握手失败')
    const secondCheck = expect(second).resolves.toBe(42)
    await vi.advanceTimersByTimeAsync(10)
    await Promise.all([firstCheck, secondCheck])
  })

  it('不同会话互不阻塞，且 forget 会把队列条目丢掉', async () => {
    const q = new SessionQueue({ opTimeoutMs: 10_000 })
    const slow = q.run('busy', () => gate(5000))
    const fast = q.run('idle', async () => 'ok')
    await vi.advanceTimersByTimeAsync(10)
    await expect(fast).resolves.toBe('ok')
    q.forget('idle')
    expect(q.snapshot('idle')).toBeNull()
    await vi.advanceTimersByTimeAsync(5000)
    await slow
  })
})
