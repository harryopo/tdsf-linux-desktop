/**
 * ai-stream-abort.spec.ts —— 模型说了一半连接断了，界面与库里都要说清（#263 / 结案 #231）
 *
 * 这块此前一直挂着一句"库里助手消息为什么是半截"（板上 #231）。先把时间轴量清楚：
 * 助手行**只在收尾时写一次**（流式期不落行），正常回答落库时就是全文。
 * "半截"只出现在一种情况下——**流到一半对端把连接掐断**：这时按设计保留已经说出来的那半截，
 * 但必须标成错误，而且界面要给"网络断了、可以重试"，不能演成"AI 说完了"。
 *
 * 这条用例把那个形状造出来（假模型吐一句就把 socket 关掉），同时钉三件事：
 *   1. 屏上保留半截 + 错误卡，并把它归类成「网络连接异常」（以前落到"原因没被认出来"）；
 *   2. 库里的那一行就是这半截，且 `isError=true`（不是一条看起来正常的完整回答）；
 *   3. 给得出「重试」这个下一步。
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { startAiFixture } from './ai-fixture-server'
import type { AiFixtureHandle } from './ai-fixture-server'
import { launchApp } from './ssh-fixture-helpers'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
if (!BUILD_READY) console.log('[ai-stream-abort] 跳过：缺 out/main/index.js，先 pnpm build')
const testOrSkip = BUILD_READY ? test : test.skip

const PROVIDER_ID = 'abort-fixture-model'
const PARTIAL = '这是说了一半的回答'

async function configureFixtureModel(page: Page, url: string): Promise<void> {
  const saved = await page.evaluate(
    async (cfg) => {
      const w = window as unknown as {
        electronAPI: {
          providerSave: (c: unknown) => Promise<boolean>
          providerSetDefault: (id: string) => Promise<boolean>
          providerList: (withMeta?: boolean) => Promise<Array<{ id: string }>>
        }
        __tdsfStores?: {
          agent?: {
            getState: () => {
              setProviders: (p: unknown[]) => void
              setSelectedProviderId: (id: string) => void
            }
          }
        }
      }
      const ok = await w.electronAPI.providerSave({
        id: cfg.providerId,
        name: '断流验证模型',
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
    { providerId: PROVIDER_ID, baseURL: url }
  )
  expect(saved.ok, 'providerSave 应成功').toBe(true)
  expect(saved.setOk, 'providerSetDefault 应成功').toBe(true)
}

test.describe('流式中途断开的界面与落库口径', () => {
  let ai: AiFixtureHandle

  test.beforeAll(async () => {
    ai = await startAiFixture()
  })

  test.afterAll(async () => {
    await ai.close()
  })

  testOrSkip('对端掐断：屏上是半截 + 网络错误 + 重试，库里那行标成错误', async () => {
    const { app, page } = await launchApp()
    try {
      await configureFixtureModel(page, ai.baseURL)
      await page.waitForSelector('.wb-main-layout', { timeout: 30_000 })

      const composer = page.locator('#ai-composer-input')
      if (!(await composer.isVisible().catch(() => false))) {
        await page.locator('[data-dom-id="btn-toggle-ai"]').click()
        await composer.waitFor({ state: 'visible', timeout: 15_000 })
      }
      ai.planAbortAfter(PARTIAL)
      await composer.click()
      await composer.pressSequentially('测试中途断流')
      await page.getByRole('button', { name: '发送' }).click()

      // 等错误卡出现（这一轮不会有正常收尾）
      const lastRow = page.locator('.ai-msg-assistant').last()
      await expect(lastRow, '断流后连半截都没留在屏上').toContainText(PARTIAL, { timeout: 30_000 })
      await expect
        .poll(async () => (await lastRow.innerText()).includes('网络连接异常'), { timeout: 30_000 })
        .toBe(true)

      const rowText = await lastRow.innerText()
      expect(rowText, '网络断了要说"检查网络/重试"，不能说"原因没认出来"').not.toContain(
        '原因没被认出来'
      )
      expect(rowText, '下一步要给得出重试').toContain('重试')

      // 库里那行：就是这半截，且必须标成错误（不是一条看起来正常的回答）
      const stored = await page.evaluate(async (prefix) => {
        const rows = (await window.electronAPI.chatHistory(null)) as Array<{
          role: string
          content: string
          isError?: boolean
        }>
        const last = [...rows].reverse().find((r) => r.role === 'assistant')
        return last ? { content: last.content, isError: last.isError === true } : null
      }, PARTIAL)
      expect(stored, '断流那一轮没有落库').not.toBeNull()
      expect(stored!.content, '库里的内容应是已经说出来的那半截').toBe(PARTIAL)
      expect(stored!.isError, '半截行必须标成错误，否则历史里看起来像一条完整的回答').toBe(true)
    } finally {
      await app.close()
    }
  })
})
