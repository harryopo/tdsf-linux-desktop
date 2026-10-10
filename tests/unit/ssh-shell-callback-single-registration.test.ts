/**
 * 终端通道的身份判据（W0 的"别叠转发" + W2 的"一条连接多个终端"）
 *
 * 两条历史缺陷钉在这里：
 * 1. 2026-10-10 W0：`ssh:shell:start` 每次都往会话的回调数组追加一份转发，
 *    而 startShell 在已有 shell 时早退返回 true —— 第二次调用之后同一份输出被推两遍，
 *    终端里就是字符成倍重复。渲染层确实有两条会各调一次的入口。
 * 2. 同一批改动暴露的形态问题：一条 SSH 连接只有一个 shell（SessionEntry.shell 是单数），
 *    所以"IDE 能开好几个终端"这件事在结构上做不到，标签页代码也就一直是死的。
 *
 * 现在的形状：startShell 每次真的开一条通道并返回 shellId；每条通道自己一份回调 Set；
 * 输出只发给本通道的订阅者。于是"叠转发"和"串字"这两件事都不再可能。
 *
 * 为什么注入会话条目而不走 connect()：没有不联网就能建会话的公共入口。
 * 每条用例都先断言真 manager 认这条会话（getConnectionState），
 * 不认就说明 SessionEntry 形状变了、测试当场失效而不是空过。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

const box = vi.hoisted(() => ({
  handlers: {} as Record<string, (event: unknown, ...args: never[]) => unknown>,
  sends: [] as Array<{ target: string; channel: string; args: unknown[] }>,
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: unknown) => {
      box.handlers[channel] = handler as (event: unknown, ...args: never[]) => unknown
    },
    removeHandler: () => {},
    on: () => {},
  },
  app: { getPath: () => '/tmp/tdsf-w2-test', getAppPath: () => '/tmp/tdsf-w2-app' },
  BrowserWindow: class {},
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  Notification: class {
    static isSupported(): boolean {
      return false
    }
  },
}))

// W4 起终端输出是广播（broadcastToWindows），不再只发给注册时那一个窗口：
// 这里把它记成一格 target='broadcast'，下面的"每条通道只推一次"照旧可判。
vi.mock('@main/windows/main-window', () => ({
  broadcastToWindows: (channel: string, ...args: unknown[]) => {
    box.sends.push({ target: 'broadcast', channel, args })
  },
}))

vi.mock('electron-store', () => {
  const store = new Map<string, unknown>()
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

/** 假 shell 通道：只实现产品代码真会碰到的那几个方法 */
type FakeShell = EventEmitter & {
  write: (data: string, enc: string, cb?: (err?: Error) => void) => void
  setWindow: () => void
  end: () => void
  writes: string[]
}

function makeShellStream(): FakeShell {
  const stream = new EventEmitter() as FakeShell
  stream.writes = []
  stream.write = (data: string, _enc: string, cb?: (err?: Error) => void) => {
    stream.writes.push(data)
    cb?.()
  }
  stream.setWindow = () => {}
  stream.end = () => {}
  return stream
}

interface Injected {
  sessionId: string
  shells: Map<string, unknown>
}

