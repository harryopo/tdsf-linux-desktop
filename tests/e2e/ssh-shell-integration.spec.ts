/**
 * 远端 shell 集成的真机验收（#61）
 *
 * 为什么值得单独立一份：这条链路的产物是"别人机器上的 ~/.bashrc 多了 5 行"，
 * 假的 RemoteFs 单测只能证明我的逻辑自洽，证明不了真 OpenSSH 上
 * SFTP 写得进去、登录 shell 真的会读那份 rc、读进去之后真的开始发 OSC 133/633。
 * 这份把这四件事一次钉住，并且收尾把 rc 还原到字节一致（含崩在中途的兜底还原）。
 *
 * 前置：先按 tests/e2e/real-sshd-fixture.ts 文件头把 WSL 里的真 sshd 起起来，
 * 且那份 config 里要有 `Subsystem sftp /usr/lib/openssh/sftp-server`（集成读写走 SFTP）。
 * 跑法：
 *   $env:TDSF_REAL_SSHD_HOST="172.20.49.165"; $env:TDSF_REAL_SSHD_PORT="2222"
 *   $env:TDSF_REAL_SSHD_USER="harryopo"
 *   pnpm test:e2e tests/e2e/ssh-shell-integration.spec.ts
 * 环境变量没给或靶子连不上 → 整份 skip 并写明原因；skip 不等于通过。
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  FIXTURE_READY,
  bindSessionToStore,
  installTerminalTap,
  launchApp,
  openShellViaIpc,
  tcpReachable,
  writeShellViaIpc,
} from './ssh-fixture-helpers'
import { parseTarget, readClientKey, wsl } from './real-sshd-fixture'

const DISTRO = (process.env.TDSF_REAL_SSHD_WSL ?? 'Ubuntu-24.04').trim()
const TARGET = parseTarget(process.env.TDSF_REAL_SSHD_HOST, process.env.TDSF_REAL_SSHD_PORT)
const HOST = TARGET?.host ?? ''
const PORT = TARGET?.port ?? 0
const USER = (process.env.TDSF_REAL_SSHD_USER ?? '').trim()
const READY = FIXTURE_READY && TARGET !== null && USER !== ''
const testOrSkip = READY ? test : test.skip

const MARKER = 'TDSF-SHELL-INTEGRATION-BEGIN'
const BACKUP = '/tmp/tdsf-e2e-si-bashrc.bak'

/** 在靶子上跑一条只含字面量的脚本（~ 与 $HOME 都由远端 shell 自己展开，不拼外部值） */
function sh(script: string): string {
  return wsl(DISTRO, ['bash', '-c', script]).replace(/\0/g, '')
}

let dir = ''
let privateKeyPath = ''
let knownHostsPath = ''
let targetUp = false
let targetWhy = ''
/** 跑之前的 rc 指纹，afterAll 用它兜底还原 */
let rcBytesBefore = ''
let rcShaBefore = ''

async function connectApp(
  page: import('@playwright/test').Page
): Promise<{ sessionId: string | null; error?: string }> {
  return page.evaluate((args) => {
    const w = window as unknown as { electronAPI: { sshConnect: (cfg: unknown) => Promise<string> } }
    return w.electronAPI
      .sshConnect({
        id: 'real-sshd',
        name: '真OpenSSH靶机',
        host: args.host,
        port: args.port,
        username: args.username,
        authType: 'privateKey',
        privateKeyPath: args.privateKeyPath,
        knownHostsPath: args.knownHostsPath,
      })
      .then((sessionId) => ({ sessionId }))
      .catch((e: Error) => ({ sessionId: null, error: e.message }))
  }, { host: HOST, port: PORT, username: USER, privateKeyPath, knownHostsPath })
}

if (!READY) {
  console.log(
    '[shell-integration] 跳过：需要 TDSF_REAL_SSHD_HOST / _PORT / _USER 且靶机可达' +
      '（起法见 tests/e2e/real-sshd-fixture.ts 文件头，config 里要带 Subsystem sftp）。'
  )
}

