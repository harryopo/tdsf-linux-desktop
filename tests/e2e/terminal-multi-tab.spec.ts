/**
 * 多终端标签（W2 的交付物判据）
 *
 * 要证的三件事，都是"一条连接只有一个 shell"时期做不到的：
 *   1. 同一条 SSH 连接上能真开两个终端，两个标签都在
 *   2. 往当前那个终端敲字，只有它收到（另一个终端的流里不许出现这串标记）
 *   3. 关掉一个标签，另一个还在收流；关掉最后一个只剩空态（空态必须给主行动）
 *
 * 靶子是本机自研的假 SSH 服务（tests/e2e/ssh-fixture-server.ts）：它对**每条通道**都会
 * 回声 `fixture 输出：<命令>`，所以"谁收到了什么"是真链路上的可判定事实，不是本地拼的。
 * known_hosts 指向本次专用临时文件，绝不碰用户真实的 ~/.ssh/known_hosts。
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startSshFixture } from './ssh-fixture-server'
import type { FixtureHandle } from './ssh-fixture-server'
import {
  FIXTURE_READY,
  bindSessionToStore,
  connectToFixture,
  launchApp,
  openShellViaIpc,
} from './ssh-fixture-helpers'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
const testOrSkip = FIXTURE_READY && BUILD_READY ? test : test.skip

if (!testOrSkip) {
  console.log(
    '[multi-tab] 跳过：需要假 SSH 靶子的前置条件成立且已 pnpm build' +
      '（skip 不等于通过，跑法见 ssh-fixture-server.ts 文件头）。',
  )
}

/** 本次运行专属的 known_hosts（只删我自己造的这一个） */
const KNOWN_HOSTS = path.join(os.tmpdir(), `tdsf-e2e-multitab-known_hosts-${process.pid}.txt`)

