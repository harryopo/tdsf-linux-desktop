/**
 * SSH exec 的"退出码没确认就不算成功"判据（真靶子实测出来的）
 *
 * 实测（openEuler 20.03 SP4 + ssh2，2026-10-13）：命令跑一半时把连接 destroy()/end()，
 * 通道只会来 `close`，**不会来 `exit-status`**。原实现是 `stream.on('close', ok)`，
 * 于是这条路径被报成"执行完成，退出码 -1"——AI 与用户看到的就是"它说成功了，
 * 但机器上什么都没发生"，然后接着往下做后续操作。
 *
 * 三条用例互相咬合：
 *   1. 只来 close ⇒ 必须 reject（这是修的那条）；
 *   2. 正向对照：exit(0) + close ⇒ 正常 resolve，exitCode 0（防止实现被改成"一律报错"蒙过 1）；
 *   3. 反向对照：exit(127) + close ⇒ 仍然 resolve（非零退出是命令自己的结果，不是连接问题）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

vi.mock('electron', () => ({
  ipcMain: { handle: () => {}, removeHandler: () => {}, on: () => {} },
  app: { getPath: () => '/tmp/tdsf-ssh-exec', getAppPath: () => '/tmp/tdsf-ssh-exec-app' },
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

type FakeStream = EventEmitter & { stderr: EventEmitter }

describe('SSH exec：没收到 exit-status 不算执行完成', () => {
  let mgr: import('../../src/main/services/ssh/connection-manager').SshConnectionManager
  let sessions: Map<string, Record<string, unknown>>
  let lastStream: FakeStream

  function inject(sessionId: string): void {
    const client = new EventEmitter() as unknown as Record<string, unknown>
    client.destroy = () => {}
    client.end = () => {}
    client.connect = () => {}
    client.shell = (_o: unknown, cb: (e: Error | null, s: FakeStream) => void) => cb(null, makeStream())
    client.exec = (_c: string, cb: (e: Error | null, s: FakeStream) => void) => {
      lastStream = makeStream()
      cb(null, lastStream)
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

  function makeStream(): FakeStream {
    const s = new EventEmitter() as FakeStream
    s.stderr = new EventEmitter()
    return s
  }

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/ssh/connection-manager')
    mgr = mod.SshConnectionManager.getInstance()
    sessions = (mgr as unknown as { sessions: Map<string, Record<string, unknown>> }).sessions
    for (const id of [...sessions.keys()]) sessions.delete(id)
  })

  it('只来 close（连接半路没了）⇒ 报错，不许报成功', async () => {
    inject('s-noexit')
    const p = mgr.exec('s-noexit', 'uptime')
    await Promise.resolve()
    lastStream.emit('data', Buffer.from('load average: 0.00'))
    lastStream.emit('close')

    await expect(p).rejects.toThrow(/未确认完成/)
  })

  it('正向对照：exit(0) + close ⇒ 成功，退出码 0', async () => {
    inject('s-ok')
    const p = mgr.exec('s-ok', 'uptime')
    await Promise.resolve()
    lastStream.emit('data', Buffer.from('load average: 0.01'))
    lastStream.emit('exit', 0)
    lastStream.emit('close')

    const r = await p
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('load average')
  })

  it('反向对照：exit(127) 是命令自己的结果，不许当成连接故障', async () => {
    inject('s-127')
    const p = mgr.exec('s-127', 'uptime')
    await Promise.resolve()
    lastStream.emit('exit', 127)
    lastStream.emit('close')

    const r = await p
    expect(r.exitCode).toBe(127)
  })
})
