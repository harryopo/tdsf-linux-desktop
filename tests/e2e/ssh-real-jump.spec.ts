/**
 * 应用经跳板机连第二台真 OpenSSH（A2 判据里最硬的那一条）
 *
 * 计划原文：「跳板机那一跳也校验主机密钥 —— 单测：构造两跳，第二跳指纹不符必须拒；
 * 真机连一次内网 VM 验证首连弹卡」。前半条已有 fixture 单测；这份补后半条，并且用真 OpenSSH：
 * 起两台一次性 sshd（跳板 2222 / 目标 2224，两把**不同**的主机密钥），
 * 问的是「两跳有没有各自问用户」—— 只信任目标时仍必须为跳板弹一次卡，
 * 因为回归的表现正是承载最终主机流量的那一跳被静默放行。
 *
 * 前置：见 tests/unit/known-hosts-openssh-interop.test.ts 文件头（同一套起法，两台端口分开）。
 * 环境变量：
 *   TDSF_REAL_SSHD_HOST / _PORT / _USER   目标机（跳板转发后要到的那台）
 *   TDSF_REAL_JUMP_PORT                   跳板机端口（与目标同 IP，密钥不同）
 *   可选 TDSF_REAL_SSHD_WSL               发行版名，默认 Ubuntu-24.04
 * 缺任一条件或靶子不可达 → skip 并写明原因，不算通过。
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from 'ssh2'
import {
  FIXTURE_READY,
  installHostKeyRecorder,
  launchApp,
  readHostKeyPrompts,
  tcpReachable,
} from './ssh-fixture-helpers'
import { parseTarget, readClientKey, scanHostLine } from './real-sshd-fixture'

const DISTRO = (process.env.TDSF_REAL_SSHD_WSL ?? 'Ubuntu-24.04').trim()
const USER = (process.env.TDSF_REAL_SSHD_USER ?? '').trim()

/** 全部值都按 fail-closed 解析：这些会进外部命令参数位与连接配置，脏值一律当"环境没配" */
const TARGET = parseTarget(process.env.TDSF_REAL_SSHD_HOST, process.env.TDSF_REAL_SSHD_PORT)
const JUMP = parseTarget(process.env.TDSF_REAL_SSHD_HOST, process.env.TDSF_REAL_JUMP_PORT)
const HOST = TARGET?.host ?? ''
const targetPort = TARGET?.port ?? null
const jumpPort = JUMP?.port ?? null
const CONFIGURED = targetPort !== null && jumpPort !== null && USER !== ''

const READY = FIXTURE_READY && CONFIGURED && targetPort !== null && jumpPort !== null
const testOrSkip = READY ? test : test.skip

if (!READY) {
  console.log(
    '[real-jump] 跳过：需要 TDSF_REAL_SSHD_HOST / _PORT / _USER / TDSF_REAL_JUMP_PORT 且两台靶子可达' +
      '（起法见 tests/unit/known-hosts-openssh-interop.test.ts 文件头）。'
  )
}

let dir = ''
let keyPath = ''
let keyContent = ''
let jumpUp = false
let jumpWhy = ''

/** 两跳直连基线：跳板转发到目标再执行命令，用来证明界面里的输出是真机来的 */
function twoHopExec(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const jump = new Client()
    jump
      .on('error', reject)
      .on('ready', () => {
        jump.forwardOut('127.0.0.1', 0, HOST, targetPort as number, (err, stream) => {
          if (err) {
            reject(err)
            return
          }
          const target = new Client()
          target
            .on('error', reject)
            .on('ready', () => {
              target.exec(cmd, (e2, s2) => {
                if (e2) {
                  reject(e2)
                  return
                }
                let out = ''
                s2.on('data', (d: Buffer) => (out += d.toString()))
                s2.stderr.on('data', (d: Buffer) => (out += d.toString()))
                s2.on('close', () => {
                  target.end()
                  jump.end()
                  resolve(out.trim())
                })
              })
            })
            .connect({ host: HOST, port: targetPort as number, username: USER, privateKey: keyContent, sock: stream })
        })
      })
      .connect({ host: HOST, port: jumpPort as number, username: USER, privateKey: keyContent })
  })
}

async function connectViaJump(page: Page, knownHostsPath: string) {
  return page.evaluate(
    async (args) => {
      const w = window as unknown as {
        electronAPI: { sshConnect: (cfg: unknown) => Promise<string> }
      }
      try {
        const sessionId = await w.electronAPI.sshConnect({
          id: 'real-jump-target',
          name: '经跳板的真机',
          host: args.host,
          port: args.port,
          username: args.username,
          authType: 'privateKey',
          privateKeyPath: args.keyPath,
          knownHostsPath: args.knownHostsPath,
          jumpHost: {
            host: args.host,
            port: args.jumpPort,
            username: args.username,
            authType: 'privateKey',
            privateKeyPath: args.keyPath,
            knownHostsPath: args.knownHostsPath,
          },
        })
        return { sessionId }
      } catch (e) {
        return { sessionId: null, error: (e as Error).message }
      }
    },
    { host: HOST, port: targetPort as number, jumpPort: jumpPort as number, username: USER, keyPath, knownHostsPath }
  )
}

async function runOn(page: Page, sid: string, cmd: string): Promise<string> {
  return page.evaluate(async (args) => {
    const w = window as unknown as {
      electronAPI: { sshExec: (s: string, c: string) => Promise<{ stdout: string }> }
    }
    return (await w.electronAPI.sshExec(args.sid, args.cmd)).stdout
  }, { sid, cmd })
}

