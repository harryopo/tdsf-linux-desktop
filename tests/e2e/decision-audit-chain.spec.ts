/**
 * 决策审计链在真应用里真的落库、真的读得出来（任务 #174 的界面侧落锤）
 *
 * 单测覆盖了"仓储能算链能验断"和"save 会写审计行"，这条 spec 覆盖的是用户那一段：
 * 走真 preload → 真 ipcMain → 真 SQLite（e2e 专用 profile 的库），
 * 然后在两个详情页看那张表——表里的行必须是库里那一份，不是界面自己排的。
 *
 * 判据拿的是界面文字与库里读数对上，不是截图：
 *   1. history:save 之后 history:audit 有行且 intact；
 *   2. 历史详情页「操作日志」列出的行数 = 库里行数，行号 #N 也一致；
 *   3. 徽章说的是"链校验通过 · N 行"，页面上不再出现"逐行可验证篡改"那种它证明不了的承诺。
 *
 * skip 不等于通过：没有 out/main/index.js 就先 pnpm build。
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { FIXTURE_READY, launchApp } from './ssh-fixture-helpers'
import type { DecisionAuditView, HistorySaveIntent } from '@shared/models'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
const testOrSkip = FIXTURE_READY && BUILD_READY ? test : test.skip

if (!testOrSkip) {
  console.log('[decision-audit-chain] 跳过：需要 out/main/index.js（先 pnpm build）。skip 不等于通过。')
}

/** 一条会被主进程判为合法的最小意图：两条已溯源证据 + 一条低风险命令 */
const INTENT: HistorySaveIntent = {
  command: 'journalctl --vacuum-size=200M',
  problem: '磁盘快满了',
  hypothesis: 'journal 日志占用过大，收缩即可释放',
  evidences: [
    {
      id: 'ev-df',
      source: 'command',
      sourceDetail: 'df -h /var',
      content: '/dev/sda2 92% 使用率',
      drainMatch: null,
      sourcePrior: 0.9,
      confidence: 0.9,
      timestamp: Date.now() - 60_000,
      verified: true,
    },
    {
      id: 'ev-log',
      source: 'log',
      sourceDetail: '/var/log/syslog',
      content: 'No space left on device',
      drainMatch: 0.62,
      sourcePrior: 0.7,
      confidence: 0.7,
      timestamp: Date.now() - 30_000,
      verified: true,
    },
  ],
  executed: true,
  fixDescription: '收缩 journal 到 200M',
}

testOrSkip('审计链：落库 → 读数 → 历史详情页把库里那五行画出来', async () => {
  test.setTimeout(150_000)
  const { app, page } = await launchApp()

  try {
    const saved = await page.evaluate((intent) => window.electronAPI.historySave(intent), INTENT)
    expect(saved, 'history:save 返回 false＝卡片或审计链没写成').toBe(true)

    const cards = await page.evaluate(() => window.electronAPI.historyList(1, 1))
    expect(cards.length, '刚落库的决策读不回来').toBe(1)
    const id = cards[0].id

    const view: DecisionAuditView = await page.evaluate(
      (decisionId) => window.electronAPI.historyAudit(decisionId),
      id
    )
    // 2 条证据 + 风险评估 + 人工批准 + 发送终端
    expect(view.rows.length, `审计行数 ${view.rows.length}，少于 5 行＝事件没记全`).toBeGreaterThanOrEqual(5)
    expect(view.intact, '刚写进去的链必须验得过').toBe(true)
    expect(view.rows.map((r) => r.actor)).toContain('Risk Engine')
    expect(view.rows.map((r) => r.action).join('\n')).toContain('证据落定 · df -h /var')

    await page.evaluate((target) => {
      window.location.hash = `#/history/${target}`
    }, id)

    const section = page.locator('[data-dom-id="audit-chain-section"]')
    await expect(section, '历史详情页没渲染出操作日志那一卡').toBeVisible({ timeout: 25_000 })
    const badge = page.locator('[data-dom-id="audit-chain-badge"]')
    await expect(badge, '徽章没报"链校验通过"＝界面读的不是库里那份或读失败').toContainText(
      `链校验通过 · ${view.rows.length} 行`
    )

    const rowCount = await page.locator('[data-dom-id="audit-row"]').count()
    expect(rowCount, '界面行数与库里行数不一致').toBe(view.rows.length)
    // 行号直接来自库里那一列，界面没有自己从 1 数一遍
    await expect(
      page.locator('[data-dom-id="audit-row"]').first(),
      '第一行没带上库里那个行号'
    ).toContainText(`#${view.rows[0].seq}`)

    // 它证明不了的承诺不许留在界面上：哈希是写入时算的，能证明的只有"之后没被动过"
    const body = await page.locator('body').innerText()
    expect(body).not.toContain('逐行可验证篡改')
  } finally {
    await app.close()
  }
})

testOrSkip('决策详情页读的也是库里那份链（两个入口同一张表）', async () => {
  test.setTimeout(150_000)
  const { app, page } = await launchApp()

  try {
    await page.evaluate((intent) => window.electronAPI.historySave(intent), INTENT)
    const cards = await page.evaluate(() => window.electronAPI.historyList(1, 1))
    const id = cards[0].id

    await page.evaluate((target) => {
      window.location.hash = `#/decision/${target}`
    }, id)

    const section = page.locator('[data-dom-id="audit-chain-section"]')
    await expect(section, '决策详情页没渲染出决策审计日志').toBeVisible({ timeout: 25_000 })
    await expect(section).toHaveAttribute('data-audit-status', 'ok')
    await expect(page.locator('[data-dom-id="audit-row"]').first()).toContainText(
      '证据落定 · df -h /var'
    )
  } finally {
    await app.close()
  }
})
