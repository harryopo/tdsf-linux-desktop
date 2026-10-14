/**
 * button-truth-census.spec.ts — 全按钮真伪普查（"按钮测谎仪"）
 *
 * 目的：回答"各个按钮是不是真的"——自动化遍历每个页面的所有可见按钮，
 * 逐个真实点击，观测点击后 600ms 内是否出现可观察反应：
 *
 *   反应信号（按优先级判定）：
 *     route  — 路由跳转（真导航按钮）
 *     dialog — 打开弹窗/抽屉（真交互按钮）
 *     toast  — sonner 提示上屏（有反馈，含"未配置/不支持"类诚实提示）
 *     focus  — 焦点换到别的元素（"聚焦终端"这类只挪光标的按钮，DOM 可以一点不动）
 *     dom    — 页面 DOM 发生变化（切换筛选/展开面板等真 UI 逻辑）
 *     none   — 无任何反应 → 假按钮/死按钮
 *   另有四类不算假按钮的合法态：disabled（禁用）、already-active（切换钮已处于
 *   选中态，再点本就不该有反应）、skipped（破坏性/窗口控制）、
 *   unreached（前面的按钮把界面换了，这一轮没轮到它）
 *
 * 安全排除：窗口控制（最小化/最大化/关闭）与破坏性操作（删除/清空/重置/
 * 断开/终止）不点击，只记录为 skipped。
 *
 * 产物：tests/e2e/button-census-report.json + 控制台分页报告。
 * 判定：三条硬门禁——none 为 0、unclickable 为 0、真点出反应的按钮 ≥40
 *       （最后一条是量具自证：万一循环空转，前两条会假绿）。
 *       2026-10-07 跑到绿灯一共六轮，每轮的病因都记在这里，免得下一个人重查：
 *       · none 11→0：只读状态格改成 span（不再伪装按钮）；教程「查看全部学习路径」
 *         删除（没有第二个视图可去，改为把全部路径平铺）；空检索词的「搜索」改 disabled；
 *         当前页码/当前分类/终端 tab 补 aria-pressed 或 aria-selected；状态栏在没有
 *         会话时不再写死一个 'main' 并声称能聚焦终端。
 *       · unclickable 22→0：两个都是量具自己的病——locator.nth(i) 每次动作重新解析，
 *         于是「检查的是 A、点下去的是 B」；以及命令面板遮罩没写 role=dialog，
 *         普查看不见它开着，此后整页按钮都被它挡住。两边都修（面板补 role，
 *         普查每轮清现场并改用 ElementHandle + 每轮重新取列表）。
 *
 * 运行：pnpm build && npx playwright test tests/e2e/button-truth-census.spec.ts
 */
import { test, expect, _electron as electron } from '@playwright/test'
import type { ElementHandle, Page } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'
import { e2eProfileDir } from './ssh-fixture-helpers'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')
const BUILD_READY = fs.existsSync(MAIN_ENTRY)
const testOrSkip = BUILD_READY ? test : test.skip

/** 报告输出路径 */
const REPORT_PATH = path.join(__dirname, 'button-census-report.json')

/** 普查页面清单（hash 路由 + 就绪选择器） */
const PAGES: Array<{ name: string; hash: string; ready: string }> = [
  { name: '工作台', hash: '#/workbench', ready: '.wb-main-layout' },
  { name: '实时监控', hash: '#/monitor', ready: '[data-dom-id="page-title"]' },
  { name: '决策历史', hash: '#/history', ready: 'main, .hist-page' },
  { name: '知识库', hash: '#/knowledge', ready: '.kb-page' },
  { name: '决策中心', hash: '#/decision', ready: 'main, body' },
  { name: '教程', hash: '#/tutorial', ready: 'main, body' },
  { name: '日志分析', hash: '#/logs', ready: 'main, body' },
  { name: '设置-通用', hash: '#/settings/general', ready: '.set-page, main' },
  { name: '设置-模型', hash: '#/settings/model', ready: '.set-page, main' },
]

/**
 * 不点击的按钮（窗口控制 + 破坏性操作），只记录 skipped
 *
 * "新建窗口"也归进来：它开的是操作系统级的另一个窗口，本普查只看当前页面，
 * 点了既判不出反应，又会让后面几十个按钮因焦点与负载变化误报"点不下去"（实测会飘）。
 * 它的真实行为由 tests/e2e/second-window.spec.ts 判（两个窗口共用同一张终端表）。
 */
