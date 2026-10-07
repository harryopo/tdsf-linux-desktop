/**
 * 阶段 A · A2 判据：跳板机那一跳也必须校验主机密钥
 *
 * 计划原文：「构造两跳，第二跳指纹不符必须拒」。
 * 实现早在 connection-manager.ts 里（跳板机那一跳同样传了 sessionId 去注 hostVerifier），
 * 但此前**没有任何测试钉住它**——谁把那个参数删掉，全仓一片绿，
 * 而 MITM 就能落在承载最终主机流量的那一跳上。这条测试补的就是这个洞。
 *
 * 两个靶机都是仓库内的 ssh-fixture（各自独立 host key、各自端口），
 * 跳板机用 direct-tcpip 转发到目标，所以走的是真 ssh2 两跳握手，不是打桩。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startSshFixture } from '../e2e/ssh-fixture-server'
import { FIXTURE_PASSWORD, FIXTURE_USER } from '../e2e/ssh-fixture-server'
import type { FixtureHandle } from '../e2e/ssh-fixture-server'
import type { SshConfig, SshHostKeyPromptEvent, SshHostKeyResponseAction } from '@shared/models'

// 被测链路会碰 ConfigStore / DatabaseManager，两者都从 electron 取路径：
// 给一个临时目录，别把测试库写进真实的 %APPDATA%
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-jump-test-'))
vi.mock('electron', () => ({
  app: {
    getPath: () => TMP_HOME,
    getName: () => 'tdsf-test',
    isReady: () => true,
    on: () => {},
    whenReady: () => Promise.resolve(),
  },
  ipcMain: { handle: () => {}, on: () => {}, removeHandler: () => {} },
  BrowserWindow: class {},
  safeStorage: {
    isAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
}))
// electron-store 在模块加载时就 new Store()，同样要 app.getPath；用内存实现替掉
vi.mock('electron-store', () => {
  const data = new Map<string, unknown>()
  return {
    default: class FakeStore {
      get(key: string): unknown {
        return data.get(key)
      }
      set(key: string, value: unknown): void {
        data.set(key, value)
      }
      delete(key: string): void {
        data.delete(key)
      }
      has(key: string): boolean {
        return data.has(key)
      }
    },
  }
})

let jump: FixtureHandle
let target: FixtureHandle

beforeAll(async () => {
  jump = await startSshFixture()
  target = await startSshFixture()
})

afterAll(async () => {
  await jump.close()
  await target.close()
  fs.rmSync(TMP_HOME, { recursive: true, force: true })
})

/** 每次用全新的 known_hosts，保证两跳都落到"首次连接"分支上 */
function freshKnownHosts(tag: string): string {
  const f = path.join(TMP_HOME, `known_hosts-${tag}`)
  fs.writeFileSync(f, '', 'utf8')
  return f
}

function twoHopConfig(knownHostsPath: string): SshConfig {
  const hop = {
    host: '127.0.0.1',
    username: FIXTURE_USER,
    authType: 'password' as const,
    password: FIXTURE_PASSWORD,
    strictHostKeyCheck: true,
    knownHostsPath,
  }
  return {
    id: 'jump-target',
    name: '两跳目标',
    ...hop,
    port: target.port,
    jumpHost: { ...hop, port: jump.port },
  }
}

/**
 * 跑一次两跳连接。
 * decide 决定"这台主机要不要放行"，asked 记录弹窗按先后问到了哪些 host:port。
 */
async function connectTwoHop(
  tag: string,
  decide: (p: SshHostKeyPromptEvent) => SshHostKeyResponseAction
): Promise<{ sessionId?: string; error?: string; asked: string[] }> {
  const { SshConnectionManager } = await import('../../src/main/services/ssh/connection-manager')
  const manager = SshConnectionManager.getInstance()
  const asked: string[] = []
  manager.setHostKeyConfirmHandler(async (prompt) => {
    asked.push(`${prompt.host}:${prompt.port}`)
    return decide(prompt)
  })
  try {
    const sessionId = await manager.connect(twoHopConfig(freshKnownHosts(tag)))
    return { sessionId, asked }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), asked }
  }
}

describe('跳板机模式的主机密钥校验（A2）', () => {
  it('两跳都问到了：跳板机和目标各弹一次确认', async () => {
    const r = await connectTwoHop('both-allow', () => 'accept-and-save')
    expect(r.error, `两跳都放行时连接应成功，实际失败：${r.error ?? ''}`).toBeUndefined()
    expect(r.sessionId, '应返回 sessionId').toBeTruthy()
    expect(r.asked, '跳板机那一跳必须也弹确认（不校验就能被 MITM）').toContain(`127.0.0.1:${jump.port}`)
    expect(r.asked, '目标那一跳照常弹确认').toContain(`127.0.0.1:${target.port}`)
    expect(new Set(r.asked).size, '两跳是两个不同的 host:port，不是问了两遍同一台').toBe(2)
  })

  it('拒掉跳板机 → 整条连接失败，且根本走不到目标', async () => {
    const r = await connectTwoHop('deny-jump', (p) =>
      p.port === jump.port ? 'reject' : 'accept-and-save'
    )
    expect(r.sessionId, '跳板机被拒后不该有会话').toBeUndefined()
    expect(r.error ?? '', '应报错而不是静默成功').not.toBe('')
    expect(r.asked, '第一跳就断了，不该再问目标').toEqual([`127.0.0.1:${jump.port}`])
  })

  it('拒掉目标（第二跳指纹不符）→ 整条连接失败', async () => {
    const r = await connectTwoHop('deny-target', (p) =>
      p.port === target.port ? 'reject' : 'accept-and-save'
    )
    expect(r.sessionId, '目标被拒后不该有会话').toBeUndefined()
    expect(r.error ?? '', '应报错而不是静默成功').not.toBe('')
    expect(r.asked).toContain(`127.0.0.1:${target.port}`)
  })
})