test.describe('同一条连接开两个终端', () => {
  let fixture: FixtureHandle

  test.beforeAll(async () => {
    fixture = await startSshFixture()
    fs.writeFileSync(KNOWN_HOSTS, '', 'utf8')
  })

  test.afterAll(async () => {
    await fixture.close()
    if (fs.existsSync(KNOWN_HOSTS)) fs.unlinkSync(KNOWN_HOSTS)
  })

  testOrSkip('两个终端各自收流，关掉一个不影响另一个', async () => {
    test.setTimeout(150_000)
    const { app, page } = await launchApp()

    try {
      // 首次连接要认主机密钥。这里按【真实路径】点弹窗里的按钮：
      // 从旁边替它应答（installHostKeyRecorder）会让界面那个弹窗一直开着，
      // 它的遮罩是 fixed inset-0，后面每一次点击都被它拦住。
      const connPromise = connectToFixture(page, {
        port: fixture.port,
        id: 'fixture-multi',
        knownHostsPath: KNOWN_HOSTS,
      })
      await page.waitForSelector('[role="dialog"]', { timeout: 20000 })
      await page.getByRole('button', { name: '保存并继续' }).click()
      const conn = await connPromise
      const sessionId = conn.sessionId as string
      expect(sessionId, `连不上假靶机：${conn.error ?? ''}`).toBeTruthy()

      await bindSessionToStore(page, 'fixture-multi', sessionId)
      await page.evaluate(() => {
        window.location.hash = '#/workbench'
      })
      await page.waitForSelector('.wb-main-layout', { timeout: 15000 })

      // 按 shellId 分别记账：红了能直接看出是哪个终端收到了什么
      await page.evaluate(() => {
        const w = window as unknown as {
          __byShell?: Record<string, string>
          electronAPI: {
            onTerminalData: (cb: (shellId: string, data: string) => void) => () => void
          }
        }
        w.__byShell = {}
        w.electronAPI.onTerminalData((shellId, data) => {
          const bag = w.__byShell ?? {}
          bag[shellId] = (bag[shellId] ?? '') + data
          w.__byShell = bag
        })
      })

      const readBag = async (): Promise<Record<string, string>> =>
        page.evaluate(
          () => (window as unknown as { __byShell?: Record<string, string> }).__byShell ?? {},
        )

      /**
       * 标签条当前的 shellId，按 DOM 顺序。
       *
       * 判据一律拿这个当身份基准，不用"第几个收到数据的 shellId"：对账把裸 IPC
       * 那条终端捞回来时是追加到数组尾部的，于是"位置 1 的标签"和"后开的那条通道"
       * 可以不是同一个 shell。之前这行混用过，红了看起来像"关错终端"，其实是测试
       * 把两个概念当一个用。
       */
      const tabShellIds = async (): Promise<string[]> =>
        (await page.$$eval('.term-tab-item [data-tab-id]', (els) =>
          els.map((e) => e.getAttribute('data-tab-id') ?? ''),
        )).map((id) => (id.startsWith('shell:') ? id.slice('shell:'.length) : id))

      /**
       * 红了先看现场：标签条上的 / 主进程那张表里的 / 收到过输出的，三份一比
       * 就知道是"对账没把标签补出来"还是"补出来又被摘掉了"——这两种是不同缺陷，
       * 光看 toHaveCount(1) 分不出来。
       */
      const snapshot = async (): Promise<{ dom: string[]; main: string[]; dataSeen: string[] }> => {
        const dom = await tabShellIds()
        const main = (await page.evaluate(
          (sid) =>
            (
              window as unknown as {
                electronAPI: { sshShellList: (s: string) => Promise<string[]> }
              }
            ).electronAPI.sshShellList(sid),
          sessionId
        )) as string[]
        return { dom, main, dataSeen: Object.keys(await readBag()) }
      }

      const first = await openShellViaIpc(page, sessionId)
      // ↑ 故意走裸 IPC 而不是界面：模拟"这终端不是本窗口点开的"（另一个窗口开的、
      // 页面重载前就存在的）。标签必须自己被对账捞出来，捞不出来就是缺陷。
      // 第二个走真实用户路径：标签条上的 + → "在这台主机再开一个终端"
      await page.click('[data-dom-id="workbench-new-terminal"]')
      // 按 menuitem 角色点：同一句文案在空态里还有一个同名按钮，getByText 会撞成两个
      await page.getByRole('menuitem', { name: '在这台主机再开一个终端' }).click()

      try {
        await expect(page.locator('.term-tab-item')).toHaveCount(2, { timeout: 15000 })
      } catch (err) {
        const now = await snapshot()
        // 再看一眼：一直只有一个 = 从没补出来；先有两个后来剩一个 = 被过期对账摘掉
        await page.waitForTimeout(3000)
        const later = await snapshot()
        throw new Error(
          `${(err as Error).message}\n现场（立即）：${JSON.stringify(now)}\n现场（+3s）：${JSON.stringify(later)}`
        )
      }
      // 同主机第二个标签必须带编号：两个都叫同一个名字，用户分不清往哪敲
      await expect(page.locator('.term-tab-item').nth(1)).toContainText('2')

      // 两条通道都开过场（假靶机每条通道都吐一个完整命令块）
      await expect
        .poll(
          async () => {
            const bag = await readBag()
            return (
              (bag[first] ?? '').includes('tdsf-boot') &&
              (await tabShellIds()).every((id) => (bag[id] ?? '').includes('tdsf-boot'))
            )
          },
          { message: '两条通道都该收到自己的开场输出', timeout: 20000 },
        )
        .toBe(true)

      const [keepId, closeId] = await tabShellIds()
      expect(new Set([keepId, closeId]).size, '两个标签必须是两条不同通道').toBe(2)
      expect([keepId, closeId], '标签里的 shellId 该包含裸 IPC 开的那条').toContain(first)

      // 往"当前终端"（活跃标签）敲一条带标记的命令 —— 只有它能收到
      const MARK = 'tdsf-multi-tab-mark'
      const activeId = (
        await page.$eval('.term-tab-item-active [data-tab-id]', (el) =>
          (el.getAttribute('data-tab-id') ?? '').replace(/^shell:/, ''),
        )
      ).trim()
      await page.click('.terminal-view.visible')
      await page.keyboard.type(`echo ${MARK}\r`)

      await expect
        .poll(
          async () => {
            const bag = await readBag()
            return Object.entries(bag)
              .filter(([, text]) => text.includes(`fixture 输出：echo ${MARK}`))
              .map(([id]) => id)
          },
          {
            message: `标记只该出现在活跃终端里，实际记账=${JSON.stringify(await readBag())}`,
            timeout: 20000,
          },
        )
        .toEqual([activeId])

      // 关掉位置 1 那个标签：留下的那条必须还活着、还在收，被关的那条必须真关掉
      await page.locator('.term-tab-item').nth(1).locator('.term-tab-close').click()
      await expect(page.locator('.term-tab-item')).toHaveCount(1)
      const remaining = await tabShellIds()
      expect(remaining, '留下的标签必须是没被点关的那条通道').toEqual([keepId])
      /** 主进程侧还开着的 shellId：标签关掉了通道有没有真关掉，只有它能证明 */
      const listMainShells = async (): Promise<string[]> =>
        (
          await page.evaluate(
            (sid) =>
              (
                window as unknown as {
                  electronAPI: { sshShellList: (id: string) => Promise<string[]> }
                }
              ).electronAPI.sshShellList(sid),
            sessionId,
          )
        ).sort()

      await expect
        .poll(
          async () => await listMainShells(),
          {
            message: `关掉 ${closeId} 后主进程只剩 ${keepId}，实际还在=${JSON.stringify(
              await listMainShells(),
            )}`,
            timeout: 15000,
          },
        )
        .toEqual([keepId])

      await page.click('.terminal-view.visible')
      await page.keyboard.type('uptime\r')
      await expect
        .poll(
          async () => {
            const bag = await readBag()
            return (bag[keepId] ?? '').includes('fixture 输出：uptime')
          },
          { message: '关掉一个终端后，剩下的那个必须还在收', timeout: 20000 },
        )
        .toBe(true)

      // 关掉最后一个 → 空态必须给主行动按钮，不许只留一行灰字
      await page.locator('.term-tab-item').nth(0).locator('.term-tab-close').click()
      await expect(page.locator('.term-tab-item')).toHaveCount(0)
      // 连着服务器时空态的主行动是"在这台主机开一个终端"（W3 起本机终端是另一个按钮）
      await expect(
        page.getByRole('button', { name: '在这台主机开一个终端', exact: true }),
      ).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
