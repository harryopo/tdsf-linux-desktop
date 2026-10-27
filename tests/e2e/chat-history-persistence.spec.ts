/**
 * chat-history-persistence.spec.ts —— 对话历史真的落进了库，而且按会话分档
 *
 * 这几条证明的是 #177 / #178 的三件事，单测给不了：
 *   1. 重启后还在。判据走真链路：界面输入框发一句话 → 假模型流式回答 → 收尾落库
 *      → page.reload() 把渲染层进程内状态清零 → 屏幕上重新出现这一问一答，
 *      并且 electronAPI.chatHistory(null) 从主进程读回来的那一行是**完整回答**
 *      （不是流式期那半截）——同 id 覆盖那一笔只有在这里才量得到。
 *   2. 切服务器不串话。把 activeSessionId 换到另一档，屏上那句要消失；
 *      换回来要重新出现。库里也证明两档互不共享。
 *   3. 「清空对话」说了要清，就真清（#178）。按取消一条不少；按清空后屏上没了、
 *      库里那一档也没了、重启还不回来，而别的档不受这一刀影响。
 *
 * 库的读数一律通过 IPC 取，不直连 SQLite 文件：应用还开着时 WAL 没 checkpoint，
 * 只读连接看到的可能是旧快照（这条量具一旦读晚就会假红，见 #105 那一族的教训）。
 *
 * 运行：pnpm build && npx playwright test tests/e2e/chat-history-persistence.spec.ts
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { startAiFixture } from './ai-fixture-server'
import type { AiFixtureHandle } from './ai-fixture-server'
import { FIXTURE_ANSWER } from './ai-fixture-server'
import { bindSessionToStore, launchApp } from './ssh-fixture-helpers'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')
const READY = fs.existsSync(MAIN_ENTRY)
if (!READY) console.log('[chat-history] 跳过：缺 out/main/index.js，先 pnpm build')
const testOrSkip = READY ? test : test.skip

const PROVIDER_ID = 'hist-fixture-model'
const QUESTION = '帮我算一下 1+1'

/** 面板收起时把 AI 停靠格点开（发送按钮在面板里） */
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
            getState: () => { setProviders: (p: unknown[]) => void; setSelectedProviderId: (id: string) => void }
          }
        }
      }
      const ok = await w.electronAPI.providerSave({
        id: cfg.providerId,
        name: '回看验证模型',
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
    { providerId: PROVIDER_ID, baseURL: url }
  )
  expect(saved.ok, 'providerSave 应成功').toBe(true)
  expect(saved.setOk, 'providerSetDefault 应成功').toBe(true)
}

/** 在输入框发一句话并等回答上屏（逐键输入：fill() 不会更新 React state） */
async function askAndAnswer(page: Page, text: string): Promise<void> {
  await ensurePanelOpen(page)
  const composer = page.locator('#ai-composer-input')
  await composer.click()
  await composer.pressSequentially(text)
  await page.getByRole('button', { name: '发送' }).click()
  const list = page.locator('.ai-stream-area')
  await expect(list, '假模型的回答应流式上屏').toContainText(FIXTURE_ANSWER, { timeout: 60_000 })
  await expect(list).toContainText(text)
}

/** 从主进程读回某一档的落库行（走真 IPC，不直连文件） */
function readRows(page: Page, sshSessionId: string | null): Promise<
  Array<{ id: string; role: string; content: string; sshSessionId: string | null }>
> {
  return page.evaluate(async (sid) => {
    const api = (window as unknown as { electronAPI: { chatHistory: (s: string | null) => Promise<unknown> } })
      .electronAPI
    return (await api.chatHistory(sid)) as Array<{
      id: string
      role: string
      content: string
      sshSessionId: string | null
    }>
  }, sshSessionId)
}

/** 屏上此刻的消息行文本（只看消息区，别把引导卡与输入框算进来） */
const screenText = (page: Page): Promise<string> => page.locator('.ai-stream-area').innerText()

async function gotoWorkbench(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '#/workbench'
  })
  await page.waitForSelector('.wb-main-layout', { timeout: 20_000 })
}

