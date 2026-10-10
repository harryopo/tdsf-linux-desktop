/**
 * W0 判据：同一个会话重复 ssh:shell:start 不许让终端输出翻倍
 *
 * 缺陷形态（2026-10-10 复核时确认当场可复现）：
 * - connection-manager 的 startShell 在已有 shell 时**早退返回 true**；
 * - ipc/ssh.ts 的 SHELL_START 看到 true 就再 push 一个转发回调；
 * - shell 输出是广播给 shellCallbacks 全体的，于是同一个 chunk 被 send 两次，
 *   xterm 里就是字符成倍重复。渲染层确实有两条会各调一次的入口
 *   （WorkbenchTitlebar 与 SshSettings 的「连接服务器」）。
 *
 * 为什么走真 handler + 真 manager 而不是假对象：这条断言要钉的是
 * 「产品代码里那份 fan-out」，mock 掉 manager 就等于测我自己的假货。
 * 会话条目是注入进私有 sessions 表的（没有不联网就能建会话的公共入口），
 * 所以每条用例都先断言真 manager 认这条会话（getConnectionState === 'connected'），
 * 不认就说明 SessionEntry 的形状变了、测试跟着失效——这是注入的自证，不是走过场。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

/** 捕获 ipcMain.handle 注册的 handler 与窗口的 send */
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
  app: { getPath: () => '/tmp/tdsf-w0-test', getAppPath: () => '/tmp/tdsf-w0-app' },
  BrowserWindow: class {},
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  Notification: class {
    static isSupported(): boolean {
      return false
    }
  },
}))

// ConfigStore 走 electron-store，node 环境下要壳
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

/** 假 shell 通道：只需要产品代码真会碰到的那几个方法 */
function makeShellStream(): EventEmitter & { write: Function; setWindow: Function; end: Function } {
  const stream = new EventEmitter() as EventEmitter & {
    write: Function
    setWindow: Function
    end: Function
  }
  stream.write = (_data: string, _enc: string, cb?: (err?: Error) => void) => cb?.()
  stream.setWindow = () => {}
  stream.end = () => {}
  return stream
}

/** 假 ssh2 Client：shell() 直接把假通道交给回调 */
function makeClient(stream: ReturnType<typeof makeShellStream>) {
  const client = new EventEmitter() as EventEmitter & Record<string, unknown>
  client.shell = (_opts: unknown, cb: (err: Error | null, stream: unknown) => void) => {
    cb(null, stream)
  }
  client.end = () => {}
  client.exec = (_cmd: string, cb: (err: Error | null, stream: unknown) => void) => cb(null, stream)
  return client
}

/** 目标终端数据通道的 send 计数 */
function terminalSends(target: string): number {
  return box.sends.filter((s) => s.target === target && s.channel === 'terminal:data').length
}

async function startShell(sessionId: string): Promise<unknown> {
  return box.handlers['ssh:shell:start']?.({}, sessionId)
}

