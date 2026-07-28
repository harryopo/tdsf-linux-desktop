/**
 * ssh-live-verification.spec.ts — 真实 SSH 连接链路验证（连真机）
 *
 * 目的：连接真实 Linux 服务器，验证"连接 → 执行命令 → 监控数据回流"全链路真通，
 * 并截图证明监控页展示的是真实数据而非占位。
 *
 * 凭据来源（不写死进代码，从环境变量读，默认用户已确认的测试机）：
 *   TDSF_SSH_HOST     默认 192.168.45.200
 *   TDSF_SSH_PORT     默认 22
 *   TDSF_SSH_USER     默认 root
 *   TDSF_SSH_PASSWORD 必填（无则整个 suite skip，避免误报）
 *
 * 运行：
 *   $env:TDSF_SSH_PASSWORD="xxxx"; pnpm build; npx playwright test tests/e2e/ssh-live-verification.spec.ts
 *
 * 注意：本 spec 依赖外部真实服务器，属"连真机"验证，不进常规 CI（CI 无此内网机）。
 */
import { test, expect, _electron as electron } from '@playwright/test'
import type { Page } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')
const BUILD_READY = fs.existsSync(MAIN_ENTRY)

/**
 * 凭据来源（优先级）：
 * 1. 环境变量 TDSF_SSH_*（CI / 手动）
 * 2. 本地凭据文件 tests/e2e/.ssh-credentials.local.json（gitignore 忽略，不提交）
 *    格式：{ "host": "192.168.45.200", "port": 22, "username": "root", "password": "xxx" }
 *
 * 用文件而非命令行环境变量，是因为 PowerShell + sandbox 下
 * 「设环境变量 + npx 重定向」会触发 npx.ps1 的 StandardOutputEncoding 冲突，
 * 导致命令无法稳定运行。读文件让运行命令保持纯净的 `npx playwright test`。
 */
function loadCredentials(): { host: string; port: number; username: string; password: string } {
  const credFile = path.join(__dirname, '.ssh-credentials.local.json')
  let fileCred: Partial<{ host: string; port: number; username: string; password: string }> = {}
  if (fs.existsSync(credFile)) {
    try {
      fileCred = JSON.parse(fs.readFileSync(credFile, 'utf-8'))
    } catch {
      // 文件损坏时忽略，回退到环境变量
    }
  }
  return {
    host: process.env.TDSF_SSH_HOST ?? fileCred.host ?? '192.168.45.200',
    port: Number(process.env.TDSF_SSH_PORT ?? fileCred.port ?? 22),
    username: process.env.TDSF_SSH_USER ?? fileCred.username ?? 'root',
    password: process.env.TDSF_SSH_PASSWORD ?? fileCred.password ?? '',
  }
}

const CRED = loadCredentials()
const SSH_HOST = CRED.host
const SSH_PORT = CRED.port
const SSH_USER = CRED.username
const SSH_PASSWORD = CRED.password

const SHOT_DIR = path.join(__dirname, 'screenshots-ssh')
fs.mkdirSync(SHOT_DIR, { recursive: true })

// 无密码或未 build 时跳过（不误报失败）
const canRun = BUILD_READY && SSH_PASSWORD.length > 0
const testOrSkip = canRun ? test : test.skip

async function launch() {
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
  })
  const window = await app.firstWindow()
  await window.waitForSelector('body', { timeout: 30000 })
  return { app, window }
}

/**
 * 在渲染进程内完成 SSH 连接（自动应答首次连接的 host key 弹窗）。
 * 返回 sessionId 或错误信息。
 */
async function connectSsh(
  window: Page,
  cfg: { host: string; port: number; username: string; password: string },
): Promise<{ sessionId: string | null; error?: string }> {
  return window.evaluate(async (c) => {
    const api = (window as unknown as {
      electronAPI: {
        sshConnect: (config: unknown) => Promise<string>
        sshRespondHostKey: (requestId: string, action: string) => Promise<boolean>
        onSshHostKeyPrompt: (cb: (p: { requestId: string }) => void) => () => void
      }
    }).electronAPI

    // 首次连接会推送 host key 确认弹窗 —— 自动 accept-and-save 放行握手
    const offPrompt = api.onSshHostKeyPrompt((prompt) => {
      void api.sshRespondHostKey(prompt.requestId, 'accept-and-save')
    })

    try {
      const sessionId = await api.sshConnect({
        id: 'e2e-live-server',
        name: 'E2E真机',
        host: c.host,
        port: c.port,
        username: c.username,
        authType: 'password',
        password: c.password,
      })
      offPrompt()
      return { sessionId }
    } catch (e) {
      offPrompt()
      return { sessionId: null, error: (e as Error).message }
    }
  }, cfg)
}

