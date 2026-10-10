/**
 * 应用连真 OpenSSH 靶机（A2 判据里「真机连一次验证首连弹卡」那一半）
 *
 * 为什么单独立一份：仓库里的 SSH 链路测试全打在自研夹具上（tests/e2e/ssh-fixture-server.ts），
 * 夹具和客户端用的是同一个 ssh2 库 —— 我们对「主机密钥该怎么问、该怎么存」的理解如果和真正的
 * OpenSSH 不一致，夹具测不出来。这份把真 sshd 当对端，把三件事钉在真语义上：
 *   1. 首连必须问（不能静默放行），认下之后写进 known_hosts 的那条要能被 OpenSSH 自己读回来
 *   2. 再连不许再问
 *   3. 执行命令拿到的是真机回显，不是本地编的（拿同一条命令的直连结果做基线比对）
 *
 * 前置与跑法见 tests/unit/known-hosts-openssh-interop.test.ts 文件头（同一条起靶子的命令）。
 * 没给环境变量或靶子连不上 → 整份 skip 并写明原因；skip 不等于通过。
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from 'ssh2'
import { FIXTURE_READY, installHostKeyRecorder, installTerminalTap, launchApp, openShellViaIpc, readHostKeyPrompts, tcpReachable, writeShellViaIpc } from './ssh-fixture-helpers'
import { opensshLookup, parseTarget, readClientKey, toWslPath } from './real-sshd-fixture'

const DISTRO = (process.env.TDSF_REAL_SSHD_WSL ?? 'Ubuntu-24.04').trim()

/** 参数不全或端口不是纯数字 = 没配靶子（这些值会进外部命令的参数位） */
const TARGET = parseTarget(process.env.TDSF_REAL_SSHD_HOST, process.env.TDSF_REAL_SSHD_PORT)
const HOST = TARGET?.host ?? ''
const PORT = TARGET?.port ?? 0
const USER = (process.env.TDSF_REAL_SSHD_USER ?? '').trim()
const CONFIGURED = TARGET !== null && USER !== ''

const READY = FIXTURE_READY && CONFIGURED
const testOrSkip = READY ? test : test.skip

if (!READY) {
  console.log(
    '[real-sshd] 跳过：需要 TDSF_REAL_SSHD_HOST / _PORT / _USER 三个变量且靶机可达' +
      '（本机可用 WSL 自带的 sshd 起一个，步骤见 tests/unit/known-hosts-openssh-interop.test.ts 文件头）。'
  )
}

let dir = ''
let privateKeyPath = ''
/**
 * 靶子在不在。
 *
 * 规矩跟其它 live spec 一致：给了环境变量但靶机没起，是 skip（带原因），不是红 ——
 * 红只能留给"产品坏了"，否则没人再信这套红了。
 */
let targetUp = false
let targetWhy = ''

/** 直连基线：同一条命令在真机上到底回什么，用来证明界面里的输出不是本地生成的 */
function groundTruth(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    conn
      .on('error', reject)
      .on('ready', () => {
        conn.exec(cmd, (err, stream) => {
          if (err) {
            reject(err)
            return
          }
          let out = ''
          stream.on('data', (d) => (out += d.toString()))
          stream.stderr.on('data', (d) => (out += d.toString()))
          stream.on('close', () => {
            conn.end()
            resolve(out.trim())
          })
        })
      })
      .connect({ host: HOST, port: PORT, username: USER, privateKey: fs.readFileSync(privateKeyPath) })
  })
}

async function disconnect(page: import('@playwright/test').Page, sid: string): Promise<void> {
  await page.evaluate(async (id) => {
    const w = window as unknown as { electronAPI: { sshDisconnect: (s: string) => Promise<boolean> } }
    await w.electronAPI.sshDisconnect(id)
  }, sid)
}
async function connectApp(
  page: import('@playwright/test').Page,
  knownHostsPath: string
): Promise<{ sessionId: string | null; error?: string }> {
  return page.evaluate(
    async (args) => {
      const w = window as unknown as {
        electronAPI: { sshConnect: (cfg: unknown) => Promise<string> }
      }
      try {
        const sessionId = await w.electronAPI.sshConnect({
          id: args.id,
          name: '真OpenSSH靶机',
          host: args.host,
          port: args.port,
          username: args.username,
          authType: 'privateKey',
          privateKeyPath: args.privateKeyPath,
          knownHostsPath: args.knownHostsPath,
        })
        return { sessionId }
      } catch (e) {
        return { sessionId: null, error: (e as Error).message }
      }
    },
    { id: 'real-sshd', host: HOST, port: PORT, username: USER, privateKeyPath, knownHostsPath }
  )
}