const SKIP_PATTERN =
  /最小化|最大化|关闭|还原|退出|新建窗口|删除|清空|重置|恢复默认|断开|终止|停止|卸载|Close|Minimize|Maximize|Quit/i

/** 每页最多普查的按钮数（防止列表类页面爆炸）；也是一页允许的最大轮次 */
const MAX_BUTTONS_PER_PAGE = 40

interface ButtonResult {
  page: string
  label: string
  verdict:
    | 'route'
    | 'dialog'
    | 'toast'
    | 'focus'
    | 'dom'
    | 'none'
    | 'skipped'
    | 'disabled'
    | 'already-active'
    | 'unclickable'
    | 'unreached'
  detail?: string
}

/** 按钮身份（aria-label > title > data-dom-id > 文本）；节点已脱离文档返回 null */
// 形参用 ElementHandle<Node>：locator('button:visible').elementHandles() 给出的就是
// Node 型句柄，声明成 HTMLButtonElement 会在赋值处对不上（选择器已经保证是 button，
// 页面内那一句 as HTMLButtonElement 才是真收窄的地方）。
async function readLabel(
  btn: ElementHandle<Node>,
): Promise<string | null> {
  return btn
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
}

/** 按钮当前是否处于"已经按下"的状态（这类钮再点本就不该有反应） */
async function readActiveState(btn: ElementHandle<Node>): Promise<string | null> {
  return btn
    .evaluate((el) => {
      const b = el as HTMLElement
      if (b.getAttribute('aria-pressed') === 'true') return 'aria-pressed'
      if (b.getAttribute('aria-selected') === 'true') return 'aria-selected'
      // 导航项的"已经在这页"用的是 aria-current="page"（activity-rail / NavLink 都这么标）。
      // 不认它，就会把"点当前页的入口"当成该有反应的按钮——再点本就不该有任何变化。
      const cur = b.getAttribute('aria-current')
      if (cur === 'page' || cur === 'true' || cur === 'location') return `aria-current=${cur}`
      const ds = b.getAttribute('data-state')
      if (ds === 'active' || ds === 'on' || ds === 'checked') return `data-state=${ds}`
      return null
    })
    .catch(() => null)
}

/** 注入 DOM 变化观察器（每次进页面后调用） */
async function injectObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
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
async function snapshot(
  page: Page,
): Promise<{ hash: string; mut: number; toast: number; dialog: number; focus: string }> {
  return page.evaluate(() => {
    const w = window as unknown as { __censusMut?: number }
    // 焦点变化不会有 DOM 变更，"聚焦终端"这类按钮只动焦点——不采这一路就会被当死按钮
    const a = document.activeElement
    const focus = a ? `${a.tagName}.${(a.getAttribute('class') || '').split(/\s+/)[0] || ''}` : ''
    return {
      hash: window.location.hash,
      mut: w.__censusMut ?? 0,
      focus,
      // sonner 的 toast 节点（antd message 已随 antd 一起退场，旧选择器恒为 0，
      // 会把"只弹提示"的按钮误判成假按钮）
      toast: document.querySelectorAll('[data-sonner-toast]').length,
      dialog: document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length,
    }
  })
}

/** 关闭点击可能打开的弹层（Escape ×2 + 点击遮罩外区域） */
async function closeOverlays(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(150)
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(150)
}

/** 进入指定页面并注入观察器；返回就绪选择器是否真的命中（白屏不许当"已普查"） */
async function gotoPage(page: Page, hash: string, ready: string): Promise<boolean> {
  // 回调里的 window 是浏览器全局，不是这里的 Page —— 形参别再叫 window 才会遮蔽它（#107 第一族的尾巴）
  await page.evaluate((h) => {
    window.location.hash = h
  }, hash)
  const ok = await page
    .waitForSelector(ready.split(',')[0].trim(), { timeout: 15000 })
    .then(() => true)
    .catch(() => false)
  // 等页面首屏请求/动画稳定，降低 DOM 噪声误判
  await page.waitForTimeout(600)
  await injectObserver(page)
  return ok
}

