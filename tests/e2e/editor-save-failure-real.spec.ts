/**
 * editor-save-failure-real.spec.ts —— 保存失败时，正文必须还在屏上、还改得动（#279）
 *
 * 病灶：`applySaveFailure` 以前把失败原因写进 `tab.error`，而 `error` 是"这个文件根本没读出来"
 * 那条通道——EditorArea 一见它就整块换成错误面板。于是远端不让写（只读文件、盘满、权限）时，
 * 用户那份**没存进去的正文从屏上消失、也没法再改**，唯一出路是关掉重开，
 * 而重开读的是服务器那份 ⇒ 改动被静默丢掉。#235 保住了脏标记，没保住"正文还看得见"。
 *
 * 这一条量的是那另一半：
 *   1. 只读文件保存失败 ⇒ 屏上有"保存失败"横幅，但**编辑器没被换掉**、
 *      刚敲的标记还在视口里、标签仍是"未保存"，而真机上那个文件**一字未变**（直连读回来当参照）；
 *   2. 正向对照：解除只读后再按一次 Ctrl+S ⇒ 横幅消失、脏点消失、真机里读得到那行标记。
 *   只有 2 也过，才说明"失败"不是把界面卡死在错误态。
 *
 * 前置（起法与约定见 `real-sshd-fixture.ts` 文件头，零安装、不动账号）：
 *   $env:TDSF_REAL_SSHD_HOST="172.20.x.x"; $env:TDSF_REAL_SSHD_PORT="2224"; $env:TDSF_REAL_SSHD_USER="…"
 *   npx playwright test tests/e2e/editor-save-failure-real.spec.ts
 * 没给变量、靶机连不上、或只读没真生效 → 整条 skip 并写明原因。**skip 不等于通过。**
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from 'ssh2'
import { bindSessionToStore, launchApp, tcpReachable } from './ssh-fixture-helpers'
import { DEFAULT_DISTRO, parseTarget, readClientKey } from './real-sshd-fixture'

const DISTRO = (process.env.TDSF_REAL_SSHD_WSL ?? DEFAULT_DISTRO).trim()
const TARGET = parseTarget(process.env.TDSF_REAL_SSHD_HOST, process.env.TDSF_REAL_SSHD_PORT)
const HOST = TARGET?.host ?? ''
const PORT = TARGET?.port ?? 0
const USER = (process.env.TDSF_REAL_SSHD_USER ?? '').trim()

const SAVE_DIR = '/tmp/e2e-save'
const SAVE_FILE = `${SAVE_DIR}/locked.conf`
const SERVER_ID = 'real-sshd-save-fail'

/** 夹具自己造：一个两行的普通文件，然后 chmod 444 让它"读得到、写不进" */
const SETUP =
  `mkdir -p ${SAVE_DIR} && printf 'line-1 original\\nline-2 original\\n' > ${SAVE_FILE} && chmod 444 ${SAVE_FILE}`
/** 解除只读（正向对照那一步用） */
const UNLOCK = `chmod 644 ${SAVE_FILE}`
/** 只读到底生效没有——不生效就是环境问题，不许演成产品红 */
const MODE_CMD = `stat -c %a ${SAVE_FILE}`

/** 直连基线：同一条命令在真机上到底回什么，用来证明界面里的结论不是本地编的 */
function groundTruth(privateKeyPath: string, cmd: string): Promise<string> {
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
          stream.on('data', (d: Buffer) => (out += d.toString()))
          stream.stderr.on('data', (d: Buffer) => (out += d.toString()))
          stream.on('close', () => {
            conn.end()
            resolve(out)
          })
        })
      })
      .connect({ host: HOST, port: PORT, username: USER, privateKey: fs.readFileSync(privateKeyPath) })
  })
}

