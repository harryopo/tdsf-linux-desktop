/**
 * 远程文件监听的轮询合批（#243）
 *
 * 为什么要改：编辑器每开一个远端文件标签就调 `file:watch:start`，而远端没装 inotifywait 时
 * 每一把 watch 各自挂一个 5 秒 setInterval、各自开一条 exec 通道。真靶机实测
 * （2026-10-26，WSL Ubuntu-24.04 真 OpenSSH，MaxSessions 默认 10）：同一条连接上
 * 12 条并发 exec，**前 10 条成功、第 11、12 条直接 "(SSH) Channel open failure: open failed"**。
 * 而这个预算不是监听独占的——监控采样、SFTP、搜索、AI 的 ssh_exec 都在抢同一把连接。
 * 更要命的是旧代码把失败空 catch 掉，还把时间基准推到当前时间：通道被挤爆时
 * 那一窗口的改动被**静默吞掉**，界面看起来就是"外部改动检测不灵"。
 *
 * 判据要能分开三种情况，所以每条都配了对照：
 * - 合批真的合了（一把会话一条 exec，不是 N 条）；
 * - 没跨会话合（两台机器的路径不能进同一条命令，那会查错机器）；
 * - 关掉一把别的还在（收定时器只能等这个会话名下真没有轮询项）；
 * - 失败不吞窗口（基准不推进，下一轮把这段补回来）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const harness = vi.hoisted(() => {
  type Listener = (sessionId: string, reason: string) => void
  const listeners: Listener[] = []
  const execs: Array<{ sessionId: string; command: string }> = []
  const sent: Array<{ channel: string; payload: { watchId: string; path: string } }> = []
  /** 测试用来改写"这一轮 exec 回什么 / 抛不抛" */
  const behavior: { stdout: string; reject: boolean } = { stdout: '', reject: false }
  const fake = {
    exec: async (sessionId: string, command: string) => {
      execs.push({ sessionId, command })
      if (command.includes('which inotifywait')) {
        // 一律答"没装"，让监听走轮询分支（轮询才有可观测的定时器）
        return { stdout: '', stderr: '', exitCode: 1, duration: 1 }
      }
      if (behavior.reject) throw new Error('(SSH) Channel open failure: open failed')
      return { stdout: behavior.stdout, stderr: '', exitCode: 0, duration: 1 }
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
  return { listeners, execs, sent, behavior, fake }
})

vi.mock('../../src/main/services/ssh/connection-manager', () => ({
  SshConnectionManager: { getInstance: () => harness.fake },
}))

vi.mock('electron', () => ({
  BrowserWindow: class {
    static getAllWindows(): unknown[] {
      return [
        {
          isDestroyed: () => false,
          webContents: {
            send: (channel: string, payload: { watchId: string; path: string }) => {
              harness.sent.push({ channel, payload })
            },
          },
        },
      ]
    }
  },
}))

function findExecs(): string[] {
  return harness.execs.filter((e) => e.command.startsWith('find ')).map((e) => e.command)
}
function probeCount(): number {
  return harness.execs.filter((e) => e.command.includes('which inotifywait')).length
}
function newermtOf(cmd: string): string {
  return cmd.match(/-newermt '@(\d+)'/)?.[1] ?? ''
}

function closeSession(sessionId: string): void {
  for (const l of [...harness.listeners]) l(sessionId, 'disconnect')
}

async function newAdapter(): Promise<{
  adapter: { start(s: string, p: string): Promise<string>; stop(w: string): boolean; dispose(): void; activeWatches(): unknown[] }
  buildPollFindCommand(paths: string[], ref: number): string
  lineBelongsToWatch(changed: string, watched: string): boolean
}> {
  vi.resetModules()
  const mod = await import('../../src/main/services/ssh/file-watcher')
  const { FileWatcherAdapter } = mod
  return {
    adapter: FileWatcherAdapter.getInstance() as never,
    buildPollFindCommand: mod.buildPollFindCommand,
    lineBelongsToWatch: mod.lineBelongsToWatch,
  }
}

