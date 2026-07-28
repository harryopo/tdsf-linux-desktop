/**
 * button-truth-census.spec.ts — 全按钮真伪普查（"按钮测谎仪"）
 *
 * 目的：回答"各个按钮是不是真的"——自动化遍历每个页面的所有可见按钮，
 * 逐个真实点击，观测点击后 600ms 内是否出现可观察反应：
 *
 *   反应信号（按优先级判定）：
 *     route  — 路由跳转（真导航按钮）
 *     dialog — 打开弹窗/抽屉（真交互按钮）
 *     toast  — antd message 提示上屏（有反馈，含"未配置/不支持"类诚实提示）
 *     dom    — 页面 DOM 发生变化（切换筛选/展开面板等真 UI 逻辑）
 *     none   — 无任何反应 → 疑似假按钮/死按钮
 *
 * 安全排除：窗口控制（最小化/最大化/关闭）与破坏性操作（删除/清空/重置/
 * 断开/终止）不点击，只记录为 skipped。
 *
 * 产物：tests/e2e/button-census-report.json + 控制台分页报告。
 * 判定：本 spec 为普查报告型，仅在"疑似死按钮"出现时输出警告清单；
 *       不因 none 直接红（首轮普查先建立基线，由人工确认后再决定是否转硬门禁）。
 *
 * 运行：pnpm build && npx playwright test tests/e2e/button-truth-census.spec.ts
 */
import { test, expect, _electron as electron } from '@playwright/test'
import type { Page } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')
const BUILD_READY = fs.existsSync(MAIN_ENTRY)
const testOrSkip = BUILD_READY ? test : test.skip

/** 报告输出路径 */
const REPORT_PATH = path.join(__dirname, 'button-census-report.json')

/** 普查页面清单（hash 路由 + 就绪选择器） */
const PAGES: Array<{ name: string; hash: string; ready: string }> = [
  { name: '工作台', hash: '#/workbench', ready: '.wb-main-layout' },
  { name: '实时监控', hash: '#/monitor', ready: '.mon-main' },
  { name: '决策历史', hash: '#/history', ready: 'main, .hist-page' },
  { name: '知识库', hash: '#/knowledge', ready: '.kb-page' },
  { name: '决策中心', hash: '#/decision', ready: 'main, body' },
  { name: '教程', hash: '#/tutorial', ready: 'main, body' },
  { name: '日志分析', hash: '#/logs', ready: 'main, body' },
  { name: '设置-通用', hash: '#/settings/general', ready: '.set-page, main' },
  { name: '设置-模型', hash: '#/settings/model', ready: '.set-page, main' },
]

/** 不点击的按钮（窗口控制 + 破坏性操作），只记录 skipped */
const SKIP_PATTERN =
  /最小化|最大化|关闭|还原|退出|删除|清空|重置|恢复默认|断开|终止|停止|卸载|Close|Minimize|Maximize|Quit/i

/** 每页最多普查的按钮数（防止列表类页面爆炸） */
const MAX_BUTTONS_PER_PAGE = 40

interface ButtonResult {
  page: string
  label: string
  verdict: 'route' | 'dialog' | 'toast' | 'dom' | 'none' | 'skipped' | 'disabled' | 'unclickable'
  detail?: string
}

/** 注入 DOM 变化观察器（每次进页面后调用） */
async function injectObserver(window: Page): Promise<void> {
  await window.evaluate(() => {
    const w = window as unknown as { __censusMut?: number; __censusObs?: MutationObserver }
    w.__censusObs?.disconnect()
    w.__censusMut = 0
    const obs = new MutationObserver((records) => {
      w.__censusMut = (w.__censusMut ?? 0) + records.length
    })
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true })
    w.__censusObs = obs
  })
}

/** 读取当前观测快照 */
async function snapshot(window: Page): Promise<{ hash: string; mut: number; toast: number; dialog: number }> {
  return window.evaluate(() => {
    const w = window as unknown as { __censusMut?: number }
    return {
      hash: window.location.hash,
      mut: w.__censusMut ?? 0,
      toast: document.querySelectorAll('.ant-message-notice').length,
      dialog: document.querySelectorAll(
        '.ant-modal:not([style*="display: none"]), .ant-drawer-open, .kb-modal, [role="dialog"]',
      ).length,
    }
  })
}

/** 关闭点击可能打开的弹层（Escape ×2 + 点击遮罩外区域） */
async function closeOverlays(window: Page): Promise<void> {
  await window.keyboard.press('Escape').catch(() => {})
  await window.waitForTimeout(150)
  await window.keyboard.press('Escape').catch(() => {})
  await window.waitForTimeout(150)
}

/** 进入指定页面并注入观察器 */
async function gotoPage(window: Page, hash: string, ready: string): Promise<void> {
  await window.evaluate((h) => {
    window.location.hash = h
  }, hash)
  await window.waitForSelector(ready.split(',')[0].trim(), { timeout: 15000 }).catch(() => {})
  // 等页面首屏请求/动画稳定，降低 DOM 噪声误判
  await window.waitForTimeout(600)
  await injectObserver(window)
}