/** 走真 IPC 连上去（privateKey 认证，known_hosts 指到本次运行的临时文件） */
async function connectApp(
  page: import('@playwright/test').Page,
  privateKeyPath: string,
  knownHostsPath: string,
): Promise<{ sessionId: string | null; error?: string }> {
  return page.evaluate(
    async (args) => {
      const w = window as unknown as { electronAPI: { sshConnect: (cfg: unknown) => Promise<string> } }
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
    { id: SERVER_ID, host: HOST, port: PORT, username: USER, privateKeyPath, knownHostsPath },
  )
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-save-fail-'))
let privateKeyPath = ''
let targetUp = false
let targetWhy = ''

test.beforeAll(async () => {
  if (!TARGET || !USER) {
    targetWhy = '没给 TDSF_REAL_SSHD_HOST / _PORT / _USER'
    return
  }
  privateKeyPath = path.join(dir, 'id_ed25519')
  fs.writeFileSync(privateKeyPath, readClientKey(DISTRO), { mode: 0o600 })
  if (!(await tcpReachable(HOST, PORT))) {
    targetWhy = `靶机 ${HOST}:${PORT} TCP 连不上（sshd 没起）`
    return
  }
  await groundTruth(privateKeyPath, SETUP)
  const mode = (await groundTruth(privateKeyPath, MODE_CMD)).trim()
  // 444 之外一律当环境问题：以 root 跑靶机时 chmod 挡不住写，那条判据就测不出要测的事
  if (!mode.endsWith('4')) {
    targetWhy = `靶子上文件模式是 ${mode}，只读没生效（靶子以 root 跑就写不进去这一条测不到）`
    return
  }
  targetUp = true
})

test.afterAll(async () => {
  if (privateKeyPath) {
    try {
      await groundTruth(privateKeyPath, `rm -rf ${SAVE_DIR}`)
    } catch {
      // 清理失败不影响结论
    }
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

/** 连上靶机 → 进工作台 → 按文件名把那个只读文件点开 */
async function openLockedFile(page: import('@playwright/test').Page, marker: string): Promise<void> {
  const knownHostsPath = path.join(dir, `known_hosts-${marker}`)
  await page.evaluate(
    (cfg) => {
      const stores = (window as unknown as {
        __tdsfStores?: { server: { getState: () => { addServer: (c: unknown) => Promise<boolean> } } }
      }).__tdsfStores
      if (!stores) throw new Error('__tdsfStores 未挂载')
      return stores.server.getState().addServer(cfg)
    },
    { id: SERVER_ID, name: '真OpenSSH靶机', host: HOST, port: PORT, username: USER, authType: 'privateKey' },
  )
  const connPromise = connectApp(page, privateKeyPath, knownHostsPath)
  await page.waitForSelector('[role="dialog"]', { timeout: 20_000 })
  await page.getByRole('button', { name: '保存并继续' }).click()
  const conn = await connPromise
  expect(conn.error ?? '', `连真机失败：${conn.error ?? ''}`).toBe('')
  await bindSessionToStore(page, SERVER_ID, conn.sessionId!)

  await page.evaluate(() => {
    window.location.hash = '#/workbench'
  })
  await expect(page.locator('.wb-filetree')).toBeVisible({ timeout: 20_000 })

  const rootInput = page.locator('.wb-filetree-root-input')
  await rootInput.click()
  await rootInput.press('Control+a')
  await rootInput.pressSequentially(SAVE_DIR, { delay: 20 })
  await rootInput.press('Enter')
  await expect(rootInput).toHaveValue(SAVE_DIR)

  await page.getByRole('button', { name: '搜索远程文件' }).click()
  const panel = page.locator('section[aria-label="远程文件搜索"]')
  await panel.getByRole('radio', { name: '文件名' }).click()
  await panel.getByRole('textbox', { name: '搜索远程文件' }).fill('locked')
  await panel.getByRole('button', { name: '搜索' }).click()
  const row = panel.getByRole('button', { name: /locked\.conf/ })
  await expect(row, '真机 find 没把这个文件找出来').toBeVisible({ timeout: 30_000 })
  await row.click()
  await expect(page.locator(`[data-tab-id="file:${SAVE_FILE}"]`)).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.term-file-error'), '真机能读到的文件被报成读不到').toHaveCount(0)
}

test('只读文件写不进去：说清没存进去，但正文不许从屏上消失', async () => {
  test.skip(!targetUp, targetWhy)
  test.setTimeout(240_000)
  const MARK = `TDSF-SAVEFAIL-${Date.now()}`
  const { app, page } = await launchApp()
  try {
    await openLockedFile(page, 'fail')

    const tab = page.locator(`[data-tab-id="file:${SAVE_FILE}"]`)
    await page.locator('.monaco-editor .view-lines').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type(`# ${MARK}`)
    await expect(tab, '敲了字但标签没标未保存').toContainText('•', { timeout: 10_000 })

    await page.keyboard.press('Control+s')

    // ① 有横幅，且带真机给的原因
    const banner = page.locator('.term-file-save-error')
    await expect(banner, '保存失败没在界面上说').toBeVisible({ timeout: 30_000 })
    await expect(banner).toContainText('保存失败')

    // ② 关键的一条：**编辑器还在**，正文没被错误面板换掉
    await expect(page.locator('.term-file-error'), '保存失败把编辑器整块换成了错误面板').toHaveCount(0)
    await expect(page.locator('.monaco-editor')).toBeVisible()
    await expect(page.locator('.monaco-editor').first(), '没存进去的正文从屏上消失了').toContainText(MARK)
    // ③ 脏标记还在（关标签仍会提示、全部保存仍会带上这条）
    await expect(tab).toContainText('•')
    // ④ 真机上那个文件一字未变（不是"其实写进去了只是界面报错"）
    const onServer = await groundTruth(privateKeyPath, `cat ${SAVE_FILE}`)
    expect(onServer, '界面报失败但真机被改了，那才是真事故').not.toContain(MARK)
  } finally {
    await app.close()
  }
})

test('正向对照：解除只读后再按一次保存，真机里读得到那行标记', async () => {
  test.skip(!targetUp, targetWhy)
  test.setTimeout(240_000)
  const MARK = `TDSF-SAVEOK-${Date.now()}`
  const { app, page } = await launchApp()
  try {
    await openLockedFile(page, 'ok')

    const tab = page.locator(`[data-tab-id="file:${SAVE_FILE}"]`)
    await page.locator('.monaco-editor .view-lines').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type(`# ${MARK}`)
    await page.keyboard.press('Control+s')
    await expect(page.locator('.term-file-save-error')).toBeVisible({ timeout: 30_000 })

    // 解除只读，再按一次——失败态必须能走出来，而不是把界面焊死在错误横幅上
    await groundTruth(privateKeyPath, UNLOCK)
    await page.keyboard.press('Control+s')

    await expect(page.locator('.term-file-save-error'), '存好了横幅还挂着').toHaveCount(0, { timeout: 30_000 })
    await expect(tab, '存好了标签还标着未保存').not.toContainText('•', { timeout: 10_000 })
    const onServer = await groundTruth(privateKeyPath, `cat ${SAVE_FILE}`)
    expect(onServer, '第二次保存没真写进真机').toContain(MARK)
  } finally {
    await app.close()
  }
})
