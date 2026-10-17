/**
 * 安装包里的程序真起一次（`build:win` 判据的落点）
 *
 * 为什么单独立一份：仓库所有 e2e 跑的都是 `out/` + 完整 node_modules，而交付物是
 * asar + 打包器自己收集出来的那份依赖树——两者不是一回事。2026-10-08 实测：
 * 四绿与 45 条 e2e 全绿的同时，装包里的 exe 一开就抛 `Cannot find module 'asn1'`
 * （electron-builder 24 读不懂 pnpm v9 锁文件，asar 里 58 个包全是直接依赖、零传递依赖）。
 * 这类缺陷只有"真把安装包里的程序起一次"才看得见，所以把它写成闸。
 *
 * 前置：`pnpm build:win`（产出 `release/win-unpacked/TDSF-Linux Desktop.exe`），
 * 且包不能比 `out/` 旧（旧包测不出当前代码，见下面 packageFreshness 的来历）。
 * 没打生产包 / 包比构建旧 → 整份 skip 并写明跑法；skip 不等于通过。
 * 档位一律指到系统临时目录，不碰 %APPDATA% 里真用户的配置。
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EXE = path.join(__dirname, '../../release/win-unpacked/TDSF-Linux Desktop.exe')
const ASAR = path.join(__dirname, '../../release/win-unpacked/resources/app.asar')
const BUILD_ENTRY = path.join(__dirname, '../../out/main/index.js')
const PACKAGED = fs.existsSync(EXE)

/**
 * 包必须不比 out/ 旧，否则这条测的不是当前代码。
 *
 * 为什么要有这一道：2026-10-17 把启动页改成"加载完自动进工作台"之后，这一条红在
 * 一个 2026-10-08 打的包上（屏上正文还是「进入工作台 · 就绪 · 点击进入工作台 · 100%」）——
 * 红得对，但红的是"包旧了"，不是"代码坏了"。不区分的话，下一个改界面的人会花时间去
 * 查一个根本不存在的回归；而直接把这条改成宽容等待更是会把"装包真的起不来"一起放过。
 * 所以：包旧 ⇒ 整份 skip 并打印两个时间与重打包命令。**skip 不等于通过。**
 */
function packageFreshness(): { fresh: boolean; detail: string } {
  if (!PACKAGED) return { fresh: false, detail: '没有装包' }
  const asarMs = fs.existsSync(ASAR) ? fs.statSync(ASAR).mtimeMs : 0
  const buildMs = fs.existsSync(BUILD_ENTRY) ? fs.statSync(BUILD_ENTRY).mtimeMs : 0
  const fmt = (ms: number): string => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '缺失')
  return {
    fresh: asarMs >= buildMs,
    detail: `app.asar=${fmt(asarMs)} / out/main/index.js=${fmt(buildMs)}`,
  }
}

const freshness = packageFreshness()
const testOrSkip = PACKAGED && freshness.fresh ? test : test.skip

if (!PACKAGED) {
  console.log(
    `[packed-app] 跳过：没有 ${path.relative(process.cwd(), EXE)} —— 先跑 pnpm build:win。` +
      '这条量的是"交付物本身能不能起"，out/ 上的 e2e 照不到它。'
  )
} else if (!freshness.fresh) {
  console.log(
    `[packed-app] 跳过：装包比当前构建旧（${freshness.detail}）—— 跑 pnpm build && pnpm build:win 重出包再看这条。` +
      'skip 不等于通过：当前代码的交付物还没被起过一次。'
  )
}

