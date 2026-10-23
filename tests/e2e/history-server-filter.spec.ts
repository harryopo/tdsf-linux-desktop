/**
 * 决策历史"服务器"这一列：显示、下拉、筛选、搜索必须是同一份读数（任务 #175-①）
 *
 * 抓到的真缺陷：那一格原先显示的是 `会话 xxxx` / `'local'`，而下拉选项来自 stats.servers
 * 里的真 serverId——两边写法不同，选任何一个服务器都得到空列表，界面还一本正经地
 * 说"这个服务器没有记录"。现在四处都由 serverLabel() 派生，这一条钉在真窗口里：
 *   1. 落库带 serverId 的记录，那一格显示 serverId 的前缀，不冒充别的机器；
 *   2. 没记 serverId 的那条，那一格写「未记录」；
 *   3. 下拉里的每一项选中后都必须筛得出行，且留下的每行等于选中项；
 *   4. 搜索框按那一格的文字能命中对应行。
 *
 * 本档位不是每轮全新的（上一轮写的行还在库里），所以不断言绝对行数：
 * 每轮用一次性 tag 命名自己的两条，只按 tag 找自己那两行，其余一律按"全等"判。
 *
 * skip 不等于通过：没有 out/main/index.js 就先 pnpm build。
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { FIXTURE_READY, launchApp } from './ssh-fixture-helpers'
import type { HistorySaveIntent } from '@shared/models'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
const testOrSkip = FIXTURE_READY && BUILD_READY ? test : test.skip

if (!testOrSkip) {
  console.log('[history-server-filter] 跳过：需要 out/main/index.js（先 pnpm build）。skip 不等于通过。')
}

/** 库里那个 e2e 档位没配过服务器，所以这个 id 在界面上应显示成「服务器 e2esrv00」 */
const SERVER_ID = 'e2esrv0001-fixture'
const SERVER_CELL = '服务器 e2esrv00'
const NO_SERVER_CELL = '未记录'
/** 本轮专属 tag：让"我的那两行"在任何遗留数据里都唯一可认 */
const TAG = `r${Date.now().toString(36)}`

function intent(kind: 'srv' | 'nosid'): HistorySaveIntent {
  const serverId = kind === 'srv' ? SERVER_ID : undefined
  return {
    command: `journalctl --vacuum-size=200M # ${TAG}-${kind}`,
    problem: `磁盘快满了 ${TAG}-${kind}`,
    hypothesis: 'journal 日志占用过大，收缩即可释放',
    evidences: [
      {
        id: `ev-${TAG}-${kind}`,
        source: 'command',
        sourceDetail: 'df -h /var',
        content: '/dev/sda2 92% 使用率',
        drainMatch: null,
        sourcePrior: 0.9,
        confidence: 0.9,
        timestamp: Date.now() - 60_000,
        verified: true,
      },
    ],
    executed: true,
    fixDescription: `收缩 journal 到 200M ${TAG}-${kind}`,
    ...(serverId ? { serverId } : {}),
  }
}

testOrSkip('服务器列与下拉/筛选/搜索同源：选了必筛得出，且每行等于选中项', async () => {
  test.setTimeout(150_000)
  const { app, page } = await launchApp()

  const rowsByText = (text: string) =>
    page.locator('[data-dom-id="history-row"]', { hasText: text })
  const cellOf = (row: ReturnType<typeof rowsByText>) =>
    row.locator('[data-dom-id="history-server-cell"]').innerText()
  const visibleCells = () =>
    page.locator('[data-dom-id="history-server-cell"]').allInnerTexts()

  try {
    for (const kind of ['srv', 'nosid'] as const) {
      const ok = await page.evaluate((i) => window.electronAPI.historySave(i), intent(kind))
      expect(ok, `history:save 没写成（${kind}）`).toBe(true)
    }

    await page.evaluate(() => {
      window.location.hash = '#/history'
    })
    await expect(rowsByText(`${TAG}-srv`)).toHaveCount(1, { timeout: 25_000 })
    await expect(rowsByText(`${TAG}-nosid`)).toHaveCount(1)

    // 1 + 2：两条各自的那一格
    expect(await cellOf(rowsByText(`${TAG}-srv`)), '认不出的 serverId 不许被演成别的').toBe(SERVER_CELL)
    expect(await cellOf(rowsByText(`${TAG}-nosid`))).toBe(NO_SERVER_CELL)
    // 老写法（会话号 / local）不许复活
    for (const c of await visibleCells()) {
      expect(c, '那一格里出现了会话号或 local').not.toMatch(/会话|^local$/i)
    }

    const select = page.locator('[data-dom-id="history-server-filter"]')
    const options = await select.locator('option').allInnerTexts()
    expect(options, '下拉里没有当前页那两格对应的选项').toContain(SERVER_CELL)
    expect(options).toContain(NO_SERVER_CELL)

    // 3 核心那条：每个选项选中后都必须筛得出行，且留下的每行等于选中项
    for (const opt of options) {
      await select.selectOption(opt)
      await page.waitForTimeout(250)
      const cells = await visibleCells()
      if (opt === '全部服务器') {
        expect(cells.length, '「全部服务器」筛出了 0 行').toBeGreaterThan(0)
        continue
      }
      expect(cells.length, `选中「${opt}」筛出 0 行＝选项与谓词不是同一份读数`).toBeGreaterThan(0)
      for (const c of cells) expect(c, `选中「${opt}」却留下了「${c}」那一行`).toBe(opt)
    }

    // 4：搜索框也走同一个读数（TAG 不在标题/命令里，命中只能来自那一格）
    await select.selectOption('全部服务器')
    await page.locator('[data-dom-id="search-history"]').fill('e2esrv00')
    await page.waitForTimeout(400)
    const found = await visibleCells()
    expect(found.length, '按那一格的文字搜，搜不到自己刚写的那行').toBeGreaterThan(0)
    for (const c of found) expect(c).toBe(SERVER_CELL)
  } finally {
    await app.close()
  }
})
