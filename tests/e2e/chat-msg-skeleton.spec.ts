/**
 * chat-msg-skeleton.spec.ts —— 聊天消息行骨架的真窗口判据（面板第①笔）
 *
 * 为什么单独一条：`ui-audit --gate` 只量它导航得到的静态页面，而消息行要先有对话才画得出来。
 * 第①笔改的正是"画出来长什么样"：头像整块删掉、助手正文不再包气泡、用户那一轮只留一颗药丸。
 * 这些全是 computed style 层面的事实，jsdom 量不到（它不做布局、不解析 CSS 变量），
 * 所以必须真起一个窗口来量——否则"去气泡"这句话只有代码在替它作证。
 *
 * 五条判据：
 *   1. 助手行的第一个子节点就是角色行（头像那一列不许回来），且正文往上到行容器的
 *      **每一层**都无底、无描边、无投影（去气泡）
 *   2. 每轮助手只有一行角色名，且它左缘与滚动区内缘齐平（头像那一列的缩进不许留下）
 *   3. 用户那颗药丸：有底、圆角 22px（`--ui-radius-bubble`）、四边无描边、无投影
 *   4. 逐文字节点过 AA（≥4.5）且字号只用界面字阶里的那几档
 *   5. 欢迎态那几条建议行是真入口：点第一条，提示词真的落进输入框（不是画上去的）
 *
 * 运行：pnpm build && npx playwright test tests/e2e/chat-msg-skeleton.spec.ts
 *
 * 反证时抓到两处量具自身的洞（都已修，留在这里别让下一个人再踩）：
 *   ① 判气泡只量最里层 `.md-body` 是空的——把底和描边加在外层 `.ai-msg-prose` 上，
 *      内层读数一个字都不变，判据照样绿。所以判据改成"正文往上到行容器逐层查"。
 *   ② 输入框非空时 Composer 是**拼接**而不是替换（`Composer.tsx:127`），
 *      不清空就读输入框，"两条行填同一句"这种错会被拼成两个不同的串而蒙过去。
 *   ③ 判"头像删掉了"不能在 e2e 里写 `.ai-avatar` 这个类名——`tests/unit/e2e-selector-exists.test.ts`
 *      把 e2e 里出现的每个类都当成"界面会画出来的元素"，死类一律判红。改成断言
 *      "这一行的第一个子节点就是角色行"，同一个缺陷照样抓到，且不依赖那个名字活着。
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp } from './ssh-fixture-helpers'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')
const READY = fs.existsSync(MAIN_ENTRY)
if (!READY) console.log('[msg-skeleton] 跳过：缺 out/main/index.js，先 pnpm build')
const testOrSkip = READY ? test : test.skip

/** 界面字阶（ui-tokens.css 里那几档）；出现档位之外的字号=有人又自己定了一个 */
const ALLOWED_FONT_SIZES = [11, 12, 13, 14, 15, 17, 20]

async function ensurePanelOpen(page: Page): Promise<void> {
  const composer = page.locator('#ai-composer-input')
  if (await composer.isVisible().catch(() => false)) return
  await page.locator('[data-dom-id="btn-toggle-ai"]').click()
  await composer.waitFor({ state: 'visible', timeout: 10_000 })
}

interface SkeletonReading {
  /**
   * 助手行第一个子节点的类名（判据 1）
   *
   * 这里不写"数一下 `.ai-avatar` 有几个"——那个类界面根本不该存在，
   * `tests/unit/e2e-selector-exists.test.ts` 会把任何 e2e 里出现的死类判成"用例在等不存在的元素"。
   * 换成正向的形状断言：这一行的第一个子节点就得是角色行，前面不许再蹲一列头像。
   */
  firstChildCls: string | null
  /** 助手轮里的角色行文本（判据 2） */
  roles: string[]
  /**
   * 从正文往上到这一行容器的每一层（判据 1）
   *
   * 只量最里面那块 `.md-body` 是抓不到气泡回潮的——反证时把底和描边加在外层
   * `.ai-msg-prose` 上，内层读数一个字都没变，判据照样绿。所以整条链都要查。
   */
  chain: Array<{
    cls: string
    backgroundColor: string
    borderTopWidth: string
    borderLeftWidth: string
    boxShadow: string
    fontSize: number
  }>
  /** 正文里那层 markdown 的字号（判据 4 的字阶核对用） */
  proseFontSize: number | null
  /** 用户药丸 */
  pill: {
    backgroundColor: string
    borderRadius: string
    borderTopWidth: string
    boxShadow: string
    fontSize: number
  } | null
  /** 正文左缘与滚动区内缘的差（px）：头像那一列的缩进会在这里露出来 */
  leftIndent: number | null
  /** 计量行左缘与正文左缘的差（px）：以前挂着 pl-8 跟头像对齐 */
  metricIndent: number | null
  /** 逐文字节点的对比度与字号 */
  texts: Array<{ text: string; fontSize: number; ratio: number }>
  offScale: string[]
}

