/**
 * ssh-fixture.spec.ts —— 用本地假 SSH 服务器把 Demo 的 S1/S2 真跑一遍
 *
 * 覆盖的是【我们这一侧的整条链路】：ssh2 客户端 → 主机密钥校验（首次弹窗 /
 * accept-and-save 后不再询问 / 密钥变更报 host-key-changed）→ 交互式 shell →
 * xterm 解析 → OSC 133/633 命令块 → 状态栏读数。
 * 对端是 tests/e2e/ssh-fixture-server.ts 演的，不是真 Linux，所以这条不能替代
 * 内网 VM 上的 ssh-live-verification.spec.ts——它替代的是"没靶机就整段跳过"。
 *
 * known_hosts 指向系统临时目录里的本次专用文件，绝不碰用户真实的 ~/.ssh/known_hosts。
 *
 * 运行：pnpm build && npx playwright test tests/e2e/ssh-fixture.spec.ts
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeAlienKnownHostLine, startSshFixture } from './ssh-fixture-server'
import type { FixtureHandle } from './ssh-fixture-server'
import {
  bindSessionToStore,
  connectToFixture,
  installHostKeyRecorder,
  launchApp,
  readHostKeyPrompts,
} from './ssh-fixture-helpers'

const testOrSkip = fs.existsSync(path.join(__dirname, '../../out/main/index.js')) ? test : test.skip

/** 本次运行专属的 known_hosts（临时目录，afterAll 里删掉——只删我自己造的） */
const KNOWN_HOSTS = path.join(os.tmpdir(), `tdsf-e2e-known_hosts-${process.pid}.txt`)

const connect = (page: Page, port: number, id: string) =>
  connectToFixture(page, { port, id, knownHostsPath: KNOWN_HOSTS })