test.describe('真实 SSH 连接链路验证（连真机）', () => {
  test.describe.configure({ mode: 'serial' })

  testOrSkip('L1: 连接真机 + 执行真实命令，输出必须是真实回显', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launch()

    const conn = await connectSsh(window, {
      host: SSH_HOST,
      port: SSH_PORT,
      username: SSH_USER,
      password: SSH_PASSWORD,
    })
    expect(conn.error, `SSH 连接失败: ${conn.error ?? ''}`).toBeUndefined()
    expect(conn.sessionId, '应返回 sessionId').toBeTruthy()

    // 执行 3 条真实命令，断言输出包含真实系统特征（不是 mock）
    const exec = await window.evaluate(async (sid) => {
      const api = (window as unknown as {
        electronAPI: { sshExec: (s: string, c: string) => Promise<{ stdout: string; exitCode: number }> }
      }).electronAPI
      const hostname = await api.sshExec(sid, 'hostname')
      const uname = await api.sshExec(sid, 'uname -a')
      const uptime = await api.sshExec(sid, 'uptime')
      return { hostname, uname, uptime }
    }, conn.sessionId as string)

    console.log('[真机] hostname =', exec.hostname.stdout.trim())
    console.log('[真机] uname    =', exec.uname.stdout.trim())
    console.log('[真机] uptime   =', exec.uptime.stdout.trim())

    expect(exec.hostname.exitCode, 'hostname 应成功执行').toBe(0)
    expect(exec.hostname.stdout.trim().length, 'hostname 应有真实输出').toBeGreaterThan(0)
    // Linux uname 输出必含 "Linux"
    expect(exec.uname.stdout, 'uname -a 应含 Linux').toContain('Linux')

    await app.close()
  })

  testOrSkip('L2: 启动监控 + 系统信息回流，监控页展示真实数据', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launch()

    const conn = await connectSsh(window, {
      host: SSH_HOST,
      port: SSH_PORT,
      username: SSH_USER,
      password: SSH_PASSWORD,
    })
    expect(conn.sessionId, `连接失败: ${conn.error ?? ''}`).toBeTruthy()
    const sessionId = conn.sessionId as string

    // 复刻真实用户路径：SSH 连接成功后，ServerList 会写入 server-store 的
    // connectionState + sessionMapping + activeSession，监控页据此认会话。
    // 测试环境 store 已挂到 window.__tdsfStores（见 main.tsx）。
    await window.evaluate((sid) => {
      const stores = (window as unknown as {
        __tdsfStores?: {
          server: { getState: () => {
            setConnectionState: (id: string, s: string) => void
            setSessionMapping: (id: string, sid: string) => void
            setActiveSession: (sid: string) => void
          } }
        }
      }).__tdsfStores
      if (stores) {
        const st = stores.server.getState()
        st.setConnectionState('e2e-live-server', 'connected')
        st.setSessionMapping('e2e-live-server', sid)
        st.setActiveSession(sid)
      }
    }, sessionId)

    // 拉真实系统信息 + 启动监控，等待若干采样
    const info = await window.evaluate(async (sid) => {
      const api = (window as unknown as {
        electronAPI: {
          monitorGetSystemInfo: (s: string) => Promise<{ hostname: string; os: string } | null>
          monitorStart: (s: string, interval: number) => Promise<boolean>
        }
      }).electronAPI
      const sysInfo = await api.monitorGetSystemInfo(sid)
      await api.monitorStart(sid, 2000)
      return sysInfo
    }, sessionId)

    console.log('[真机] 系统信息 =', JSON.stringify(info))
    expect(info, '应返回真实系统信息').toBeTruthy()
    expect(info!.hostname.length, 'hostname 非空').toBeGreaterThan(0)

    // 等 2 个采样周期让监控数据回流
    await window.waitForTimeout(5000)

    // 进监控页截图（此时应有真实数据，而非"未连接服务器"占位）
    await window.evaluate(() => {
      window.location.hash = '#/monitor'
    })
    await window.waitForSelector('.mon-main', { timeout: 15000 })
    await window.waitForTimeout(3000)
    await window.screenshot({ path: path.join(SHOT_DIR, 'monitor-live.png'), fullPage: true })

    // 断言监控页确实认到了会话（不再显示"未连接服务器"占位）
    const monText = await window.locator('.mon-main').innerText()
    expect(monText, '监控页不应再显示未连接占位').not.toContain('未连接 SSH 服务器')

    await app.close()
  })
})
