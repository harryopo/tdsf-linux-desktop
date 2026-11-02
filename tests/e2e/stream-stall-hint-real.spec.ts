/**
 * stream-stall-hint-real.spec.ts —— 流式"卡住了"这句话在真窗口里必须真出现（#292）
 *
 * 为什么这条不能只留组件测：组件测是自己 emit('x') 把 lastStreamActivityAt 写进 store 的，
 * 于是"真流式有没有把这个时间戳喂起来"这一半从来没被覆盖——主进程推字、渲染层记时间、
 * 界面按时间提示，三段里断任何一段，组件测照样绿。
 * 这里改用假模型服务真的把流停住：说完第一个分片卡 16 秒再说完，
 * 于是"12 秒没新内容"这句话必须由真实链路自己长出来，再随下一个真实分片自己收掉。
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { startAiFixture } from './ai-fixture-server'
import type { AiFixtureHandle } from './ai-fixture-server'
import { launchApp } from './ssh-fixture-helpers'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
if (!BUILD_READY) console.log('[stream-stall-hint-real] 跳过：缺 out/main/index.js，先 pnpm build')
const testOrSkip = BUILD_READY ? test : test.skip

const PROVIDER_ID = 'stall-hint-fixture'
/** 比界面阈值（12 秒）多留 4 秒余量，避免机器一慢就判成"提示没出现" */
const STALL_MS = 16_000

async function configureFixtureModel(page: Page, baseURL: string): Promise<void> {
  const saved = await page.evaluate(
    async (cfg) => {
      const w = window as unknown as {
        electronAPI: {
          providerSave: (c: unknown) => Promise<boolean>
          providerSetDefault: (id: string) => Promise<boolean>
          providerList: (withMeta?: boolean) => Promise<Array<{ id: string }>>
        }
        __tdsfStores?: {
          agent?: { getState: () => { setProviders: (p: unknown[]) => void; setSelectedProviderId: (id: string) => void } }
        }
      }
      const ok = await w.electronAPI.providerSave({
        id: cfg.providerId,
        name: '停滞验证模型',
        type: 'openai-compatible',
        baseURL: cfg.baseURL,
        model: cfg.providerId,
        apiKey: 'fixture-' + 'key',
        defaultParams: { temperature: 0, maxTokens: 64 },
        builtin: false,
        enabled: true,
        roles: ['chat'],
      })
      const setOk = await w.electronAPI.providerSetDefault(cfg.providerId)
      const list = await w.electronAPI.providerList(true)
      if (w.__tdsfStores?.agent) {
        const store = w.__tdsfStores.agent.getState()
        store.setProviders(list)
        store.setSelectedProviderId(cfg.providerId)
      }
      return { ok, setOk }
    },
    { providerId: PROVIDER_ID, baseURL },
  )
  expect(saved.ok, 'providerSave 应成功').toBe(true)
  expect(saved.setOk, 'providerSetDefault 应成功').toBe(true)
}

/** 发送并把"第一个分片已上屏"当作起点 */
async function sendAndWatchFirstDelta(page: Page): Promise<void> {
  const composer = page.locator('#ai-composer-input')
  await page.locator('[data-dom-id="btn-toggle-ai"]').waitFor({ state: 'visible', timeout: 20_000 })
  if (!(await composer.isVisible().catch(() => false))) {
    await page.locator('[data-dom-id="btn-toggle-ai"]').click()
    await composer.waitFor({ state: 'visible', timeout: 15_000 })
  }
  await composer.click()
  await composer.pressSequentially('测试一下')
  await page.getByRole('button', { name: '发送' }).click()
  // 第一个分片真上屏了，停滞计时才算开始；否则"还没开始流"会被读成"流卡住了"
  await expect
    .poll(() => page.locator('.ai-messages').innerText(), { timeout: 20_000, message: '第一个分片应先上屏' })
    .toContain('1+1')
}

const hint = (page: Page) => page.locator('[data-dom-id="stream-stall-hint"]')

test.describe('流式停滞预告的真窗口口径', () => {
  let ai: AiFixtureHandle

  test.beforeAll(async () => {
    ai = await startAiFixture()
  })

  test.afterAll(async () => {
    await ai.close()
  })

  testOrSkip('上游说完半句卡住：提示要自己长出来，下一个分片到了要自己收掉', async () => {
    test.setTimeout(90_000)
    const { app, page: mainWin } = await launchApp()
    try {
      await mainWin.evaluate(() => {
        window.location.hash = '#/workbench'
      })
      await mainWin.waitForSelector('.wb-main-layout', { timeout: 15000 })
      await configureFixtureModel(mainWin, ai.baseURL)
      ai.planStallAfterFirstChunk(STALL_MS)
      await sendAndWatchFirstDelta(mainWin)

      // 阈值 12 秒：卡住 16 秒 ⇒ 这句必须出现
      await hint(mainWin).waitFor({ state: 'visible', timeout: 20_000 })
      expect(await hint(mainWin).innerText()).toMatch(/没收到新内容/)

      // 反向的一半：分片继续到达后提示必须收掉，而不是挂着说"还在等"
      await expect
        .poll(() => hint(mainWin).count(), { timeout: STALL_MS + 20_000, message: '流恢复后提示应消失' })
        .toBe(0)
      await expect(mainWin.locator('.ai-messages')).toContainText('1+1 等于 2', { timeout: 20_000 })
    } finally {
      await app.close()
    }
  })
})
