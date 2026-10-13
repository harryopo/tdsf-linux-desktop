/**
 * tests/unit/ssh-connection-lifecycle.test.ts — 断链要报出来、迟到的连接不许接管、中文不能被切断
 *
 * 钉住 2026-10-13 后端审查里连接层的三条（都在 SshConnectionManager）：
 * 1. ssh2 的 close 事件以前只改 entry.state，不推 ssh:state-changed。渲染层的连接状态
 *    只认这一条通道（ipc/ssh.ts 的 onStateChanged），所以服务器重启/拔网线之后界面
 *    还显示"已连接"，用户继续往死通道里敲。
 * 2. error 监听原来是 once('error')：握手期那一次消耗掉之后，链路中途的 socket error
 *    没有监听者 —— Node 把它抛成主进程未捕获异常。
 * 3. shell 输出按包 toString('utf8')：跨包被切开的多字节字符变成一个 U+FFFD，
 *    中文输出（journalctl、中文文件名）首当其冲。
 *
 * 注入方式说明：不发真连接，直接把会话条目塞进 manager 的真 Map，然后调用真 wireClient
 * 把监听器挂上（和 ssh-shell-callback-single-registration.test.ts 同一套路）。
 * 每条用例都先自证真 manager 认这条会话，条目形状变了就当场红，不会空过。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

vi.mock('electron', () => ({
  ipcMain: { handle: () => {}, removeHandler: () => {}, on: () => {} },
  app: { getPath: () => '/tmp/tdsf-ssh-lifecycle', getAppPath: () => '/tmp/tdsf-ssh-lifecycle-app' },
  BrowserWindow: class {},
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  Notification: class {
    static isSupported(): boolean {
      return false
    }
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

type FakeClient = EventEmitter & {
  connect: (opts: unknown) => void
  destroy: () => void
  end: () => void
  shell: (opts: unknown, cb: (err: Error | null, stream: EventEmitter) => void) => void
  exec: (cmd: string, cb: (err: Error | null, stream: EventEmitter) => void) => void
  destroyed: number
  ended: number
  lastStream: EventEmitter | null
}

function makeFakeClient(): FakeClient {
  const c = new EventEmitter() as FakeClient
  c.destroyed = 0
  c.ended = 0
  c.lastStream = null
  c.destroy = () => {
    c.destroyed++
  }
  c.end = () => {
    c.ended++
  }
  // wireClient 末尾会调 connect()；假 client 不发网络包，等着测试自己 emit
  c.connect = () => {}
  c.shell = (_opts, cb) => {
    c.lastStream = new EventEmitter() as EventEmitter & { stderr: EventEmitter }
    // ssh2 的通道自带一个 stderr 子流
    ;(c.lastStream as unknown as { stderr: EventEmitter }).stderr = new EventEmitter()
    cb(null, c.lastStream)
  }
  c.exec = (_cmd, cb) => {
    const s = new EventEmitter() as EventEmitter & { stderr: EventEmitter }
    s.stderr = new EventEmitter()
    cb(null, s)
  }
  return c
}

interface WireClientFn {
  (client: unknown, opts: unknown, onReady: () => void, onError: (err: Error) => void): void
}

describe('连接层：断链上报 / 错误监听常驻 / 中文不被切断', () => {
  let mgr: import('../../src/main/services/ssh/connection-manager').SshConnectionManager
  let sessions: Map<string, Record<string, unknown>>
  let client: FakeClient

  function inject(sessionId: string): Record<string, unknown> {
    client = makeFakeClient()
    const entry: Record<string, unknown> = {
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
    }
    sessions.set(sessionId, entry)
    expect(mgr.getConnectionState(sessionId), '注入的会话没被认出来，条目形状变了').toBe('connected')
    return entry
  }

  /** 用真 wireClient 把监听器挂到假 client 上（不改测试里的实现，只借它的入口） */
  function wire(entry: Record<string, unknown>, onReady = (): void => {}): void {
    const wireClient = (mgr as unknown as { wireClient: WireClientFn }).wireClient
    wireClient.call(mgr, client, {}, onReady, () => {
      entry.state = 'error'
    })
  }

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/ssh/connection-manager')
    mgr = mod.SshConnectionManager.getInstance()
    sessions = (mgr as unknown as { sessions: Map<string, Record<string, unknown>> }).sessions
    for (const id of [...sessions.keys()]) sessions.delete(id)
  })

  it('1. 远端 close 会推一条 disconnected 给渲染层（以前只改内存里的 state）', () => {
    const seen: Array<{ sessionId: string; state: string }> = []
    mgr.onStateChanged((e) => seen.push({ sessionId: e.sessionId, state: e.state }))

    const entry = inject('s-close')
    wire(entry)
    client.emit('close')

    expect(entry.state, 'close 之后内存状态该是 disconnected').toBe('disconnected')
    const pushed = seen.find((s) => s.sessionId === 's-close')
    expect(pushed, '界面拿不到这条断链，就会一直显示"已连接"').toBeTruthy()
    expect(pushed!.state).toBe('disconnected')
  })

  it('2. 握手之后再报错，仍有监听者按断链处理（once 会被握手期那一次消耗掉）', () => {
    const seen: string[] = []
    mgr.onStateChanged((e) => seen.push(e.state))
    const closedSessions: string[] = []
    mgr.onSessionClosed((sessionId) => closedSessions.push(sessionId))

    const entry = inject('s-err')
    let readyFired = false
    wire(entry, () => {
      readyFired = true
    })
    // 先消耗掉 once('error')：模拟握手期报过一次错
    client.emit('error', new Error('握手期报错'))
    expect(readyFired, '握手期那次不该触发 ready').toBe(false)

    entry.state = 'connected'
    client.emit('error', new Error('链路中途断了'))

    expect(seen).toContain('disconnected')
    expect(closedSessions).toContain('s-err')
  })

  it('3. shell 输出跨包切开的中文不再变成乱码', async () => {
    const entry = inject('s-utf8')
    const chunks: string[] = []
    const stream = new EventEmitter() as EventEmitter & { stderr: EventEmitter }
    stream.stderr = new EventEmitter()
    // 直接走真 startShell 的注册路径：fake client 的 shell() 会把我们造的通道交回去
    client = makeFakeClient()
    client.shell = (_o, cb) => cb(null, stream)
    entry.client = client

    const sessionId = 's-utf8'
    const shellId = await (
      mgr as unknown as {
        startShell: (sid: string, size?: unknown) => Promise<string>
      }
    ).startShell(sessionId)
    expect(entry.shells, 'startShell 没登记通道').toBeTruthy()
    void shellId

    const shellEntry = (entry.shells as Map<string, { callbacks: Set<(d: string) => void> }>).get(shellId)
    expect(shellEntry, '拿不到这条 shell 的回调集合').toBeTruthy()
    shellEntry!.callbacks.add((d) => chunks.push(d))

    // "中" = E4 B8 AD：把第三个字节切到下一个包里
    const whole = Buffer.from('中文输出', 'utf8')
    stream.emit('data', whole.subarray(0, 2))
    stream.emit('data', whole.subarray(2))

    expect(chunks.join(''), '跨包的中文被切成了乱码').toBe('中文输出')
    // U+FFFD 用码位写，不写字面量（源文件里放替换字符会被工具改坏）
    expect(chunks.join('').includes(String.fromCharCode(0xfffd)), '输出里混进了乱码字符').toBe(false)
  })

  it('4. 正对照：一包就完整的 ASCII 照常一次到位（解码器不是把输出改慢了）', async () => {
    const entry = inject('s-ascii')
    const stream = new EventEmitter() as EventEmitter & { stderr: EventEmitter }
    stream.stderr = new EventEmitter()
    client = makeFakeClient()
    client.shell = (_o, cb) => cb(null, stream)
    entry.client = client

    const shellId = await (
      mgr as unknown as { startShell: (sid: string) => Promise<string> }
    ).startShell('s-ascii')
    const chunks: string[] = []
    const shellEntry = (entry.shells as Map<string, { callbacks: Set<(d: string) => void> }>).get(shellId)
    shellEntry!.callbacks.add((d) => chunks.push(d))

    stream.emit('data', Buffer.from('ls /etc\n', 'utf8'))
    expect(chunks).toEqual(['ls /etc\n'])
  })
})