async function readSkeleton(page: Page): Promise<SkeletonReading> {
  return page.evaluate(
    (a: { allowed: number[] }) => {
      const list = document.querySelector<HTMLElement>('.ai-messages')
      if (!list) throw new Error('屏上没有 .ai-messages，消息区没画出来')
      const row = document.querySelector<HTMLElement>('.ai-msg-assistant')
      if (!row) throw new Error('屏上没有 .ai-msg-assistant，助手轮没画出来')

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

      const prose = row.querySelector<HTMLElement>('.ai-msg-prose .md-body')
      const pill = document.querySelector<HTMLElement>('.ai-msg-user-bubble')
      const metric = row.querySelector<HTMLElement>('.ai-token-row')

      // 正文往上到这一行容器的整条链（不含 .ai-msg-assistant 本身）
      const chain: Array<{
        cls: string
        backgroundColor: string
        borderTopWidth: string
        borderLeftWidth: string
        boxShadow: string
        fontSize: number
      }> = []
      for (let n: HTMLElement | null = prose; n && n !== row; n = n.parentElement) {
        const cs = getComputedStyle(n)
        chain.push({
          cls: n.className || n.tagName.toLowerCase(),
          backgroundColor: cs.backgroundColor,
          borderTopWidth: cs.borderTopWidth,
          borderLeftWidth: cs.borderLeftWidth,
          boxShadow: cs.boxShadow,
          fontSize: Math.round(parseFloat(cs.fontSize) * 10) / 10,
        })
      }

      const listCs = getComputedStyle(list)
      const proseRect = prose?.getBoundingClientRect()
      const innerLeft =
        list.getBoundingClientRect().left + parseFloat(listCs.paddingLeft) + parseFloat(listCs.borderLeftWidth)

      const texts = Array.from(row.querySelectorAll<HTMLElement>('*'))
        .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim().length > 0)
        .map((el) => {
          const cs = getComputedStyle(el)
          return {
            text: (el.textContent ?? '').trim().slice(0, 40),
            fontSize: Math.round(parseFloat(cs.fontSize) * 10) / 10,
            ratio: Math.round(ratioOf(el) * 100) / 100,
          }
        })
      // 用户那颗药丸里的文字也算：它是这一笔唯一还带底的地方
      if (pill) {
        const cs = getComputedStyle(pill)
        texts.push({
          text: (pill.textContent ?? '').trim().slice(0, 40),
          fontSize: Math.round(parseFloat(cs.fontSize) * 10) / 10,
          ratio: Math.round(ratioOf(pill) * 100) / 100,
        })
      }

      return {
        firstChildCls: row.firstElementChild ? row.firstElementChild.className : null,
        roles: Array.from(row.querySelectorAll<HTMLElement>('.ai-msg-role')).map(
          (el) => el.textContent ?? '',
        ),
        chain,
        proseFontSize: prose
          ? Math.round(parseFloat(getComputedStyle(prose).fontSize) * 10) / 10
          : null,
        pill: pill
          ? {
              backgroundColor: getComputedStyle(pill).backgroundColor,
              borderRadius: getComputedStyle(pill).borderRadius,
              borderTopWidth: getComputedStyle(pill).borderTopWidth,
              boxShadow: getComputedStyle(pill).boxShadow,
              fontSize: Math.round(parseFloat(getComputedStyle(pill).fontSize) * 10) / 10,
            }
          : null,
        leftIndent: proseRect ? Math.round((proseRect.left - innerLeft) * 10) / 10 : null,
        metricIndent:
          metric && proseRect
            ? Math.round((metric.getBoundingClientRect().left - proseRect.left) * 10) / 10
            : null,
        texts,
        offScale: texts
          .filter((t) => !a.allowed.includes(Math.round(t.fontSize)))
          .map((t) => `${t.text}=${t.fontSize}px`),
      }
    },
    { allowed: ALLOWED_FONT_SIZES },
  )
}

