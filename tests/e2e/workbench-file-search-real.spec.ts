/**
 * workbench-file-search-real.spec.ts —— 远程搜索整条链的真机版（#213 的另一半）
 *
 * 仓库里的假 SSH 夹具（`ssh-fixture-server.ts`）只演 exec，不演 SFTP 子系统，
 * 所以 `workbench-file-search.spec.ts` 那条只能证到"请求带着行号进了编辑器"，
 * 证不到**屏幕上真的滚到第 137 行**（正文根本读不回来）。这一条补的就是那半边：
 * 对端是 WSL 里真 OpenSSH（真 find、真 grep、真 SFTP），
 * 并且每个断言都拿同一条命令的**直连基线**当参照——界面里的数不是本地编的。
 *
 * 前置（起靶子与约定见 `tests/e2e/real-sshd-fixture.ts` 文件头，零安装、不动账号）：
 *   $env:TDSF_REAL_SSHD_HOST="172.20.49.165"; $env:TDSF_REAL_SSHD_PORT="2224"
 *   $env:TDSF_REAL_SSHD_USER="harryopo"
 *   npx playwright test tests/e2e/workbench-file-search-real.spec.ts
 * 没给环境变量、靶机连不上、或直连基线跑不出来 → 整份 skip 并写明原因。
 * skip 不等于通过。
 *
 * 靶子上需要的文件（这一条自己造，跑完自己清）：
 *   /tmp/e2e-search/probe.conf —— 200 行，第 137 行含 TDSF-SEARCH-PROBE-137
 *   /tmp/e2e-search/tdsf-probe-name.txt —— 给"按文件名"那条模式用
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from 'ssh2'
import {
  bindSessionToStore,
  launchApp,
  tcpReachable,
} from './ssh-fixture-helpers'
import { DEFAULT_DISTRO, parseTarget, readClientKey } from './real-sshd-fixture'

const DISTRO = (process.env.TDSF_REAL_SSHD_WSL ?? DEFAULT_DISTRO).trim()
const TARGET = parseTarget(process.env.TDSF_REAL_SSHD_HOST, process.env.TDSF_REAL_SSHD_PORT)
const HOST = TARGET?.host ?? ''
const PORT = TARGET?.port ?? 0
const USER = (process.env.TDSF_REAL_SSHD_USER ?? '').trim()

const MARKER = 'TDSF-SEARCH-PROBE-137'
const PROBE_DIR = '/tmp/e2e-search'
const PROBE_FILE = `${PROBE_DIR}/probe.conf`
const NAMED_FILE = `${PROBE_DIR}/tdsf-probe-name.txt`
const SERVER_ID = 'real-sshd-search'

/** 探针夹具由这条自己造：200 行的文件（第 137 行埋标记）+ 一个按名字可找到的文件 */
const PROBE_SETUP =
  `mkdir -p ${PROBE_DIR} && ` +
  `seq 1 200 | awk '{if(NR==137) print "    server_name ${MARKER}"; else print "    line-" NR " = filler"}' > ${PROBE_FILE} && ` +
  `printf 'for name-mode lookup\\n' > ${NAMED_FILE}`

/** 直连基线：同一条命令在真机上到底回什么，用来证明界面里的结果不是本地生成的 */
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
  knownHostsPath: string
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
    { id: SERVER_ID, host: HOST, port: PORT, username: USER, privateKeyPath, knownHostsPath }
  )
}

let dir = ''
let privateKeyPath = ''
let targetUp = false
let targetWhy = ''