testOrSkip('全按钮真伪普查（点击后必须有可观察反应）', async () => {
  test.setTimeout(840_000)

  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${e2eProfileDir()}`],
    env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
  })
  const mainWin = await app.firstWindow()
  await mainWin.waitForSelector('body', { timeout: 30000 })

  const results: ButtonResult[] = []
  // 全局去重：侧边导航/标题栏等公共按钮在每页都出现，只普查一次，
  // 否则 9 页 × 公共钮（含大量 route 型）会反复触发跳转+回跳，耗时爆炸
  const seenGlobal = new Set<string>()

  for (const pageDef of PAGES) {
    const ready = await gotoPage(mainWin, pageDef.hash, pageDef.ready)
    expect(ready, `${pageDef.name} 就绪选择器 ${pageDef.ready} 未命中（白屏或选择器已过期）`).toBe(
      true,
    )

    // 一轮只点一个按钮，点完重新取句柄列表。这里踩过两个相反的坑：
    //   locator.nth(i) 每次动作都重新解析——检查 disabled 的是 A，点下去可能已是 B；
    //   一次性抓完全部句柄再逐个点——遇到会重渲染的页面（知识库卡片、教程分类、
    //     收起 AI 面板），剩下的句柄全是脱离文档的旧节点，一轮报出 52 个"点不下去"。
    const laidEyesOn = new Set<string>()
    let rounds = 0

    while (rounds++ < MAX_BUTTONS_PER_PAGE) {
      const handles = await mainWin.locator('button:visible').elementHandles()
      let btn: ElementHandle<Node> | null = null
      let label = ''
      for (const h of handles) {
        const id = await readLabel(h)
        if (id === null) continue
        laidEyesOn.add(id)
        if (seenGlobal.has(id)) continue
        btn = h
        label = id
        break
      }
      if (!btn) break // 这一页没有未普查的按钮了
      seenGlobal.add(label)

      // disabled 按钮：记录后跳过（disabled 是合法状态，不算假按钮）
      const isDisabled = await btn
        .evaluate((el) => (el as HTMLButtonElement).disabled)
        .catch(() => false)
      if (isDisabled) {
        results.push({ page: pageDef.name, label, verdict: 'disabled' })
        continue
      }

      // 已处于按下/选中态的切换钮（当前分类、当前页码、已经打开的面板）：
      // 再点一次本来就该没反应，报成假按钮等于工具在喊狼
      const activeState = await readActiveState(btn)
      if (activeState) {
        results.push({ page: pageDef.name, label, verdict: 'already-active', detail: activeState })
        continue
      }

      // 危险/窗口控制按钮：不点，只记录
      if (SKIP_PATTERN.test(label)) {
        results.push({ page: pageDef.name, label, verdict: 'skipped' })
        continue
      }

      // ==== 点击前快照 → 点击 → 500ms → 点击后快照 ====
      await mainWin.waitForTimeout(120) // 静置，clear 噪声
      const before = await snapshot(mainWin)

      // 点不下去先清现场再重试一次：全量跑时同机负载会把 Playwright 的可操作性等待
      // 顶过 2 秒（实测单跑 0 个、全量跑 9 个"点不下去"，且都是同一批按钮）。
      // 判据没放松——真有遮罩的按钮清完还是点不下去，第二次照样记 unclickable。
      let clicked = await btn
        .click({ timeout: 2000 })
        .then(() => true)
        .catch(() => false)
      if (!clicked) {
        await closeOverlays(mainWin)
        await mainWin.waitForTimeout(200)
        clicked = await btn
          .click({ timeout: 2000 })
          .then(() => true)
          .catch(() => false)
      }
      if (!clicked) {
        results.push({ page: pageDef.name, label, verdict: 'unclickable', detail: '清现场后仍点不下去' })
        continue
      }

      // 看出反应为止，最多再等 2.5 秒。固定 500ms 窗口在并行跑（同机 6 个 Electron 实例抢 CPU）下
      // 会把"慢半拍的真反应"报成假按钮：全量跑一次报出 16 个点不下去，单跑同样的按钮 0 个。
      // 判据本身没放松——真没反应的按钮等满 2.5 秒照样是 none。
      let after = await snapshot(mainWin)
      for (let waited = 0; waited < 2500; waited += 150) {
        if (after.hash !== before.hash || after.mut > before.mut) break
        await mainWin.waitForTimeout(150)
        after = await snapshot(mainWin)
      }

      // 焦点信号只认"焦点被交给了别的元素"。点任何按钮都会把焦点落在这个按钮自身上，
      // 若按 before/after 的焦点差异来判，每个死按钮都会被判成有反应——门禁就废了。
      const focusMovedOffSelf = await btn
        .evaluate((el) => {
          const a = document.activeElement
          if (!a || a === el || a === document.body || a === document.documentElement) return false
          return true
        })
        .catch(() => false)

      // 分类判定（优先级：route > dialog > toast > focus > dom > none）
      let verdict: ButtonResult['verdict']
      let detail: string | undefined
      if (after.hash !== before.hash) {
        verdict = 'route'
        detail = `${before.hash} → ${after.hash}`
      } else if (after.dialog > before.dialog) {
        verdict = 'dialog'
      } else if (after.toast > before.toast) {
        verdict = 'toast'
      } else if (focusMovedOffSelf) {
        verdict = 'focus'
        detail = `焦点交给 ${after.focus}`
      } else if (after.mut > before.mut) {
        verdict = 'dom'
        detail = `mutations=${after.mut - before.mut}`
      } else {
        verdict = 'none'
      }
      results.push({ page: pageDef.name, label, verdict, detail })

      // 清理现场：每个按钮都从干净页面测起，否则上一个按钮留下的遮罩会连锁误报；
      // 若路由跳走则回到普查页面
      await closeOverlays(mainWin)
      if (after.hash !== before.hash) {
        await gotoPage(mainWin, pageDef.hash, pageDef.ready)
      }
    }

    // 点过别的按钮后这页换了副面孔（面板收起、列表重排），之前看到却一直没轮到的
    // 控件如实报 unreached——不报就等于把"没测到"混进"测过了"
    for (const id of laidEyesOn) {
      if (!results.some((r) => r.label === id)) {
        results.push({ page: pageDef.name, label: id, verdict: 'unreached' })
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
    focus: byVerdict('focus').length,
    dom: byVerdict('dom').length,
    none: byVerdict('none').length,
    disabled: byVerdict('disabled').length,
    'already-active': byVerdict('already-active').length,
    skipped: byVerdict('skipped').length,
    unclickable: byVerdict('unclickable').length,
    unreached: byVerdict('unreached').length,
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
        r.verdict === 'none'
          ? '❌'
          : r.verdict === 'unclickable'
            ? '⚠️'
            : r.verdict === 'skipped' ||
              r.verdict === 'disabled' ||
              r.verdict === 'already-active' ||
              r.verdict === 'unreached'
              ? '⏭️'
              : '✅'
      console.log(`  ${mark} [${r.verdict}] ${r.label}${r.detail ? ` (${r.detail})` : ''}`)
    }
  }

  const deadButtons = byVerdict('none')
  if (deadButtons.length > 0) {
    console.log('\n❌ 假按钮（点击后无任何可观察反应）：')
    for (const r of deadButtons) console.log(`  - [${r.page}] ${r.label}`)
  }
  const stuck = byVerdict('unclickable')
  if (stuck.length > 0) {
    console.log('\n❌ 点不下去（被遮挡/不稳定）：')
    for (const r of stuck) console.log(`  - [${r.page}] ${r.label}`)
  }
  const unreached = byVerdict('unreached')
  if (unreached.length > 0) {
    console.log(`\n⏭️ 没轮到（前面的按钮把界面换了，${unreached.length} 个，不算通过也不算失败）：`)
    for (const r of unreached) console.log(`  - [${r.page}] ${r.label}`)
  }
  console.log('\n完整报告已写入: ' + REPORT_PATH)

  // 量具自证：真要一个按钮都没点到，none=0 也会假绿，所以覆盖数必须站得住
  const reacted = summary.route + summary.dialog + summary.toast + summary.focus + summary.dom
  expect(reacted, `应有至少 40 个按钮被真点出反应（实测 ${reacted}）`).toBeGreaterThanOrEqual(40)
  expect(summary.total, '普查应至少覆盖 30 个按钮').toBeGreaterThan(30)
  // 硬门禁一：不许有按了没反应的按钮
  expect(deadButtons.map((r) => `[${r.page}] ${r.label}`), '存在假按钮').toEqual([])
  // 硬门禁二：不许有用户点不下去的按钮（disabled 与已按下态另计，不算点这里）
  expect(stuck.map((r) => `[${r.page}] ${r.label}`), '存在点不下去的按钮').toEqual([])
})