async function drop(page: Page, sid: string): Promise<void> {
  await page.evaluate(async (id) => {
    const w = window as unknown as { electronAPI: { sshDisconnect: (s: string) => Promise<boolean> } }
    await w.electronAPI.sshDisconnect(id)
  }, sid)
}

test.describe('应用 × 两台真 OpenSSH（跳板那一跳的密钥校验）', () => {
  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-real-jump-'))
    keyPath = path.join(dir, 'id')
    try {
      keyContent = readClientKey(DISTRO)
      fs.writeFileSync(keyPath, keyContent, { mode: 0o600 })
    } catch (e) {
      jumpWhy = `取不到跳板靶子的临时密钥：${(e as Error).message.split('\n')[0]}`
      return
    }
    if (keyContent.length < 40) {
      jumpWhy = '临时私钥内容异常（太短），靶子没配好'
      return
    }
    const b = await tcpReachable(HOST, jumpPort as number)
    const t = await tcpReachable(HOST, targetPort as number)
    if (!b || !t) {
      jumpWhy = `靶子不可达：跳板 ${HOST}:${jumpPort}=${b} 目标 ${HOST}:${targetPort}=${t}`
      return
    }
    // 阳性对照：两跳直连本身要跑得出结果，否则界面里"没输出"分不清是产品坏还是靶子坏
    try {
      const truth = await twoHopExec('echo tdsf-jump-alive')
      if (!truth.includes('tdsf-jump-alive')) {
        jumpWhy = `两跳直连基线跑不出结果：${JSON.stringify(truth)}`
        return
      }
    } catch (e) {
      jumpWhy = `两跳直连基线异常：${(e as Error).message}`
      return
    }
    jumpUp = true
  })

  test.afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  testOrSkip('两跳都不认识时，必须各问一次（不多不少）', async () => {
    test.skip(!jumpUp, jumpWhy || '靶子未就绪')
    const knownHostsPath = path.join(dir, 'kh_both_unknown')
    fs.writeFileSync(knownHostsPath, '', 'utf8')
    const { app, page } = await launchApp()
    try {
      await installHostKeyRecorder(page, 'accept-and-save')
      const r = await connectViaJump(page, knownHostsPath)
      expect(r.error ?? '', `经跳板连接失败：${r.error ?? ''}`).toBe('')

      const prompts = await readHostKeyPrompts(page)
      expect(prompts, `两跳应各问一次，实际问了 ${prompts.length} 次：${prompts.join(',')}`).toHaveLength(2)
      expect(prompts.every((p) => p === 'unknown-host'), `场景值不对：${prompts.join(',')}`).toBe(true)

      // 隧道真的通了：界面里执行命令的输出必须与两跳直连基线一致
      const sid = r.sessionId as string
      const out = await runOn(page, sid, 'uname -sr')
      const truth = await twoHopExec('uname -sr')
      expect(truth, '基线失败，量具坏了').not.toBe('')
      expect(out.trim(), `界面="${out.trim()}" 基线="${truth}"`).toBe(truth)

      await drop(page, sid)
      // 两跳的行都要落到同一份 known_hosts，且各自带自己的端口
      const file = fs.readFileSync(knownHostsPath, 'utf8')
      expect(file).toContain(`[${HOST}]:${jumpPort}`)
      expect(file).toContain(`[${HOST}]:${targetPort}`)
    } finally {
      await app.close()
    }
  })

  testOrSkip('只信任目标那一跳时，跳板那一跳仍必须被问（回归就坏在这里）', async () => {
    test.skip(!jumpUp, jumpWhy || '靶子未就绪')
    const line = scanHostLine(HOST, targetPort as number, DISTRO)
    expect(line, '扫不到目标机的主机密钥，没法只信任它').toBeTruthy()
    const knownHostsPath = path.join(dir, 'kh_only_target')
    fs.writeFileSync(knownHostsPath, `${line}\n`, 'utf8')

    const { app, page } = await launchApp()
    try {
      await installHostKeyRecorder(page, 'accept-and-save')
      const r = await connectViaJump(page, knownHostsPath)
      expect(r.error ?? '', `连接失败：${r.error ?? ''}`).toBe('')

      const prompts = await readHostKeyPrompts(page)
      // 目标已被信任 → 只剩跳板该问。若代码不给跳板装校验，这里会是 0 次（静默放行）
      expect(
        prompts,
        `跳板那一跳没被校验（承载最终主机流量的一跳被静默放行就是 MITM 面）：问了 ${prompts.length} 次`
      ).toHaveLength(1)
      await drop(page, r.sessionId as string)
    } finally {
      await app.close()
    }
  })

  testOrSkip('两跳都认过之后再连，一次都不该再问', async () => {
    test.skip(!jumpUp, jumpWhy || '靶子未就绪')
    const knownHostsPath = path.join(dir, 'kh_reuse')
    fs.writeFileSync(knownHostsPath, '', 'utf8')
    const { app, page } = await launchApp()
    try {
      await installHostKeyRecorder(page, 'accept-and-save')
      const first = await connectViaJump(page, knownHostsPath)
      expect(first.sessionId, '第一趟没连上，第二趟谈什么不再问').toBeTruthy()
      await drop(page, first.sessionId as string)
      expect(await readHostKeyPrompts(page), '第一趟应正好问两次').toHaveLength(2)

      const second = await connectViaJump(page, knownHostsPath)
      expect(second.error ?? '', `第二趟连接失败：${second.error ?? ''}`).toBe('')
      await drop(page, second.sessionId as string)
      expect(
        await readHostKeyPrompts(page),
        '再连还在问 —— 两跳里有一跳没吃到 known_hosts'
      ).toHaveLength(2)
    } finally {
      await app.close()
    }
  })
})
