/**
 * ssh-fixture-helpers.ts —— 给 e2e spec 用的 fixture 连接helper
 *
 * 单独一个文件的原因：ssh-fixture-server.ts 也要被 vitest（node 环境）自环测试导入，
 * 把依赖 @playwright/test 的 Page helper 混进去会把 Playwright 拖进单元测试里。
 */
import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { FIXTURE_PASSWORD, FIXTURE_USER } from './ssh-fixture-server'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')

export interface FixtureConnResult {
  sessionId: string | null
  error?: string
}

export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [MAIN_ENTRY],
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
