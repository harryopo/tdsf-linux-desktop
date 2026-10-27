/**
 * chat-credibility-card.spec.ts —— 聊天里那张可信度卡，展开态也要量
 *
 * 为什么单独一条：`ui-audit --gate` 只量它导航得到的页面，而这张卡要先跑一轮
 * 带真实工具调用的对话、再点一下才出现——所以它从来没进过对比度的取数面。
 * 2026-10-27 就是在这里量出 Dempster 徽标 2.79:1（拿 --color-link 一个背景色令牌
 * 当字色），而门是绿的。这条判据补的就是那个盲区：**展开态逐节点算 WCAG 对比度**。
 *
 * 四条断言：
 *   1. 收起行报的"几个来源"与展开后那份清单同源（一个数组，不许两个数）
 *   2. 展开体不再套一张卡（背景透明、四边无描边）——"与整体效果不一致"的结构判据
 *   3. 每个文字节点的对比度 ≥ 4.5，字号只用界面字阶里的那几档
 *   4. Bel/Pl 各只出现一次（旧版同屏说两遍：30.8% 与 31%）
 *
 * 运行：pnpm build && npx playwright test tests/e2e/chat-credibility-card.spec.ts
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { startAiFixture } from './ai-fixture-server'
import type { AiFixtureHandle } from './ai-fixture-server'
import { launchApp } from './ssh-fixture-helpers'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')
const READY = fs.existsSync(MAIN_ENTRY)
if (!READY) console.log('[cred-card] 跳过：缺 out/main/index.js，先 pnpm build')
const testOrSkip = READY ? test : test.skip

const PROVIDER_ID = 'cred-card-fixture-model'
const QUESTION = '这台机器的磁盘为什么满了'

/** 界面字阶（ui-tokens.css 里那几档）；出现档位之外的字号=有人又自己定了一个 */
const ALLOWED_FONT_SIZES = [11, 12, 13, 14, 15, 17, 20]

async function ensurePanelOpen(page: Page): Promise<void> {
  const composer = page.locator('#ai-composer-input')
  if (await composer.isVisible().catch(() => false)) return
  await page.locator('[data-dom-id="btn-toggle-ai"]').click()
  await composer.waitFor({ state: 'visible', timeout: 10_000 })
}

async function configureFixtureModel(page: Page, url: string): Promise<void> {
  const saved = await page.evaluate(
    async (cfg) => {
      const w = window as unknown as {
        electronAPI: {
          providerSave: (c: unknown) => Promise<boolean>
          providerSetDefault: (id: string) => Promise<boolean>
          providerList: (withMeta?: boolean) => Promise<unknown[]>
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
        name: '可信度验证模型',
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
        const st = w.__tdsfStores.agent.getState()
        st.setProviders(list)
        st.setSelectedProviderId(cfg.providerId)
      }
      return { ok, setOk }
    },
    { providerId: PROVIDER_ID, baseURL: url },
  )
  expect(saved.ok, 'providerSave 应成功').toBe(true)
  expect(saved.setOk, 'providerSetDefault 应成功').toBe(true)
}

/** 屏上那份可信度卡的逐节点读数（收起行 + 展开体一起算） */
interface CredReading {
  /** 收起行"几个来源"里那个数字 */
  collapsedSourceCount: number | null
  /** 展开体是否真的展开了（左竖线里那块在不在） */
  expanded: boolean
  /** 展开体的容器样式：卡里套卡会在这里露出来 */
  body: {
    backgroundColor: string
    borderTopWidth: string
    borderLeftWidth: string
  } | null
  /** 展开体里的来源行数 */
  sourceRows: number
  /** 每个文字节点：文本、字号、对比度 */
  texts: Array<{
    text: string
    fontSize: number
    fontWeight: number
    ratio: number
  }>
  /** 字号不在界面字阶里的那些 */
  offScale: string[]
  /** 整卡文字（折成一行），用来数 Bel/Pl 各说了几遍 */
  flat: string
}

async function readCredCard(page: Page, index: number): Promise<CredReading> {
  return page.evaluate(
    (a: { idx: number; allowed: number[] }) => {
      const root = document.querySelectorAll('.ai-credibility')[a.idx]
      if (!root) throw new Error(`屏上没有第 ${a.idx + 1} 张 .ai-credibility`)
      const allowed = a.allowed

      const parse = (c: string) => {
        const m = /rgba?\(([^)]+)\)/.exec(c)
        if (!m) return null
        const p = m[1].split(',').map((x) => parseFloat(x.trim()))
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
      }
      const chan = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
      const lum = (r: number, g: number, b: number) =>
        0.2126 * chan(r / 255) + 0.7152 * chan(g / 255) + 0.0722 * chan(b / 255)
      /** 有效底：往上找到第一个不透明的背景色；一路透明就按画布 #1e1e1e 算 */
      const bgOf = (el: Element | null) => {
        let n: Element | null = el
        while (n) {
          const c = parse(getComputedStyle(n).backgroundColor)
          if (c && c.a > 0.9) return c
          n = n.parentElement
        }
        return { r: 30, g: 30, b: 30, a: 1 }
      }
      const ratioOf = (el: Element) => {
        const fg = parse(getComputedStyle(el).color)
        if (!fg) return 21
        const bg = bgOf(el.parentElement)
        const mix = (x: number, y: number) => x * fg.a + y * (1 - fg.a)
        const l1 = lum(mix(fg.r, bg.r), mix(fg.g, bg.g), mix(fg.b, bg.b))
        const l2 = lum(bg.r, bg.g, bg.b)
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
      }

      const body = root.querySelector('.confidence-breakdown')
      const texts = Array.from(root.querySelectorAll<HTMLElement>('*'))
        .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim().length > 0)
        .map((el) => {
          const cs = getComputedStyle(el)
          return {
            text: (el.textContent ?? '').trim().slice(0, 40),
            fontSize: Math.round(parseFloat(cs.fontSize) * 10) / 10,
            fontWeight: parseInt(cs.fontWeight, 10) || 400,
            ratio: Math.round(ratioOf(el) * 100) / 100,
          }
        })
      const micro = root.querySelector('.text-micro')?.textContent ?? ''

      return {
        collapsedSourceCount: Number(/(\d+)\s*个来源/.exec(micro)?.[1] ?? '') || null,
        expanded: !!body,
        body: body
          ? {
              backgroundColor: getComputedStyle(body).backgroundColor,
              borderTopWidth: getComputedStyle(body).borderTopWidth,
              borderLeftWidth: getComputedStyle(body).borderLeftWidth,
            }
          : null,
        sourceRows: body ? body.querySelectorAll('.confidence-breakdown-source').length : 0,
        texts,
        offScale: texts
          .filter((t) => !allowed.includes(Math.round(t.fontSize)))
          .map((t) => `${t.text}=${t.fontSize}px`),
        flat: (root.textContent ?? '').replace(/\s+/g, ' '),
      }
    },
    { idx: index, allowed: ALLOWED_FONT_SIZES },
  )
}

