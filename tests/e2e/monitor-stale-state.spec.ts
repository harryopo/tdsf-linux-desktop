/**
 * monitor-stale-state.spec.ts —— 监控数据停了，界面必须承认停了（#257）
 *
 * 改前：远端断链后采集定时器还在空转（`tick` 的失败全被吞掉），渲染层唯一能知道的
 * 信号 `ssh:state-changed` 监控页又不读。于是页面把最后一帧当现在：
 *   横幅写「系统运行正常，暂无 critical 告警」，KPI 是十分钟前的数，没有任何时间戳。
 *
 * 这条在真窗口里验三种状态：
 *   1. 连接状态 error + 十分钟前的采样 → 说「连接已断开 · 监控已停止更新」
 *   2. 连接状态 connected 但十分钟没有新采样 → 说「没有收到新采样」
 *   3. 连接状态 connected + 刚刚的采样 → 才允许说「系统运行正常」（反向对照，
 *      防止它变成"永远报警"）
 *
 * 状态用真实的 store 写（`__tdsfStores`），页面读的是同一条链路；
 * 不断言"函数被调用"，只断言屏上显示了什么。
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, type ElectronApplication } from '@playwright/test'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')
const BUILD_READY = fs.existsSync(MAIN_ENTRY)
if (!BUILD_READY) console.log('[monitor-stale] 跳过：缺 out/main/index.js，先 pnpm build')
const testOrSkip = BUILD_READY ? test : test.skip

type ConnState = 'disconnected' | 'connecting' | 'connected' | 'error'

/** 往真实 store 里写一台"已连上/已断开"的机器，以及它的采样 */
async function seedMonitor(
  page: Page,
  opts: { connectionState: ConnState; sampleAgeMs: number | null }
): Promise<void> {
  await page.evaluate(({ connectionState, sampleAgeMs }) => {
    const w = window as unknown as {
      __tdsfStores?: {
        server: { setState: (s: unknown) => void }
        monitor: { setState: (s: unknown) => void }
      }
    }
    const stores = w.__tdsfStores
    if (!stores) throw new Error('__tdsfStores 未暴露：判据没法把"断线"写进去')

    const now = Date.now()
    const server = {
      id: 'e2e-mon',
      name: 'e2e-mon',
      host: '10.9.9.9',
      port: 22,
      username: 'tester',
      authType: 'password',
      hasCredential: true,
    }
    const info = {
      hostname: 'e2e-host',
      os: 'Linux',
      kernel: '6.0.0',
      architecture: 'x64',
      cpuModel: 'e2e-cpu',
      cpuCores: 2,
      totalMemory: 1024,
      totalDisk: 1024,
    }
    const sample = (timestamp: number) => ({
      timestamp,
      cpuUsage: 5,
      memoryUsage: 40,
      diskUsage: 55,
      networkIn: 12,
      networkOut: 8,
      loadAverage: 0.2,
      uptime: 3600,
      processCount: 120,
    })
    // 两条采样：同分钟只留最后一条的规则在 store 层，这里给跨分钟的两条
    const samples =
      sampleAgeMs == null
        ? []
        : [sample(now - sampleAgeMs - 60_000), sample(now - sampleAgeMs)]

    stores.server.setState({
      servers: [server],
      activeSessionId: 'sess-mon',
      sessionMap: { 'e2e-mon': 'sess-mon' },
      connectionStates: { 'e2e-mon': connectionState },
    })
    stores.monitor.setState({
      monitorData: new Map([['sess-mon', samples]]),
      systemInfo: new Map([['sess-mon', info]]),
    })
  }, opts)
}

/** 读屏上的横幅与页头副标题 */
async function readBanner(page: Page): Promise<{ banner: string; subtitle: string }> {
  return page.evaluate(() => {
    const alert = document.querySelector('.mon-alert')
    const sub = document.querySelector('header p')
    return {
      banner: (alert?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      subtitle: (sub?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    }
  })
}

test.describe('监控数据停更/断线时的界面口径', () => {
  let app: ElectronApplication
  let page: Page
  let profile: string

  test.beforeAll(async () => {
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-e2e-monitor-'))
    app = await electron.launch({
      args: [MAIN_ENTRY, `--user-data-dir=${profile}`],
      env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
    })
    page = await app.firstWindow()
    await page.waitForSelector('body', { timeout: 30_000 })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForSelector('.wb-main-layout', { timeout: 30_000 })
    await page.evaluate(() => (window.location.hash = '#/monitor'))
    await page.waitForSelector('[data-dom-id="page-title"]', { timeout: 20_000 })
  })

  test.afterAll(async () => {
    await app?.close()
    if (profile) fs.rmSync(profile, { recursive: true, force: true })
  })

  testOrSkip('连接已断开：横幅承认"停止更新"，不再报"系统运行正常"', async () => {
    await seedMonitor(page, { connectionState: 'error', sampleAgeMs: 10 * 60_000 })
    await page.waitForSelector('[data-monitor-freshness="disconnected"]', { timeout: 10_000 })
    const { banner, subtitle } = await readBanner(page)
    expect(banner).toContain('连接已断开')
    expect(banner).toContain('监控已停止更新')
    expect(banner, '断线了还在报"系统运行正常"，这是最危险的一种假象').not.toContain(
      '系统运行正常'
    )
    expect(subtitle, '页头要给出最后一条数据的时间，否则用户无法判断这份数是多久前的').toMatch(
      /最后更新 \d{2}:\d{2}:\d{2}/
    )
    // 告警表自己的空态也不许替机器背书
    const body = await page.evaluate(() => document.body.innerText)
    expect(body).toContain('无法判断当前是否有告警')
    expect(body, '告警表还写着"暂无告警，系统运行正常"').not.toContain('暂无告警，系统运行正常')
  })

  testOrSkip('连接还在但十分钟没有新采样：也要说停更', async () => {
    await seedMonitor(page, { connectionState: 'connected', sampleAgeMs: 10 * 60_000 })
    await page.waitForSelector('[data-monitor-freshness="stalled"]', { timeout: 10_000 })
    const { banner } = await readBanner(page)
    expect(banner).toContain('没有收到新采样')
    expect(banner).not.toContain('系统运行正常')
    const body = await page.evaluate(() => document.body.innerText)
    expect(body).toContain('无法判断当前是否有告警')
  })

  testOrSkip('反向对照：连接在、数据是新的，才说"系统运行正常"', async () => {
    await seedMonitor(page, { connectionState: 'connected', sampleAgeMs: 0 })
    await page.waitForSelector('[data-monitor-freshness="live"]', { timeout: 10_000 })
    const { banner } = await readBanner(page)
    expect(banner).toContain('系统运行正常')
    expect(banner).not.toContain('监控已停止更新')
    const body = await page.evaluate(() => document.body.innerText)
    expect(body, '数据是新的却说"无法判断"，等于天天误报').toContain('暂无告警，系统运行正常')
  })
})