describe('shellId 是终端身份', () => {
  let mgr: import('../../src/main/services/ssh/connection-manager').SshConnectionManager
  let sessions: Map<string, Injected>
  /** 最近一次 startShell 造出来的通道（供 emit 用） */
  let lastStream: FakeShell

  function makeClient(): unknown {
    return {
      shell: (_opts: unknown, cb: (err: Error | null, stream: unknown) => void) => {
        lastStream = makeShellStream()
        cb(null, lastStream)
      },
      end: () => {},
      exec: (_cmd: string, cb: (err: Error | null, stream: unknown) => void) => {
        cb(null, makeShellStream())
      },
    }
  }

  /** 注入一条已连接的会话，并自证真 manager 认它 */
  function injectSession(sessionId: string): Injected {
    const entry: Injected = { sessionId, shells: new Map() }
    Object.assign(entry, {
      client: makeClient(),
      config: { id: 'srv-1', host: 'example.invalid', port: 22, username: 'tester' },
      state: 'connected',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      keepAliveTimer: null,
      reconnecting: false,
      closeNotified: false,
    })
    sessions.set(sessionId, entry)
    expect(mgr.getConnectionState(sessionId), '注入的会话没被认出来，条目形状变了').toBe('connected')
    return entry
  }

  function terminalSends(target: string): Array<{ channel: string; args: unknown[] }> {
    return box.sends
      .filter((s) => s.target === target && s.channel === 'terminal:data')
      .map((s) => ({ channel: s.channel, args: s.args }))
  }

  async function registerOnce(target: string): Promise<() => void> {
    const mod = await import('../../src/main/ipc/ssh')
    const win = {
      isDestroyed: () => false,
      webContents: {
        // 非广播通道（对话框等）仍按窗口记账
        send: (channel: string, ...args: unknown[]) => {
          box.sends.push({ target, channel, args })
        },
      },
    }
    return mod.registerSshIpcHandlers(win as never)
  }

  /** 走真 handler 开一个终端，返回 shellId */
  async function startShell(sessionId: string): Promise<string> {
    const handler = box.handlers['ssh:shell:start']
    expect(handler, 'ssh:shell:start 没注册').toBeTruthy()
    const got = (await handler({}, sessionId)) as unknown
    if (typeof got !== 'string' || !got) {
      throw new Error(`ssh:shell:start 应返回 shellId，实际拿到 ${JSON.stringify(got)}`)
    }
    return got
  }

  async function callHandler<T>(channel: string, ...args: unknown[]): Promise<T> {
    const handler = box.handlers[channel]
    expect(handler, `${channel} 没注册`).toBeTruthy()
    return (await handler({}, ...args)) as T
  }

  beforeEach(async () => {
    box.handlers = {}
    box.sends = []
    vi.resetModules()
    const mod = await import('../../src/main/services/ssh/connection-manager')
    mgr = mod.SshConnectionManager.getInstance()
    sessions = (mgr as unknown as { sessions: Map<string, Injected> }).sessions
    for (const id of [...sessions.keys()]) sessions.delete(id)
  })

  it('两次 start 得到两个不同终端，各自只收自己的输出', async () => {
    injectSession('s1')
    await registerOnce('winA')

    const a = await startShell('s1')
    const streamA = lastStream
    const b = await startShell('s1')
    const streamB = lastStream

    expect(b, '两次 start 拿到同一个 shellId，等于还是一个终端').not.toBe(a)
    expect(streamA).not.toBe(streamB)
    // 每条通道只挂一个 data 监听（叠加转发就是从这里消失的）
    expect(streamA.listenerCount('data')).toBe(1)
    expect(streamB.listenerCount('data')).toBe(1)

    streamA.emit('data', Buffer.from('AAA'))
    expect(terminalSends('broadcast').map((s) => s.args)).toEqual([[a, 'AAA']])

    streamB.emit('data', Buffer.from('BBB'))
    expect(terminalSends('broadcast').map((s) => s.args)).toEqual([
      [a, 'AAA'],
      [b, 'BBB'],
    ])
  })

  it('写与尺寸按 shellId 定位，关一个不影响另一个', async () => {
    injectSession('s1')
    await registerOnce('winA')
    const a = await startShell('s1')
    const streamA = lastStream
    const b = await startShell('s1')
    const streamB = lastStream

    expect(await callHandler('ssh:shell:write', b, 'ls\n')).toBe(true)
    expect(streamB.writes).toEqual(['ls\n'])
    expect(streamA.writes, '写到 A 去了就是串终端').toEqual([])

    expect(await callHandler('ssh:shell:resize', a, 120, 30)).toBe(true)

    expect(await callHandler('ssh:shell:close', a)).toBe(true)
    expect(streamA.listenerCount('data'), '通道对象上的监听留着也没人广播了').toBeLessThanOrEqual(1)
    streamB.emit('data', Buffer.from('still-alive'))
    expect(terminalSends('broadcast').some((s) => s.args[1] === 'still-alive')).toBe(true)

    // 关掉之后再往它写：必须是清楚的错误而不是静默丢弃
    await expect(callHandler('ssh:shell:write', a, 'whoami\n')).rejects.toThrow(/终端/)
  })

  it('list 报出当前开着的终端；关掉后不再报', async () => {
    injectSession('s1')
    await registerOnce('winA')
    const a = await startShell('s1')
    const b = await startShell('s1')
    expect(await callHandler('ssh:shell:list', 's1')).toEqual([a, b])
    await callHandler('ssh:shell:close', a)
    expect(await callHandler('ssh:shell:list', 's1')).toEqual([b])
  })

  it('卸载后不再转发，重新注册能再挂上（不是一摘就永久黑洞）', async () => {
    injectSession('s1')
    const dispose = await registerOnce('winA')
    const a = await startShell('s1')
    lastStream.emit('data', Buffer.from('one'))
    expect(terminalSends('broadcast')).toHaveLength(1)

    dispose()
    lastStream.emit('data', Buffer.from('two'))
    expect(terminalSends('broadcast'), '卸载后还在推说明订阅没摘干净').toHaveLength(1)

    await registerOnce('winB')
    const c = await startShell('s1')
    lastStream.emit('data', Buffer.from('three'))
    expect(terminalSends('broadcast').map((s) => s.args)).toEqual([
      [a, 'one'],
      [c, 'three'],
    ])
  })

  it('注入自证：没 start 就一个监听都没有、一次 send 都没有', async () => {
    const entry = injectSession('s1')
    await registerOnce('winA')
    expect(entry.shells.size, '不该凭空有通道').toBe(0)
    expect(terminalSends('broadcast')).toHaveLength(0)
  })
})
