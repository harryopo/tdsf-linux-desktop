/**
 * 真靶子集成测试：拿我们自己的连接层代码连真机，验证只有真网络才能证伪的东西
 *
 * 运行方式（默认不参与全量跑）：
 *   SSH_LIVE=1 npx vitest run tests/live/ssh-real-target.test.ts
 *
 * 为什么默认关：它要一台开着的 Linux 靶子和 .env.local 里的真口令。
 * 放进默认套件 = 靶子一关全仓变红，而长期红的闸等于没有闸（这条教训本项目已付过学费）。
 * 所以用 SSH_LIVE 在收集阶段就门掉，"这次到底跑没跑"从 vitest 的文件数就能看出来。
 *
 * 覆盖的都是 mock 测不出来的语义：
 *   主机密钥首连确认与落盘 / 真实退出码 / stdout 与 stderr 分离 /
 *   中文跨包不被切成乱码（StringDecoder 那条修复的真机验证）/ 大输出 /
 *   执行超时 / 一条连接多 shell 不串台 / 并发 exec / 断链上报 / 跳板机两跳都校验密钥
 *
 * 全程只读命令，不在靶子上写任何东西；known_hosts 指到临时文件，不碰 ~/.ssh。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  ipcMain: { handle: () => {}, removeHandler: () => {}, on: () => {} },
  app: { getPath: (k: string) => (k === 'home' ? tmpdir() : tmpdir()), getAppPath: () => tmpdir() },
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
      get(key: string, def?: unknown) {
        return store.has(key) ? store.get(key) : def
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

const LIVE = process.env.SSH_LIVE === '1'

function readEnvLocal(): Record<string, string> {
  const p = join(process.cwd(), '.env.local')
  const out: Record<string, string> = {}
  if (!existsSync(p)) return out
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i > 0 && !line.trimStart().startsWith('#')) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

const ENV = readEnvLocal()
const HOST = ENV.TDSF_SSH_HOST ?? ''
const USER = ENV.TDSF_SSH_USER ?? ''
const PASS = ENV.TDSF_SSH_PASSWORD ?? ''

describe.skipIf(!LIVE)('真靶子：SSH 连接层', () => {
  let mgr: import('../../src/main/services/ssh/connection-manager').SshConnectionManager
  let dir: string
  let knownHosts: string
  let sessionId = ''
  const prompts: Array<{ host: string; scenario: string }> = []

  function baseConfig(over: Record<string, unknown> = {}): never {
    return {
      id: 'live-1',
      name: 'live 靶子',
      host: HOST,
      port: 22,
      username: USER,
      authType: 'password',
      password: PASS,
      strictHostKeyCheck: true,
      knownHostsPath: knownHosts,
      ...over,
    } as never
  }

  beforeAll(async () => {
    const mod = await import('../../src/main/services/ssh/connection-manager')
    mgr = mod.SshConnectionManager.getInstance()
    dir = mkdtempSync(join(tmpdir(), 'tdsf-live-ssh-'))
    knownHosts = join(dir, 'known_hosts')
    mgr.setHostKeyConfirmHandler(async (p) => {
      prompts.push({ host: p.host, scenario: p.scenario })
      return 'accept-and-save'
    })
    sessionId = await mgr.connect(baseConfig())
  }, 60_000)

  afterAll(async () => {
    await mgr.disconnectAll()
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* 临时目录清不掉不影响判定 */
    }
  })

  it('连上了，且首连确实弹了一次主机密钥确认', () => {
    expect(mgr.getConnectionState(sessionId)).toBe('connected')
    expect(prompts.length, 'strictHostKeyCheck 下首连必须问一次').toBeGreaterThanOrEqual(1)
    expect(prompts[0].scenario).toBe('unknown-host')
    // 确认后必须落盘，否则下次还要问
    expect(readFileSync(knownHosts, 'utf8')).toContain(HOST)
  })

  it('真命令：退出码 0，stdout 有内容', async () => {
    const r = await mgr.exec(sessionId, 'uname -sr')
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatch(/Linux/)
  })

  it('命令失败不是异常：false 的退出码是 1', async () => {
    const r = await mgr.exec(sessionId, 'false')
    expect(r.exitCode).toBe(1)
  })

  it('不存在的命令 → 127（真靶子上实测到的行为）', async () => {
    const r = await mgr.exec(sessionId, '/this/binary/does/not/exist-xyz')
    expect(r.exitCode).toBe(127)
  })

  it('stdout 与 stderr 分开收，不混成一段', async () => {
    const r = await mgr.exec(sessionId, 'echo OUTMARK; echo ERRMARK >&2')
    expect(r.stdout).toContain('OUTMARK')
    expect(r.stdout).not.toContain('ERRMARK')
    expect(r.stderr).toContain('ERRMARK')
  })

  it('中文跨包不被切成乱码（300KB 多字节输出）', async () => {
    const r = await mgr.exec(sessionId, "yes '中文测试αβγ服务正常' | head -c 300000")
    expect(r.exitCode, '大输出不该被当成失败').toBe(0)
    expect(r.stdout.length, '输出被截了').toBeGreaterThan(50_000)
    expect(r.stdout).not.toContain('\uFFFD')
    expect(r.stdout).toContain('中文测试αβγ服务正常')
  })

  it('并发 5 条 exec 都拿到自己的结果（会话队列不串台）', async () => {
    const rs = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => mgr.exec(sessionId, `echo N${n}`))
    )
    rs.forEach((r, i) => {
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toContain(`N${i + 1}`)
    })
  })

  it('一条连接开两条 shell，输出不互相串', async () => {
    const seenA: string[] = []
    const seenB: string[] = []
    const shellA = await mgr.startShell(sessionId, { cols: 80, rows: 24 })
    const shellB = await mgr.startShell(sessionId, { cols: 80, rows: 24 })
    const offA = mgr.onShellData(shellA, (d) => seenA.push(d))
    const offB = mgr.onShellData(shellB, (d) => seenB.push(d))

    await mgr.writeShell(shellA, 'echo ONLY_IN_A\n')
    await mgr.writeShell(shellB, 'echo ONLY_IN_B\n')
    await new Promise((r) => setTimeout(r, 2500))

    const a = seenA.join('')
    const b = seenB.join('')
    offA()
    offB()
    mgr.closeShell(shellA)
    mgr.closeShell(shellB)

    expect(a).toContain('ONLY_IN_A')
    expect(b).toContain('ONLY_IN_B')
    expect(b, 'B 里出现了 A 的输出 ⇒ shellId 串台').not.toContain('ONLY_IN_A')
    expect(a).not.toContain('ONLY_IN_B')
  })

  it('resizeShell 真发窗口尺寸且不报错', async () => {
    const shell = await mgr.startShell(sessionId, { cols: 80, rows: 24 })
    // 真签名是 resizeShell(shellId, cols, rows) → Promise<boolean>（connection-manager.ts:579）。
    // 原先传的是 (shell, {cols,rows})：这条只有接了真靶机才会跑，所以 arity 错了也没人撞见；
    // 断言也从 toBeDefined() 收紧成 toBe(true)——false 表示通道没找到，那是失败不是"有定义"
    await expect(mgr.resizeShell(shell, 120, 40)).resolves.toBe(true)
    mgr.closeShell(shell)
  })

  it('执行超时按失败上报（不是静默挂住）', async () => {
    const { ConfigStore } = await import('../../src/main/services/storage/config-store')
    ConfigStore.set('terminal.cmdTimeout', 10)
    await expect(mgr.exec(sessionId, 'sleep 25')).rejects.toThrow(/超时/)
    ConfigStore.set('terminal.cmdTimeout', 30)
  }, 40_000)

  it('断开后渲染层收到 disconnected（不是只改内存）', async () => {
    const seen: string[] = []
    const off = mgr.onStateChanged((e) => seen.push(e.state))
    const s2 = await mgr.connect(baseConfig({ id: 'live-2' }))
    await mgr.disconnect(s2)
    await new Promise((r) => setTimeout(r, 500))
    off()
    expect(seen, '界面拿不到断链就会一直显示"已连接"').toContain('disconnected')
  })

  it('SFTP 列远程目录（只读，走真 sftp 通道）', async () => {
    const { SftpManager } = await import('../../src/main/services/ssh/sftp')
    const sftp = new SftpManager(mgr)
    const entries = await sftp.list(sessionId, '/etc')
    const names = entries.map((e) => e.name)
    expect(names, '列不出 /etc ⇒ sftp 通道没通').toContain('passwd')
    expect(names).toContain('os-release')
  })

  it('被服务端踢掉时，界面收得到状态变化（真 socket，不是 emit 假事件）', async () => {
    // 用第二条连接把第一条的会话进程杀掉：这是"拔网线/服务端踢人"的等价物。
    // 只杀本测试自己起的会话，不碰靶子上别人的。
    // 取 $PPID 而不是 $$：exec 的 shell 跑完就退出，杀它等于杀一个已经不存在的进程；
    // 它的父进程才是服务这条连接的 sshd，杀掉它 socket 才真的断。
    const victim = await mgr.exec(sessionId, 'echo $PPID')
    const pid = victim.stdout.trim().split(/\s+/).pop()
    expect(pid, `没拿到 sshd 会话进程号（stdout=${JSON.stringify(victim.stdout)}）`).toMatch(/^[0-9]+$/)

    const killer = await mgr.connect(baseConfig({ id: 'live-killer' }))
    const seen: string[] = []
    const off = mgr.onStateChanged((e) => {
      if (e.sessionId === sessionId) seen.push(e.state)
    })
    const killed = await mgr.exec(killer, `kill -9 ${pid}`)
    expect(killed.exitCode, '没杀掉自己的会话进程，这条判据无从判定').toBe(0)

    // 等 FIN/close 到达（真网络，给 5 秒轮询窗口）
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !seen.some((s) => s !== 'connected')) {
      await new Promise((r) => setTimeout(r, 200))
    }
    off()
    await mgr.disconnect(killer)
    expect(seen, '被踢掉后界面还显示"已连接"').toContain('disconnected')
  }, 30_000)

  /**
   * 跳板机要真两跳才验得动。
   *
   * 实测这台靶子关着 TCP 转发：forwardOut 到"同机外网 IP:22 / 127.0.0.1:22 / 127.0.0.1:80"
   * 三条全被服务端拒（(SSH) Channel open failure: open failed），所以"自己给自己当跳板"
   * 走不通——那是环境限制，不是代码缺陷（我们的报错文案把失败原因原样带出来了）。
   * 因此这条只在给了第二台机器时才跑：
   *   SSH_LIVE_JUMP_HOST=<跳板机IP> SSH_LIVE=1 npx vitest run tests/live/ssh-real-target.test.ts
   */
  const JUMP_HOST = process.env.SSH_LIVE_JUMP_HOST ?? ''

  it.skipIf(!JUMP_HOST)('跳板机模式：两跳都问主机密钥（A2 的真机验证）', async () => {
    const before = prompts.length
    const jump = await mgr.connect(
      baseConfig({
        id: 'live-jump',
        jumpHost: {
          host: JUMP_HOST,
          port: Number(process.env.SSH_LIVE_JUMP_PORT ?? 22),
          username: process.env.SSH_LIVE_JUMP_USER ?? USER,
          authType: 'password',
          password: process.env.SSH_LIVE_JUMP_PASSWORD ?? PASS,
          strictHostKeyCheck: true,
          knownHostsPath: knownHosts,
        },
      })
    )
    expect(mgr.getConnectionState(jump)).toBe('connected')
    const r = await mgr.exec(jump, 'hostname')
    expect(r.exitCode).toBe(0)
    // 跳板机与目标各问一次；两台机器时至少多问一次
    expect(prompts.length, '跳板机那一跳没走主机密钥校验').toBeGreaterThan(before)
    await mgr.disconnect(jump)
  }, 60_000)
})
