/**
 * db-degraded-banner.spec.ts —— 数据库真的挂掉时，横幅要真的出现（#261）
 *
 * 现状：`DbDegradedBanner` 有组件测，但那条测的是"喂给它一个 available:false 它会画"。
 * 真正容易断的是链路两端：主进程有没有如实报 `available:false`、渲染层有没有去取。
 * 这一段断掉时，组件测仍然全绿，用户那边则是"记录悄悄不保存"。
 *
 * 做法：把 `<userData>/tdsf.db` 建成一个**目录**（better-sqlite3 打不开），
 * 起真窗口看横幅；再起一个正常档位做反向对照（必须没有横幅，否则它就成了常驻噪音）。
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, type ElectronApplication } from '@playwright/test'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')
const BUILD_READY = fs.existsSync(MAIN_ENTRY)
if (!BUILD_READY) console.log('[db-degraded] 跳过：缺 out/main/index.js，先 pnpm build')
const testOrSkip = BUILD_READY ? test : test.skip

interface Launched {
  app: ElectronApplication
  profile: string
}

async function launch(profile: string): Promise<Launched> {
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${profile}`],
    env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
  })
  return { app, profile }
}

test.describe('数据库降级的真窗口取证', () => {
  let broken: Launched
  let healthy: Launched

  test.beforeAll(async () => {
    const brokenProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-e2e-dbdown-'))
    // 同名目录占住库文件的位置：open 会报 "unable to open database file"
    fs.mkdirSync(path.join(brokenProfile, 'tdsf.db'))
    broken = await launch(brokenProfile)

    const okProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-e2e-dbok-'))
    healthy = await launch(okProfile)
  })

  test.afterAll(async () => {
    await broken?.app.close()
    await healthy?.app.close()
    for (const p of [broken?.profile, healthy?.profile]) {
      if (p) fs.rmSync(p, { recursive: true, force: true })
    }
  })

  testOrSkip('库打不开：横幅出现、说清后果与原因，换页也还在', async () => {
    const page = await broken.app.firstWindow()
    await page.waitForSelector('body', { timeout: 30_000 })
    await page.waitForSelector('.wb-main-layout', { timeout: 30_000 })

    const banner = await page.waitForSelector('.db-degraded-banner.is-critical', { timeout: 15_000 })
    const text = (await banner.innerText()).replace(/\s+/g, ' ')
    expect(text, '必须说清后果：本次会话的记录不会保存').toContain('数据库不可用')
    expect(text, '不写后果，用户会以为只是"有点卡"').toContain('不会被保存')
    expect(text, '原因要写出来，否则没法排查').toContain('unable to open database file')

    // 换到设置页：横幅挂在主布局上，应该一直在
    await page.evaluate(() => (window.location.hash = '#/settings/appearance'))
    await page.waitForTimeout(800)
    const stillThere = await page.$('.db-degraded-banner.is-critical')
    expect(stillThere, '换个页面横幅就没了，用户在别的页面会以为一切正常').not.toBeNull()
  })

  testOrSkip('库正常时不出现横幅（反向对照：它不能变成常驻噪音）', async () => {
    const page = await healthy.app.firstWindow()
    await page.waitForSelector('.wb-main-layout', { timeout: 30_000 })
    await page.waitForTimeout(1500)
    expect(await page.$('.db-degraded-banner')).toBeNull()
  })
})