test.describe('对话历史落盘与按会话回看', () => {
  test.describe.configure({ mode: 'serial' })

  let ai: AiFixtureHandle

  test.beforeAll(async () => {
    ai = await startAiFixture()
  })

  test.afterAll(async () => {
    await ai.close()
  })

  testOrSkip('问一句答一句后重启，屏幕上这一问一答还在，库里那一行是完整回答', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launchApp()
    await gotoWorkbench(page)
    await configureFixtureModel(page, ai.baseURL)
    // 这一档是跨轮、跨次运行累积的（临时档位目录不重置），所以"库里至少有两行"根本证明不了
    // 本轮那一笔落了库——满足它的可能是上一次运行留下的行，而 `find(role==='assistant')`
    // 取到的也就是那种旧行（2026-10-26 报"半截"时读的就是这么一行，判据没对本轮负责）。
    // 先记基线 id，再等【新出现的】那行助手消息，断言只对它取数。
    const baselineIds = new Set((await readRows(page, null)).map((r) => r.id))
    await askAndAnswer(page, QUESTION)

    /** 本轮新落库的行（基线之外的那些） */
    const freshRows = async () => (await readRows(page, null)).filter((r) => !baselineIds.has(r.id))
    await expect
      .poll(() => freshRows().then((r) => r.filter((x) => x.role === 'assistant').length), {
        message: '本轮的助手消息没有落成新的一行（屏上有字、库里没这一笔）',
        timeout: 20_000,
      })
      .toBeGreaterThanOrEqual(1)

    const rows = await readRows(page, null)
    const beforeIds = rows.map((r) => r.id).sort()
    const answer = (await freshRows()).find((r) => r.role === 'assistant')
    // 红了要当场能分出"落库那笔取的是哪一份文本"：把库里的实际字节、长度、这一行的 id
    // 连同屏上此刻的那篇一起写进消息（2026-10-26 那次红只留下"半截"两个字，什么也判不出来）
    expect(
      answer?.content,
      `库里那行助手消息应是完整回答，不是流式期的半截 —— 库里=${JSON.stringify(answer?.content)}` +
        `（长度 ${String(answer?.content ?? '').length}，id=${answer?.id ?? '无'}），` +
        `屏上=${JSON.stringify(await screenText(page)).slice(0, 200)}`
    ).toBe(FIXTURE_ANSWER)

    // 重启：渲染进程整页重载，内存里那份列表归零，屏上还能看见 = 只能来自库
    await page.reload({ waitUntil: 'domcontentloaded' })
    await gotoWorkbench(page)
    const after = await screenText(page)
    expect(after, '重启后这一问一答没回到屏幕上').toContain(QUESTION)
    expect(after).toContain(FIXTURE_ANSWER)

    const afterIds = (await readRows(page, null)).map((r) => r.id).sort()
    expect(afterIds, '同一条消息落成了第二行（覆盖没生效）').toEqual(beforeIds)

    await app.close()
  })

  testOrSkip('换到另一台服务器的会话，上一档的对话不许还挂在屏上', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launchApp()
    await gotoWorkbench(page)

    // 上一轮留下的那条就在库里（同一档位目录），先证明屏上有它
    await expect.poll(() => screenText(page), { timeout: 20_000 }).toContain(QUESTION)

    await bindSessionToStore(page, 'hist-server', 'hist-session-B')
    await expect
      .poll(() => screenText(page), {
        message: '切到另一台服务器后，本机那档的对话还显示在屏上（串话）',
        timeout: 20_000,
      })
      .not.toContain(QUESTION)

    // 那一档的库里确实没有这条：不是界面藏了，是本来就按会话分档存的
    const other = await readRows(page, 'hist-session-B')
    expect(other.map((r) => r.id), '主进程按另一档取，读到了本机那档的行').toEqual([])

    await page.evaluate(() => {
      const st = (
        window as unknown as {
          __tdsfStores?: { server?: { getState: () => { setActiveSession: (s: string | null) => void } } }
        }
      ).__tdsfStores?.server?.getState()
      st!.setActiveSession(null)
    })
    await expect
      .poll(() => screenText(page), { message: '切回本机那档后对话没有回来', timeout: 20_000 })
      .toContain(QUESTION)

    await app.close()
  })

  testOrSkip('「清空对话」按下去要真清掉落库那一份（取消则一条不少）', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launchApp()
    await gotoWorkbench(page)
    await configureFixtureModel(page, ai.baseURL)
    // 用另一档（某台服务器的会话）来判：这一档每次从零开始，不会被上一条用例留下的记录干扰
    await bindSessionToStore(page, 'clear-server', 'clear-session')
    await askAndAnswer(page, '这一条是要被清掉的')

    await expect
      .poll(() => readRows(page, 'clear-session').then((r) => r.length), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(2)

    // 先按「取消」：弹了确认又反悔，一条都不该少
    await page.getByRole('button', { name: '清空对话' }).click()
    await page.getByRole('button', { name: '取消' }).click()
    expect(await readRows(page, 'clear-session').then((r) => r.length), '按取消却删了东西').toBeGreaterThanOrEqual(2)
    await expect.poll(() => screenText(page)).toContain('这一条是要被清掉的')

    // 再按「清空」：屏上没了，库里也没了，重启还不回来
    await page.getByRole('button', { name: '清空对话' }).click()
    await page.getByRole('button', { name: '清空', exact: true }).click()
    await expect
      .poll(() => readRows(page, 'clear-session').then((r) => r.length), {
        message: '确认清空后库里那一档还有记录（按钮只清了内存）',
        timeout: 20_000,
      })
      .toBe(0)
    await expect.poll(() => screenText(page)).not.toContain('这一条是要被清掉的')

    await page.reload({ waitUntil: 'domcontentloaded' })
    await gotoWorkbench(page)
    await bindSessionToStore(page, 'clear-server', 'clear-session')
    await expect.poll(() => screenText(page), { timeout: 20_000 }).not.toContain('这一条是要被清掉的')

    // 别的档不受这一刀影响：本机那档（第一条用例留下的）还在库里
    expect(await readRows(page, null).then((r) => r.length), '删这一档带走了别的档').toBeGreaterThan(0)

    await app.close()
  })
})

/*
 * 回看失败那一档（屏上说得出原因 + 重试）不放在这里：e2e 要制造读失败，
 * 得开一条 dev-only 的"任意 SQL"通道——那是为了验收往产品里长新入口，
 * 而这条红线本仓记过账（假 affordance）。同一判据在
 * tests/components/workbench/ai-history-error.test.tsx 里挂真 hook + 真 store 跑，
 * 只有 electronAPI 那一层是替身。
 */