test.describe('聊天消息行骨架：无头像、无气泡、一颗药丸', () => {
  test.describe.configure({ mode: 'serial' })

  testOrSkip('欢迎态的建议行是真入口：点它把提示词填进输入框', async () => {
    const { app, page } = await launchApp()
    await page.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await page.waitForSelector('.wb-main-layout', { timeout: 20_000 })
    await ensurePanelOpen(page)

    // 先清屏：消息档是跨次运行累积的，不清就落回对话态，欢迎态根本画不出来
    await page.evaluate(() => {
      const stores = (
        window as unknown as {
          __tdsfStores?: { agent?: { getState: () => { clearMessages: () => void } } }
        }
      ).__tdsfStores
      stores?.agent?.getState().clearMessages()
    })

    const rows = page.locator('.ai-sug')
    await expect(rows.first(), '欢迎态一条建议都没有').toBeVisible({ timeout: 10_000 })
    const labels = await rows.allTextContents()
    expect(labels.length, '欢迎态只剩一两行，等于入口比原来还少').toBeGreaterThanOrEqual(4)

    // 每行填进来的话必须各是各的。两个坑都踩过：
    // ① 只断言"点了有东西"——所有行填同一句也能绿；
    // ② 输入框非空时 Composer 是**拼接**而不是替换（Composer.tsx:127），
    //    不清空就读到"上一句 + 这一句"，两句一样的错照样绿。
    const composer = page.locator('#ai-composer-input')
    const filled: string[] = []
    for (const idx of [0, 1]) {
      await composer.fill('')
      await expect(rows.nth(idx), `第 ${idx + 1} 条建议行点不到了`).toBeVisible()
      await rows.nth(idx).click()
      const value = (await composer.inputValue()).trim()
      expect(value.length, `点「${labels[idx]}」输入框里却没东西——这行是画上去的`).toBeGreaterThan(0)
      filled.push(value)
    }
    expect(
      filled[1],
      `两条不同的建议填进来的是同一句话（都是「${filled[0].slice(0, 24)}…」），行与提示词不同源`,
    ).not.toBe(filled[0])
    // 行标签自己点名了"磁盘/内存/负载"，填进来的那句就得讲到它
    expect(filled[0], `点「不对劲」填的却是没提磁盘的一句：${filled[0]}`).toContain('磁盘')

    await app.close()
  })

  testOrSkip('消息行骨架：头像没了、正文不包气泡、用户只剩一颗药丸', async () => {
    const { app, page } = await launchApp()
    await page.evaluate(() => {
      window.location.hash = '#/workbench'
    })
    await page.waitForSelector('.wb-main-layout', { timeout: 20_000 })
    await ensurePanelOpen(page)

    const injected = await page.evaluate(() => {
      const stores = (
        window as unknown as {
          __tdsfStores?: {
            agent?: {
              getState: () => {
                clearMessages: () => void
                addMessage: (m: Record<string, unknown>) => void
              }
            }
          }
        }
      ).__tdsfStores
      if (!stores?.agent) return false
      const st = stores.agent.getState()
      st.clearMessages()
      st.addMessage({
        id: 'skel_user',
        role: 'user',
        content: '这台机器昨晚开始 load 很高，帮我看看是什么拖的',
        timestamp: Date.now(),
      })
      st.addMessage({
        id: 'skel_assistant',
        role: 'assistant',
        content: '主要占用来自 nginx 的磁盘写，日志分区已用到 92%。',
        timestamp: Date.now(),
        isStreaming: false,
        model: 'skeleton-fixture',
        usage: { inputTokens: 1200, outputTokens: 180, totalTokens: 1380 },
      })
      return true
    })
    expect(injected, '__tdsfStores 测试钩子应可用（main.tsx 在 webdriver 下挂载）').toBe(true)

    await expect(page.locator('.ai-msg-assistant')).toHaveCount(1, { timeout: 10_000 })
    const r = await readSkeleton(page)

    // 1. 去头像、去气泡：这一行开头就得是角色行，正文往上每一层都不许有底/描边/投影
    expect(
      r.firstChildCls,
      `助手行第一个子节点不是角色行（实测 ${JSON.stringify(r.firstChildCls)}）——前面又蹲了一列别的东西`,
    ).toContain('ai-msg-role')
    expect(r.chain.length, '正文往上找不到 .ai-msg-assistant，取的这串链不对').toBeGreaterThanOrEqual(2)
    const bad = r.chain.filter(
      (n) =>
        n.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
        n.borderTopWidth !== '0px' ||
        n.borderLeftWidth !== '0px' ||
        n.boxShadow !== 'none',
    )
    expect(bad, `助手正文这一串里有人自己画了底/描边/投影（等于又包回气泡）：${JSON.stringify(bad)}`).toEqual(
      [],
    )

    // 2. 角色行：一轮一句，且左缘不再有头像的缩进
    expect(r.roles, `角色行应该有且只有一行，实测 ${JSON.stringify(r.roles)}`).toEqual(['助手'])
    expect(r.leftIndent, '正文左缘比滚动区内缘还往右——头像删了但缩进留着').toBeLessThanOrEqual(1)
    expect(r.metricIndent, '计量行与正文不同一条左缘（旧的 pl-8 缩进没跟着撤）').toBe(0)

    // 3. 用户那颗药丸
    expect(r.pill, '用户那一轮没画出药丸').not.toBeNull()
    expect(r.pill!.backgroundColor, '用户药丸没底，和助手正文分不开').not.toBe('rgba(0, 0, 0, 0)')
    expect(r.pill!.borderTopWidth, '用户药丸有描边').toBe('0px')
    expect(r.pill!.boxShadow, '用户药丸有投影').toBe('none')
    expect(r.pill!.borderRadius, '用户药丸的圆角不是 `--ui-radius-bubble`（22px）').toBe('22px')

    // 4. 对比度与字阶
    const lowContrast = r.texts.filter((t) => t.ratio < 4.5)
    expect(lowContrast, `这些文字不过 AA：${JSON.stringify(lowContrast)}`).toEqual([])
    expect(r.offScale, `这些字号不在界面字阶里：${JSON.stringify(r.offScale)}`).toEqual([])
    expect(r.proseFontSize, '助手正文不是正文档（15px）').toBe(15)

    await app.close()
  })
})