testOrSkip('全按钮真伪普查（点击后必须有可观察反应）', async () => {
  test.setTimeout(840_000)

  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
  })
  const window = await app.firstWindow()
  await window.waitForSelector('body', { timeout: 30000 })

  const results: ButtonResult[] = []
  // 全局去重：侧边导航/标题栏等公共按钮在每页都出现，只普查一次，
  // 否则 9 页 × 公共钮（含大量 route 型）会反复触发跳转+回跳，耗时爆炸
  const seenGlobal = new Set<string>()

  for (const pageDef of PAGES) {
    await gotoPage(window, pageDef.hash, pageDef.ready)

    // 收集当前页面可见按钮的标识（每轮重新收集，避免点击后 DOM 失效）
    const buttonCount = Math.min(
      await window.locator('button:visible').count(),
      MAX_BUTTONS_PER_PAGE,
    )

    for (let i = 0; i < buttonCount; i++) {
      const btn = window.locator('button:visible').nth(i)

      // 读取按钮身份（aria-label > title > data-dom-id > 文本）
      const label = await btn
        .evaluate((el) => {
          const b = el as HTMLButtonElement
          return (
            b.getAttribute('aria-label') ||
            b.getAttribute('title') ||
            b.getAttribute('data-dom-id') ||
            b.innerText.trim().slice(0, 24) ||
            '(无标识图标按钮)'
          )
        })
        .catch(() => null)
      if (label === null) continue // 按钮已随 DOM 变化消失

      // 全局同名按钮只测一次（公共导航/重复列表项）
      if (seenGlobal.has(label)) continue
      seenGlobal.add(label)

      // disabled 按钮：记录后跳过（disabled 是合法状态，不算假按钮）
      if (await btn.isDisabled().catch(() => false)) {
        results.push({ page: pageDef.name, label, verdict: 'disabled' })
        continue
      }

      // 危险/窗口控制按钮：不点，只记录
      if (SKIP_PATTERN.test(label)) {
        results.push({ page: pageDef.name, label, verdict: 'skipped' })
        continue
      }

      // ==== 点击前快照 → 点击 → 500ms → 点击后快照 ====
      await window.waitForTimeout(120) // 静置，clear 噪声
      const before = await snapshot(window)

      const clicked = await btn
        .click({ timeout: 2000 })
        .then(() => true)
        .catch(() => false)
      if (!clicked) {
        results.push({ page: pageDef.name, label, verdict: 'unclickable', detail: '点击超时/被遮挡' })
        continue
      }

      await window.waitForTimeout(500)
      const after = await snapshot(window)

      // 分类判定（优先级：route > dialog > toast > dom > none）
      let verdict: ButtonResult['verdict']
      let detail: string | undefined
      if (after.hash !== before.hash) {
        verdict = 'route'
        detail = `${before.hash} → ${after.hash}`
      } else if (after.dialog > before.dialog) {
        verdict = 'dialog'
      } else if (after.toast > before.toast) {
        verdict = 'toast'
      } else if (after.mut > before.mut) {
        verdict = 'dom'
        detail = `mutations=${after.mut - before.mut}`
      } else {
        verdict = 'none'
      }
      results.push({ page: pageDef.name, label, verdict, detail })

      // 清理现场：关弹层；若路由跳走则回到普查页面
      if (after.dialog > before.dialog) await closeOverlays(window)
      if (after.hash !== before.hash) {
        await gotoPage(window, pageDef.hash, pageDef.ready)
      }
    }
  }

  await app.close()

  // ==== 输出报告 ====
  fs.writeFileSync(REPORT_PATH, JSON.stringify(results, null, 2), 'utf-8')

  const byVerdict = (v: ButtonResult['verdict']) => results.filter((r) => r.verdict === v)
  const summary = {
    total: results.length,
    route: byVerdict('route').length,
    dialog: byVerdict('dialog').length,
    toast: byVerdict('toast').length,
    dom: byVerdict('dom').length,
    none: byVerdict('none').length,
    disabled: byVerdict('disabled').length,
    skipped: byVerdict('skipped').length,
    unclickable: byVerdict('unclickable').length,
  }

  console.log('\n' + '='.repeat(72))
  console.log('全按钮真伪普查报告')
  console.log('='.repeat(72))
  console.log(JSON.stringify(summary))
  for (const pageDef of PAGES) {
    const rows = results.filter((r) => r.page === pageDef.name)
    if (rows.length === 0) continue
    console.log(`\n■ ${pageDef.name}（${rows.length} 个按钮）`)
    for (const r of rows) {
      const mark =
        r.verdict === 'none' ? '❌' : r.verdict === 'unclickable' ? '⚠️' : r.verdict === 'skipped' || r.verdict === 'disabled' ? '⏭️' : '✅'
      console.log(`  ${mark} [${r.verdict}] ${r.label}${r.detail ? ` (${r.detail})` : ''}`)
    }
  }

  const deadButtons = byVerdict('none')
  if (deadButtons.length > 0) {
    console.log('\n❌ 疑似假按钮（点击后无任何可观察反应）：')
    for (const r of deadButtons) console.log(`  - [${r.page}] ${r.label}`)
  }
  console.log('\n完整报告已写入: ' + REPORT_PATH)

  // 至少要普查到按钮（防止选择器全挂造成"0 按钮全通过"假绿）
  expect(summary.total, '普查应至少覆盖 30 个按钮').toBeGreaterThan(30)
})