test.describe('应用 × 真 OpenSSH 靶机（A2 真机那一半）', () => {
  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-real-sshd-'))
    privateKeyPath = path.join(dir, 'id_ed25519')
    // 环境不到位就 skip（带原因），不许演成"产品坏了"的红：
    // 取密钥要先经过 wsl，发行版没起时它抛错 —— 那也是环境缺，不是缺陷。
    try {
      fs.writeFileSync(privateKeyPath, readClientKey(DISTRO), { mode: 0o600 })
      if (!(await tcpReachable(HOST, PORT))) {
        targetWhy = `靶机 ${HOST}:${PORT} TCP 连不上（sshd 没起）`
        return
      }
      // 阳性对照：直连本身要能成，否则后面「界面里没输出」分不清是产品坏还是靶子坏
      const truth = await groundTruth('echo tdsf-real-alive')
      if (!truth.includes('tdsf-real-alive')) {
        targetWhy = `直连基线跑不出结果：${JSON.stringify(truth)}`
        return
      }
      targetUp = true
    } catch (e) {
      targetWhy = `真靶子前置没就绪：${(e as Error).message.split('\n')[0]}`
    }
  })

  test.afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  testOrSkip('首连必须弹窗，认下后写入的行要能被 OpenSSH 读回来，且回显是真机的', async () => {
    test.skip(!targetUp, targetWhy || '靶子未就绪')
    const knownHostsPath = path.join(dir, 'known_hosts')
    const { app, page } = await launchApp()
    try {
      await installHostKeyRecorder(page, 'accept-and-save')
      const first = await connectApp(page, knownHostsPath)
      expect(first.error ?? '', `连接真机失败：${first.error ?? ''}`).toBe('')
      expect(first.sessionId, '没拿到会话 ID').toBeTruthy()

      const prompts = await readHostKeyPrompts(page)
      expect(prompts, '首连没问用户（静默放行就是缺陷）').toEqual(['unknown-host'])

      // 写回的行必须带真端口写法，而且 OpenSSH 自己的读取器要能找回来
      const written = fs.readFileSync(knownHostsPath, 'utf8')
      expect(written, `known_hosts 里没有这条：${written}`).toContain(`[${HOST}]:${PORT}`)
      expect(
        opensshLookup(`[${HOST}]:${PORT}`, toWslPath(knownHostsPath), DISTRO),
        'OpenSSH 读不回我们写的行'
      ).toContain(`[${HOST}]:${PORT}`)

      // 界面里执行命令拿到的输出，必须与同一台直连的基线逐字一致
      const sid = first.sessionId as string
      const out = await page.evaluate(async (args) => {
        const w = window as unknown as {
          electronAPI: { sshExec: (s: string, c: string) => Promise<{ stdout: string }> }
        }
        return w.electronAPI.sshExec(args.sid, 'uname -sr')
      }, { sid })
      const truth = await groundTruth('uname -sr')
      expect(truth, '基线跑不出内容，量具失效').not.toBe('')
      expect(
        out.stdout.trim(),
        `界面里的输出与真机不一致：界面="${out.stdout.trim()}" 真机="${truth}"`
      ).toBe(truth)

      await disconnect(page, sid)
    } finally {
      await app.close()
    }
  })

  testOrSkip('同一台再连不许再问（known_hosts 真的生效，两个方向都要对）', async () => {
    test.skip(!targetUp, targetWhy || '靶子未就绪')
    const knownHostsPath = path.join(dir, 'known_hosts_reuse')
    fs.writeFileSync(knownHostsPath, '', 'utf8')
    const { app, page } = await launchApp()
    try {
      await installHostKeyRecorder(page, 'accept-and-save')
      const first = await connectApp(page, knownHostsPath)
      expect(first.sessionId, '第一次没连上，第二次谈什么不再问').toBeTruthy()
      await disconnect(page, first.sessionId as string)
      expect(await readHostKeyPrompts(page), '第一跳应只问一次').toEqual(['unknown-host'])

      // 同一页面、同一份 known_hosts 再连：记录器还挂着，弹窗数不该 +1
      const second = await connectApp(page, knownHostsPath)
      expect(second.error ?? '', `第二跳连接失败：${second.error ?? ''}`).toBe('')
      await disconnect(page, second.sessionId as string)

      const prompts = await readHostKeyPrompts(page)
      expect(prompts, `再连还在问用户（known_hosts 没生效）：${prompts.join(', ')}`).toHaveLength(1)
    } finally {
      await app.close()
    }
  })

  testOrSkip('A1 的另一半：人类终端打字仍走裸 shell，真机回显必须上屏', async () => {
    test.skip(!targetUp, targetWhy || '靶子未就绪')
    const knownHostsPath = path.join(dir, 'known_hosts_human')
    fs.writeFileSync(knownHostsPath, '', 'utf8')
    const { app, page } = await launchApp()
    try {
      await installHostKeyRecorder(page, 'accept-and-save')
      const r = await connectApp(page, knownHostsPath)
      expect(r.sessionId, `连不上真机，人类终端无从测起：${r.error ?? ''}`).toBeTruthy()
      const sid = r.sessionId as string

      // 先挂上原始流：红了能一眼分清是"对端没发"还是"发了但没显示"
      const readTermLog = await installTerminalTap(page)

      const shellId = await openShellViaIpc(page, sid)

      const MARK = 'tdsf-human-alive'
      const wrote = await writeShellViaIpc(page, shellId, `echo ${MARK}\r`)
      expect(wrote, 'sshShellWrite 写不进去 ⇒ 把 AI 挪走时把人类路径一起弄断了').toBe(true)

      // 真 pty 会先回显敲的那行、再把 echo 的输出打一遍 ⇒ 同一标记至少出现两次
      const rawText = (): Promise<string> => readTermLog()
      await expect
        .poll(async () => (await rawText()).split(MARK).length - 1, {
          message: `真机回显没回到渲染进程，原始流=${JSON.stringify(await rawText())}`,
          timeout: 20000,
        })
        .toBeGreaterThanOrEqual(2)

      await disconnect(page, sid)
    } finally {
      await app.close()
    }
  })
})