test.describe('远端 shell 集成 × 真 OpenSSH（#61）', () => {
  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-e2e-si-'))
    privateKeyPath = path.join(dir, 'id_ed25519')
    knownHostsPath = path.join(dir, 'known_hosts')
    fs.writeFileSync(knownHostsPath, '', 'utf8')
    try {
      fs.writeFileSync(privateKeyPath, readClientKey(DISTRO), { mode: 0o600 })
      if (!(await tcpReachable(HOST, PORT))) {
        targetWhy = `靶机 ${HOST}:${PORT} TCP 连不上（sshd 没起）`
        return
      }
      // 阳性对照：靶子在，且 rc 是干净的（上一轮崩了没还原就先还原，还原不了才 skip）
      rcBytesBefore = sh('wc -c < ~/.bashrc').trim()
      if (sh(`grep -c '${MARKER}' ~/.bashrc || true`).trim() !== '0') {
        sh(`cp -a ${BACKUP} ~/.bashrc 2>/dev/null || true; rm -f ~/.tdsf-shell-integration.sh`)
        rcBytesBefore = sh('wc -c < ~/.bashrc').trim()
      }
      if (sh(`grep -c '${MARKER}' ~/.bashrc || true`).trim() !== '0') {
        targetWhy = '靶子的 ~/.bashrc 里已有集成块残留且没有备份可还原，请先手工清理'
        return
      }
      rcShaBefore = sh('sha256sum ~/.bashrc').slice(0, 12)
      sh(`cp -a ~/.bashrc ${BACKUP}`)
      if (sh(`test -f ${BACKUP} && echo ok`).trim() !== 'ok') {
        targetWhy = `备份 ~/.bashrc 到 ${BACKUP} 失败，不敢往真机上写`
        return
      }
      targetUp = true
    } catch (e) {
      targetWhy = `真靶子前置没就绪：${(e as Error).message.split('\n')[0]}`
    }
  })

  test.afterAll(() => {
    // 无论测试走到哪一步（包括中途抛错），都把用户的 rc 还原回跑之前的字节
    if (targetUp) {
      sh(`cp -a ${BACKUP} ~/.bashrc; rm -f ~/.tdsf-shell-integration.sh; rm -f ${BACKUP}`)
      const after = sh('sha256sum ~/.bashrc').slice(0, 12)
      console.log(`[shell-integration] rc 还原：跑前=${rcShaBefore} 跑后=${after} 一致=${rcShaBefore === after}`)
    }
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  testOrSkip(
    '逐台确认装上 → 真机开始发 OSC 133/633 → 移除后 rc 回到原样',
    async () => {
      test.setTimeout(180_000)
      test.skip(targetUp === false, targetWhy || '靶子未就绪')

      const { app, page } = await launchApp()
      try {
        // 主机密钥按真实路径点掉：从旁边替它应答会让那个 fixed inset-0 的遮罩一直挂着，
        // 后面每一次点击都被它拦住（这条坑 terminal-multi-tab.spec.ts 里已经记过一遍）
        const connPromise = connectApp(page)
        await page.waitForSelector('[role="dialog"]', { timeout: 20000 })
        await page.getByRole('button', { name: '保存并继续' }).click()
        const conn = await connPromise
        const sid = conn.sessionId as string
        expect(conn.error ?? '', `连不上真机：${conn.error ?? ''}`).toBe('')
        expect(sid, '没拿到会话 ID').toBeTruthy()

        // ① 状态：真 SFTP + 真 exec 探测出来的，不是单测里那个假 RemoteFs
        const st = await page.evaluate((id) => {
          const w = window as unknown as {
            electronAPI: {
              sshShellIntegrationStatus: (s: string) => Promise<{
                kind: string
                installed: boolean
                snippetFile: string
                rcFile: string | null
                message: string
              }>
            }
          }
          return w.electronAPI.sshShellIntegrationStatus(id)
        }, sid)
        expect(['bash', 'zsh'], `靶子的登录 shell 不在支持范围内：${JSON.stringify(st)}`).toContain(st.kind)
        expect(st.installed, `跑前就该是未安装：${st.message}`).toBe(false)

        // ② 界面：提示条出现 → 打开确认弹窗 → 原文逐字可见 → 点写入
        await bindSessionToStore(page, 'real-sshd', sid)
        await page.evaluate(() => {
          window.location.hash = '#/workbench'
        })
        await page.waitForSelector('.wb-main-layout', { timeout: 20000 })
        await page
          .getByRole('button', { name: /在这台主机(再)?开一个终端/ })
          .click()
        await page.waitForSelector('.term-tab-item', { timeout: 20000 })

        await page.waitForSelector('[data-dom-id="si-bar"]', { timeout: 30000 })
        await page.click('[data-dom-id="si-enable"]')
        await page.waitForSelector('[role="dialog"]', { timeout: 20000 })
        const dialog = page.locator('[role="dialog"]')
        // 原文要等真机问完才出来（弹窗刚开时是"正在问…"），所以等它而不是等固定秒数
        await page.waitForSelector('[role="dialog"] pre.term-si-code', { timeout: 30000 })
        expect(
          await dialog.getByText('OSC 133').first().isVisible(),
          '确认弹窗没把要写的序列讲清楚'
        ).toBe(true)
        expect(
          await dialog.locator('pre.term-si-code').first().isVisible(),
          '确认弹窗没有逐字展示要追加进 rc 的那几行'
        ).toBe(true)
        await page.click('[data-dom-id="si-install"]')

        // ③ 磁盘上真的写进去了（用 OpenSSH 那一侧的读数，不信我们自己的读法）
        await expect
          .poll(() => Number(sh(`grep -c '${MARKER}' ~/.bashrc || true`).trim() || '0'), {
            message: `rc 里找不到标记块：${sh('tail -8 ~/.bashrc')}`,
            timeout: 20000,
          })
          .toBe(1)
        expect(
          sh('test -f ~/.tdsf-shell-integration.sh && echo ok').trim(),
          '集成脚本没落到家目录'
        ).toBe('ok')

        // 提示条该消失（装好了就没有可做的动作，不常驻占高度）
        await expect
          .poll(async () => await page.locator('[data-dom-id="si-bar"]').count(), {
            message: '装好后提示条还挂着',
            timeout: 20000,
          })
          .toBe(0)

        // ④ 新开一条终端：真 shell 得开始发序列（rc 只有登录 shell 读一次，所以必须新开）
        const readRaw = await installTerminalTap(page)
        const shellId = await openShellViaIpc(page, sid)
        const MARK = 'tdsf-si-alive'
        const wrote = await writeShellViaIpc(page, shellId, `echo ${MARK}\r`)
        expect(wrote, '写不进真机 shell，后面的判据都无从谈起').toBe(true)
        await expect
          .poll(
            async () => {
              const raw = await readRaw()
              return raw.includes('\x1b]133;B') && raw.includes(`633;E;echo ${MARK}`) ? 'yes' : 'no'
            },
            {
              message: `新终端没发 OSC 133/633，原始流尾部=${JSON.stringify((await readRaw()).slice(-400))}`,
              timeout: 30000,
            }
          )
          .toBe('yes')

        // ⑤ 从工具钮进同一个弹窗里移除，rc 回到跑前的字节
        await page.click('[data-dom-id="si-toolbar"]')
        await page.waitForSelector('[data-dom-id="si-uninstall"]', { timeout: 20000 })
        await page.click('[data-dom-id="si-uninstall"]')
        await expect
          .poll(() => sh('wc -c < ~/.bashrc').trim(), {
            message: `移除后 rc 字节数没回到 ${rcBytesBefore}，现在是 ${sh('wc -c < ~/.bashrc')}`,
            timeout: 20000,
          })
          .toBe(rcBytesBefore)
        expect(
          sh('sha256sum ~/.bashrc').slice(0, 12),
          '字节数对了但内容变了，还原没做对'
        ).toBe(rcShaBefore)
        expect(
          // 文件不在时 test 的退出码是 1，execFileSync 会把那当成命令失败抛出来
          sh('test -f ~/.tdsf-shell-integration.sh && echo still || true').trim(),
          '脚本没删掉'
        ).not.toBe('still')

        await page.evaluate((id) => {
          const w = window as unknown as { electronAPI: { sshDisconnect: (s: string) => Promise<boolean> } }
          return w.electronAPI.sshDisconnect(id)
        }, sid)
      } finally {
        await app.close()
      }
    }
  )

  testOrSkip('会话不存在时直接报错，绝不动靶子的 rc', async () => {
    test.skip(targetUp === false, targetWhy || '靶子未就绪')
    const { app, page } = await launchApp()
    try {
      const err = await page.evaluate(async () => {
        const w = window as unknown as {
          electronAPI: { sshShellIntegrationStatus: (s: string) => Promise<unknown> }
        }
        try {
          await w.electronAPI.sshShellIntegrationStatus('no-such-session')
          return ''
        } catch (e) {
          return (e as Error).message
        }
      })
      expect(err, '不存在的会话居然返回了状态').not.toBe('')
      expect(err).toMatch(/会话|不存在|未连接/)
      expect(
        sh(`grep -c '${MARKER}' ~/.bashrc || true`).trim(),
        '没确认过的操作不该已经把 rc 改了'
      ).toBe('0')
    } finally {
      await app.close()
    }
  })
})
