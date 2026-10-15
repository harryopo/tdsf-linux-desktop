/**
 * SSH exec 超时后的通道收尾（2026-10-15 全维度系统审查 B1）
 *
 * 病根：exec() 的 fail() 只 clearTimeout + reject，那条已经建好的 ssh2 通道一个字没碰。
 * 后果不是"慢"，是留着不放：远端命令继续跑、data 监听器继续往已经作废的闭包里攒字符串、
 * 半开的通道还占着连接的通道额度。反复超时就是反复留。
 *
 * 判据要能区分"关掉了"和"没关掉"，所以三条都盯在假通道的 close() 与监听器计数上：
 *   1. 超时 ⇒ 拒错 + 通道关掉 + 监听器摘干净
 *   2. 正向对照：正常跑完（exit+close）⇒ 不许再 close 一次（通道自己关的，重复关是错的语义）
 *   3. 超时先到的那条最隐蔽：exec 回调在超时之后才回来，以前会把监听器挂到一条没人收的通道上，
 *      现在必须当场关掉且不挂任何监听器
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

vi.mock('electron', () => ({
  ipcMain: { handle: () => {}, removeHandler: () => {}, on: () => {} },
  app: { getPath: () => '/tmp/tdsf-ssh-exec-teardown', getAppPath: () => '/tmp/tdsf-ssh-exec-app' },
  BrowserWindow: class {},
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  Notification: class {
    static isSupported(): boolean {
      return false
    }
  },
}))

vi.mock('electron-store', () => {
  const store = new Map<string, unknown>([['terminal.cmdTimeout', 10]])
  return {
    default: class {
      get(key: string) {
        return store.get(key)
      }
      set(key: string, value: unknown) {
        store.set(key, value)
      }
      delete(key: string) {
        store.delete(key)
      }
    },
  }
})

type FakeStream = EventEmitter & {
  stderr: EventEmitter
  close: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

function makeStream(): FakeStream {
  const s = new EventEmitter() as FakeStream
  s.stderr = new EventEmitter()
  s.close = vi.fn()
  s.destroy = vi.fn()
  return s
}

describe('exec 超时/失败必须关掉 ssh2 通道', () => {
  let mgr: import('../../src/main/services/ssh/connection-manager').SshConnectionManager
  let sessions: Map<string, Record<string, unknown>>
  let nextStream: FakeStream
  /** 扣住的 exec 回调本体——"迟到"必须是同一个回调晚一步被调用，而不是另造一条通道 */
  let pendingCb: ((e: Error | null, s: FakeStream) => void) | null = null
  /** 把 exec 回调扣住不发，用来模拟"超时先于回调" */
  let holdCallback = false

  function inject(sessionId: string): void {
    const client = new EventEmitter() as unknown as Record<string, unknown>
    client.destroy = () => {}
    client.end = () => {}
    client.connect = () => {}
    client.exec = (_c: string, cb: (e: Error | null, s: FakeStream) => void) => {
      nextStream = makeStream()
      pendingCb = cb
      if (!holdCallback) cb(null, nextStream)
    }
    sessions.set(sessionId, {
      client,
      sessionId,
      config: { id: 'srv-1', host: 'example.invalid', port: 22, username: 'tester' },
      state: 'connected',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      shells: new Map(),
      keepAliveTimer: null,
      reconnecting: false,
      closeNotified: false,
    })
    expect(mgr.getConnectionState(sessionId), '注入的会话没被认出来，条目形状变了').toBe('connected')
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    holdCallback = false
    const mod = await import('../../src/main/services/ssh/connection-manager')
    mgr = mod.SshConnectionManager.getInstance()
    sessions = (mgr as unknown as { sessions: Map<string, Record<string, unknown>> }).sessions
    for (const id of [...sessions.keys()]) sessions.delete(id)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('超时：拒错 + 通道 close + 监听器摘干净', async () => {
    inject('s-timeout')
    const p = mgr.exec('s-timeout', 'sleep 999')
    await vi.advanceTimersByTimeAsync(0)
    // 命令一直没输出也没退出，到 10 秒（设置页那格）就该判死
    const assertion = expect(p).rejects.toThrow(/命令执行超时/)
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
    expect(nextStream.close, '超时后通道没关：远端进程继续跑，监听器继续攒字符串').toHaveBeenCalled()
    expect(nextStream.listenerCount('data'), '监听器没摘干净').toBe(0)
    expect(nextStream.stderr.listenerCount('data'), 'stderr 的监听器也没摘').toBe(0)
  })

  it('正向对照：正常跑完不许再 close 一次（通道自己关的）', async () => {
    inject('s-normal')
    const p = mgr.exec('s-normal', 'uptime')
    await vi.advanceTimersByTimeAsync(0)
    nextStream.emit('exit', 0)
    nextStream.emit('close')
    const r = await p
    expect(r.exitCode).toBe(0)
    expect(nextStream.close, '命令已经自己退出，实现不该再补一刀 close').not.toHaveBeenCalled()
  })

  it('AI 侧的 abortSignal 一到：拒错、关通道，不等命令超时', async () => {
    inject('s-abort')
    const ac = new AbortController()
    const p = mgr.exec('s-abort', 'sleep 999', undefined, { signal: ac.signal })
    await vi.advanceTimersByTimeAsync(0)
    const assertion = expect(p).rejects.toThrow(/已被取消/)
    ac.abort()
    await assertion
    expect(nextStream.close, '取消后不关通道就是留了一条还在跑的远端命令').toHaveBeenCalled()
    expect(nextStream.listenerCount('data')).toBe(0)
  })

  it('已经是 aborted 的信号：当场拒错，不去等一个永不来的回调', async () => {
    inject('s-already')
    const ac = new AbortController()
    ac.abort()
    await expect(mgr.exec('s-already', 'uptime', undefined, { signal: ac.signal })).rejects.toThrow(/已被取消/)
  })

  it('命令正常跑完要摘掉 abort 监听器（不留悬挂引用）', async () => {
    inject('s-clean')
    const ac = new AbortController()
    const p = mgr.exec('s-clean', 'uptime', undefined, { signal: ac.signal })
    await vi.advanceTimersByTimeAsync(0)
    nextStream.emit('exit', 0)
    nextStream.emit('close')
    await expect(p).resolves.toMatchObject({ exitCode: 0 })
    // 结算之后再点"停止"：不许重复关通道，也不许把一个已完成的结果改判成取消
    // （监听器没摘干净的话，这里就会踩出第二个 settle）
    ac.abort()
    await Promise.resolve()
    expect(nextStream.close, '命令已经正常结束，取消不该再动它').not.toHaveBeenCalled()
  })

  it('exec 回调在超时之后才回来：当场关掉，且不挂任何监听器', async () => {
    holdCallback = true
    inject('s-late')
    const p = mgr.exec('s-late', 'sleep 999')
    const assertion = expect(p).rejects.toThrow(/命令执行超时/)
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
    expect(pendingCb, 'exec 回调没被扣住，这条用例在空跑').not.toBeNull()

    // 现在才把通道交出去（同一条回调，晚了一拍）：以前这里会把 data/close/error 全挂上，
    // 挂完没人收，通道也留着不放
    const late = nextStream
    const emitSpy = vi.spyOn(late, 'emit')
    pendingCb!(null, late)
    expect(late.close, '迟到的通道必须当场关闭').toHaveBeenCalled()
    expect(emitSpy, '迟到通道上不该再挂任何监听器').not.toHaveBeenCalled()
    expect(late.listenerCount('data'), 'data 监听器没挂上才对').toBe(0)
    expect(late.listenerCount('close'), 'close 监听器没挂上才对').toBe(0)
  })
})