describe('重复 ssh:shell:start 不再叠加转发回调', () => {
  let mgr: import('../../src/main/services/ssh/connection-manager').SshConnectionManager
  let stream: ReturnType<typeof makeShellStream>

  /** 把一条已连接的会话注进私有 sessions 表，并当场自证真 manager 认它 */
  async function injectSession(sessionId: string): Promise<void> {
    stream = makeShellStream()
    const client = makeClient(stream)
    const sessions = (
      mgr as unknown as {
        sessions: Map<string, unknown>
      }
    ).sessions
    sessions.set(sessionId, {
      client,
      sessionId,
      config: { id: 'srv-1', host: 'example.invalid', port: 22, username: 'tester' },
      state: 'connected',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      shell: null,
      shellCallbacks: [],
      keepAliveTimer: null,
      reconnecting: false,
      closeNotified: false,
    })
    // 注入自证：形状不对这条就先红，而不是后面所有断言空过
    expect(mgr.getConnectionState(sessionId)).toBe('connected')
  }

  /** 会话条目里的 fan-out 数组（只读，用来证明回调确实挂在产品代码那份数组上） */
  function entryOf(sessionId: string): { shellCallbacks: Array<(d: string) => void>; state: string } {
    const entry = (mgr as unknown as { sessions: Map<string, unknown> }).sessions.get(sessionId)
    expect(entry, `会话 ${sessionId} 不在表里，注入或清理逻辑变了`).toBeTruthy()
    return entry as { shellCallbacks: Array<(d: string) => void>; state: string }
  }

  beforeEach(async () => {
    box.handlers = {}
    box.sends = []
    vi.resetModules()
    const mod = await import('../../src/main/services/ssh/connection-manager')
    mgr = mod.SshConnectionManager.getInstance()
    // 单例跨用例存活：清干净会话表，避免上一轮的会话冒充这一轮
    const sessions = (mgr as unknown as { sessions: Map<string, unknown> }).sessions
    for (const id of [...sessions.keys()]) {
      sessions.delete(id)
    }
  })

  /** 注册一轮 IPC，返回它的卸载函数 */
  async function registerOnce(target: string): Promise<() => void> {
    const mod = await import('../../src/main/ipc/ssh')
    const win = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, ...args: unknown[]) => {
          box.sends.push({ target, channel, args })
        },
      },
    }
    return mod.registerSshIpcHandlers(win as never)
  }

  it('一次 start 一份转发：推一块数据只 send 一次', async () => {
    await injectSession('s1')
    await registerOnce('winA')

    await expect(startShell('s1')).resolves.toBe(true)
    // 该发生的确实发生：假通道上真的挂了 1 个 data 监听
    expect(stream.listenerCount('data')).toBe(1)
    stream.emit('data', Buffer.from('MARKER'))
    expect(terminalSends('winA')).toBe(1)
    // 而且送出去的内容确实是那块数据
    const first = box.sends.find((s) => s.channel === 'terminal:data')
    expect(first?.args).toEqual(['s1', 'MARKER'])
  })

  it('同一会话连开三次仍然只 send 一次（原缺陷当场复现形状）', async () => {
    await injectSession('s1')
    await registerOnce('winA')

    await expect(startShell('s1')).resolves.toBe(true)
    await expect(startShell('s1')).resolves.toBe(true)
    await expect(startShell('s1')).resolves.toBe(true)

    expect(stream.listenerCount('data'), 'shell 通道上的 data 监听数').toBe(1)
    expect(entryOf('s1').shellCallbacks.length, '转发回调数').toBe(1)

    stream.emit('data', Buffer.from('X'))
    // 修之前这里是 3
    expect(terminalSends('winA')).toBe(1)
  })

  it('卸载之后不再转发，且重新注册能挂回来（不是永久黑洞）', async () => {
    await injectSession('s1')
    const dispose = await registerOnce('winA')
    await startShell('s1')
    stream.emit('data', Buffer.from('a'))
    expect(terminalSends('winA')).toBe(1)

    dispose()
    stream.emit('data', Buffer.from('b'))
    expect(terminalSends('winA'), '卸载后仍收到数据说明订阅没真的摘掉').toBe(1)

    // 换一个窗口重注册：产品代码必须能再次挂上转发
    await registerOnce('winB')
    await expect(startShell('s1')).resolves.toBe(true)
    stream.emit('data', Buffer.from('c'))
    expect(terminalSends('winB')).toBe(1)
  })

  it('会话断开后重连，新 shell 仍然有转发且不翻倍', async () => {
    await injectSession('s1')
    await registerOnce('winA')
    await startShell('s1')

    // 断开：产品代码会清空 shellCallbacks 并广播 onSessionClosed
    await mgr.disconnect('s1')
    stream.emit('data', Buffer.from('after-disconnect'))
    expect(terminalSends('winA')).toBe(0)

    // 重连同名会话：如果 IPC 层的去重登记没跟着会话关闭删掉，
    // 这次 start 会被去重逻辑跳过，新 shell 就一条转发都没有（黑洞）。
    await injectSession('s1')
    await expect(startShell('s1')).resolves.toBe(true)
    stream.emit('data', Buffer.from('reconnected'))
    expect(terminalSends('winA'), '重连后新 shell 必须重新挂上转发').toBe(1)
  })

  it('注入自证：假通道没被产品代码接上时，前面的计数不成立', async () => {
    await injectSession('s1')
    await registerOnce('winA')
    // 不调 startShell —— 通道上就该 0 个监听、0 次 send。
    // 这一条证明上面那些 "1 次" 是被真跑出来的，不是 mock 白送的。
    expect(stream.listenerCount('data')).toBe(0)
    stream.emit('data', Buffer.from('nobody-listening'))
    expect(terminalSends('winA')).toBe(0)
  })
})