test.describe('本地 fixture SSH 靶机（S1 连接 + S2 命令块 + 主机密钥三态）', () => {
  test.describe.configure({ mode: 'serial' })

  let fixture: FixtureHandle

  test.beforeAll(async () => {
    fixture = await startSshFixture()
    fs.writeFileSync(KNOWN_HOSTS, '', 'utf8')
  })

  test.afterAll(async () => {
    await fixture.close()
    if (fs.existsSync(KNOWN_HOSTS)) fs.unlinkSync(KNOWN_HOSTS)
  })

  testOrSkip('F1: 首次连接弹窗 → accept-and-save → 再连不再问', async () => {
    test.setTimeout(120_000)
    const { app, page } = await launchApp()
    await installHostKeyRecorder(page, 'accept-and-save')

    const first = await connect(page, fixture.port, 'fixture-first')
    expect(first.error, `连接失败：${first.error ?? ''}`).toBeUndefined()
    expect(first.sessionId, '应拿到 sessionId').toBeTruthy()

    // 首次必须问一次，且问的是"陌生主机"
    expect(await readHostKeyPrompts(page), '首次连接应弹一次 unknown-host').toEqual(['unknown-host'])

    // 指纹要真落进 known_hosts（端口非 22 的写法是 [host]:port）
    const recorded = fs.readFileSync(KNOWN_HOSTS, 'utf8')
    expect(recorded, 'known_hosts 应记下 [127.0.0.1]:port').toContain(`[127.0.0.1]:${fixture.port}`)
    expect(recorded).toContain('ssh-ed25519')

    // 再连一次：信任已建立，不该再弹
    const second = await connect(page, fixture.port, 'fixture-second')
    expect(second.sessionId, `第二次连接失败：${second.error ?? ''}`).toBeTruthy()
    expect(await readHostKeyPrompts(page), '第二次连接不该再弹密钥窗').toEqual(['unknown-host'])

    await app.close()
  })

  testOrSkip('F2: 交互式 shell → OSC 133/633 → 状态栏命令块真的在长', async () => {
    test.setTimeout(120_000)
    const { app, page } = await launchApp()
    await installHostKeyRecorder(page, 'accept-and-save')

    // F1 已把这台靶机写进临时 known_hosts，这里应当直接就通
    const conn = await connect(page, fixture.port, 'fixture-shell')
    const sessionId = conn.sessionId as string
    expect(sessionId, `连接失败：${conn.error ?? ''}`).toBeTruthy()

    // 先把会话写进 server-store（真实路径里这一步由 ServerList/标题栏做），
    // 再进工作台让 TerminalView 挂上——挂上之后才有人旁听 OSC，顺序不能颠倒
    await bindSessionToStore(page, 'fixture-shell', sessionId)
    await page.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await page.waitForSelector('.wb-main-layout', { timeout: 15000 })

    // 旁听渲染进程收到的原始字节：红了能一眼分清是"对端没发"还是"发了但没成块"
    await page.evaluate(() => {
      const w = window as unknown as {
        __termLog?: string
        electronAPI: { onTerminalData: (cb: (sid: string, data: string) => void) => () => void }
      }
      w.__termLog = ''
      w.electronAPI.onTerminalData((_sid, data) => {
        w.__termLog = (w.__termLog ?? '') + data
      })
    })

    // 开 shell（真实路径由标题栏在连接后调用，这里直连 IPC 复现同一步）
    const started = await page.evaluate(
      (sid) => (window as unknown as { electronAPI: { sshShellStart: (s: string) => Promise<boolean> } })
        .electronAPI.sshShellStart(sid),
      sessionId,
    )
    expect(started, 'sshShellStart 应成功').toBe(true)

    // shell 一开场就吐一个完整命令块（fixture 里写死 echo tdsf-boot）
    const statusbar = page.locator('.wb-statusbar')
    await expect
      .poll(async () => statusbar.innerText(), { message: '状态栏应出现至少 1 个命令块', timeout: 20000 })
      .toMatch(/[1-9]\d* 命令块/)

    // 敲一条命令（走 sshShellWrite → 对端回显 → xterm 解析 → 块模型）
    const wrote = await page.evaluate(
      ({ sid, data }) => {
        const w = window as unknown as { electronAPI: { sshShellWrite: (s: string, d: string) => Promise<boolean> } }
        return w.electronAPI.sshShellWrite(sid, data)
      },
      { sid: sessionId, data: 'uptime\r' },
    )
    expect(wrote, 'sshShellWrite 应写入成功').toBe(true)

    const rawSeen = async (): Promise<string> =>
      page.evaluate(() => (window as unknown as { __termLog?: string }).__termLog ?? '')

    await expect
      .poll(async () => statusbar.innerText(), {
        message: `敲命令后命令块计数应增加，渲染进程实际收到的原始流=${JSON.stringify(await rawSeen())}`,
        timeout: 20000,
      })
      .toMatch(/[2-9]\d* 命令块/)

    // 块内容来自真链路，不是本地拼的：最近命令与退出码在状态栏那条读数的 title 里
    const blockTitle = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.wb-statusbar .wb-status-item')]
      const hit = items.find((el) => (el.getAttribute('title') ?? '').includes('最近命令'))
      return hit ? (hit.getAttribute('title') ?? '') : ''
    })
    expect(blockTitle, '状态栏最近命令应带出敲过的那条').toContain('uptime')
    expect(blockTitle, '应带退出码（真实来自 133;D）').toMatch(/\[ok\]/)

    await app.close()
  })

  testOrSkip('F3: known_hosts 里是另一把钥匙时必须报 host-key-changed 并允许拒绝', async () => {
    test.setTimeout(120_000)
    // 预置一行同 host:port 但密钥不同的记录（模拟中间人换了服务器密钥）
    fs.writeFileSync(KNOWN_HOSTS, makeAlienKnownHostLine('127.0.0.1', fixture.port), 'utf8')

    const { app, page } = await launchApp()
    await installHostKeyRecorder(page, 'reject')

    const conn = await connect(page, fixture.port, 'fixture-alien')
    expect(await readHostKeyPrompts(page), '应报密钥变更而不是陌生主机').toEqual(['host-key-changed'])
    expect(conn.sessionId, '拒绝后不该建立会话').toBeNull()
    expect(conn.error ?? '', '应给出连接失败原因').not.toBe('')

    await app.close()
  })
})
