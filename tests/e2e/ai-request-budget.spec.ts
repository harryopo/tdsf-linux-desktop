/**
 * ai-request-budget.spec.ts —— 一句话到底会让模型被叫几次（2026-10-28，#255）
 *
 * 为什么单独量这个：主对话是 ReAct 循环，`stopWhen: isStepCount(hasTools ? 12 : 1)`——
 * 带工具时**上界是 12 次计费请求**，而且 SDK 每一步都把前面所有消息（含工具结果）重发一遍。
 * 另有一处 5 分钟节流的记忆抽取会在对话成功后 fire-and-forget 再打一次模型。
 * 这些加起来，用户看到的是"我就问了一句话，怎么账单涨了"。
 *
 * 这条判据钉两件事：
 * 1. **一句不需要工具的话，主对话只发 1 次请求**（不是 12 次）——模型自己不再调工具就停；
 * 2. **请求里带着输出上限**（max_tokens 有值且等于产品里配的那个），不许"没传上限让模型随便写"。
 *
 * 计数与字段都从假模型服务那一侧取（requestCount / lastRequest），
 * 不从渲染层猜：那边看不到真正发出去的请求。
 *
 * 运行：pnpm build && npx playwright test tests/e2e/ai-request-budget.spec.ts
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { startAiFixture } from './ai-fixture-server'
import type { AiFixtureHandle } from './ai-fixture-server'
import { launchApp } from './ssh-fixture-helpers'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
if (!BUILD_READY) console.log('[ai-request-budget] 跳过：缺 out/main/index.js，先 pnpm build')
const testOrSkip = BUILD_READY ? test : test.skip

const PROVIDER_ID = 'budget-fixture-model'
/** 与下面 providerSave 里的 maxTokens 保持一致；断言读的是请求里的真实值 */
const MAX_TOKENS = 64
/** 主对话 1 次 + 记忆抽取最多 1 次（成功后异步触发，5 分钟节流） */
const MAX_REQUESTS_PER_QUESTION = 2

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
        name: '预算验证模型',
        type: 'openai-compatible',
        baseURL: cfg.baseURL,
        model: cfg.providerId,
        apiKey: 'fixture-' + 'key',
        defaultParams: { temperature: 0, maxTokens: cfg.maxTokens },
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
    { providerId: PROVIDER_ID, baseURL: url, maxTokens: MAX_TOKENS }
  )
  expect(saved.ok, 'providerSave 应成功').toBe(true)
  expect(saved.setOk, 'providerSetDefault 应成功').toBe(true)
}

test.describe('一次提问的模型请求预算', () => {
  let ai: AiFixtureHandle

  test.beforeAll(async () => {
    ai = await startAiFixture()
  })

  test.afterAll(async () => {
    await ai.close()
  })

  testOrSkip('一句不需要工具的话：只发 1 次请求，且带着输出上限', async () => {
    const { app, page } = await launchApp()
    try {
      await configureFixtureModel(page, ai.baseURL)

      // 冷启动首帧可能还在挂载：先等工作台外壳，再点开 AI 面板
      await page.waitForSelector('.wb-main-layout', { timeout: 30_000 })
      const composer = page.locator('#ai-composer-input')
      if (!(await composer.isVisible().catch(() => false))) {
        await page.locator('[data-dom-id="btn-toggle-ai"]').click()
        await composer.waitFor({ state: 'visible', timeout: 15_000 })
      }

      const before = ai.requestCount()
      await composer.click()
      await composer.pressSequentially('用一句话说明 df -h 是做什么的')
      await page.getByRole('button', { name: '发送' }).click()

      // 第一次请求一落地就读它带的字段——这一定是主对话那一次（记忆抽取在成功之后才发）
      await expect
        .poll(() => ai.requestCount(), { timeout: 20_000, message: '主对话没有发出请求' })
        .toBeGreaterThan(before)
      const first = ai.lastRequest()

      expect(first.maxTokens, '请求里没带 max_tokens 等于让模型随便写到上下文上限').toBe(MAX_TOKENS)
      expect(first.messageCount, '至少要带上这一轮的问题').toBeGreaterThanOrEqual(1)
      expect(first.toolCount, '挂了多少工具 schema 也计入 input token，这里只做个上界留痕').toBeLessThanOrEqual(30)

      // 等这一轮真跑完（发送按钮从"停止生成"变回"发送"）
      await expect
        .poll(
          async () =>
            (await page.getByRole('button', { name: '发送' }).count()) > 0 ||
            (await composer.inputValue().catch(() => '')) === '',
          { timeout: 30_000, message: '这一轮没有正常收尾' }
        )
        .toBe(true)

      // 收尾之后再等一会儿，把"成功后异步触发"的那些调用也数进来
      await page.waitForTimeout(1500)
      const used = ai.requestCount() - before
      expect(
        used,
        `一句话触发了 ${used} 次模型请求（主对话应只 1 次，至多再加 1 次记忆抽取）`
      ).toBeLessThanOrEqual(MAX_REQUESTS_PER_QUESTION)
    } finally {
      await app.close()
    }
  })
})
