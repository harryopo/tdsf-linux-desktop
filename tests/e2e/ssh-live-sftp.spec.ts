/**
 * ssh-live-sftp.spec.ts — 真机交互链路验证（SFTP 读写 / 终端字节流 / 主机密钥只问一次）
 *
 * 为什么要有这一份：ssh-live-verification.spec.ts 只量了「连上 + exec + 监控」。
 * 用户真正会点的另外三条路仍没有真机判据：
 *   1. 文件工作台走的是 SFTP 通道（write/read/stat/list/rename/delete），不是 exec；
 *   2. 终端走的是 shell 字节流（sshShellStart/Write），不是一次性 exec；
 *   3. 首连认下主机密钥后，重连必须不再弹卡（known_hosts 真的写进去了）。
 *
 * 凭据来源（优先级）：
 *   1. 环境变量 TDSF_SSH_HOST / _PORT / _USER / _PASSWORD
 *   2. tests/e2e/.ssh-credentials.local.json（gitignore 忽略，不提交）
 * 没有凭据、没 build、或靶机 TCP 不通 → skip 并写明原因；skip 不等于通过。
 *
 * 全程用临时 known_hosts 文件，不碰用户 ~/.ssh/known_hosts。
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  installHostKeyRecorder,
  installTerminalTap,
  launchApp,
  openShellViaIpc,
  readHostKeyPrompts,
  tcpReachable,
  writeShellViaIpc,
} from './ssh-fixture-helpers'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))

interface LiveCred {
  host: string
  port: number
  username: string
  password: string
}

function loadCred(): LiveCred {
  let file: Partial<LiveCred> = {}
  const credFile = path.join(__dirname, '.ssh-credentials.local.json')
  if (fs.existsSync(credFile)) {
    try {
      file = JSON.parse(fs.readFileSync(credFile, 'utf8')) as Partial<LiveCred>
    } catch {
      file = {}
    }
  }
  return {
    host: (process.env.TDSF_SSH_HOST ?? file.host ?? '').trim(),
    port: Number((process.env.TDSF_SSH_PORT ?? String(file.port ?? 22)).trim()),
    username: (process.env.TDSF_SSH_USER ?? file.username ?? '').trim(),
    password: process.env.TDSF_SSH_PASSWORD ?? file.password ?? '',
  }
}

const CRED = loadCred()
const CAN_RUN = BUILD_READY && !!CRED.host && !!CRED.username && !!CRED.password
const testOrSkip = CAN_RUN ? test : test.skip

if (!CAN_RUN) {
  console.log('[ssh-live-sftp] 跳过：需要 pnpm build + TDSF_SSH_HOST/PORT/USER/PASSWORD（或本地凭据文件）。')
}

async function connect(
  page: Page,
  knownHostsPath: string,
  id: string
): Promise<{ sessionId: string | null; error?: string }> {
  return page.evaluate(
    async (args) => {
      const api = (window as unknown as {
        electronAPI: { sshConnect: (cfg: unknown) => Promise<string> }
      }).electronAPI
      try {
        const sessionId = await api.sshConnect({
          id: args.id,
          name: '真机链路验证',
          host: args.host,
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
    },
    { ...CRED, id, knownHostsPath }
  )
}

async function disconnect(page: Page, sessionId: string): Promise<void> {
  await page.evaluate((sid) => {
    const api = (window as unknown as {
      electronAPI: { sshDisconnect: (s: string) => Promise<boolean> }
    }).electronAPI
    return api.sshDisconnect(sid)
  }, sessionId)
}

async function requireTarget(): Promise<void> {
  const up = await tcpReachable(CRED.host, CRED.port)
  test.skip(!up, `靶机 ${CRED.host}:${CRED.port} TCP 连不上（机器没开或不在同一网）`)
}

test.describe.configure({ mode: 'serial' })

test.describe('真机交互链路（SFTP / 终端流 / 重连不重问主机密钥）', () => {
  testOrSkip('SFTP 往返：写 / 读 / stat / list / rename / delete 全部落在真机', async () => {
    await requireTarget()
    test.setTimeout(120_000)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-live-sftp-'))
    const knownHostsPath = path.join(dir, 'known_hosts')
    const remote = `/tmp/tdsf-e2e-${Date.now()}-${process.pid}.txt`
    const renamed = `${remote}.bak`
    const content = `tdsf e2e real\n第二行中文\n${Date.now()}\n`
    const { app, page } = await launchApp()
    await installHostKeyRecorder(page, 'accept-and-save')
    let sid = ''
    try {
      const conn = await connect(page, knownHostsPath, 'live-sftp')
      expect(conn.error, `SSH 连接失败: ${conn.error ?? ''}`).toBeUndefined()
      expect(conn.sessionId, '应返回 sessionId').toBeTruthy()
      sid = conn.sessionId as string

      const wrote = await page.evaluate(
        (args) => {
          const api = (window as unknown as {
            electronAPI: { sftpWriteFile: (s: string, p: string, c: string) => Promise<boolean> }
          }).electronAPI
          return api.sftpWriteFile(args.sid, args.path, args.content)
        },
        { sid, path: remote, content }
      )
      expect(wrote, 'sftpWriteFile 应返回 true').toBe(true)

      const read = await page.evaluate(
        (args) => {
          const api = (window as unknown as {
            electronAPI: { sftpReadFile: (s: string, p: string) => Promise<string> }
          }).electronAPI
          return api.sftpReadFile(args.sid, args.path)
        },
        { sid, path: remote }
      )
      expect(read, '读回内容必须与写入逐字节一致').toBe(content)


      const listed = await page.evaluate(
        (args) => {
          const api = (window as unknown as {
electronAPI: {
              sftpList: (s: string, p: string) => Promise<{ name: string; isFile: boolean; size: number }[]>
            }
          }).electronAPI
          return api.sftpList(args.sid, '/tmp')
        },
        { sid }
      )
      const hit = listed.find((e) => e.name === path.basename(remote))
      expect(hit, '/tmp 列表应含刚写的文件').toBeTruthy()
      expect(hit!.isFile, '列出来这一条必须是普通文件（不是目录）').toBe(true)
      expect(hit!.size, '列表里的 size 必须等于写入字节数（这是界面显示大小的同一份数）').toBe(
        Buffer.byteLength(content)
      )

      const renamedOk = await page.evaluate(
        (args) => {
          const api = (window as unknown as {
            electronAPI: { sftpRename: (s: string, a: string, b: string) => Promise<boolean> }
          }).electronAPI
          return api.sftpRename(args.sid, args.from, args.to)
        },
        { sid, from: remote, to: renamed }
      )
      expect(renamedOk, 'sftpRename 应返回 true').toBe(true)

      const readAfter = await page.evaluate(
        (args) => {
          const api = (window as unknown as {
            electronAPI: { sftpReadFile: (s: string, p: string) => Promise<string> }
          }).electronAPI
          return api.sftpReadFile(args.sid, args.path)
        },
        { sid, path: renamed }
      )
      expect(readAfter, '改名后内容不变').toBe(content)

      const deleted = await page.evaluate(
        (args) => {
          const api = (window as unknown as {
            electronAPI: { sftpDelete: (s: string, p: string) => Promise<boolean> }
          }).electronAPI
          return api.sftpDelete(args.sid, args.path)
        },
        { sid, path: renamed }
      )
      expect(deleted, 'sftpDelete 应返回 true').toBe(true)

      // 复查走界面真用的那条：列父目录，被删掉的那个名字必须不在里面
      const afterDelete = await page.evaluate(
        (args) => {
          const api = (window as unknown as {
            electronAPI: { sftpList: (s: string, p: string) => Promise<{ name: string }[]> }
          }).electronAPI
          return api.sftpList(args.sid, '/tmp')
        },
        { sid }
      )
      expect(
        afterDelete.some((e) => e.name === path.basename(renamed)),
        '删除后 /tmp 列表里不该再有这个文件'
      ).toBe(false)

    } finally {
      if (sid) await disconnect(page, sid).catch(() => undefined)
      await app.close().catch(() => undefined)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  testOrSkip('终端字节流：shell 写命令，回流里必须出现真机 uname 的输出', async () => {
    await requireTarget()
    test.setTimeout(120_000)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-live-shell-'))
    const knownHostsPath = path.join(dir, 'known_hosts')
    const { app, page } = await launchApp()
    await installHostKeyRecorder(page, 'accept-and-save')
    let sid = ''
    let shellId = ''
    try {
      const conn = await connect(page, knownHostsPath, 'live-shell')
      expect(conn.error, `SSH 连接失败: ${conn.error ?? ''}`).toBeUndefined()
      expect(conn.sessionId).toBeTruthy()
      sid = conn.sessionId as string

      const readRaw = await installTerminalTap(page)
      shellId = await openShellViaIpc(page, sid)
      expect(shellId, 'sshShellStart 应返回 shellId').toBeTruthy()

      // 先等 shell 真的开口（提示符/banner 任一字节），再打字
      await expect
        .poll(async () => (await readRaw()).length, { timeout: 20_000, message: 'shell 一个字节都没回流' })
        .toBeGreaterThan(0)

      // 键入串里是 $(uname -s)，断言串里是展开后的 Linux —— 防止"本地回显"冒充真机输出
      const wrote = await writeShellViaIpc(page, shellId, 'echo TDSF_LINUX_$(uname -s)_OK\r')
      expect(wrote, 'sshShellWrite 应返回 true').toBe(true)

      await expect
        .poll(async () => (await readRaw()).includes('TDSF_LINUX_Linux_OK'), {
          timeout: 20_000,
          message: '真机命令输出没有回到终端流',
        })
        .toBe(true)

      const shells = await page.evaluate((sessionId) => {
        const api = (window as unknown as {
          electronAPI: { sshShellList: (s: string) => Promise<string[]> }
        }).electronAPI
        return api.sshShellList(sessionId)
      }, sid)
      expect(shells, 'sshShellList 应列出刚开的 shell').toContain(shellId)
    } finally {
      if (shellId) {
        await page
          .evaluate((id) => {
            const api = (window as unknown as {
              electronAPI: { sshShellClose: (s: string) => Promise<boolean> }
            }).electronAPI
            return api.sshShellClose(id)
          }, shellId)
          .catch(() => undefined)
      }
      if (sid) await disconnect(page, sid).catch(() => undefined)
      await app.close().catch(() => undefined)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  testOrSkip('主机密钥：首连必问一次，认下后重连不再问，且新会话能执行命令', async () => {
    await requireTarget()
    test.setTimeout(120_000)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-live-reconnect-'))
    const knownHostsPath = path.join(dir, 'known_hosts')
    const { app, page } = await launchApp()
    let first = ''
    let second = ''
    try {
      await installHostKeyRecorder(page, 'accept-and-save')
      const one = await connect(page, knownHostsPath, 'live-reconnect')
      expect(one.error, `首连失败: ${one.error ?? ''}`).toBeUndefined()
      expect(one.sessionId).toBeTruthy()
      first = one.sessionId as string
      const firstPrompts = await readHostKeyPrompts(page)
      expect(firstPrompts.length, '首次连接必须问主机密钥，不能静默放行').toBeGreaterThan(0)
      expect(fs.statSync(knownHostsPath).size, 'accept-and-save 后 known_hosts 必须真有内容').toBeGreaterThan(0)

      await disconnect(page, first)
      first = ''

      // 重置记录器（它会把 __hkPrompts 清空），再连一次
      await installHostKeyRecorder(page, 'accept-and-save')
      const two = await connect(page, knownHostsPath, 'live-reconnect')
      expect(two.error, `重连失败: ${two.error ?? ''}`).toBeUndefined()
      expect(two.sessionId).toBeTruthy()
      second = two.sessionId as string
      expect(await readHostKeyPrompts(page), '认下之后重连不该再弹主机密钥卡').toEqual([])

      const out = await page.evaluate((sid) => {
        const api = (window as unknown as {
          electronAPI: { sshExec: (s: string, c: string) => Promise<{ stdout: string; exitCode: number }> }
        }).electronAPI
        return api.sshExec(sid, 'echo RECONNECT_OK')
      }, second)
      expect(out.exitCode).toBe(0)
      expect(out.stdout).toContain('RECONNECT_OK')
    } finally {
      if (second) await disconnect(page, second).catch(() => undefined)
      if (first) await disconnect(page, first).catch(() => undefined)
      await app.close().catch(() => undefined)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