describe('轮询合批（每会话一把定时器、一条 exec）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-26T12:00:00Z'))
    harness.execs.length = 0
    harness.sent.length = 0
    harness.behavior.stdout = ''
    harness.behavior.reject = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('1. 命令构造：多个起点一次给，head 按批大小给余量', async () => {
    const { buildPollFindCommand } = await newAdapter()
    expect(buildPollFindCommand(['/var/log/a.log', '/etc/nginx'], 1700000000)).toBe(
      "find '/var/log/a.log' '/etc/nginx' -type f -newermt '@1700000000' 2>/dev/null | head -100"
    )
  })

  it('2. 三个标签一轮只发一条 find（旧写法是三条，会在 10 条通道硬顶里各抢一位）', async () => {
    const { adapter } = await newAdapter()
    await adapter.start('s1', '/var/log/a.log')
    await adapter.start('s1', '/var/log/b.log')
    await adapter.start('s1', '/etc/hosts')

    harness.execs.length = 0
    await vi.advanceTimersByTimeAsync(5_000)

    const cmds = findExecs()
    expect(cmds).toHaveLength(1)
    for (const p of ['/var/log/a.log', '/var/log/b.log', '/etc/hosts']) {
      expect(cmds[0]).toContain(`'${p}'`)
    }
    adapter.dispose()
  })

  it('3. 合批按会话分开：两台机器的路径绝不进同一条命令（那会查错机器）', async () => {
    const { adapter } = await newAdapter()
    await adapter.start('s1', '/var/log/a.log')
    await adapter.start('s2', '/var/log/a.log')

    harness.execs.length = 0
    await vi.advanceTimersByTimeAsync(5_000)

    const onS1 = harness.execs.filter((e) => e.sessionId === 's1' && e.command.startsWith('find '))
    const onS2 = harness.execs.filter((e) => e.sessionId === 's2' && e.command.startsWith('find '))
    expect(onS1).toHaveLength(1)
    expect(onS2).toHaveLength(1)
    adapter.dispose()
  })

  it('4. inotifywait 探测每会话只跑一次（开三个标签不该探三遍）', async () => {
    const { adapter } = await newAdapter()
    await adapter.start('s1', '/var/log/a.log')
    await adapter.start('s1', '/var/log/b.log')
    await adapter.start('s1', '/var/log/c.log')
    expect(probeCount()).toBe(1)

    // 会话断了要作废这份答案：下次连上的可能是另一台机器
    closeSession('s1')
    await vi.advanceTimersByTimeAsync(0)
    await adapter.start('s1', '/var/log/a.log')
    expect(probeCount(), '重连后必须重新探测').toBe(2)
    adapter.dispose()
  })

  it('5. 事件按归属派发：目录监听吃到子文件，前缀边界不许误认', async () => {
    const { adapter, lineBelongsToWatch } = await newAdapter()
    expect(lineBelongsToWatch('/var/log/a.log', '/var/log')).toBe(true)
    expect(lineBelongsToWatch('/var/log2/a.log', '/var/log'), '少一个 / 就是另一台目录').toBe(false)
    expect(lineBelongsToWatch('/var/log', '/var/log')).toBe(true)

    const dirWatch = await adapter.start('s1', '/var/log')
    const fileWatch = await adapter.start('s1', '/etc/hosts')
    harness.behavior.stdout = '/var/log/nginx.log\n/etc/hosts\n/etc/hosts\n'

    await vi.advanceTimersByTimeAsync(5_000)

    const payloads = harness.sent.map((s) => s.payload)
    expect(payloads.filter((p) => p.watchId === dirWatch && p.path === '/var/log/nginx.log')).toHaveLength(1)
    expect(
      payloads.filter((p) => p.watchId === fileWatch && p.path === '/etc/hosts'),
      '同一行回两遍也只派一次'
    ).toHaveLength(1)
    // 三行输出 → 两个事件：重复的那行被去重，另外两行各属一把 watch
    expect(payloads.length, '只有这两把 watch 的变更该被派发').toBe(2)
    expect(harness.sent.every((s) => s.channel === 'file:changed')).toBe(true)
    adapter.dispose()
  })

  it('6. exec 失败不许把时间基准推走：下一轮仍从旧基准查起（窗口不被吞）', async () => {
    const { adapter } = await newAdapter()
    await adapter.start('s1', '/var/log/a.log')

    harness.behavior.reject = true
    await vi.advanceTimersByTimeAsync(5_000)
    const first = newermtOf(findExecs()[0])
    expect(findExecs()).toHaveLength(1)

    harness.behavior.reject = false
    await vi.advanceTimersByTimeAsync(5_000)
    const second = newermtOf(findExecs()[1])
    expect(second, '上一轮失败了，这一轮的起点必须还停在原处').toBe(first)
    adapter.dispose()
  })

  it('7. 成功一轮才推进基准（不会每轮重复报同一批变更）', async () => {
    const { adapter } = await newAdapter()
    await adapter.start('s1', '/var/log/a.log')
    harness.behavior.stdout = '/var/log/a.log\n'

    await vi.advanceTimersByTimeAsync(5_000)
    const first = newermtOf(findExecs()[0])
    await vi.advanceTimersByTimeAsync(5_000)
    const second = newermtOf(findExecs()[1])
    expect(second > first, '这一轮真的查过了，基准就该往前走').toBe(true)
    adapter.dispose()
  })

  it('8. 关一把别的还在，全关完定时器才收', async () => {
    const { adapter } = await newAdapter()
    const w1 = await adapter.start('s1', '/var/log/a.log')
    const w2 = await adapter.start('s1', '/var/log/b.log')

    expect(adapter.stop(w1)).toBe(true)
    harness.execs.length = 0
    await vi.advanceTimersByTimeAsync(5_000)
    expect(findExecs(), '还剩一把，批次不许停').toHaveLength(1)

    expect(adapter.stop(w2)).toBe(true)
    harness.execs.length = 0
    await vi.advanceTimersByTimeAsync(60_000)
    expect(findExecs(), '名下没有轮询项了，定时器必须收干净').toHaveLength(0)
    adapter.dispose()
  })
})