test.describe('生产包真启动', () => {
  // 装包冷启动比 out/ 慢（要解 asar、起 GPU 进程），默认 30s 会把"起得慢"误判成"起不来"
  test.describe.configure({ mode: 'serial' })

  let app: ElectronApplication
  let page: Page
  let profile = ''
  const pageErrors: string[] = []
  /** 主进程 stderr：装包起不来时（如缺模块）原因只在这里，不接住就得自己写探针复现 */
  const mainErr: string[] = []
  let procExit: string | null = null

  const dieWithContext = async (stage: string, cause: unknown): Promise<never> => {
    // 主进程弹错误框时窗口标题会变成 "Error"、页面正文就是那段堆栈——上一轮就是靠这两样
    // 十秒钟定位到 `Cannot find module 'asn1'` 的，别把它留给下一个接手的人去重写探针
    let win = ''
    if (page) {
      const title = await page.title().catch(() => '(取不到标题)')
      const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '(取不到正文)')
      win = `窗口标题=[${title}]，正文=「${String(text).replace(/\s+/g, ' ').slice(0, 200)}」`
    }
    throw new Error(
      `装包在「${stage}」这一步失败（主进程退出：${procExit ?? '未退出'}）。${win || '还没有窗口'} ` +
        `主进程 stderr：${mainErr.join(' / ') || '(空)'}。原始错误：${String(cause).slice(0, 160)}`
    )
  }

  test.beforeAll(async () => {
    profile = path.join(os.tmpdir(), `tdsf-packed-boot-${Date.now()}`)
    app = await electron.launch({ executablePath: EXE, args: [`--user-data-dir=${profile}`] })
    const proc = app.process()
    proc.stderr?.on('data', (b: Buffer) => {
      if (mainErr.length < 40) mainErr.push(b.toString().replace(/\0/g, '').trim())
    })
    proc.on('exit', (code, sig) => {
      procExit = `code=${code} sig=${sig}`
    })
    try {
      // firstWindow() 自己不带超时：主进程弹了错误框就永远等不到窗口。
      // 每一步的上限都压在钩子预算（30s）之内——钩子级 timeout 参数实测不生效，
      // 让 Playwright 先掐表就只能看到"hook timeout"，看不到主进程给的原因。
      // 本机实测装包开窗口约 2s，10s 已是 5 倍余量。
      const guard = new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new Error('10s 内没有开出窗口')), 10000)
        t.unref()
      })
      page = await Promise.race([app.firstWindow(), guard])
    } catch (e) {
      throw await dieWithContext('开出第一个窗口', e)
    }
    page.on('pageerror', (err) => pageErrors.push(String(err && err.message)))
    // 启动页只负责加载，加载完自动跳；所以"应用真的起来了"的唯一判据是工作台外壳出现。
    // 上限给 25s：打包版冷启动要解 asar、开 SQLite、建知识库索引，几秒的上限在慢盘上会假红。
    try {
      await page.waitForSelector('.wb-main-layout', { timeout: 25000 })
    } catch (e) {
      throw await dieWithContext('自动进入工作台外壳', e)
    }
    // 钩子级的 timeout 参数实测不生效（上面注释记的就是这件事），本份的类型检查也不认
    // 这个两参写法（它匹配到 (title, body) 那条重载）。真正兜时间的是上面每步自己的
    // 10s/8s/6s 上限，所以把这个死参数去掉不改变行为。
  })

  test.afterAll(async () => {
    // 不用 app.close()：装包进程收尾时会留下子进程让 close 挂住，按 PID 收更可靠
    try {
      app?.process().kill('SIGKILL')
    } catch {
      /* 已经退了 */
    }
    if (profile) {
      try {
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 1000 })
      } catch {
        /* 临时目录被占用：留给系统清，不该把闸弄红 */
      }
    }
  })

  testOrSkip('起的是打包产物而不是 out/，且外壳与状态栏都渲染出来了', async () => {
    const href = page.url()
    expect(href, '装包应当从 asar 里加载渲染层').toContain('app.asar')
    expect(href.startsWith('file:'), '装包不该连着 dev server').toBe(true)
    await expect(page.locator('.wb-main-layout')).toBeVisible()
    await expect(page.locator('.wb-statusbar')).toBeVisible()
    expect(pageErrors, `渲染层报错：${pageErrors.slice(0, 2).join(' | ')}`).toHaveLength(0)
  })

  testOrSkip('preload 桥与一次真 IPC 往返在 asar 下活着', async () => {
    const probe = await page.evaluate(async () => {
      const api = (window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI
      if (!api) return { hasApi: false as const }
      // 不带 onlyEnabled：预置模板默认未必是"启用"态，按启用过滤会把这条断言变成随机红
      const list = (await (api.providerList as (only?: boolean) => Promise<unknown[]>)()) as unknown[]
      return { hasApi: true as const, keys: Object.keys(api).length, providers: Array.isArray(list) ? list.length : -1 }
    })
    expect(probe.hasApi, 'window.electronAPI 是 undefined：preload 在沙箱里没跑起来').toBe(true)
    if (!('keys' in probe)) throw new Error('类型兜底：hasApi 为真时有 keys')
    // 264 = 当前桥的方法数；下限给宽（新增通道只会涨），掉到 200 以下说明某个域整个没挂上
    expect(probe.keys, `桥只剩 ${probe.keys} 个键`).toBeGreaterThanOrEqual(200)
    // 主进程启动时种子了 13 个预置 Provider；返回空数组说明 IPC 或数据库在装包里断了
    expect(probe.providers, 'providerList 没拿到预置模板').toBeGreaterThanOrEqual(1)
  })
})
