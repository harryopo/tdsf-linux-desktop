/**
 * ssh-fixture-helpers.ts —— 给 e2e spec 用的 fixture 连接helper
 *
 * 单独一个文件的原因：ssh-fixture-server.ts 也要被 vitest（node 环境）自环测试导入，
 * 把依赖 @playwright/test 的 Page helper 混进去会把 Playwright 拖进单元测试里。
 */
import { _electron as electron, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FIXTURE_PASSWORD, FIXTURE_USER } from './ssh-fixture-server'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')

export interface FixtureConnResult {
  sessionId: string | null
  error?: string
}

/**
 * e2e 专用 userData（临时目录），**每个 spec 一个**。
 * 不指定的话，未打包的 Electron 会把配置写进 %APPDATA%\Electron，
 * 测试留下的 provider / 会话痕迹会跟用户真实实例混在一起（虽然真实产品在
 * %APPDATA%\tdsf-linux-desktop，但共用 profiles 依然难以复现）。
 * 共用同一个临时档位同样有问题：一个 spec 存的假 Provider 会被别的 spec 读到——
 * 实测 ai-chat-live 因此以为"有 Key"不再跳过、visual 的像素基线因模型名变了而误红。
 */
export function e2eProfileDir(): string {
  let tag = 'shared'
  try {
    const info = test.info()
    if (info?.file) tag = path.basename(info.file, '.spec.ts')
  } catch {
    // 不在 Playwright 测试上下文里调用（例如被别的测试框架导入），退回共享名
  }
  return path.join(os.tmpdir(), `tdsf-e2e-profile-${tag}`)
}

export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${e2eProfileDir()}`],
    env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
  })
  const page = await app.firstWindow()
  await page.waitForSelector('body', { timeout: 30000 })
  return { app, page }
}

/**
 * 装一次主机密钥弹窗记录器：记录 scenario，并按 answer 自动应答。
 * 记录到 window.__hkPrompts，用 readHostKeyPrompts 读回。
 */
export async function installHostKeyRecorder(
  page: Page,
  answer: 'accept-once' | 'accept-and-save' | 'reject',
): Promise<void> {
  await page.evaluate((mode) => {
    const w = window as unknown as {
      __hkPrompts?: string[]
      electronAPI: {
        onSshHostKeyPrompt: (cb: (p: { requestId: string; scenario: string }) => void) => () => void
        sshRespondHostKey: (requestId: string, action: string) => Promise<boolean>
      }
    }
    w.__hkPrompts = []
    w.electronAPI.onSshHostKeyPrompt((prompt) => {
      w.__hkPrompts?.push(prompt.scenario)
      void w.electronAPI.sshRespondHostKey(prompt.requestId, mode)
    })
  }, answer)
}

export async function readHostKeyPrompts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __hkPrompts?: string[] }
    return w.__hkPrompts ?? []
  })
}

/** 走真实 IPC 连到 fixture（knownHostsPath 指到调用方给的临时文件，不碰用户 ~/.ssh） */
export async function connectToFixture(
  page: Page,
  opts: { port: number; id: string; knownHostsPath: string },
): Promise<FixtureConnResult> {
  return page.evaluate(async (args) => {
    const w = window as unknown as {
      electronAPI: { sshConnect: (cfg: unknown) => Promise<string> }
    }
    try {
      const sessionId = await w.electronAPI.sshConnect({
        id: args.id,
        name: 'Fixture靶机',
        host: '127.0.0.1',
        port: args.port,
        username: args.username,
        authType: 'password',
        password: args.password,
        knownHostsPath: args.knownHostsPath,
      })
      return { sessionId }
    } catch (e) {
      return { sessionId: null, error: (e as Error).message }
    }
  }, { ...opts, username: FIXTURE_USER, password: FIXTURE_PASSWORD })
}

/** 把会话写进 server-store（真实路径里由 ServerList/标题栏做），TerminalView 才挂得上 */
export async function bindSessionToStore(page: Page, serverId: string, sessionId: string): Promise<void> {
  await page.evaluate(
    ({ sid, id }) => {
      const stores = (window as unknown as {
        __tdsfStores?: {
          server: { getState: () => {
            setConnectionState: (k: string, s: string) => void
            setSessionMapping: (k: string, sid: string) => void
            setActiveSession: (sid: string) => void
          } }
        }
      }).__tdsfStores
      if (!stores) throw new Error('__tdsfStores 未挂载，无法建立会话映射')
      const st = stores.server.getState()
      st.setConnectionState(id, 'connected')
      st.setSessionMapping(id, sid)
      st.setActiveSession(sid)
    },
    { sid: sessionId, id: serverId },
  )
}

export const FIXTURE_READY = fs.existsSync(MAIN_ENTRY)

/**
 * TCP 可达性探针（3 秒）。
 *
 * 为什么需要：靶机没开的时候，"连真机"那几条 spec 会报 ETIMEDOUT 变成红，
 * 而红是"环境不在"不是"产品坏了"——混在一起就没人再信这套红了。
 * 用它把这两种情况分开：连不上 → skip 并把原因打出来；连得上 → 失败才算数。
 */
export async function tcpReachable(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
  const net = await import('node:net')
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port, timeout: timeoutMs })
    const done = (ok: boolean) => {
      sock.destroy()
      resolve(ok)
    }
    sock.on('connect', () => done(true))
    sock.on('timeout', () => done(false))
    sock.on('error', () => done(false))
  })
}


/**
 * 在渲染进程里开一个终端，返回 shellId
 *
 * 2026-10-10 起 sshShellStart 的返回从 boolean 变成 shellId（一条连接可以开多个终端，
 * 输出按 shellId 分发）。四个 spec 原先各抄一遍这段 page.evaluate，线格式一改就必然漏一处，
 * 所以收成一个 helper。
 */
export async function openShellViaIpc(page: Page, sessionId: string): Promise<string> {
  const got = await page.evaluate(
    (sid) =>
      (
        window as unknown as {
          electronAPI: { sshShellStart: (s: string) => Promise<unknown> }
        }
      ).electronAPI.sshShellStart(sid),
    sessionId,
  )
  if (typeof got !== 'string' || !got) {
    throw new Error(`sshShellStart 应返回 shellId 字符串，实际拿到 ${JSON.stringify(got)}`)
  }
  return got
}

/** 往指定终端写数据（第一个参数是 shellId，不是 sessionId） */
export async function writeShellViaIpc(
  page: Page,
  shellId: string,
  data: string,
): Promise<boolean> {
  return page.evaluate(
    (args) =>
      (
        window as unknown as {
          electronAPI: { sshShellWrite: (s: string, d: string) => Promise<boolean> }
        }
      ).electronAPI.sshShellWrite(args.shellId, args.data),
    { shellId, data },
  )
}

/**
 * 挂上原始字节流旁听，返回"读累计收到的字节串"的函数
 *
 * 用途：终端类断言红了，先看这里 —— 能一眼分清是"对端根本没发"还是"发了但没切成块"。
 */
export async function installTerminalTap(page: Page): Promise<() => Promise<string>> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __termLog?: string
      electronAPI: { onTerminalData: (cb: (shellId: string, data: string) => void) => () => void }
    }
    w.__termLog = ''
    w.electronAPI.onTerminalData((_shellId, data) => {
      w.__termLog = (w.__termLog ?? '') + data
    })
  })
  return () => page.evaluate(() => (window as unknown as { __termLog?: string }).__termLog ?? '')
}
