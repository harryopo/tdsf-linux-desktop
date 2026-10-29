/**
 * ai-empty-reply.spec.ts —— 模型回空内容时，界面不许留一个空气泡（#262）
 *
 * 实测（改前）：假模型只回一个 `finish_reason=stop`、没有任何 content 增量，
 * AI 面板会渲染一个**空的「助手」气泡**，还挂着「可信度分析 60%」和「0 tokens」——
 * 等于替"什么都没说"背书。用户看到的是"AI 说完了"，实际一句话都没有。
 *
 * 这条用假模型服务的 `planEmptyReply` 造这个形状，正反各验一次：
 *   1. 空回复 → 出现「模型没有返回内容」的说明，且这条消息里没有可信度卡；
 *   2. 正常回复（反向对照）→ 不出现这句说明，正文照常显示。
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { startAiFixture } from './ai-fixture-server'
import type { AiFixtureHandle } from './ai-fixture-server'
import { launchApp } from './ssh-fixture-helpers'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
if (!BUILD_READY) console.log('[ai-empty-reply] 跳过：缺 out/main/index.js，先 pnpm build')
const testOrSkip = BUILD_READY ? test : test.skip

const PROVIDER_ID = 'empty-reply-fixture'

async function configureFixtureModel(page: Page, url: string): Promise<void> {
  const saved = await page.evaluate(
    async (cfg) => {
      const w = window as unknown as {
        electronAPI: {
          providerSave: (c: unknown) => Promise<boolean>
          providerSetDefault: (id: string) => Promise<boolean>
          providerList: (withMeta?: boolean) => Promise<Array<{ id: string; hasApiKey?: boolean }>>
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
        name: '空回复验证模型',
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

async function ask(page: Page, question: string): Promise<void> {
  const composer = page.locator('#ai-composer-input')
  // 工作台是懒加载的：先等这颗按钮出现，否则"此刻还没画上"会被误判成"面板关着"，
  // 于是一点反而把开着的面板关掉（2026-10-29 工作台改成常驻挂载后这条竞态被放大）。
  await page.locator('[data-dom-id="btn-toggle-ai"]').waitFor({ state: 'visible', timeout: 20_000 })
  if (!(await composer.isVisible().catch(() => false))) {
    await page.locator('[data-dom-id="btn-toggle-ai"]').click()
    await composer.waitFor({ state: 'visible', timeout: 15_000 })
  }
  await composer.click()
  await composer.pressSequentially(question)
  await page.getByRole('button', { name: '发送' }).click()
  // 等这一轮收尾（发送按钮回来）
  await expect
    .poll(async () => page.getByRole('button', { name: '发送' }).count(), { timeout: 30_000 })
    .toBeGreaterThan(0)
  await page.waitForTimeout(1200)
}

test.describe('模型空回复的界面口径', () => {
  let ai: AiFixtureHandle

  test.beforeAll(async () => {
    ai = await startAiFixture()
  })

  test.afterAll(async () => {
    await ai.close()
  })

  testOrSkip('空回复：说明"模型没有返回内容"，且不给空气泡挂可信度', async () => {
    const { app, page } = await launchApp()
    try {
      await configureFixtureModel(page, ai.baseURL)
      await page.waitForSelector('.wb-main-layout', { timeout: 30_000 })

      ai.planEmptyReply(true)
      await ask(page, '你好')

      // 对话历史是持久化的（同一个 e2e 档位跨用例复用），所以只认最后一条助手消息
      const lastRow = page.locator('.ai-msg-assistant').last()
      const marker = lastRow.locator('[data-dom-id="message-empty-reply"]')
      await expect(marker, '空回复什么提示都没有，用户以为 AI 说完了').toBeVisible()
      await expect(marker).toContainText('模型没有返回内容')

      // 这条助手消息里不许再挂可信度卡（没内容就没有可信度可言）
      expect(await lastRow.innerText()).not.toContain('可信度分析')
    } finally {
      await app.close()
    }
  })

  testOrSkip('反向对照：正常回复不出现"模型没有返回内容"', async () => {
    const { app, page } = await launchApp()
    try {
      await configureFixtureModel(page, ai.baseURL)
      await page.waitForSelector('.wb-main-layout', { timeout: 30_000 })

      ai.planEmptyReply(false)
      await ask(page, '用一句话说明 df -h 是做什么的')

      const lastRow = page.locator('.ai-msg-assistant').last()
      expect(
        await lastRow.locator('[data-dom-id="message-empty-reply"]').count(),
        '正常回复被误判成空回复'
      ).toBe(0)
      const rowText = await lastRow.innerText()
      expect(rowText.trim().length, '正常回复被吃掉了？').toBeGreaterThan(10)
    } finally {
      await app.close()
    }
  })
})