test.describe('聊天可信度卡：展开态逐节点量对比度', () => {
  test.describe.configure({ mode: 'serial' })

  let ai: AiFixtureHandle

  test.beforeAll(async () => {
    ai = await startAiFixture()
  })

  test.afterAll(async () => {
    await ai.close()
  })

  testOrSkip('带工具调用的一轮答完，收起行与展开体都过 AA', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launchApp()
    await page.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await page.waitForSelector('.wb-main-layout', { timeout: 20_000 })
    await configureFixtureModel(page, ai.baseURL)

    // 安排一次知识库检索：这条工具轨迹是这张卡唯一的挂载前提（没有证据就不渲染）
    ai.planToolCall({ name: 'kb_search', args: { query: '磁盘' } })
    await ensurePanelOpen(page)
    // 消息档是跨次运行累积的（临时档位目录不重置），所以先记基线：
    // 屏上可能留着上一次运行那张卡，`.ai-credibility` 一命中就取数等于量旧账。
    const beforeCards = await page.locator('.ai-credibility').count()
    const composer = page.locator('#ai-composer-input')
    await composer.click()
    await composer.pressSequentially(QUESTION)
    await page.getByRole('button', { name: '发送' }).click()

    const card = page.locator('.ai-credibility').nth(beforeCards)
    await expect(
      card,
      `本轮答完后没有多出第 ${beforeCards + 1} 张可信度卡（假模型回了一次 kb_search 工具调用；` +
        `要么没挂载、要么评估失败被静默吞掉）`,
    ).toBeVisible({ timeout: 90_000 })

    // 收起态先量一遍：这一行本来就一直在屏上，旧版漏的是"没人点开就没测"
    const collapsedReading = await readCredCard(page, beforeCards)
    expect(collapsedReading.texts.length, '收起行上一个文字节点都没读到').toBeGreaterThan(0)

    await card.locator('button.ai-tool-row').click()
    await expect(card.locator('.confidence-breakdown')).toBeVisible({
      timeout: 10_000,
    })
    const r = await readCredCard(page, beforeCards)

    // 1. 同源：收起行那个数就是展开那份清单的行数
    expect(r.expanded, '点了标题行，展开体没出来').toBe(true)
    expect(
      r.sourceRows,
      `收起行报"${r.collapsedSourceCount} 个来源"，展开体里却有 ${r.sourceRows} 行——两个数不同源`,
    ).toBeGreaterThanOrEqual(1)
    expect(
      r.collapsedSourceCount,
      `收起行的来源数与清单行数不一致（收起=${r.collapsedSourceCount} 展开=${r.sourceRows}）`,
    ).toBe(r.sourceRows)

    // 2. 结构：展开体不许再画一张卡（聊天流里其它折叠块只有左竖线）
    expect(r.body?.backgroundColor, '展开体又自带背景色了，等于卡里套卡').toBe('rgba(0, 0, 0, 0)')
    expect(r.body?.borderTopWidth, '展开体又自带描边了').toBe('0px')

    // 3. 对比度与字阶
    const lowContrast = r.texts.filter((t) => t.ratio < 4.5)
    expect(
      lowContrast,
      `这些文字不过 AA（旧版那块 Dempster 徽标就是这么漏的，2.79:1）：${JSON.stringify(lowContrast)}`,
    ).toEqual([])
    expect(r.offScale, `这些字号不在界面字阶里：${JSON.stringify(r.offScale)}`).toEqual([])

    // 4. Bel/Pl 各只说一遍
    const belHits = (r.flat.match(/Bel\s*\d+%/g) ?? []).length
    const plHits = (r.flat.match(/Pl\s*\d+%/g) ?? []).length
    expect(belHits, `Bel 在同屏出现了 ${belHits} 次：${r.flat}`).toBe(1)
    expect(plHits, `Pl 在同屏出现了 ${plHits} 次：${r.flat}`).toBe(1)

    await app.close()
  })
})