test.beforeAll(async () => {
  if (TARGET === null || USER === '') {
    targetWhy = '没给 TDSF_REAL_SSHD_HOST / _PORT / _USER'
    return
  }
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-real-search-'))
  privateKeyPath = path.join(dir, 'id_ed25519')
  try {
    fs.writeFileSync(privateKeyPath, readClientKey(DISTRO), { mode: 0o600 })
    if (!(await tcpReachable(HOST, PORT))) {
      targetWhy = `靶机 ${HOST}:${PORT} TCP 连不上（sshd 没起）`
      return
    }
    // 阳性对照 + 自备夹具：直连要能成，探针文件由这条自己造（跑完自己清）
    await groundTruth(privateKeyPath, PROBE_SETUP)
    const truth = await groundTruth(privateKeyPath, `grep -rn -i -F '${MARKER}' ${PROBE_DIR}`)
    if (!truth.includes(`${PROBE_FILE}:137:`)) {
      targetWhy = `靶子上没有预期的探针文件或行号不对：${JSON.stringify(truth.slice(0, 120))}`
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

test('真机整条链：内容命中带着真行号跳到真那一行，按文件名也真开得开', async () => {
  test.skip(!targetUp, targetWhy)
  test.setTimeout(240_000)

  const knownHostsPath = path.join(dir, 'known_hosts')
  const { app, page } = await launchApp()
  try {
    // 资源管理器只认"服务器列表里那台"：会话要先有配置身份，activeServer 才非空，
    // 搜索开关与根目录输入框才会出现（真实路径里这台机器本来就是先存列表再连的）
    await page.evaluate(
      (cfg) => {
        const stores = (window as unknown as {
          __tdsfStores?: { server: { getState: () => { addServer: (c: unknown) => Promise<boolean> } } }
        }).__tdsfStores
        if (!stores) throw new Error('__tdsfStores 未挂载')
        return stores.server.getState().addServer(cfg)
      },
      {
        id: SERVER_ID,
        name: '真OpenSSH靶机',
        host: HOST,
        port: PORT,
        username: USER,
        authType: 'privateKey',
      }
    )

    // 首连真机一定问主机密钥：走真实用户路径点「保存并继续」。
    // 只用 IPC 应答不行——那样弹窗那层遮罩还开着，后面的每一次点击都会被它拦下。
    const connPromise = connectApp(page, privateKeyPath, knownHostsPath)
    await page.waitForSelector('[role="dialog"]', { timeout: 20_000 })
    await page.getByRole('button', { name: '保存并继续' }).click()
    const first = await connPromise
    expect(first.error ?? '', `连真机失败：${first.error ?? ''}`).toBe('')
    expect(first.sessionId, '没拿到会话 ID').toBeTruthy()
    await bindSessionToStore(page, SERVER_ID, first.sessionId!)

    await page.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await expect(page.locator('.wb-filetree'), '工作台里没有出现资源管理器').toBeVisible({
      timeout: 20_000,
    })

    // 把搜索范围收到靶子上那个只有两个文件的目录：整盘 find 一定撞 3 秒超时，测不出接线。
    // 用真键盘事件而不是 fill：这是受控输入，事件没打到 onChange 时 React 会把值改回 state
    const rootInput = page.locator('.wb-filetree-root-input')
    await rootInput.click()
    await rootInput.press('Control+a')
    await rootInput.pressSequentially(PROBE_DIR, { delay: 20 })
    await rootInput.press('Enter')
    await expect(rootInput, '根目录没改成功，搜索范围还是 /').toHaveValue(PROBE_DIR)

    const toggle = page.getByRole('button', { name: '搜索远程文件' })
    await expect(toggle).toBeEnabled({ timeout: 20_000 })
    await toggle.click()
    const panel = page.locator('section[aria-label="远程文件搜索"]')
    await expect(panel).toBeVisible()

    // —— 按内容搜：行号必须与直连基线逐字一致
    await panel.getByRole('radio', { name: '内容' }).click()
    // 量具自证：搜索范围真的落在靶子那个目录上，不是整盘
    await expect(panel.getByText(`在 ${PROBE_DIR} 下面找文件内容`)).toBeVisible()
    await panel.getByRole('textbox', { name: '搜索远程文件' }).fill(MARKER)
    await panel.getByRole('button', { name: '搜索' }).click()
    const row = panel.getByRole('button', { name: /第 137 行/ })
    await expect(row, '真机上第 137 行的命中没上屏').toBeVisible({ timeout: 30_000 })

    // 基线：同一条 grep 在真机上回的那一行，界面里的行号与正文都要对得上
    const truth = await groundTruth(privateKeyPath, `grep -rn -i -F '${MARKER}' ${PROBE_DIR}`)
    expect(truth, '直连基线自己也跑不出那一行，量具失效').toContain(`${PROBE_FILE}:137:`)
    const rowText = await row.innerText()
    expect(rowText, `界面那一行与真机不一致：界面="${rowText}" 真机="${truth.trim()}"`).toContain(MARKER)

    // —— 点它：正文由真 SFTP 读回来，编辑器必须真的滚到第 137 行
    await row.click()
    await expect(page.locator('[data-tab-id="file:/tmp/e2e-search/probe.conf"]')).toBeVisible({
      timeout: 20_000,
    })
    const editor = page.locator('.term-file-editor')
    await expect(editor, '正文没读回来（出现错误面或空白面）').toBeVisible({ timeout: 60_000 })
    await expect(page.locator('.term-file-error'), '真机能读到的文件被报成读不到').toHaveCount(0)

    // Monaco 只渲染视口里的行：这条断言成立，当且仅当它真的滚过去了
    const viewport = page.locator('.monaco-editor .view-lines')
    await expect(
      viewport,
      '没滚到第 137 行（视口里看不到那一行就是没跳）'
    ).toContainText(MARKER, { timeout: 30_000 })
    // 状态栏那个 Ln 读数必须跟着变成 137（它读的是编辑器光标，不是搜索结果里的数字）
    await expect(page.getByTitle('光标位置（编辑器集成后自动更新）')).toContainText('Ln 137', {
      timeout: 20_000,
    })
    // 整行高亮这条装饰也必须在
    await expect(page.locator('.monaco-editor .wb-file-hit-line').first()).toBeVisible()

    // —— 按文件名搜：真 find 找到的那个文件点得开
    await panel.getByRole('radio', { name: '文件名' }).click()
    await panel.getByRole('textbox', { name: '搜索远程文件' }).fill('tdsf-probe-name')
    await panel.getByRole('button', { name: '搜索' }).click()
    const nameRow = panel.getByRole('button', { name: /tdsf-probe-name\.txt/ })
    await expect(nameRow, '真机 find 的结果没上屏').toBeVisible({ timeout: 30_000 })
    const nameTruth = await groundTruth(privateKeyPath, `find ${PROBE_DIR} -type f -name '*tdsf-probe-name*'`)
    expect(nameTruth.trim(), '直连基线与界面结果不是同一个路径').toBe(NAMED_FILE)
    await nameRow.click()
    await expect(page.locator(`[data-tab-id="file:${NAMED_FILE}"]`), '按文件名的结果点不开').toBeVisible({
      timeout: 20_000,
    })
    await expect(page.locator('.term-file-error')).toHaveCount(0)
  } finally {
    await app.close()
    // 靶子上那两个文件是这条自己造的，跑完顺手清掉（路径是常量，不动 /tmp 下的别的东西）
    if (targetUp) {
      try {
        await groundTruth(privateKeyPath, `rm -rf ${PROBE_DIR}`)
      } catch {
        /* 清不掉不算失败：文件在 /tmp 下，靶子重启即没 */
      }
    }
  }
})

/**
 * 编辑器 Ctrl+S 真的把改动写回真机（#233）
 *
 * 为什么要单开一条：界面里那个保存快捷键，此前只有代码层的处理器（`EditorArea` 里 window 的 keydown），
 * 没有任何真窗口取证；假 SSH 夹具又没有 SFTP 子系统，所以只能用真靶机证。
 * 这条走的全是真实用户路径：资源管理器 → 按文件名搜 → 点结果开文件 → 在编辑器里敲字 →
 * **按 Ctrl+S** → 读靶子上那个文件的实际内容。判据只认"文件真的变了"，
 * 顺带钉住标签上的「未保存」圆点：敲完字必须有、按完保存必须没。
 */
test('Ctrl+S 把编辑器里的改动写回真机（真 SFTP，不是本地假象）', async () => {
  test.skip(!targetUp, targetWhy)
  test.setTimeout(240_000)

  const knownHostsPath = path.join(dir, 'known_hosts-save')
  const MARK = `TDSF-CTRLS-${Date.now()}`
  // 夹具自己造：上面那条用例跑完会把 PROBE_DIR 清掉（它造的它清），这条不能依赖它留东西；
  // 建完立刻拿直连读回来当阳性对照——文件不在就得先报环境错，不许把"没文件"演成产品红。
  await groundTruth(privateKeyPath, PROBE_SETUP)
  const seed = await groundTruth(privateKeyPath, `cat ${NAMED_FILE}`)
  expect(seed, `靶子上没造出待编辑文件：${JSON.stringify(seed)}`).toContain('for name-mode lookup')
  const { app, page } = await launchApp()

  try {
    await page.evaluate(
      (cfg) => {
        const stores = (window as unknown as {
          __tdsfStores?: { server: { getState: () => { addServer: (c: unknown) => Promise<boolean> } } }
        }).__tdsfStores
        if (!stores) throw new Error('__tdsfStores 未挂载')
        return stores.server.getState().addServer(cfg)
      },
      { id: `${SERVER_ID}-save`, name: '真OpenSSH靶机', host: HOST, port: PORT, username: USER, authType: 'privateKey' }
    )

    const connPromise = connectApp(page, privateKeyPath, knownHostsPath)
    await page.waitForSelector('[role="dialog"]', { timeout: 20_000 })
    await page.getByRole('button', { name: '保存并继续' }).click()
    const conn = await connPromise
    expect(conn.error ?? '', `连真机失败：${conn.error ?? ''}`).toBe('')
    expect(conn.sessionId).toBeTruthy()
    await bindSessionToStore(page, `${SERVER_ID}-save`, conn.sessionId!)

    await page.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await expect(page.locator('.wb-filetree')).toBeVisible({ timeout: 20_000 })

    // 搜索范围收到靶子那个目录（整盘 find 会撞超时），再按文件名把目标文件打开
    const rootInput = page.locator('.wb-filetree-root-input')
    await rootInput.click()
    await rootInput.press('Control+a')
    await rootInput.pressSequentially(PROBE_DIR, { delay: 20 })
    await rootInput.press('Enter')
    await expect(rootInput).toHaveValue(PROBE_DIR)

    await page.getByRole('button', { name: '搜索远程文件' }).click()
    const panel = page.locator('section[aria-label="远程文件搜索"]')
    await panel.getByRole('radio', { name: '文件名' }).click()
    await panel.getByRole('textbox', { name: '搜索远程文件' }).fill('tdsf-probe-name')
    await panel.getByRole('button', { name: '搜索' }).click()
    const nameRow = panel.getByRole('button', { name: /tdsf-probe-name\.txt/ })
    await expect(nameRow, '真机 find 的结果没上屏').toBeVisible({ timeout: 30_000 })
    await nameRow.click()

    const tab = page.locator(`[data-tab-id="file:${NAMED_FILE}"]`)
    await expect(tab, '结果点开之后没有文件标签').toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.term-file-error'), '真机能读到的文件被报成读不到').toHaveCount(0)
    // 打开态：还没改动，标签上不该有「未保存」圆点
    expect(await tab.innerText(), '刚打开就显示未保存，脏标记起点就不对').not.toContain('•')

    // 在编辑器里敲一行（末尾追加），标签必须变成「未保存」
    await page.locator('.monaco-editor .view-lines').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type(`# ${MARK}`)
    await expect(tab, '敲了字但标签没标未保存，脏标记链路断了').toContainText('•', { timeout: 10_000 })

    // 按下去：window 上的 Ctrl+S → sftpWriteFile 写回真机
    await page.keyboard.press('Control+s')
    await expect(tab, 'Ctrl+S 之后「未保存」还在：保存没发生或没报成' ).not.toContainText('•', {
      timeout: 20_000,
    })

    // 只认靶子上的真内容：文件里必须有刚敲进去的那串标记
    const after = await groundTruth(privateKeyPath, `cat ${NAMED_FILE}`)
    expect(after, `靶子上没有 Ctrl+S 写进去的标记。实际内容=${JSON.stringify(after)}`).toContain(MARK)

    // #235：只读态下 Ctrl+S 必须被挡下——不许把只读视图里的内容写回远端
    const MARK_RO = `${MARK}-RO`
    await page.keyboard.press('Control+End')
    await page.keyboard.type(`# ${MARK_RO}`)
    await expect(tab, '只读用例前，新改动没标未保存').toContainText('•', { timeout: 10_000 })
    await page.locator('.term-readonly-btn').click()
    await expect(page.locator('.term-readonly-btn'), '「只读」没切过去').toHaveText(/只读/, {
      timeout: 10_000,
    })
    await page.keyboard.press('Control+s')
    await expect(page.getByText('这是只读视图，先关掉只读再保存'), '只读下 Ctrl+S 没被挡下').toBeVisible({
      timeout: 10_000,
    })
    const blocked = await groundTruth(privateKeyPath, `cat ${NAMED_FILE}`)
    expect(blocked, `只读态下 Ctrl+S 仍然写回了远端。实际内容=${JSON.stringify(blocked)}`).not.toContain(
      MARK_RO,
    )
    await expect(tab, '保存被挡下后「未保存」标记被清掉了，改动会静默丢').toContainText('•')

    // 解除只读后再保存：同一条路径必须真的能写回去（证明挡下的是只读，不是保存坏了）
    await page.locator('.term-readonly-btn').click()
    await page.keyboard.press('Control+s')
    await expect(tab, '解除只读后保存没生效').not.toContainText('•', { timeout: 20_000 })
    const afterRo = await groundTruth(privateKeyPath, `cat ${NAMED_FILE}`)
    expect(afterRo, '解除只读后 Ctrl+S 没写回真机').toContain(MARK_RO)
  } finally {
    await app.close()
  }
})
